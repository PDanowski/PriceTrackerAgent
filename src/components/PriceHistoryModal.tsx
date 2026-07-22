import React from 'react';
import { Product } from '../types';
import { X, TrendingDown, Calendar, Award } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface PriceHistoryModalProps {
  product: Product | null;
  onClose: () => void;
}

export const PriceHistoryModal: React.FC<PriceHistoryModalProps> = ({ product, onClose }) => {
  if (!product) return null;

  const chartData = product.priceHistory.map((pt) => ({
    date: new Date(pt.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }),
    price: pt.price,
  }));

  const prices = product.priceHistory.map((p) => p.price);
  const minPrice = Math.min(...prices, product.currentPrice);
  const maxPrice = Math.max(...prices, product.currentPrice);

  const formatPrice = (val: number, curr: string) => {
    const formatted = val.toFixed(2).replace('.', ',');
    return curr === 'zł' || curr === 'PLN' ? `${formatted} zł` : `${curr}${val.toFixed(2)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-3">
            {product.imageUrl && (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="w-10 h-10 object-contain rounded-lg border border-slate-200 bg-white p-0.5"
                referrerPolicy="no-referrer"
              />
            )}
            <div>
              <h3 className="text-base font-bold text-slate-900 line-clamp-1">{product.title}</h3>
              <p className="text-xs text-slate-500">Historia i trendy zmian ceny</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
              <span className="text-[11px] font-medium text-slate-400 block mb-1">Aktualna cena</span>
              <span className="text-xl font-black text-slate-900">
                {formatPrice(product.currentPrice, product.currency)}
              </span>
            </div>

            <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-100">
              <span className="text-[11px] font-medium text-emerald-700 block mb-1">Najniższa w historii</span>
              <span className="text-xl font-black text-emerald-900">
                {formatPrice(minPrice, product.currency)}
              </span>
            </div>
          </div>

          {/* Recharts Line Chart */}
          <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(val) => `${val} zł`}
                />
                <Tooltip
                  formatter={(value: any) => [formatPrice(Number(value), product.currency), 'Cena']}
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#059669"
                  strokeWidth={3}
                  dot={{ r: 4, fill: '#059669', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>Zarejestrowano {product.priceHistory.length} dziennych minimów cenowych</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
