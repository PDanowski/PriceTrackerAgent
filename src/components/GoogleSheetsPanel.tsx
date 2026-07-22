import React, { useState } from 'react';
import { FileSpreadsheet as SheetIcon, RefreshCw, ExternalLink, PlusCircle, CheckCircle2, AlertCircle, HardDrive } from 'lucide-react';
import { GoogleSheetInfo } from '../types';

interface GoogleSheetsPanelProps {
  sheetInfo: GoogleSheetInfo | null;
  onCreateSheet: () => Promise<void>;
  onSyncSheet: () => Promise<void>;
  onSelectExistingSheet: (sheetId: string, title: string, url: string) => void;
  onToggleAutoSync: (enabled: boolean) => void;
  isSyncing: boolean;
  isCreating: boolean;
  userTokenAvailable: boolean;
  onPromptSignIn: () => void;
}

export const GoogleSheetsPanel: React.FC<GoogleSheetsPanelProps> = ({
  sheetInfo,
  onCreateSheet,
  onSyncSheet,
  onSelectExistingSheet,
  onToggleAutoSync,
  isSyncing,
  isCreating,
  userTokenAvailable,
  onPromptSignIn,
}) => {
  const [driveSheets, setDriveSheets] = useState<Array<{ id: string; name: string; webViewLink: string }>>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [showDriveDropdown, setShowDriveDropdown] = useState(false);

  const handleFetchDriveSheets = async () => {
    if (!userTokenAvailable) {
      onPromptSignIn();
      return;
    }
    setIsLoadingDrive(true);
    try {
      const response = await fetch('/api/sheets/list');
      if (response.ok) {
        const data = await response.json();
        setDriveSheets(data.files || []);
        setShowDriveDropdown(true);
      }
    } catch (err) {
      console.error('Failed to load drive sheets:', err);
    } finally {
      setIsLoadingDrive(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2.5">
          <div className="p-2.5 bg-emerald-100 text-emerald-800 rounded-xl">
            <SheetIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Google Sheets Live Sync</h3>
            <p className="text-xs text-slate-500">Automatically update product prices in your spreadsheet</p>
          </div>
        </div>

        {sheetInfo && (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Connected</span>
          </span>
        )}
      </div>

      {!userTokenAvailable ? (
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 text-center space-y-3">
          <p className="text-xs text-slate-600">
            Connect your Google Account to automatically publish and sync price logs to Google Sheets.
          </p>
          <button
            onClick={onPromptSignIn}
            className="inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2 rounded-xl transition-all cursor-pointer"
          >
            <span>Sign in with Google</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sheetInfo ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{sheetInfo.name}</h4>
                  <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate max-w-xs">ID: {sheetInfo.id}</p>
                </div>
                <a
                  href={sheetInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-200 transition-colors"
                >
                  <span>Open Sheet</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/60">
                <span className="text-slate-500">
                  Last Synced:{' '}
                  <strong className="text-slate-700">
                    {sheetInfo.lastSynced ? new Date(sheetInfo.lastSynced).toLocaleTimeString() : 'Never'}
                  </strong>
                </span>
                <span className="text-slate-500">
                  Synced Rows: <strong className="text-slate-700">{sheetInfo.syncedRowCount}</strong>
                </span>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                <label className="inline-flex items-center space-x-2 text-xs text-slate-700 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sheetInfo.autoSync}
                    onChange={(e) => onToggleAutoSync(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                  />
                  <span>Auto-sync on price check</span>
                </label>

                <button
                  onClick={onSyncSheet}
                  disabled={isSyncing}
                  className="inline-flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-3.5 py-1.5 rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={onCreateSheet}
                disabled={isCreating}
                className="flex flex-col items-center justify-center p-4 bg-emerald-50/50 hover:bg-emerald-50 border border-emerald-200 border-dashed rounded-xl transition-all cursor-pointer text-center group"
              >
                <PlusCircle className="w-6 h-6 text-emerald-600 mb-2 group-hover:scale-110 transition-transform" />
                <span className="text-xs font-bold text-emerald-900">Create New Price Sheet</span>
                <span className="text-[11px] text-emerald-700 mt-0.5">1-click automated setup</span>
              </button>

              <button
                onClick={handleFetchDriveSheets}
                disabled={isLoadingDrive}
                className="flex flex-col items-center justify-center p-4 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 border-dashed rounded-xl transition-all cursor-pointer text-center group"
              >
                <RefreshCw className={`w-6 h-6 text-slate-600 mb-2 group-hover:scale-110 transition-transform ${isLoadingDrive ? 'animate-spin' : ''}`} />
                <span className="text-xs font-bold text-slate-800">Select Existing Drive Sheet</span>
                <span className="text-[11px] text-slate-500 mt-0.5">Browse your Google Drive</span>
              </button>
            </div>
          )}

          {/* Drive Sheets Selector dropdown */}
          {showDriveDropdown && driveSheets.length > 0 && (
            <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <span className="text-xs font-semibold text-slate-700 block">Select a Google Sheet from Drive:</span>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {driveSheets.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onSelectExistingSheet(s.id, s.name, s.webViewLink);
                      setShowDriveDropdown(false);
                    }}
                    className="w-full text-left p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-xs font-medium text-slate-800 truncate flex items-center justify-between cursor-pointer"
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">Use</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
