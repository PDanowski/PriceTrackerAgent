import { scrapeProductDetails } from './scraper';
import {
  state,
  ServerProduct,
  AgentServerState,
  saveState,
  addServerLog,
  computeNextRunTime,
  recordDailyLowestPrice,
  getPreviousDayPrice,
} from './agentTaskState';

export * from './agentTaskState';

// Perform full automated price check on server
export async function runServerAgentCheck(): Promise<AgentServerState> {
  if (state.isRunning) return state;
  state.isRunning = true;
  state.lastRunTime = new Date().toISOString();
  addServerLog('info', 'Automated server agent execution started with controlled concurrency (4 parallel workers)...');

  const priceDropsToSend: Array<{ title: string; oldPrice: number; newPrice: number; currency: string; url: string }> = [];
  const productsToProcess = [...state.products];
  const updatedProductsMap = new Map<number, ServerProduct>();

  const CONCURRENCY_LIMIT = 4;
  let nextProductIndex = 0;

  const worker = async () => {
    while (nextProductIndex < productsToProcess.length) {
      const idx = nextProductIndex++;
      const product = productsToProcess[idx];

      try {
        addServerLog('info', `Background scraping product [${idx + 1}/${productsToProcess.length}]: ${product.title}...`);
        const scraped = await scrapeProductDetails(product.url);

        if (scraped.price && scraped.price > 0) {
          const currentP = scraped.price;
          const lowestP = Math.min(product.lowestPrice || currentP, currentP);
          const highestP = Math.max(product.highestPrice || currentP, currentP);

          const newHistory = recordDailyLowestPrice(product.priceHistory || [], currentP);
          const prevP = getPreviousDayPrice(newHistory) ?? product.previousPrice;

          if (state.emailSettings?.enabled && state.emailSettings?.recipientEmail) {
            const dropPercent = prevP !== null && prevP > 0 ? ((prevP - currentP) / prevP) * 100 : 0;
            const minDropReq = state.emailSettings.minDropPercent || 5;

            const qualifiesDrop = prevP !== null && currentP < prevP && dropPercent >= minDropReq;
            const qualifiesTarget = product.targetPrice && currentP <= product.targetPrice;

            let triggerEmail = false;
            if (state.emailSettings.alertOnlyOnTargetHit) {
              if (qualifiesTarget) triggerEmail = true;
            } else if (state.emailSettings.alertOnPriceDrop) {
              if (qualifiesDrop || qualifiesTarget) triggerEmail = true;
            }

            if (triggerEmail && prevP !== null) {
              priceDropsToSend.push({
                title: scraped.title || product.title,
                oldPrice: prevP,
                newPrice: currentP,
                currency: scraped.currency || product.currency || 'zł',
                url: scraped.url || product.url,
              });
            }
          }

          updatedProductsMap.set(idx, {
            ...product,
            url: scraped.url || product.url,
            title: scraped.title || product.title,
            currentPrice: currentP,
            previousPrice: prevP,
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
          updatedProductsMap.set(idx, {
            ...product,
            scrapeWarning: scraped.scrapeWarning || 'Failed to read price',
          });
          addServerLog('warning', `Price check for "${product.title}" returned no price or needs manual entry.`);
        }
      } catch (err: any) {
        updatedProductsMap.set(idx, product);
        addServerLog('error', `Error checking product "${product.title}": ${err.message}`);
      }
    }
  };

  const activeWorkerCount = Math.min(CONCURRENCY_LIMIT, productsToProcess.length);
  await Promise.all(Array.from({ length: activeWorkerCount }, () => worker()));

  const updatedProducts: ServerProduct[] = productsToProcess.map((p, idx) => updatedProductsMap.get(idx) || p);
  state.products = updatedProducts;

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
  }, 10000);
}
