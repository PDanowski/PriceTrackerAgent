import React, { useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, Trash2, Shield, Sparkles } from 'lucide-react';
import { AgentLog } from '../types';

interface AgentLogConsoleProps {
  logs: AgentLog[];
  onClearLogs: () => void;
}

export const AgentLogConsole: React.FC<AgentLogConsoleProps> = ({ logs, onClearLogs }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const getTypeStyle = (type: AgentLog['type']) => {
    switch (type) {
      case 'success':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/50';
      case 'warning':
        return 'text-amber-400 bg-amber-950/60 border-amber-800/50';
      case 'error':
        return 'text-rose-400 bg-rose-950/60 border-rose-800/50';
      default:
        return 'text-teal-300 bg-slate-800 border-slate-700';
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-lg mt-8 text-slate-200">
      {/* Console Header */}
      <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
          <div className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
          <span className="font-mono text-xs font-bold text-slate-300 ml-2 flex items-center space-x-1.5">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Agent Execution & Sync Terminal</span>
          </span>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono">
            {logs.length} events
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {logs.length > 0 && (
            <button
              onClick={onClearLogs}
              className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors text-xs font-mono"
              title="Clear Terminal Logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition-colors"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Terminal Content */}
      {isExpanded && (
        <div className="p-4 font-mono text-xs max-h-60 overflow-y-auto space-y-2 bg-slate-950/90">
          {logs.length === 0 ? (
            <div className="text-slate-500 italic py-3 text-center">
              Agent execution log empty. Click "Run Agent Price Check" to trigger live scraping, Google Sheets sync, and Gmail alerts.
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex items-start space-x-2.5 leading-relaxed border-b border-slate-900/80 pb-1.5">
                <span className="text-slate-500 text-[10px] flex-shrink-0 pt-0.5">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>

                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase border ${getTypeStyle(log.type)}`}>
                  {log.type}
                </span>

                <div className="flex-1 min-w-0">
                  <span className="text-slate-200">{log.message}</span>
                  {log.details && (
                    <span className="block text-[11px] text-slate-400 mt-0.5 whitespace-pre-wrap">
                      {log.details}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
