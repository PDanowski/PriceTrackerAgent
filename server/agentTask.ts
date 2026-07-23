import fs from 'fs';
import path from 'path';
import { scrapeProductDetails } from './scraper';

export interface ServerProduct {
  id: string;
  title: string;
  url: string;
  currentPrice: number;
  previousPrice: number | null;
  lowestPrice: number;
  highestPrice: number;
  currency: string;
  inStock: boolean;
  imageUrl: string;
  category: string;
  targetPrice?: number;
  lastChecked: string;
  needsManualPrice?: boolean;
  scrapeWarning?: string;
  priceHistory: Array<{ timestamp: string; price: number }>;
  colorBadge?: string;
}

export interface AgentServerState {
  scheduleInterval: string; // '15min' | '1hr' | '3hr' | '6hr' | '12hr' | '24hr' | 'daily_noon_cet' | 'manual'
  lastRunTime: string | null;
  nextRunTime: string | null;
  isRunning: boolean;
  products: ServerProduct[];
  sheetInfo?: { spreadsheetId: string; title: string; url: string; lastSynced: string } | null;
  emailSettings?: {
    enabled: boolean;
    recipientEmail: string;
    alertOnPriceDrop: boolean;
    alertOnlyOnTargetHit: boolean;
    minDropPercent: number;
    lastEmailSent: string | null;
  };
  googleToken?: string | null;
  logs: Array<{
    id: string;
    timestamp: string;
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
    details?: string;
  }>;
}

const DATA_FILE = path.join(process.cwd(), 'agent_server_state.json');

// Default initial state
let state: AgentServerState = {
  scheduleInterval: '3hr',
  lastRunTime: null,
  nextRunTime: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
  isRunning: false,
  products: [],
  sheetInfo: null,
  emailSettings: {
    enabled: true,
    recipientEmail: '',
    alertOnPriceDrop: true,
    alertOnlyOnTargetHit: false,
    minDropPercent: 5,
    lastEmailSent: null,
  },
  googleToken: null,
  logs: [
    {
      id: 'server-init',
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'Server-side continuous background agent initialized.',
      details: 'Agent runs persistent checks in cloud server independently of browser open/close state.',
    },
  ],
};

// Load saved state from disk on startup if exists
function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
      console.log('Loaded persistent agent server state from disk.');
    }
  } catch (err) {
    console.warn('Failed to load agent server state from disk:', err);
  }
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save agent server state to disk:', err);
  }
}

loadState();

export function getAgentState(): AgentServerState {
  return state;
}

export function updateAgentConfig(partialState: Partial<AgentServerState>): AgentServerState {
  if (partialState.products) state.products = partialState.products;
  if (partialState.scheduleInterval) {
    const intervalChanged = state.scheduleInterval !== partialState.scheduleInterval;
    state.scheduleInterval = partialState.scheduleInterval;
    if (intervalChanged || !state.nextRunTime) {
      state.nextRunTime = computeNextRunTime(state.scheduleInterval);
    }
  }
  if (partialState.sheetInfo !== undefined) state.sheetInfo = partialState.sheetInfo;
  if (partialState.emailSettings) state.emailSettings = { ...state.emailSettings, ...partialState.emailSettings };
  if (partialState.googleToken !== undefined) state.googleToken = partialState.googleToken;

  saveState();
  return state;
}

export function addServerLog(type: 'info' | 'success' | 'warning' | 'error', message: string, details?: string) {
  const newLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
  };
  state.logs = [newLog, ...state.logs].slice(0, 80);
  saveState();
}

function getSecondsUntilNextNoonCET(): number {
  const now = new Date();
  const nowUtcMs = now.getTime();
  const targetCET = new Date(nowUtcMs);
  targetCET.setUTCHours(11, 0, 0, 0);

  if (targetCET.getTime() <= nowUtcMs) {
    targetCET.setUTCDate(targetCET.getUTCDate() + 1);
  }

  return Math.max(1, Math.floor((targetCET.getTime() - nowUtcMs) / 1000));
}

function computeNextRunTime(interval: string): string | null {
  if (interval === 'manual') return null;
  let secs = 10800; // default 3hr
  if (interval === '15min') secs = 900;
  else if (interval === '1hr') secs = 3600;
  else if (interval === '3hr') secs = 10800;
  else if (interval === '6hr') secs = 21600;
  else if (interval === '12hr') secs = 43200;
  else if (interval === '24hr') secs = 86400;
  else if (interval === 'daily_noon_cet') secs = getSecondsUntilNextNoonCET();

  return new Date(Date.now() + secs * 1000).toISOString();
}

// Record daily lowest price helper
function recordDailyLowestPrice(
  history: Array<{ timestamp: string; price: number }>,
  newPrice: number
): Array<{ timestamp: string; price: number }> {
  const todayStr = new Date().toISOString().split('T')[0];
  const existingIndex = history.findIndex((item) => item.timestamp.split('T')[0] === todayStr);

  if (existingIndex >= 0) {
    const existing = history[existingIndex];
    if (newPrice < existing.price) {
      const updated = [...history];
      updated[existingIndex] = { timestamp: new Date().toISOString(), price: newPrice };
      return updated;
    }
    return history;
  } else {
    return [...history, { timestamp: new Date().toISOString(), price: newPrice }].slice(-60);
  }
}

// Perform full automated price check on server
export async function runServerAgentCheck(): Promise<AgentServerState> {
  if (state.isRunning) return state;
  state.isRunning = true;
  state.lastRunTime = new Date().toISOString();
  addServerLog('info', 'Automated server agent execution started (background check)...');

  const priceDropsToSend: Array<{ title: string; oldPrice: number; newPrice: number; currency: string; url: string }> = [];
  const updatedProducts: ServerProduct[] = [];

  for (const product of state.products) {
    try {
      addServerLog('info', `Background scraping product: ${product.title}...`);
      const scraped = await scrapeProductDetails(product.url);

      if (scraped.price && scraped.price > 0) {
        const currentP = scraped.price;
        const prevP = product.currentPrice;
        const lowestP = Math.min(product.lowestPrice || currentP, currentP);
        const highestP = Math.max(product.highestPrice || currentP, currentP);

        const newHistory = recordDailyLowestPrice(product.priceHistory || [], currentP);

        // Check price drop alert thresholds
        if (state.emailSettings?.enabled && state.emailSettings?.recipientEmail) {
          const dropPercent = prevP > 0 ? ((prevP - currentP) / prevP) * 100 : 0;
          const minDropReq = state.emailSettings.minDropPercent || 5;

          const qualifiesDrop = currentP < prevP && dropPercent >= minDropReq;
          const qualifiesTarget = product.targetPrice && currentP <= product.targetPrice;

          let triggerEmail = false;
          if (state.emailSettings.alertOnlyOnTargetHit) {
            if (qualifiesTarget) triggerEmail = true;
          } else if (state.emailSettings.alertOnPriceDrop) {
            if (qualifiesDrop || qualifiesTarget) triggerEmail = true;
          }

          if (triggerEmail) {
            priceDropsToSend.push({
              title: scraped.title || product.title,
              oldPrice: prevP,
              newPrice: currentP,
              currency: scraped.currency || product.currency || 'zł',
              url: scraped.url || product.url,
            });
          }
        }

        updatedProducts.push({
          ...product,
          url: scraped.url || product.url,
          title: scraped.title || product.title,
          currentPrice: currentP,
          previousPrice: prevP !== currentP ? prevP : product.previousPrice,
          lowestPrice: lowestP,
          highestPrice: highestP,
          currency: scraped.currency || product.currency || 'zł',
          inStock: scraped.inStock !== undefined ? scraped.inStock : true,
          imageUrl: scraped.imageUrl || product.imageUrl,
          lastChecked: new Date().toISOString(),
          needsManualPrice: scraped.needsManualPrice,
          scrapeWarning: scraped.scrapeWarning,
          priceHistory: newHistory,
        });

        addServerLog(
          'success',
          `Scraped "${scraped.title || product.title}": ${currentP} ${scraped.currency || 'zł'}${
            scraped.fetchedFromCeneo ? ' (via Ceneo)' : ''
          }`
        );
      } else {
        updatedProducts.push({
          ...product,
          lastChecked: new Date().toISOString(),
          scrapeWarning: scraped.scrapeWarning || 'Failed to read price',
        });
        addServerLog('warning', `Price check for "${product.title}" returned no price or needs manual entry.`);
      }
    } catch (err: any) {
      updatedProducts.push(product);
      addServerLog('error', `Error checking product "${product.title}": ${err.message}`);
    }
  }

  state.products = updatedProducts;

  // Send email alerts if price drops detected
  if (priceDropsToSend.length > 0 && state.emailSettings?.enabled && state.emailSettings?.recipientEmail && state.googleToken) {
    try {
      addServerLog('info', `Sending email alert for ${priceDropsToSend.length} price drop(s) to ${state.emailSettings.recipientEmail}...`);

      const rowsHtml = priceDropsToSend
        .map(
          (d) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold;"><a href="${d.url}" style="color: #059669; text-decoration: none;">${d.title}</a></td>
          <td style="padding: 10px; color: #64748b; text-decoration: line-through;">${d.currency}${d.oldPrice.toFixed(2)}</td>
          <td style="padding: 10px; color: #059669; font-weight: bold;">${d.currency}${d.newPrice.toFixed(2)}</td>
          <td style="padding: 10px; color: #0d9488; font-weight: bold;">-${((1 - d.newPrice / d.oldPrice) * 100).toFixed(1)}%</td>
        </tr>
      `
        )
        .join('');

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #0f172a; padding: 20px; text-align: center; color: #ffffff;">
            <h2 style="margin: 0; font-size: 20px;">Price Drop Alert!</h2>
            <p style="margin: 5px 0 0 0; font-size: 13px; color: #94a3b8;">Product Price Tracker Agent Notice</p>
          </div>
          <div style="padding: 20px;">
            <p style="font-size: 14px; color: #334155;">The automated price tracker agent detected price drops on your monitored items:</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; margin-top: 15px;">
              <thead>
                <tr style="background-color: #f8fafc; color: #475569;">
                  <th style="padding: 8px;">Product</th>
                  <th style="padding: 8px;">Was</th>
                  <th style="padding: 8px;">Now</th>
                  <th style="padding: 8px;">Save</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 25px;">Tracked automatically by Product Price Tracker Agent.</p>
          </div>
        </div>
      `;

      const encodeMimeHeader = (text: string) => {
        if (/[^\x00-\x7F]/.test(text)) {
          return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
        }
        return text;
      };

      const rawMessage = [
        `To: ${state.emailSettings.recipientEmail}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${encodeMimeHeader(`[Price Alert] ${priceDropsToSend.length} item(s) dropped in price!`)}`,
        '',
        htmlBody,
      ].join('\r\n');

      const encodedMessage = Buffer.from(rawMessage, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const mailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: encodedMessage }),
      });

      if (mailRes.ok) {
        addServerLog('success', `Price drop alert email sent successfully to ${state.emailSettings.recipientEmail}.`);
        state.emailSettings.lastEmailSent = new Date().toISOString();
      } else {
        const errTxt = await mailRes.text();
        addServerLog('warning', `Failed to send email alert: ${errTxt}`);
      }
    } catch (e: any) {
      addServerLog('error', `Error sending alert email: ${e.message}`);
    }
  }

  // Auto-sync Google Sheets if connected
  if (state.sheetInfo?.spreadsheetId && state.googleToken) {
    try {
      addServerLog('info', `Syncing updated prices to Google Sheet (${state.sheetInfo.title})...`);
      const syncRes = await fetch(`http://localhost:3000/api/sheets/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.googleToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          spreadsheetId: state.sheetInfo.spreadsheetId,
          products: state.products,
        }),
      });

      if (syncRes.ok) {
        state.sheetInfo.lastSynced = new Date().toISOString();
        addServerLog('success', 'Google Sheet auto-synced successfully!');
      } else {
        const errText = await syncRes.text();
        addServerLog('warning', `Google Sheet auto-sync notice: ${errText}`);
      }
    } catch (err: any) {
      addServerLog('error', `Sheet sync error: ${err.message}`);
    }
  }

  state.isRunning = false;
  state.nextRunTime = computeNextRunTime(state.scheduleInterval);
  addServerLog('success', `Automated server check completed. Next run scheduled for: ${state.nextRunTime || 'Manual'}`);
  saveState();

  return state;
}

// Background Cron loop running every 10 seconds in Node.js server
let cronTimer: NodeJS.Timeout | null = null;

export function startServerBackgroundScheduler() {
  if (cronTimer) clearInterval(cronTimer);

  console.log('Starting server background agent scheduler (continuous 24/7 background mode)...');

  cronTimer = setInterval(async () => {
    if (state.scheduleInterval === 'manual' || state.isRunning) return;
    if (!state.nextRunTime) return;

    const now = Date.now();
    const nextMs = new Date(state.nextRunTime).getTime();

    if (now >= nextMs) {
      console.log('Server scheduler trigger time reached! Running background price check...');
      try {
        await runServerAgentCheck();
      } catch (err) {
        console.error('Error executing server background agent check:', err);
        state.isRunning = false;
      }
    }
  }, 10000); // Check schedule trigger condition every 10 seconds
}
