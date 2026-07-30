import { Product } from '../types';
import { recordDailyLowestPrice, getPreviousDayPrice } from './priceTrackerUtils';

export const PRODUCTS_STORAGE_KEY = 'price_tracker_products';
export const PRODUCTS_BACKUP_STORAGE_KEY = 'price_tracker_products_backup';

export function addProductToList(
  products: Product[],
  newProd: Omit<Product, 'id' | 'priceHistory' | 'status'>
): Product[] {
  const created: Product = {
    ...newProd,
    id: `prod-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    status: 'active',
    priceHistory: [{ timestamp: new Date().toISOString(), price: newProd.currentPrice }],
  };
  return [created, ...products];
}

export function removeProductFromList(products: Product[], id: string): Product[] {
  return products.filter((p) => p.id !== id);
}

export function updateProductPrice(
  products: Product[],
  id: string,
  scrapedData: {
    price: number;
    title?: string;
    imageUrl?: string;
    inStock?: boolean;
  }
): Product[] {
  return products.map((p) => {
    if (p.id !== id) return p;

    const newPrice = scrapedData.price > 0 ? scrapedData.price : p.currentPrice;
    const newHistory = recordDailyLowestPrice(p.priceHistory || [], newPrice);
    const prevDayPrice = getPreviousDayPrice(newHistory) ?? p.previousPrice;
    const validTitle =
      scrapedData.title &&
      !scrapedData.title.includes('403') &&
      !scrapedData.title.includes('Cloudflare')
        ? scrapedData.title
        : p.title;

    return {
      ...p,
      title: validTitle,
      imageUrl: scrapedData.imageUrl || p.imageUrl,
      previousPrice: prevDayPrice,
      currentPrice: newPrice,
      lowestPrice: Math.min(p.lowestPrice, newPrice),
      inStock: scrapedData.inStock !== false,
      lastChecked: new Date().toISOString(),
      priceHistory: newHistory,
      status: prevDayPrice !== null && newPrice < prevDayPrice ? 'alert' : 'active',
    };
  });
}

export function saveProductsToStorage(
  products: Product[],
  storage: Storage = typeof window !== 'undefined' ? window.localStorage : (null as any)
): void {
  if (!storage) return;
  const json = JSON.stringify(products);
  storage.setItem(PRODUCTS_STORAGE_KEY, json);
  storage.setItem(PRODUCTS_BACKUP_STORAGE_KEY, json);
}

export function loadProductsFromStorage(
  fallbackProducts: Product[],
  storage: Storage = typeof window !== 'undefined' ? window.localStorage : (null as any)
): Product[] {
  if (!storage) return fallbackProducts;
  try {
    const saved = storage.getItem(PRODUCTS_STORAGE_KEY) || storage.getItem(PRODUCTS_BACKUP_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse saved products from storage:', e);
  }
  return fallbackProducts;
}

export function buildGoogleSheetsRows(products: Product[]): (string | number)[][] {
  const header = ['Nazwa Produktu', 'Aktualna Cena (PLN)', 'Poprzednia Cena', 'Najniższa Cena', 'Waluta', 'Dostępność', 'Link', 'Ostatnie Sprawdzenie'];
  const rows = products.map((p) => [
    p.title,
    p.currentPrice,
    p.previousPrice !== null ? p.previousPrice : '-',
    p.lowestPrice,
    p.currency,
    p.inStock ? 'W magazynie' : 'Brak w magazynie',
    p.url,
    p.lastChecked ? new Date(p.lastChecked).toLocaleString('pl-PL') : 'Nigdy',
  ]);
  return [header, ...rows];
}
