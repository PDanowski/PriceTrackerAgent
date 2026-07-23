import React, { useState } from 'react';
import { X, Globe, Search, Tag, Loader2, Sparkles, CheckCircle2, Image as ImageIcon, Palette } from 'lucide-react';
import { Product, COLOR_BADGES, ColorBadgeOption } from '../types';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProduct: (product: Omit<Product, 'id' | 'priceHistory' | 'status'>) => void;
}

export const AddProductModal: React.FC<AddProductModalProps> = ({ isOpen, onClose, onAddProduct }) => {
  const [url, setUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState('');
  
  // Scraped preview state
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('zł');
  const [imageUrl, setImageUrl] = useState('');
  const [selectedColorBadge, setSelectedColorBadge] = useState<ColorBadgeOption | undefined>('blue');
  const [inStock, setInStock] = useState(true);
  const [hasScraped, setHasScraped] = useState(false);
  const [scrapeNotice, setScrapeNotice] = useState('');

  if (!isOpen) return null;

  const handleScrape = async () => {
    if (!url || !url.startsWith('http')) {
      setScrapeError('Wprowadź prawidłowy adres URL produktu (HTTP/HTTPS)');
      return;
    }

    setIsScraping(true);
    setScrapeError('');

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Nie udało się pobrać szczegółów produktu');
      }

      const data = await response.json();
      if (data.url) setUrl(data.url);
      setTitle(data.title || '');
      setPrice(data.price && data.price > 0 ? data.price.toString() : '');
      setCurrency(data.currency || 'zł');
      setImageUrl(data.imageUrl || '');
      setInStock(data.inStock !== false);
      setScrapeNotice(data.scrapeWarning || '');

      setHasScraped(true);
    } catch (err: any) {
      setScrapeError(err.message || 'Błąd pobierania danych z linku');
    } finally {
      setIsScraping(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const currentPriceNum = parseFloat(price) || 0;

    onAddProduct({
      title: title || 'Śledzony Produkt',
      url,
      currentPrice: currentPriceNum,
      previousPrice: null,
      lowestPrice: currentPriceNum,
      currency: currency || 'zł',
      imageUrl: imageUrl || undefined,
      inStock,
      lastChecked: new Date().toISOString(),
      colorBadge: selectedColorBadge,
    });

    // Reset & close
    setUrl('');
    setTitle('');
    setPrice('');
    setHasScraped(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Dodaj link do produktu</h3>
              <p className="text-xs text-slate-500">Wklej adres URL z dowolnego sklepu internetowego</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Step 1: URL input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Adres URL produktu</label>
            <div className="flex gap-2">
              <input
                type="url"
                required
                placeholder="https://www.sklep.pl/produkt/123"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={handleScrape}
                disabled={isScraping || !url}
                className="inline-flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
              >
                {isScraping ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Pobieranie...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Pobierz cenę</span>
                  </>
                )}
              </button>
            </div>
            {scrapeError && <p className="text-xs text-rose-600 mt-1.5 font-medium">{scrapeError}</p>}
          </div>

          {/* Scraped details preview form */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            {hasScraped && !scrapeNotice && (
              <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-3 flex items-center space-x-2 text-xs text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>Pobrano dane z linku! Możesz zweryfikować wartości poniżej.</span>
              </div>
            )}

            {scrapeNotice && (
              <div className="bg-amber-50 border border-amber-200/90 rounded-xl p-3 text-xs text-amber-900 leading-relaxed">
                <div className="font-semibold text-amber-900 mb-0.5 flex items-center space-x-1">
                  <span>Ochrona Anty-Bot Sklepu (np. Allegro)</span>
                </div>
                <span>{scrapeNotice}</span>
              </div>
            )}

            {/* Extracted Product Image Preview */}
            {imageUrl && (
              <div className="flex items-center space-x-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="w-14 h-14 bg-white border border-slate-200 rounded-lg p-1 flex-shrink-0 flex items-center justify-center overflow-hidden">
                  <img
                    src={imageUrl}
                    alt="Pobrany obraz"
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
                <div className="text-xs text-slate-600 overflow-hidden">
                  <span className="font-semibold text-slate-800 block">Pobrane zdjęcie produktu</span>
                  <span className="text-[11px] text-slate-400 truncate block">{imageUrl}</span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nazwa produktu</label>
              <input
                type="text"
                required
                placeholder="np. Słuchawki bezprzewodowe"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Aktualna cena</label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="np. 299.00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3.5 pr-10 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <span className="absolute right-3 text-xs font-bold text-slate-500">
                    {currency}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Znacznik koloru</label>
                <select
                  value={selectedColorBadge || ''}
                  onChange={(e) => setSelectedColorBadge((e.target.value as ColorBadgeOption) || undefined)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none"
                >
                  <option value="">Brak znacznika</option>
                  {COLOR_BADGES.map((badge) => (
                    <option key={badge.id} value={badge.id}>
                      {badge.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Adres zdjęcia (URL)</label>
              <input
                type="url"
                placeholder="https://..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none truncate"
              />
            </div>
          </div>

          {/* Footer buttons */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2 rounded-xl text-xs shadow-sm transition-all cursor-pointer"
            >
              Dodaj do agenta śledzącego
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
