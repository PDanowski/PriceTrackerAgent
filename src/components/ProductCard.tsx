import React, { useState, useRef, useEffect } from 'react';
import { Product, COLOR_BADGES, ColorBadgeOption } from '../types';
import {
  ExternalLink,
  TrendingDown,
  TrendingUp,
  LineChart,
  RefreshCw,
  Trash2,
  Palette,
  Check,
  Edit2,
  X,
} from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onCheckSinglePrice: (id: string) => void;
  onDeleteProduct: (id: string) => void;
  onOpenHistoryChart: (product: Product) => void;
  onUpdateColorBadge?: (id: string, color: ColorBadgeOption | undefined) => void;
  onUpdatePrice?: (id: string, newPrice: number) => void;
  isChecking: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onCheckSinglePrice,
  onDeleteProduct,
  onOpenHistoryChart,
  onUpdateColorBadge,
  onUpdatePrice,
  isChecking,
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [editedPriceInput, setEditedPriceInput] = useState(product.currentPrice.toString());
  const pickerRef = useRef<HTMLDivElement>(null);

  const activeBadge = COLOR_BADGES.find((b) => b.id === product.colorBadge);

  const hasPriceDrop = product.previousPrice !== null && product.currentPrice < product.previousPrice;
  const priceDiff = product.previousPrice !== null ? product.currentPrice - product.previousPrice : 0;
  const priceDiffPercent =
    product.previousPrice && product.previousPrice > 0
      ? Math.abs((priceDiff / product.previousPrice) * 100).toFixed(1)
      : '0.0';

  const formatPrice = (val: number, curr: string) => {
    const formatted = val.toFixed(2).replace('.', ',');
    return curr === 'zł' || curr === 'PLN' ? `${formatted} zł` : `${curr}${val.toFixed(2)}`;
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      className={`bg-white rounded-2xl border transition-all duration-200 hover:shadow-md flex flex-col justify-between overflow-hidden ${
        hasPriceDrop
          ? 'border-emerald-400 ring-1 ring-emerald-400/20'
          : 'border-slate-200'
      }`}
    >
      <div className="p-4 sm:p-5">
        {/* Top bar with color badge selector & status */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className={`inline-flex items-center space-x-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                activeBadge
                  ? `${activeBadge.bgClass} ${activeBadge.textClass} ${activeBadge.borderClass}`
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
              }`}
              title="Zmień znacznik koloru"
            >
              <span className={`w-2 h-2 rounded-full ${activeBadge ? activeBadge.dotClass : 'bg-slate-300'}`} />
              <span>{activeBadge ? activeBadge.name : 'Brak znacznika'}</span>
              <Palette className="w-3 h-3 ml-0.5 opacity-60" />
            </button>

            {/* Color Badge Selector Popover */}
            {showColorPicker && (
              <div className="absolute left-0 top-full mt-1.5 z-20 w-48 bg-white rounded-xl border border-slate-200 shadow-xl p-2 animate-fadeIn">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 mb-1">
                  Wybierz znacznik koloru
                </div>
                <div className="grid grid-cols-1 gap-0.5">
                  <button
                    onClick={() => {
                      onUpdateColorBadge?.(product.id, undefined);
                      setShowColorPicker(false);
                    }}
                    className="flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full border border-slate-300 bg-slate-200" />
                      <span>Brak koloru</span>
                    </div>
                    {!product.colorBadge && <Check className="w-3.5 h-3.5 text-slate-600" />}
                  </button>

                  {COLOR_BADGES.map((badge) => (
                    <button
                      key={badge.id}
                      onClick={() => {
                        onUpdateColorBadge?.(product.id, badge.id);
                        setShowColorPicker(false);
                      }}
                      className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                        product.colorBadge === badge.id ? `${badge.bgClass} ${badge.textClass}` : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${badge.dotClass}`} />
                        <span>{badge.name}</span>
                      </div>
                      {product.colorBadge === badge.id && <Check className={`w-3.5 h-3.5 ${badge.textClass}`} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {hasPriceDrop && (
              <span className="inline-flex items-center space-x-1 text-[11px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                <TrendingDown className="w-3 h-3 text-emerald-600" />
                <span>Spadek ceny (-{priceDiffPercent}%)</span>
              </span>
            )}
            <span
              className={`inline-flex items-center space-x-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${
                product.inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${product.inStock ? 'bg-emerald-500' : 'bg-rose-500'}`}
              />
              <span>{product.inStock ? 'Dostępny' : 'Niedostępny'}</span>
            </span>
          </div>
        </div>

        {/* Product details & thumbnail */}
        <div className="flex gap-4">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-slate-100 border border-slate-200 flex-shrink-0 overflow-hidden flex items-center justify-center p-1">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="w-full h-full object-contain hover:scale-105 transition-transform"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="text-slate-400 text-xs text-center font-medium">Brak zdjęcia</div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900 leading-snug line-clamp-2 mb-1.5 hover:text-emerald-600 transition-colors">
              {product.title}
            </h3>

            <a
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium truncate max-w-full mb-3"
            >
              <span className="truncate">{new URL(product.url).hostname}</span>
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>

            {/* Price display & manual edit */}
            {isEditingPrice ? (
              <div className="flex items-center space-x-1.5 my-1 bg-amber-50 p-1.5 rounded-xl border border-amber-200">
                <input
                  type="number"
                  step="0.01"
                  value={editedPriceInput}
                  onChange={(e) => setEditedPriceInput(e.target.value)}
                  className="w-24 bg-white border border-amber-300 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <span className="text-xs font-bold text-slate-600">{product.currency}</span>
                <button
                  onClick={() => {
                    const parsed = parseFloat(editedPriceInput);
                    if (!isNaN(parsed) && parsed >= 0) {
                      onUpdatePrice?.(product.id, parsed);
                    }
                    setIsEditingPrice(false);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white p-1 rounded-lg text-xs font-semibold"
                  title="Zapisz cenę"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsEditingPrice(false)}
                  className="bg-slate-200 hover:bg-slate-300 text-slate-600 p-1 rounded-lg text-xs"
                  title="Anuluj"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-baseline space-x-2 flex-wrap">
                <span className="text-2xl font-black text-slate-900 tracking-tight">
                  {formatPrice(product.currentPrice, product.currency)}
                </span>

                <button
                  onClick={() => {
                    setEditedPriceInput(product.currentPrice.toString());
                    setIsEditingPrice(true);
                  }}
                  className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-slate-100 rounded transition-colors"
                  title="Edytuj cenę ręcznie"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>

                {product.previousPrice !== null && product.previousPrice !== product.currentPrice && (
                  <span className="text-xs text-slate-400 line-through font-medium">
                    {formatPrice(product.previousPrice, product.currency)}
                  </span>
                )}

                {hasPriceDrop && (
                  <span className="inline-flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                    <TrendingDown className="w-3.5 h-3.5 mr-0.5" />
                    -{priceDiffPercent}%
                  </span>
                )}

                {!hasPriceDrop && product.previousPrice !== null && product.currentPrice > product.previousPrice && (
                  <span className="inline-flex items-center text-xs font-semibold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                    <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
                    +{priceDiffPercent}%
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Lowest Recorded */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium">Najniższa w historii:</span>
          <span className="font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg">
            {formatPrice(product.lowestPrice, product.currency)}
          </span>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="bg-slate-50/80 px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
        <span className="text-slate-400 font-mono text-[10px]">
          Sprawdzono:{' '}
          {product.lastChecked ? new Date(product.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Nigdy'}
        </span>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => onOpenHistoryChart(product)}
            className="inline-flex items-center space-x-1 text-slate-600 hover:text-emerald-600 font-medium px-2 py-1 rounded hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Wykres historii ceny"
          >
            <LineChart className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Historia</span>
          </button>

          <button
            onClick={() => onCheckSinglePrice(product.id)}
            disabled={isChecking}
            className="inline-flex items-center space-x-1 text-slate-700 hover:text-emerald-600 font-medium px-2 py-1 rounded hover:bg-slate-200/60 transition-colors cursor-pointer disabled:opacity-50"
            title="Sprawdź cenę teraz"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-emerald-600' : ''}`} />
            <span>Sprawdź</span>
          </button>

          <button
            onClick={() => onDeleteProduct(product.id)}
            className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
            title="Usuń produkt z listy"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
