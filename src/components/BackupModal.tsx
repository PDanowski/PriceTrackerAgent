import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Upload, ShieldCheck, CheckCircle2, AlertCircle, HardDriveDownload, Cloud, CloudUpload, CloudDownload, RefreshCw } from 'lucide-react';
import { Product } from '../types';
import { getAccessToken, googleSignIn } from '../auth';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onRestoreProducts: (products: Product[]) => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  products,
  onRestoreProducts,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isDriveSyncing, setIsDriveSyncing] = useState(false);
  const [driveLastBackupTime, setDriveLastBackupTime] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset status message & check status when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null);
      checkDriveStatus();
    }
  }, [isOpen]);

  const checkDriveStatus = async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/drive/status', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (data.modifiedTime) {
          setDriveLastBackupTime(new Date(data.modifiedTime).toLocaleString());
        }
      }
    } catch {
      // Ignore background status check error
    }
  };

  if (!isOpen) return null;

  // Export products as JSON file
  const handleExportJSON = () => {
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(products, null, 2));
      const downloadAnchor = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `price_tracker_backup_${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      setStatusMessage({
        type: 'success',
        text: `Backup file (${products.length} products) downloaded to local disk.`,
      });
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Error creating backup file.',
      });
    }
  };

  // Import JSON backup file
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        if (Array.isArray(parsed)) {
          onRestoreProducts(parsed);
          setStatusMessage({
            type: 'success',
            text: `Successfully restored ${parsed.length} products from JSON file!`,
          });
        } else {
          setStatusMessage({
            type: 'error',
            text: 'Invalid backup file. The file must contain a list of products.',
          });
        }
      } catch {
        setStatusMessage({
          type: 'error',
          text: 'Failed to read JSON file. Please ensure the file is valid.',
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Manual trigger Google Drive Backup
  const handleDriveBackup = async () => {
    setIsDriveSyncing(true);
    setStatusMessage(null);
    try {
      let token = await getAccessToken();
      if (!token) {
        const signResult = await googleSignIn();
        if (signResult?.accessToken) {
          token = signResult.accessToken;
        } else {
          setStatusMessage({
            type: 'error',
            text: 'Google Sign-In required to connect to Google Drive.',
          });
          setIsDriveSyncing(false);
          return;
        }
      }

      let response = await fetch('/api/drive/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ products, accessToken: token }),
      });

      if (response.status === 401) {
        const signResult = await googleSignIn();
        if (signResult?.accessToken) {
          token = signResult.accessToken;
          response = await fetch('/api/drive/backup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ products, accessToken: token }),
          });
        }
      }

      const data = await response.json();
      if (response.ok) {
        setDriveLastBackupTime(new Date().toLocaleString());
        setStatusMessage({
          type: 'success',
          text: `Backup saved successfully to Google Drive (${products.length} products)!`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || 'Failed to save backup to Google Drive.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Google Drive connection error',
      });
    } finally {
      setIsDriveSyncing(false);
    }
  };

  // Restore from Google Drive Backup
  const handleDriveRestore = async () => {
    setIsDriveSyncing(true);
    setStatusMessage(null);
    try {
      let token = await getAccessToken();
      if (!token) {
        const signResult = await googleSignIn();
        if (signResult?.accessToken) {
          token = signResult.accessToken;
        } else {
          setStatusMessage({
            type: 'error',
            text: 'Google Sign-In required to download backup from Google Drive.',
          });
          setIsDriveSyncing(false);
          return;
        }
      }

      let response = await fetch('/api/drive/restore', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        const signResult = await googleSignIn();
        if (signResult?.accessToken) {
          token = signResult.accessToken;
          response = await fetch('/api/drive/restore', {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }

      const data = await response.json();
      if (response.ok && Array.isArray(data.products)) {
        onRestoreProducts(data.products);
        setStatusMessage({
          type: 'success',
          text: `Restored ${data.products.length} products from Google Drive backup!`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || 'No backup file found on Google Drive.',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Error downloading backup from Google Drive',
      });
    } finally {
      setIsDriveSyncing(false);
    }
  };

  // Restore from Local Storage Auto-Backup
  const handleRestoreFromLocalAutoBackup = () => {
    try {
      const backupStr = localStorage.getItem('price_tracker_products_backup');
      if (backupStr) {
        const parsed = JSON.parse(backupStr);
        if (Array.isArray(parsed)) {
          onRestoreProducts(parsed);
          setStatusMessage({
            type: 'success',
            text: `Restored ${parsed.length} products from browser auto-backup!`,
          });
          return;
        }
      }
      setStatusMessage({
        type: 'error',
        text: 'No saved backup found in browser cache.',
      });
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'An error occurred while reading the automatic backup.',
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200/60 shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Backup & Restore</h2>
              <p className="text-xs text-slate-500">Automatic backup to Google Drive & local storage</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl text-xs flex items-center space-x-2.5 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Current Status */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-700">Currently Tracked Products</p>
              <p className="text-xs text-slate-500">{products.length} items</p>
            </div>
            <button
              type="button"
              onClick={handleExportJSON}
              className="inline-flex items-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-xs cursor-pointer border border-slate-200"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>JSON File</span>
            </button>
          </div>

          {/* Google Drive Auto-Sync Box */}
          <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Cloud className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-xs font-bold text-blue-900">Google Drive Auto-Backup</span>
              </div>
              {driveLastBackupTime && (
                <span className="text-[10px] text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-full font-medium">
                  Last: {driveLastBackupTime}
                </span>
              )}
            </div>
            <p className="text-[11px] text-blue-800/90 leading-relaxed">
              The application automatically synchronizes <code className="bg-blue-100 px-1 py-0.5 rounded text-blue-900">Price_Tracker_Products_Backup.json</code> to your Google Drive whenever products change.
            </p>
            <div className="flex items-center space-x-2 pt-1 flex-wrap gap-y-2">
              <button
                type="button"
                onClick={handleDriveBackup}
                disabled={isDriveSyncing}
                className="inline-flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-xs cursor-pointer"
              >
                {isDriveSyncing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                <span>Save to Google Drive now</span>
              </button>

              <button
                type="button"
                onClick={handleDriveRestore}
                disabled={isDriveSyncing}
                className="inline-flex items-center space-x-1.5 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer"
              >
                <CloudDownload className="w-3.5 h-3.5" />
                <span>Restore from Google Drive</span>
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 my-1" />

          <p className="text-xs font-semibold text-slate-700">Other restore options:</p>

          {/* Import JSON File */}
          <div className="flex items-center justify-between p-2.5 border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
            <div className="flex items-center space-x-2.5">
              <Upload className="w-4 h-4 text-teal-600 shrink-0" />
              <div>
                <p className="text-xs font-medium text-slate-800">Load backup from JSON file</p>
                <p className="text-[10px] text-slate-500">Import previously downloaded .json file</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0"
            >
              Select file
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>

          {/* Auto-backup Restore */}
          <div className="flex items-center justify-between p-2.5 border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
            <div className="flex items-center space-x-2.5">
              <HardDriveDownload className="w-4 h-4 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-medium text-slate-800">Restore from browser auto-backup</p>
                <p className="text-[10px] text-slate-500">Automatic restore point in browser cache</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRestoreFromLocalAutoBackup}
              className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0"
            >
              Restore
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50/80 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
