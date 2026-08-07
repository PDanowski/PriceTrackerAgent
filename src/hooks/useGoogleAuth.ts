import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, getAccessToken, saveToken } from '../auth';
import { GoogleSheetInfo, EmailSettings } from '../types';

export function useGoogleAuth(
  addLog: (type: 'info' | 'success' | 'warning' | 'error', message: string, details?: string) => void
) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAuthInitializing, setIsAuthInitializing] = useState(true);

  const [sheetInfo, setSheetInfo] = useState<GoogleSheetInfo | null>(() => {
    const saved = localStorage.getItem('price_tracker_sheet');
    return saved ? JSON.parse(saved) : null;
  });

  const [emailSettings, setEmailSettings] = useState<EmailSettings>(() => {
    const saved = localStorage.getItem('price_tracker_email');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...parsed,
        minDropPercent: parsed.minDropPercent ?? 5,
      };
    }
    return {
      enabled: true,
      recipientEmail: '',
      alertOnPriceDrop: true,
      alertOnlyOnTargetHit: false,
      minDropPercent: 5,
      lastEmailSent: null,
    };
  });

  // Persist sheet info
  useEffect(() => {
    if (sheetInfo) {
      localStorage.setItem('price_tracker_sheet', JSON.stringify(sheetInfo));
    } else {
      localStorage.removeItem('price_tracker_sheet');
    }
  }, [sheetInfo]);

  // Persist email settings
  useEffect(() => {
    localStorage.setItem('price_tracker_email', JSON.stringify(emailSettings));
  }, [emailSettings]);

  // Init Firebase Auth
  useEffect(() => {
    let resolved = false;
    const unsub = initAuth((usr) => {
      setUser(usr);
      if (usr?.email && !emailSettings.recipientEmail) {
        setEmailSettings((prev) => ({ ...prev, recipientEmail: usr.email || '' }));
      }
      getAccessToken().then((t) => {
        setToken(t);
        setIsAuthInitializing(false);
        resolved = true;
      });
    });

    const fallbackTimeout = setTimeout(() => {
      if (!resolved) {
        setIsAuthInitializing(false);
      }
    }, 1500);

    return () => {
      unsub();
      clearTimeout(fallbackTimeout);
    };
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      setUser(res.user);
      setToken(res.accessToken);
      if (res.user?.email) {
        setEmailSettings((prev) => ({ ...prev, recipientEmail: res.user.email || '' }));
      }
      addLog('success', `Signed in as ${res.user.displayName || res.user.email}`);
    } catch (err: any) {
      addLog('error', `Sign in failed: ${err.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    saveToken(null);
    addLog('info', 'Signed out');
  };

  return {
    user,
    token,
    setToken,
    isLoggingIn,
    isAuthInitializing,
    sheetInfo,
    setSheetInfo,
    emailSettings,
    setEmailSettings,
    handleLogin,
    handleLogout,
  };
}
