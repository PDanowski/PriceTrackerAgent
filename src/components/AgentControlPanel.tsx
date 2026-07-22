import React from 'react';
import { Play, Plus, Clock, Search, Filter, RefreshCw, AlertTriangle, Palette } from 'lucide-react';
import { COLOR_BADGES } from '../types';

interface AgentControlPanelProps {
  onRunAgent: () => void;
  isRunning: boolean;
  onOpenAddModal: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedColorBadge: string;
  onColorBadgeChange: (color: string) => void;
  scheduleInterval: string;
  onScheduleChange: (interval: string) => void;
  nextRunSeconds: number;
}

export const AgentControlPanel: React.FC<AgentControlPanelProps> = ({
  onRunAgent,
  isRunning,
  onOpenAddModal,
  searchQuery,
  onSearchChange,
  selectedColorBadge,
  onColorBadgeChange,
  scheduleInterval,
  onScheduleChange,
  nextRunSeconds,
}) => {
  const formatTime = (totalSecs: number) => {
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    }
    return `${mins > 0 ? `${mins}m ` : ''}${secs}s`;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 mb-6 shadow-sm">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Main Agent Trigger */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onRunAgent}
            disabled={isRunning}
            className="inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2.5 rounded-xl shadow-sm hover:shadow transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed text-sm"
          >
            <Play className={`w-4 h-4 fill-white ${isRunning ? 'animate-bounce' : ''}`} />
            <span>{isRunning ? 'Uruchamianie sprawdzania...' : 'Uruchom sprawdzanie cen'}</span>
          </button>

          <button
            onClick={onOpenAddModal}
            className="inline-flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white font-medium px-4 py-2.5 rounded-xl shadow-sm transition-all cursor-pointer text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Dodaj link do produktu</span>
          </button>

          {/* Schedule selector */}
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs text-slate-700">
            <Clock className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-medium text-slate-500">Harmonogram:</span>
            <select
              value={scheduleInterval}
              onChange={(e) => onScheduleChange(e.target.value)}
              className="bg-transparent font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="3hr">Co 3 godziny (Domyślnie)</option>
              <option value="1hr">Co 1 godzinę</option>
              <option value="6hr">Co 6 godzin</option>
              <option value="12hr">Co 12 godzin</option>
              <option value="24hr">Co 24 godziny</option>
              <option value="15min">Co 15 minut (Demo)</option>
              <option value="daily_noon_cet">Codziennie o 12:00 (CET)</option>
              <option value="manual">Tylko ręczne uruchamianie</option>
            </select>
          </div>

          {scheduleInterval !== 'manual' && (
            <div className="text-xs text-slate-600 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1.5 rounded-xl font-mono flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Następne sprawdzenie za: <strong className="text-emerald-900">{formatTime(nextRunSeconds)}</strong></span>
            </div>
          )}
        </div>

        {/* Search & Color Filter */}
        <div className="flex items-center space-x-3 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Szukaj produktów..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div className="relative">
            <select
              value={selectedColorBadge}
              onChange={(e) => onColorBadgeChange(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
            >
              <option value="all">Wszystkie kolory</option>
              <option value="none">Bez znacznika</option>
              {COLOR_BADGES.map((badge) => (
                <option key={badge.id} value={badge.id}>
                  Kolor: {badge.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
