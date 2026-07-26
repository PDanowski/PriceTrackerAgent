import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, getAccessToken, saveToken } from './auth';
import { Product, GoogleSheetInfo, EmailSettings, AgentLog, ColorBadgeOption, CheckProgress } from './types';
import { INITIAL_PRODUCTS } from './mockData';
import { getSecondsUntilNextNoonCET } from './utils/timeUtils';
import { recordDailyLowestPrice, buildPriceDropEmailHtml } from './utils/priceTrackerUtils';
import { Header } from './components/Header';
import { GoogleAuthBanner } from './components/GoogleAuthBanner';
import { AgentControlPanel } from './components/AgentControlPanel';
import { CheckProgressBar } from './components/CheckProgressBar';
import { ProductCard } from './components/ProductCard';
import { AddProductModal } from './components/AddProductModal';
import { PriceHistoryModal } from './components/PriceHistoryModal';
import { BackupModal } from './components/BackupModal';
import { GoogleSheetsPanel } from './components/GoogleSheetsPanel';
import { EmailAlertsPanel } from './components/EmailAlertsPanel';
import { AgentLogConsole } from './components/AgentLogConsole';
import { Bot } from 'lucide-react';

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // App Data state
  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = localStorage.getItem('price_tracker_products');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved products:', e);
    }
    return [];
  });

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

  const [logs, setLogs] = useState<AgentLog[]>([
    {
      id: 'init-log',
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'Agent initialized & scheduled for 3-hour checks (recording daily lowest prices).',
      details: 'Isolating main product price, tracking history, recording daily minimums, and alerting when price drops by 5%+ vs previous day.',
    },
  ]);

  // Modal & UI states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [historyModalProduct, setHistoryModalProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColorBadge, setSelectedColorBadge] = useState('all');
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const isAgentRunningRef = useRef(false);
  const [checkProgress, setCheckProgress] = useState<CheckProgress | null>(null);
  const [checkingProductId, setCheckingProductId] = useState<string | null>(null);
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  // Schedule timer state (Default: Every 3 hours = 10800 seconds)
  const [scheduleInterval, setScheduleInterval] = useState('3hr');
  const [nextRunSeconds, setNextRunSeconds] = useState(10800);
  const timerRef = useRef<any>(null);

  // Persist products and maintain continuous auto-backup
  useEffect(() => {
    localStorage.setItem('price_tracker_products', JSON.stringify(products));
    if (Array.isArray(products) && products.length > 0) {
      localStorage.setItem('price_tracker_products_backup', JSON.stringify(products));
    }
  }, [products]);

  // Auto-backup to Google Drive whenever products are added, removed, or modified
  useEffect(() => {
    if (!products) return;
    const syncTimer = setTimeout(async () => {
      try {
        const accessToken = token || (await getAccessToken());
        if (accessToken) {
          const res = await fetch('/api/drive/backup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ products, accessToken }),
          });
          if (res.status === 401) {
            saveToken(null);
            setToken(null);
          }
        }
      } catch (err) {
        console.warn('Auto Google Drive backup background attempt:', err);
      }
    }, 1000);

    return () => clearTimeout(syncTimer);
  }, [products, token]);

  const handleRestoreProducts = (newProducts: Product[]) => {
    setProducts(newProducts);
    localStorage.setItem('price_tracker_products', JSON.stringify(newProducts));
    localStorage.setItem('price_tracker_products_backup', JSON.stringify(newProducts));
    addLog('success', `Przywrócono listę produktów (${newProducts.length} pozycji)`);

    // Immediately push to agent server to prevent background state sync from overwriting restored products
    fetch('/api/agent/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: newProducts,
        scheduleInterval,
        sheetInfo,
        emailSettings,
        googleToken: token,
      }),
    }).catch((e) => console.warn('Failed to sync restored products to agent server:', e));

    // Also trigger Google Drive backup if token available
    getAccessToken().then((accessToken) => {
      if (accessToken) {
        fetch('/api/drive/backup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ products: newProducts, accessToken }),
        }).catch((e) => console.warn('Drive backup after restore failed:', e));
      }
    });
  };

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

  // Push latest configuration to continuous background agent server
  useEffect(() => {
    if (isAgentRunningRef.current) return;
    fetch('/api/agent/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products,
        scheduleInterval,
        sheetInfo,
        emailSettings,
        googleToken: token,
      }),
    }).catch((e) => console.warn('Failed to sync agent config to server:', e));
  }, [products, scheduleInterval, sheetInfo, emailSettings, token]);

  // Init Firebase Auth
  useEffect(() => {
    initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
        if (!emailSettings.recipientEmail && currentUser.email) {
          setEmailSettings((prev) => ({ ...prev, recipientEmail: currentUser.email || '' }));
        }
      },
      () => {
        setUser(null);
        setToken(null);
      }
    );
  }, []);

  const targetRunTimeRef = useRef<number>(Date.now() + 10800 * 1000);

  // Sync state with server
  const syncWithServer = async () => {
    if (isAgentRunningRef.current) return;
    try {
      const res = await fetch('/api/agent/state');
      if (res.ok) {
        const serverState = await res.json();
        if (serverState.products && serverState.products.length > 0) {
          setProducts(serverState.products);
        }
        if (serverState.logs && serverState.logs.length > 0) {
          setLogs(serverState.logs);
        }
        if (serverState.nextRunTime) {
          const targetMs = new Date(serverState.nextRunTime).getTime();
          if (targetMs > Date.now()) {
            targetRunTimeRef.current = targetMs;
            const remSecs = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
            setNextRunSeconds(remSecs);
          }
        }
        if (serverState.scheduleInterval) {
          setScheduleInterval(serverState.scheduleInterval);
        }
      }
    } catch (e) {
      console.warn('Failed to sync state from agent server:', e);
    }
  };

  // Persistent Web Worker Heartbeat Ping & tab recovery listener
  useEffect(() => {
    syncWithServer();

    const handleTabWakeup = () => {
      if (document.visibilityState === 'visible') {
        syncWithServer();
      }
    };

    // Standard interval backup
    const heartbeatInterval = setInterval(() => {
      syncWithServer();
    }, 45000);

    // Dedicated Web Worker thread for persistent background heartbeat pings (unthrottled by browser tab backgrounding)
    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (timer) clearInterval(timer);
            timer = setInterval(() => {
              postMessage('ping');
            }, 30000);
          } else if (e.data === 'stop') {
            if (timer) clearInterval(timer);
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      workerUrl = URL.createObjectURL(blob);
      worker = new Worker(workerUrl);
      worker.onmessage = (e) => {
        if (e.data === 'ping') {
          syncWithServer();
        }
      };
      worker.postMessage('start');
    } catch (err) {
      console.warn('Web worker initialization skipped:', err);
    }

    document.addEventListener('visibilitychange', handleTabWakeup);
    window.addEventListener('focus', handleTabWakeup);

    return () => {
      if (worker) {
        worker.postMessage('stop');
        worker.terminate();
      }
      if (workerUrl) {
        URL.revokeObjectURL(workerUrl);
      }
      clearInterval(heartbeatInterval);
      document.removeEventListener('visibilitychange', handleTabWakeup);
      window.removeEventListener('focus', handleTabWakeup);
    };
  }, []);

  // Wall-Clock Countdown Timer for Auto Schedule
  useEffect(() => {
    if (scheduleInterval === 'manual') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const computeTargetMs = () => {
      let secs = 10800;
      if (scheduleInterval === 'daily_noon_cet') {
        secs = getSecondsUntilNextNoonCET();
      } else {
        secs = scheduleInterval === '15min'
          ? 900
          : scheduleInterval === '1hr'
          ? 3600
          : scheduleInterval === '3hr'
          ? 10800
          : scheduleInterval === '6hr'
          ? 21600
          : scheduleInterval === '12hr'
          ? 43200
          : 86400;
      }
      return Date.now() + secs * 1000;
    };

    if (!targetRunTimeRef.current || targetRunTimeRef.current <= Date.now()) {
      targetRunTimeRef.current = computeTargetMs();
    }

    timerRef.current = setInterval(() => {
      if (isAgentRunningRef.current) return;

      const remainingSecs = Math.max(0, Math.ceil((targetRunTimeRef.current - Date.now()) / 1000));
      setNextRunSeconds(remainingSecs);

      if (remainingSecs <= 0) {
        targetRunTimeRef.current = computeTargetMs();
        runServerAgentRun();
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [scheduleInterval]);

  const addLog = (type: AgentLog['type'], message: string, details?: string) => {
    const newLog: AgentLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      details,
    };
    setLogs((prev) => [newLog, ...prev.slice(0, 49)]);
  };

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        addLog('success', `Signed in as ${res.user.email}`, 'Google Workspace permissions granted.');
        if (!emailSettings.recipientEmail && res.user.email) {
          setEmailSettings((prev) => ({ ...prev, recipientEmail: res.user.email || '' }));
        }
        await fetch('/api/agent-task/sync-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ googleToken: res.accessToken }),
        });
      }
    } catch (err: any) {
      if (
        err?.code === 'auth/cancelled-popup-request' ||
        err?.code === 'auth/popup-closed-by-user' ||
        err?.message?.includes('cancelled-popup-request')
      ) {
        console.warn('Sign-in popup cancelled by user');
      } else {
        addLog('error', 'Google Sign-in failed', err.message || 'Unknown sign-in error');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setToken(null);
    addLog('info', 'Signed out from Google Account');
  };

  // Trigger agent check on server / client with progress tracking
  const runServerAgentRun = async () => {
    await runFullAgentCheck();
  };

  // Run full price check agent loop with progress bar updates
  const runFullAgentCheck = async () => {
    if (isAgentRunningRef.current) {
      console.warn('Agent check already in progress. Skipping duplicate run.');
      return;
    }
    if (!products || products.length === 0) {
      addLog('info', 'Brak produktów do sprawdzenia.');
      return;
    }

    isAgentRunningRef.current = true;
    setIsAgentRunning(true);
    const totalCount = products.length;
    setCheckProgress({ current: 0, total: totalCount, currentTitle: products[0]?.title });
    addLog('info', `Rozpoczynanie sprawdzania cen dla ${totalCount} produktów z listy...`);

    let priceDropsDetected: Array<{ title: string; oldPrice: number; newPrice: number; currency: string; url: string }> = [];
    const updatedProducts = [...products];

    try {
      for (let i = 0; i < updatedProducts.length; i++) {
        if (i > 0) {
          // Polite delay between product checks to prevent store rate limiting
          await new Promise((r) => setTimeout(r, 400));
        }

        const prod = updatedProducts[i];
        setCheckingProductId(prod.id);
        setCheckProgress({
          current: i,
          total: totalCount,
          currentTitle: prod.title,
        });

        try {
          addLog('info', `Sprawdzanie ceny [${i + 1}/${totalCount}]: "${prod.title}"...`);

          // 1-time auto-retry on scrape errors / timeouts with 12s per-attempt timeout
          let response: Response | null = null;
          for (let retry = 0; retry < 2; retry++) {
            if (retry > 0) {
              addLog('info', `Ponowna próba dla "${prod.title}" po krótkim opóźnieniu...`);
              await new Promise((r) => setTimeout(r, 1200));
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);
            try {
              const res = await fetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: prod.url }),
                signal: controller.signal,
              });
              if (res.ok) {
                response = res;
                break;
              }
            } catch (fetchErr: any) {
              if (retry === 1) throw fetchErr;
            } finally {
              clearTimeout(timeoutId);
            }
          }

          if (response && response.ok) {
            const scraped = await response.json();
            const newPrice = (scraped.price && scraped.price > 0) ? scraped.price : prod.currentPrice;

            // Compare against currentPrice right before this check
            const basePreviousPrice = prod.currentPrice;
            const isDrop = newPrice < basePreviousPrice;
            const dropAmount = isDrop ? basePreviousPrice - newPrice : 0;
            const dropPercent = (isDrop && basePreviousPrice > 0) ? (dropAmount / basePreviousPrice) * 100 : 0;

            // 5% Threshold rule enforcement for Gmail notification
            const meetsThreshold = dropPercent >= (emailSettings.minDropPercent || 5);

            if (meetsThreshold) {
              priceDropsDetected.push({
                title: prod.title,
                oldPrice: basePreviousPrice,
                newPrice,
                currency: prod.currency,
                url: prod.url,
              });
              addLog(
                'success',
                `🔔 OBNIŻKA CENY o ${dropPercent.toFixed(1)}% dla "${prod.title}"!`,
                `Poprzednia: ${prod.currency}${basePreviousPrice.toFixed(2)} ➔ Nowa: ${prod.currency}${newPrice.toFixed(2)}`
              );
            } else if (isDrop) {
              addLog(
                'info',
                `Zaktualizowano cenę dla "${prod.title}" (-${dropPercent.toFixed(1)}%)`,
                `Cena spadła z ${prod.currency}${basePreviousPrice.toFixed(2)} na ${prod.currency}${newPrice.toFixed(2)}.`
              );
            } else {
              addLog(
                'info',
                `Zarejestrowano cenę dla "${prod.title}": ${prod.currency}${newPrice.toFixed(2)}`
              );
            }

            // Record daily minimum price in history log
            const newHistory = recordDailyLowestPrice(prod.priceHistory || [], newPrice);

            const newPreviousPrice = newPrice !== prod.currentPrice ? prod.currentPrice : (prod.previousPrice ?? prod.currentPrice);

            updatedProducts[i] = {
              ...prod,
              title: (scraped.title && !scraped.title.includes('403') && !scraped.title.includes('Cloudflare')) ? scraped.title : prod.title,
              url: prod.url,
              imageUrl: scraped.imageUrl || prod.imageUrl,
              previousPrice: newPreviousPrice,
              currentPrice: newPrice,
              lowestPrice: Math.min(prod.lowestPrice, newPrice),
              inStock: scraped.inStock !== false,
              lastChecked: new Date().toISOString(),
              priceHistory: newHistory,
              status: meetsThreshold ? 'alert' : 'active',
            };

            // Live UI state update after each product
            setProducts([...updatedProducts]);
          } else {
            addLog('warning', `Nie udało się pobrać ceny dla "${prod.title}". Zachowano dotychczasową cenę.`);
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
            addLog('warning', `Przekroczono czas oczekiwania (12s) dla "${prod.title}". Pomijanie...`);
          } else {
            addLog('error', `Błąd podczas sprawdzania ${prod.title}: ${err.message}`);
          }
        } finally {
          setCheckProgress({
            current: i + 1,
            total: totalCount,
            currentTitle: prod.title,
          });
          setCheckingProductId(null);
        }
      }

      addLog('success', `Zakończono sprawdzanie cen dla wszystkich ${totalCount} produktów.`);

      // Sync updated products to server background agent
      fetch('/api/agent/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: updatedProducts,
          scheduleInterval,
          sheetInfo,
          emailSettings,
          googleToken: token,
        }),
      }).catch((e) => console.warn('Failed to sync updated products to server:', e));

      // Auto-sync Google Sheet with tracked prices
      const currentToken = token || (await getAccessToken());
      if (sheetInfo && sheetInfo.autoSync && currentToken) {
        await syncToGoogleSheet(sheetInfo.id, updatedProducts, currentToken);
      }

      // Auto-send Gmail notification ONLY when 5%+ price drops are present
      if (emailSettings.enabled && priceDropsDetected.length > 0 && currentToken) {
        const recipient = emailSettings.recipientEmail || user?.email;
        if (recipient) {
          await dispatchPriceDropEmail(recipient, priceDropsDetected, currentToken);
        }
      } else if (priceDropsDetected.length === 0) {
        addLog('info', 'Powiadomienie Gmail:', `Żaden produkt nie spadł o co najmniej 5% ceny. Brak wiadomości email.`);
      }
    } finally {
      isAgentRunningRef.current = false;
      setIsAgentRunning(false);
      setCheckProgress(null);
    }
  };

  // Check single product
  const checkSinglePrice = async (id: string) => {
    setCheckingProductId(id);
    const prod = products.find((p) => p.id === id);
    if (!prod) return;

    addLog('info', `Checking single product price: ${prod.title}`);
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: prod.url }),
      });

      if (response.ok) {
        const scraped = await response.json();
        const newPrice = (scraped.price && scraped.price > 0) ? scraped.price : prod.currentPrice;

        const updated = products.map((p) => {
          if (p.id === id) {
            const newHistory = recordDailyLowestPrice(p.priceHistory || [], newPrice);

            return {
              ...p,
              title: (scraped.title && !scraped.title.includes('403') && !scraped.title.includes('Cloudflare')) ? scraped.title : p.title,
              url: p.url,
              imageUrl: scraped.imageUrl || p.imageUrl,
              previousPrice: p.currentPrice !== newPrice ? p.currentPrice : p.previousPrice,
              currentPrice: newPrice,
              lowestPrice: Math.min(p.lowestPrice, newPrice),
              inStock: scraped.inStock !== false,
              lastChecked: new Date().toISOString(),
              priceHistory: newHistory,
              status: newPrice < p.currentPrice ? 'alert' : 'active',
            } as Product;
          }
          return p;
        });

        setProducts(updated);
        addLog('success', `Updated price for ${prod.title}: ${newPrice.toFixed(2)} ${prod.currency}`);

        // Trigger sheet sync if configured
        const currentToken = token || (await getAccessToken());
        if (sheetInfo && sheetInfo.autoSync && currentToken) {
          await syncToGoogleSheet(sheetInfo.id, updated, currentToken);
        }
      }
    } catch (err: any) {
      addLog('error', `Failed to update ${prod.title}: ${err.message}`);
    } finally {
      setCheckingProductId(null);
    }
  };

  // Handle updating a product's price manually
  const handleUpdatePrice = async (id: string, newPrice: number) => {
    const updated = products.map((p) => {
      if (p.id === id) {
        const newHistory = recordDailyLowestPrice(p.priceHistory || [], newPrice);
        return {
          ...p,
          previousPrice: p.currentPrice !== newPrice ? p.currentPrice : p.previousPrice,
          currentPrice: newPrice,
          lowestPrice: Math.min(p.lowestPrice, newPrice),
          lastChecked: new Date().toISOString(),
          priceHistory: newHistory,
        } as Product;
      }
      return p;
    });
    setProducts(updated);
    addLog('info', `Ręcznie zaktualizowano cenę produktu do ${newPrice.toFixed(2)} PLN`);

    const currentToken = token || (await getAccessToken());
    if (sheetInfo && sheetInfo.autoSync && currentToken) {
      await syncToGoogleSheet(sheetInfo.id, updated, currentToken);
    }
  };

  // Create Google Sheet
  const handleCreateGoogleSheet = async () => {
    let currentToken = token || (await getAccessToken());
    if (!currentToken) {
      await handleSignIn();
      currentToken = await getAccessToken();
      if (!currentToken) return;
    }

    setIsCreatingSheet(true);
    addLog('info', 'Creating new Google Sheet for Price Tracker Agent...');

    try {
      const response = await fetch('/api/sheets/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ title: 'Product Price Tracker Output' }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to create sheet');
      }

      const data = await response.json();
      const newSheet: GoogleSheetInfo = {
        id: data.spreadsheetId,
        name: data.title,
        url: data.url,
        lastSynced: new Date().toISOString(),
        autoSync: true,
        syncedRowCount: products.length,
      };

      setSheetInfo(newSheet);
      addLog('success', `Created Google Sheet! Spreadsheet ID: ${data.spreadsheetId}`);

      // Initial sync of rows
      await syncToGoogleSheet(data.spreadsheetId, products, currentToken);
    } catch (err: any) {
      addLog('error', 'Google Sheet creation failed', err.message);
    } finally {
      setIsCreatingSheet(false);
    }
  };

  // Sync to Google Sheet
  const syncToGoogleSheet = async (
    spreadsheetId: string,
    currentProducts: Product[],
    accessToken: string,
    allowAutoRetry = true
  ) => {
    setIsSyncingSheet(true);
    addLog('info', `Syncing ${currentProducts.length} items to Google Sheet...`);

    try {
      const response = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          spreadsheetId,
          products: currentProducts,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Sync failed' }));
        if (response.status === 401) {
          setToken(null);
          localStorage.removeItem('google_access_token');
          localStorage.removeItem('google_access_token_expires_at');

          if (allowAutoRetry) {
            addLog('info', 'Google Access Token expired. Prompting automatic token renewal...');
            try {
              const res = await googleSignIn();
              if (res) {
                setUser(res.user);
                setToken(res.accessToken);
                // Sync state to server background task
                await fetch('/api/agent-task/sync-state', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ googleToken: res.accessToken }),
                });
                // Auto-retry sync with fresh token
                return await syncToGoogleSheet(spreadsheetId, currentProducts, res.accessToken, false);
              }
            } catch (reauthErr: any) {
              console.warn('Auto re-authentication skipped:', reauthErr);
            }
          }
          throw new Error('Google access token expired or invalid (401). Please click "Sync Now" to sign in again.');
        }
        throw new Error(err.error || `Sync failed with status ${response.status}`);
      }

      const resData = await response.json().catch(() => ({}));

      setSheetInfo((prev) =>
        prev
          ? {
              ...prev,
              lastSynced: new Date().toISOString(),
              syncedRowCount: currentProducts.length,
            }
          : null
      );

      addLog(
        'success',
        `Successfully synced ${currentProducts.length} product rows to tab "${resData.sheetTitle || 'Price Log'}" in Google Sheet!`
      );
    } catch (err: any) {
      addLog('error', 'Google Sheet sync error', err.message);
    } finally {
      setIsSyncingSheet(false);
    }
  };

  // Send Email Alert via Gmail
  const dispatchPriceDropEmail = async (
    recipientEmail: string,
    drops: Array<{ title: string; oldPrice: number; newPrice: number; currency: string; url: string }>,
    accessToken: string,
    allowAutoRetry = true
  ) => {
    addLog('info', `Dispatching Gmail price drop notification to ${recipientEmail}...`);

    const htmlBody = buildPriceDropEmailHtml(drops);

    try {
      const response = await fetch('/api/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          recipientEmail,
          subject: `🔔 Powiadomienie o obniżce ceny: ${drops.length} produkt(ów) z niższą ceną!`,
          htmlBody,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Failed to dispatch email' }));
        if (response.status === 401 || err.isTokenExpired) {
          setToken(null);
          localStorage.removeItem('google_access_token');
          localStorage.removeItem('google_access_token_expires_at');

          if (allowAutoRetry) {
            addLog('info', 'Google token expired during Gmail alert. Attempting automatic token renewal...');
            try {
              const res = await googleSignIn();
              if (res) {
                setUser(res.user);
                setToken(res.accessToken);
                return await dispatchPriceDropEmail(recipientEmail, drops, res.accessToken, false);
              }
            } catch (reauthErr: any) {
              console.warn('Auto re-authentication for Gmail skipped:', reauthErr);
            }
          }
          throw new Error('Google token expired. Sign in again to enable automated Gmail alerts.');
        }
        throw new Error(err.error || 'Failed to dispatch email');
      }

      setEmailSettings((prev) => ({ ...prev, lastEmailSent: new Date().toISOString() }));
      addLog('success', `Gmail alert sent to ${recipientEmail} for ${drops.length} item(s)!`);
    } catch (err: any) {
      addLog('error', 'Gmail alert dispatch error', err.message);
    }
  };

  // Test Email handler
  const handleSendTestEmail = async (recipient: string) => {
    let currentToken = token || (await getAccessToken());
    if (!currentToken) {
      await handleSignIn();
      currentToken = await getAccessToken();
      if (!currentToken) throw new Error('Google Sign-in required for Gmail');
    }

    setIsSendingTestEmail(true);
    try {
      const sampleDrop = [
        {
          title: products[0]?.title || 'Sony WH-1000XM5 Słuchawki Bezprzewodowe',
          oldPrice: 1599.00,
          newPrice: 1399.00,
          currency: 'zł',
          url: products[0]?.url || 'https://www.sony.pl',
        },
      ];
      await dispatchPriceDropEmail(recipient, sampleDrop, currentToken);
    } finally {
      setIsSendingTestEmail(false);
    }
  };

  // Add new product handler
  const handleAddProduct = async (newProd: Omit<Product, 'id' | 'priceHistory' | 'status'>) => {
    const created: Product = {
      ...newProd,
      id: `prod-${Date.now()}`,
      status: 'active',
      priceHistory: [{ timestamp: new Date().toISOString(), price: newProd.currentPrice }],
    };

    const updated = [created, ...products];
    setProducts(updated);
    addLog('success', `Added new product link: "${created.title}"`, `Initial Price: ${created.currentPrice.toFixed(2)} ${created.currency}`);

    const currentToken = token || (await getAccessToken());
    if (sheetInfo && sheetInfo.autoSync && currentToken) {
      await syncToGoogleSheet(sheetInfo.id, updated, currentToken);
    }
  };

  // Delete product
  const handleDeleteProduct = async (id: string) => {
    const target = products.find((p) => p.id === id);
    const updated = products.filter((p) => p.id !== id);
    setProducts(updated);
    if (target) {
      addLog('info', `Usunięto produkt z listy: "${target.title}"`);
    }

    const currentToken = token || (await getAccessToken());
    if (sheetInfo && sheetInfo.autoSync && currentToken) {
      await syncToGoogleSheet(sheetInfo.id, updated, currentToken);
    }
  };

  // Update product color badge
  const handleUpdateColorBadge = (id: string, colorBadge: ColorBadgeOption | undefined) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, colorBadge } : p))
    );
  };

  // Filtered products
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesColor =
      selectedColorBadge === 'all'
        ? true
        : selectedColorBadge === 'none'
        ? !p.colorBadge
        : p.colorBadge === selectedColorBadge;
    return matchesSearch && matchesColor;
  });

  const alertProductsCount = products.filter((p) => p.previousPrice !== null && p.currentPrice < p.previousPrice).length;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* Header Bar */}
      <Header
        user={user}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        isLoggingIn={isLoggingIn}
        productCount={products.length}
        alertCount={alertProductsCount}
        sheetConnected={!!sheetInfo}
        emailEnabled={emailSettings.enabled}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Google Auth Prompt Banner if not signed in */}
        {!user && <GoogleAuthBanner onSignIn={handleSignIn} isLoggingIn={isLoggingIn} />}

        {/* Top Control Panel */}
        <AgentControlPanel
          onRunAgent={runServerAgentRun}
          isRunning={isAgentRunning}
          checkProgress={checkProgress}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          onOpenBackupModal={() => setIsBackupModalOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedColorBadge={selectedColorBadge}
          onColorBadgeChange={setSelectedColorBadge}
          scheduleInterval={scheduleInterval}
          onScheduleChange={setScheduleInterval}
          nextRunSeconds={nextRunSeconds}
        />

        {/* Live Manual Price Check Progress Bar */}
        <CheckProgressBar progress={checkProgress} isRunning={isAgentRunning} />

        {/* Integration Hub (Google Sheets & Gmail Panels) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <GoogleSheetsPanel
            sheetInfo={sheetInfo}
            onCreateSheet={handleCreateGoogleSheet}
            onSyncSheet={async () => {
              let tok = token || (await getAccessToken());
              if (!tok) {
                addLog('info', 'Google Auth token required. Initiating Google sign-in...');
                try {
                  const res = await googleSignIn();
                  if (res) {
                    setUser(res.user);
                    setToken(res.accessToken);
                    tok = res.accessToken;
                  }
                } catch (err: any) {
                  addLog('error', 'Google Sign-in failed', err.message);
                  return;
                }
              }

              if (!tok) {
                addLog('error', 'Google Sheet sync cancelled', 'Google Access Token is required.');
                return;
              }

              if (!sheetInfo) {
                addLog('error', 'Google Sheet sync error', 'No Google Sheet connected. Create or connect a sheet first.');
                return;
              }

              await syncToGoogleSheet(sheetInfo.id, products, tok);
            }}
            onSelectExistingSheet={(id, name, url) => {
              setSheetInfo({
                id,
                name,
                url,
                lastSynced: new Date().toISOString(),
                autoSync: true,
                syncedRowCount: products.length,
              });
              addLog('success', `Connected existing Google Sheet: ${name}`);
            }}
            onToggleAutoSync={(enabled) =>
              setSheetInfo((prev) => (prev ? { ...prev, autoSync: enabled } : null))
            }
            isSyncing={isSyncingSheet}
            isCreating={isCreatingSheet}
            userTokenAvailable={!!user || !!token}
            onPromptSignIn={handleSignIn}
          />

          <EmailAlertsPanel
            settings={emailSettings}
            onUpdateSettings={(upd) => setEmailSettings((prev) => ({ ...prev, ...upd }))}
            onSendTestEmail={handleSendTestEmail}
            isSendingTest={isSendingTestEmail}
            userTokenAvailable={!!user || !!token}
            userEmail={user?.email || undefined}
            onPromptSignIn={handleSignIn}
          />
        </div>

        {/* Monitored Products Section */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Monitored Product Links</h2>
            <p className="text-xs text-slate-500">
              Showing {filteredProducts.length} of {products.length} items
            </p>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
          >
            <span>+ Add Product Link</span>
          </button>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm my-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <Bot className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-800">No product links found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
              Add your first online store product URL to start monitoring prices, syncing with Google Sheets, and receiving Gmail alerts.
            </p>
            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
              >
                Dodaj produkt
              </button>
              <button
                onClick={() => setIsBackupModalOpen(true)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                Przywróć z kopii zapasowej
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onCheckSinglePrice={checkSinglePrice}
                onDeleteProduct={handleDeleteProduct}
                onOpenHistoryChart={(p) => setHistoryModalProduct(p)}
                onUpdateColorBadge={handleUpdateColorBadge}
                onUpdatePrice={handleUpdatePrice}
                isChecking={checkingProductId === product.id}
              />
            ))}
          </div>
        )}

        {/* Live Terminal / Execution Logs Console */}
        <AgentLogConsole logs={logs} onClearLogs={() => setLogs([])} />
      </main>

      {/* Add Product Modal */}
      <AddProductModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddProduct={handleAddProduct}
      />

      {/* Recharts Price History Modal */}
      <PriceHistoryModal
        product={historyModalProduct}
        onClose={() => setHistoryModalProduct(null)}
      />

      {/* Backup and Restore Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        products={products}
        onRestoreProducts={handleRestoreProducts}
      />

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-400 py-6 mt-12 text-xs text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2">
            <Bot className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-slate-300">Product Price Tracker Agent</span>
          </div>
          <p className="text-slate-500">
            Powered by Gemini AI • Google Sheets API • Gmail API Integration
          </p>
        </div>
      </footer>
    </div>
  );
}
