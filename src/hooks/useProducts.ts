import { useState, useEffect } from 'react';
import { Product, ColorBadgeOption } from '../types';

export function useProducts(
  scheduleInterval: string,
  sheetInfo: any,
  emailSettings: any,
  token: string | null,
  addLog: (type: 'info' | 'success' | 'warning' | 'error', message: string, details?: string) => void
) {
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = localStorage.getItem('price_tracker_products');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved products:', e);
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('price_tracker_products', JSON.stringify(products));
    if (Array.isArray(products) && products.length > 0) {
      localStorage.setItem('price_tracker_products_backup', JSON.stringify(products));
    }
  }, [products]);

  const handleRestoreProducts = (newProducts: Product[]) => {
    setProducts(newProducts);
    localStorage.setItem('price_tracker_products', JSON.stringify(newProducts));
    localStorage.setItem('price_tracker_products_backup', JSON.stringify(newProducts));
    addLog('success', `Restored product list (${newProducts.length} items)`);

    fetch('/api/agent/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: newProducts,
        scheduleInterval,
        sheetInfo,
        emailSettings,
        googleToken: token,
      }),
    }).catch((e) => console.warn('Failed to sync restored products to agent server:', e));
  };

  const handleAddProduct = (productData: Omit<Product, 'id' | 'lastChecked' | 'priceHistory' | 'lowestPrice' | 'previousPrice' | 'status'>) => {
    const initialPrice = productData.currentPrice;
    const nowIso = new Date().toISOString();
    const newProduct: Product = {
      ...productData,
      id: Date.now().toString(),
      lowestPrice: initialPrice,
      highestPrice: initialPrice,
      previousPrice: null,
      lastChecked: nowIso,
      status: 'active',
      priceHistory: [
        {
          timestamp: nowIso,
          price: initialPrice,
        },
      ],
    };

    setProducts((prev) => [newProduct, ...prev]);
    addLog('info', `Added new product: "${newProduct.title}"`, `URL: ${newProduct.url}`);
  };

  const handleDeleteProduct = (id: string) => {
    const productToDelete = products.find((p) => p.id === id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    if (productToDelete) {
      addLog('info', `Removed product: "${productToDelete.title}"`);
    }
  };

  const handleSetTargetPrice = (id: string, targetPrice?: number) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, targetPrice } : p))
    );
    const prod = products.find((p) => p.id === id);
    if (prod) {
      addLog('info', `Updated target price for "${prod.title}" to ${targetPrice ? `${targetPrice} ${prod.currency}` : 'None'}`);
    }
  };

  const handleUpdateBadgeColor = (id: string, colorBadge?: ColorBadgeOption) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, colorBadge } : p))
    );
  };

  const handleManualPriceOverride = (id: string, newPrice: number) => {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id === id) {
          const nowIso = new Date().toISOString();
          const lowestP = Math.min(p.lowestPrice || newPrice, newPrice);
          const highestP = Math.max(p.highestPrice || newPrice, newPrice);
          const newHistory = [...(p.priceHistory || []), { timestamp: nowIso, price: newPrice }].slice(-60);

          return {
            ...p,
            currentPrice: newPrice,
            lowestPrice: lowestP,
            highestPrice: highestP,
            previousPrice: p.currentPrice,
            lastChecked: nowIso,
            needsManualPrice: false,
            scrapeWarning: undefined,
            priceHistory: newHistory,
          };
        }
        return p;
      })
    );
    const prod = products.find((p) => p.id === id);
    if (prod) {
      addLog('success', `Manually updated price for "${prod.title}" to ${newPrice} ${prod.currency}`);
    }
  };

  return {
    products,
    setProducts,
    handleRestoreProducts,
    handleAddProduct,
    handleDeleteProduct,
    handleSetTargetPrice,
    handleUpdateBadgeColor,
    handleManualPriceOverride,
  };
}
