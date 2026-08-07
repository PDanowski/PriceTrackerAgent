import React from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { CheckProgress } from '../types';

interface CheckProgressBarProps {
  progress: CheckProgress | null;
  isRunning: boolean;
}

export const CheckProgressBar: React.FC<CheckProgressBarProps> = ({ progress, isRunning }) => {
  if (!isRunning || !progress || progress.total === 0) return null;

  const current = Math.min(progress.current, progress.total);
  const total = progress.total;
  const percent = Math.min(100, Math.round((current / total) * 100));

  return (
    <div className="bg-slate-900 text-white border border-slate-800 rounded-2xl p-4 sm:p-5 mb-6 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl animate-spin shrink-0">
            <Loader2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-sm text-slate-100">
                Price check in progress...
              </span>
              <span className="bg-emerald-500/20 text-emerald-300 text-xs font-mono font-bold px-2 py-0.5 rounded-md border border-emerald-500/30">
                {percent}%
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono text-emerald-400 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 shrink-0 self-start sm:self-auto">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            Checked <strong className="text-white font-bold">{current}</strong> of <strong className="text-white font-bold">{total}</strong> products
          </span>
        </div>
      </div>

      {/* Progress track */}
      <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden p-0.5 border border-slate-700/80 shadow-inner">
        <div
          className="bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 h-full rounded-full transition-all duration-300 ease-out shadow-sm"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
