import fs from 'fs';
import path from 'path';
import { loadFirestoreState, saveFirestoreState } from './firebase';

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
  scheduleInterval: string;
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

export let state: AgentServerState = {
  scheduleInterval: '3hr',
  lastRunTime: null,
  nextRunTime: null,
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

async function initPersistentState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed, isRunning: false };
      if (!Array.isArray(state.products)) {
        state.products = [];
      }
      console.log('Loaded agent server state from local disk cache.');
    }
  } catch (err) {
    console.warn('Failed to load agent server state from disk:', err);
  }

  try {
    const firestoreData = await loadFirestoreState();
    if (firestoreData) {
      state = {
        ...state,
        ...firestoreData,
        isRunning: false,
        products: Array.isArray(firestoreData.products) ? firestoreData.products : (state.products || []),
        emailSettings: { ...state.emailSettings, ...(firestoreData.emailSettings || {}) },
        sheetInfo: firestoreData.sheetInfo !== undefined ? firestoreData.sheetInfo : state.sheetInfo,
        logs: Array.isArray(firestoreData.logs) && firestoreData.logs.length > 0 ? firestoreData.logs : state.logs,
      };
      if (!state.nextRunTime && state.scheduleInterval !== 'manual') {
        state.nextRunTime = computeNextRunTime(state.scheduleInterval);
      }
      console.log(`Firestore state synced into agent runtime with ${state.products.length} products. Next run: ${state.nextRunTime || 'Manual'}`);
    } else {
      if (!state.nextRunTime && state.scheduleInterval !== 'manual') {
        state.nextRunTime = computeNextRunTime(state.scheduleInterval);
      }
      saveFirestoreState(state);
    }
  } catch (err) {
    console.warn('Error syncing with Firestore on boot:', err);
    if (!state.nextRunTime && state.scheduleInterval !== 'manual') {
      state.nextRunTime = computeNextRunTime(state.scheduleInterval);
    }
  }
}

export function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Failed to save agent server state to disk:', err);
  }
  saveFirestoreState(state).catch((err) => console.warn('Background Firestore save failed:', err));
}

export const initStatePromise = initPersistentState();

export async function getAgentStateAsync(): Promise<AgentServerState> {
  await initStatePromise;
  if (!Array.isArray(state.products)) {
    state.products = [];
  }
  return state;
}

export function getAgentState(): AgentServerState {
  if (!Array.isArray(state.products)) {
    state.products = [];
  }
  return state;
}

export async function updateAgentConfig(partialState: Partial<AgentServerState>): Promise<AgentServerState> {
  await initStatePromise;
  if (Array.isArray(partialState.products)) {
    state.products = partialState.products;
  }
  if (partialState.scheduleInterval) {
    const intervalChanged = state.scheduleInterval !== partialState.scheduleInterval;
    state.scheduleInterval = partialState.scheduleInterval;
    if (intervalChanged || !state.nextRunTime) {
      state.nextRunTime = computeNextRunTime(state.scheduleInterval);
    }
  }
  if (partialState.nextRunTime !== undefined) {
    state.nextRunTime = partialState.nextRunTime;
  }
  if (partialState.lastRunTime !== undefined) {
    state.lastRunTime = partialState.lastRunTime;
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

export function getSecondsUntilNextNoonCET(): number {
  const now = new Date();
  const nowUtcMs = now.getTime();
  const targetCET = new Date(nowUtcMs);
  targetCET.setUTCHours(11, 0, 0, 0);

  if (targetCET.getTime() <= nowUtcMs) {
    targetCET.setUTCDate(targetCET.getUTCDate() + 1);
  }

  return Math.max(1, Math.floor((targetCET.getTime() - nowUtcMs) / 1000));
}

export function computeNextRunTime(interval: string): string | null {
  if (interval === 'manual') return null;
  let secs = 10800;
  if (interval === '15min') secs = 900;
  else if (interval === '1hr') secs = 3600;
  else if (interval === '3hr') secs = 10800;
  else if (interval === '6hr') secs = 21600;
  else if (interval === '12hr') secs = 43200;
  else if (interval === '24hr') secs = 86400;
  else if (interval === 'daily_noon_cet') secs = getSecondsUntilNextNoonCET();

  return new Date(Date.now() + secs * 1000).toISOString();
}

export function recordDailyLowestPrice(
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

export function getPreviousDayPrice(
  history: Array<{ timestamp: string; price: number }>,
  referenceDateStr?: string
): number | null {
  if (!history || history.length === 0) return null;
  const targetDateStr = referenceDateStr
    ? referenceDateStr.split('T')[0]
    : new Date().toISOString().split('T')[0];

  const previousDayEntries = history.filter((item) => {
    const itemDateStr = item.timestamp.split('T')[0];
    return itemDateStr < targetDateStr;
  });

  if (previousDayEntries.length === 0) return null;
  return previousDayEntries[previousDayEntries.length - 1].price;
}
