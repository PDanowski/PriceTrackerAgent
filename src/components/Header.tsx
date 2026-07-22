import React from 'react';
import { Bot, RefreshCw, Layers, ShieldCheck, Mail, FileSpreadsheet as SheetIcon } from 'lucide-react';
import { User } from 'firebase/auth';

interface HeaderProps {
  user: User | null;
  onSignIn: () => void;
  onSignOut: () => void;
  isLoggingIn: boolean;
  productCount: number;
  alertCount: number;
  sheetConnected: boolean;
  emailEnabled: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onSignIn,
  onSignOut,
  isLoggingIn,
  productCount,
  alertCount,
  sheetConnected,
  emailEnabled,
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Logo & Title */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/40">
            <Bot className="w-6 h-6 text-slate-950 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-tight text-white">Price Tracker Agent</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                Active Agent
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Automated price checks • Google Sheets sync • Email alerts
            </p>
          </div>
        </div>

        {/* Live Badges */}
        <div className="hidden md:flex items-center space-x-3 text-xs">
          <div className="flex items-center space-x-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-300 font-medium">{productCount} Products</span>
          </div>

          <div className="flex items-center space-x-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60">
            <SheetIcon className={`w-3.5 h-3.5 ${sheetConnected ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className={sheetConnected ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
              {sheetConnected ? 'Sheets Synced' : 'Sheets Offline'}
            </span>
          </div>

          <div className="flex items-center space-x-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/60">
            <Mail className={`w-3.5 h-3.5 ${emailEnabled ? 'text-teal-400' : 'text-slate-500'}`} />
            <span className={emailEnabled ? 'text-teal-300 font-medium' : 'text-slate-400'}>
              {emailEnabled ? 'Email Active' : 'Email Off'}
            </span>
          </div>
        </div>

        {/* User Google Auth */}
        <div className="flex items-center space-x-3">
          {user ? (
            <div className="flex items-center space-x-2 bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-700">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || 'User'} className="w-6 h-6 rounded-full" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-teal-600 text-white flex items-center justify-center text-xs font-bold">
                  {(user.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="text-xs hidden sm:block">
                <p className="font-medium text-slate-200 leading-none">{user.displayName || 'Google User'}</p>
                <p className="text-[10px] text-slate-400 truncate max-w-[120px]">{user.email}</p>
              </div>
              <button
                onClick={onSignOut}
                className="text-xs text-slate-400 hover:text-rose-400 font-medium ml-1 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-700/50"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={onSignIn}
              disabled={isLoggingIn}
              className="inline-flex items-center space-x-2 bg-white text-slate-900 hover:bg-slate-100 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all border border-slate-200 cursor-pointer disabled:opacity-50"
            >
              {isLoggingIn ? (
                <RefreshCw className="w-4 h-4 animate-spin text-slate-600" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
              )}
              <span>{isLoggingIn ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
