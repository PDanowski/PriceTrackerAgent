export interface PriceHistoryPoint {
  timestamp: string; // ISO date or formatted date
  price: number;
}

export type ColorBadgeOption = 'blue' | 'emerald' | 'purple' | 'amber' | 'rose' | 'indigo' | 'cyan' | 'slate';

export interface ColorBadgeConfig {
  id: ColorBadgeOption;
  name: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  dotClass: string;
}

export const COLOR_BADGES: ColorBadgeConfig[] = [
  { id: 'blue', name: 'Niebieski', bgClass: 'bg-blue-50', textClass: 'text-blue-700', borderClass: 'border-blue-200', dotClass: 'bg-blue-500' },
  { id: 'emerald', name: 'Zielony', bgClass: 'bg-emerald-50', textClass: 'text-emerald-700', borderClass: 'border-emerald-200', dotClass: 'bg-emerald-500' },
  { id: 'purple', name: 'Fioletowy', bgClass: 'bg-purple-50', textClass: 'text-purple-700', borderClass: 'border-purple-200', dotClass: 'bg-purple-500' },
  { id: 'amber', name: 'Bursztynowy', bgClass: 'bg-amber-50', textClass: 'text-amber-700', borderClass: 'border-amber-200', dotClass: 'bg-amber-500' },
  { id: 'rose', name: 'Różowy', bgClass: 'bg-rose-50', textClass: 'text-rose-700', borderClass: 'border-rose-200', dotClass: 'bg-rose-500' },
  { id: 'indigo', name: 'Indygo', bgClass: 'bg-indigo-50', textClass: 'text-indigo-700', borderClass: 'border-indigo-200', dotClass: 'bg-indigo-500' },
  { id: 'cyan', name: 'Cyjan', bgClass: 'bg-cyan-50', textClass: 'text-cyan-700', borderClass: 'border-cyan-200', dotClass: 'bg-cyan-500' },
  { id: 'slate', name: 'Szary', bgClass: 'bg-slate-100', textClass: 'text-slate-700', borderClass: 'border-slate-200', dotClass: 'bg-slate-500' },
];

export interface Product {
  id: string;
  title: string;
  url: string;
  currentPrice: number;
  previousPrice: number | null;
  lowestPrice: number;
  currency: string;
  imageUrl?: string;
  inStock: boolean;
  lastChecked: string | null;
  priceHistory: PriceHistoryPoint[];
  colorBadge?: ColorBadgeOption;
  status: 'active' | 'checking' | 'error' | 'alert';
  lastError?: string;
}

export interface GoogleSheetInfo {
  id: string;
  name: string;
  url: string;
  lastSynced: string | null;
  autoSync: boolean;
  syncedRowCount: number;
}

export interface EmailSettings {
  enabled: boolean;
  recipientEmail: string;
  alertOnPriceDrop: boolean;
  minDropPercent: number; // e.g. 5 for 5% drop rule
  lastEmailSent: string | null;
}

export interface AgentLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  details?: string;
}

export interface ScrapeResult {
  title: string;
  price: number;
  currency: string;
  inStock: boolean;
  imageUrl?: string;
  rawText?: string;
}
