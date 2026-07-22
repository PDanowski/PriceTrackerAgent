import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, getAccessToken } from './auth';
import { Product, GoogleSheetInfo, EmailSettings, AgentLog, ColorBadgeOption } from './types';
import { INITIAL_PRODUCTS } from './mockData';
import { getSecondsUntilNextNoonCET } from './utils/timeUtils';
import { Header } from './components/Header';
import { GoogleAuthBanner } from './components/GoogleAuthBanner';
import { AgentControlPanel } from './components/AgentControlPanel';
import { ProductCard } from './components/ProductCard';
import { AddProductModal } from './components/AddProductModal';
import { PriceHistoryModal } from './components/PriceHistoryModal';
import { GoogleSheetsPanel } from './components/GoogleSheetsPanel';
import { EmailAlertsPanel } from './components/EmailAlertsPanel';
import { AgentLogConsole } from './components/AgentLogConsole';
import { Sparkles, Bot, ShieldCheck, CheckCircle, RefreshCw } from 'lucide-react';

// Helper to record ONLY the lowest price observed on each calendar day
const recordDailyLowestPrice = (
  history: Array<{ timestamp: string; price: number }>,
  newPrice: number
): Array<{ timestamp: string; price: number }> => {
  const todayStr = new Date().toISOString().split('T')[0];
  const existingIndex = history.findIndex((item) => item.timestamp.split('T')[0] === todayStr);

  if (existingIndex >= 0) {
    const existing = history[existingIndex];
    if (newPrice < existing.price) {
      // Found a lower price today -> update today's recorded entry to this new minimum
      const updated = [...history];
      updated[existingIndex] = { timestamp: new Date().toISOString(), price: newPrice };
      return updated;
    }
    // Price today is higher or equal to today's recorded lowest price -> keep existing lower record
    return history;
  } else {
    // First price check of the day -> record this initial price for today
    return [...history, { timestamp: new Date().toISOString(), price: newPrice }].slice(-60);
  }
};

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // App Data state
  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('price_tracker_products');
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
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
  const [historyModalProduct, setHistoryModalProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColorBadge, setSelectedColorBadge] = useState('all');
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [checkingProductId, setCheckingProductId] = useState<string | null>(null);
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  // Schedule timer state (Default: Every 3 hours = 10800 seconds)
  const [scheduleInterval, setScheduleInterval] = useState('3hr');
  const [nextRunSeconds, setNextRunSeconds] = useState(10800);
  const timerRef = useRef<any>(null);

  // Persist products
  useEffect(() => {
    localStorage.setItem('price_tracker_products', JSON.stringify(products));
  }, [products]);

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

  // Countdown Timer for Auto Schedule
  useEffect(() => {
    if (scheduleInterval === 'manual') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const computeIntervalSecs = () => {
      if (scheduleInterval === 'daily_noon_cet') {
        return getSecondsUntilNextNoonCET();
      }
      return scheduleInterval === '15min'
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
    };

    setNextRunSeconds(computeIntervalSecs());

    timerRef.current = setInterval(() => {
      setNextRunSeconds((prev) => {
        if (prev <= 1) {
          runFullAgentCheck();
          return computeIntervalSecs();
        }
        return prev - 1;
      });
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
      }
    } catch (err: any) {
      addLog('error', 'Google Sign-in failed', err.message);
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

  // Run full price check agent loop
  const runFullAgentCheck = async () => {
    if (isAgentRunning) return;
    setIsAgentRunning(true);
    addLog('info', `Starting agent execution. Checking prices for ${products.length} product links...`);

    let priceDropsDetected: Array<{ title: string; oldPrice: number; newPrice: number; currency: string; url: string }> = [];
    const updatedProducts = [...products];

    for (let i = 0; i < updatedProducts.length; i++) {
      const prod = updatedProducts[i];
      try {
        addLog('info', `Extracting main product price for "${prod.title}"...`);
        const response = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: prod.url }),
        });

        if (response.ok) {
          const scraped = await response.json();
          const newPrice = scraped.price || prod.currentPrice;

          // Track ALL prices (calculate price drop percentage vs previous day / previous recorded price)
          const basePreviousPrice = prod.previousPrice || prod.currentPrice;
          const dropAmount = basePreviousPrice - newPrice;
          const dropPercent = basePreviousPrice > 0 ? (dropAmount / basePreviousPrice) * 100 : 0;

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
              `🔔 5%+ PRICE DROP DETECTED for "${prod.title}"! (-${dropPercent.toFixed(1)}%)`,
              `Previous Price: ${prod.currency}${basePreviousPrice.toFixed(2)} ➔ New Price: ${prod.currency}${newPrice.toFixed(2)} (${dropPercent.toFixed(1)}% reduction)`
            );
          } else if (newPrice < basePreviousPrice) {
            addLog(
              'info',
              `Tracked price update for "${prod.title}" (-${dropPercent.toFixed(1)}%)`,
              `Price decreased from ${prod.currency}${basePreviousPrice.toFixed(2)} to ${prod.currency}${newPrice.toFixed(2)}. (Below the ${emailSettings.minDropPercent || 5}% notification threshold, email notification withheld).`
            );
          } else {
            addLog(
              'info',
              `Recorded current price for "${prod.title}": ${prod.currency}${newPrice.toFixed(2)}`,
              `No price reduction detected.`
            );
          }

          // Record daily minimum price in history log
          const newHistory = recordDailyLowestPrice(prod.priceHistory || [], newPrice);

          updatedProducts[i] = {
            ...prod,
            title: scraped.title || prod.title,
            url: scraped.url || prod.url,
            imageUrl: scraped.imageUrl || prod.imageUrl,
            previousPrice: prod.currentPrice,
            currentPrice: newPrice,
            lowestPrice: Math.min(prod.lowestPrice, newPrice),
            inStock: scraped.inStock !== false,
            lastChecked: new Date().toISOString(),
            priceHistory: newHistory,
            status: meetsThreshold ? 'alert' : 'active',
          };
        }
      } catch (err: any) {
        addLog('error', `Error checking ${prod.title}: ${err.message}`);
      }
    }

    setProducts(updatedProducts);
    addLog('success', 'Completed tracking check across all product links');

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
      addLog('info', 'Gmail notification check:', `No product prices dropped by 5%+ during this run. No email dispatched.`);
    }

    setIsAgentRunning(false);
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
        const newPrice = scraped.price || prod.currentPrice;

        const updated = products.map((p) => {
          if (p.id === id) {
            const newHistory = recordDailyLowestPrice(p.priceHistory || [], newPrice);

            return {
              ...p,
              title: scraped.title || p.title,
              url: scraped.url || p.url,
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
  const handleUpdatePrice = (id: string, newPrice: number) => {
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
  const syncToGoogleSheet = async (spreadsheetId: string, currentProducts: Product[], accessToken: string) => {
    setIsSyncingSheet(true);
    addLog('info', 'Syncing latest prices to Google Sheet...');

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
        const err = await response.json();
        throw new Error(err.error || 'Sync failed');
      }

      setSheetInfo((prev) =>
        prev
          ? {
              ...prev,
              lastSynced: new Date().toISOString(),
              syncedRowCount: currentProducts.length,
            }
          : null
      );

      addLog('success', `Successfully synced ${currentProducts.length} items to Google Sheet!`);
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
    accessToken: string
  ) => {
    addLog('info', `Dispatching Gmail price drop notification to ${recipientEmail}...`);

    const rowsHtml = drops
      .map(
        (d) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px; font-weight: bold;"><a href="${d.url}" style="color: #059669; text-decoration: none;">${d.title}</a></td>
        <td style="padding: 10px; color: #64748b; text-decoration: line-through;">${d.currency}${d.oldPrice.toFixed(2)}</td>
        <td style="padding: 10px; color: #059669; font-weight: bold;">${d.currency}${d.newPrice.toFixed(2)}</td>
        <td style="padding: 10px; color: #0d9488; font-weight: bold;">-${((1 - d.newPrice / d.oldPrice) * 100).toFixed(1)}%</td>
      </tr>
    `
      )
      .join('');

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; rounded-radius: 12px; overflow: hidden;">
        <div style="background-color: #0f172a; padding: 20px; text-align: center; color: #ffffff;">
          <h2 style="margin: 0; font-size: 20px;">Price Drop Alert!</h2>
          <p style="margin: 5px 0 0 0; font-size: 13px; color: #94a3b8;">Product Price Tracker Agent Notice</p>
        </div>
        <div style="padding: 20px;">
          <p style="font-size: 14px; color: #334155;">The automated price tracker agent detected price drops on your monitored items:</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; margin-top: 15px;">
            <thead>
              <tr style="background-color: #f8fafc; color: #475569;">
                <th style="padding: 8px;">Product</th>
                <th style="padding: 8px;">Was</th>
                <th style="padding: 8px;">Now</th>
                <th style="padding: 8px;">Save</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 25px;">Tracked automatically by Product Price Tracker Agent.</p>
        </div>
      </div>
    `;

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
        const err = await response.json();
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
  const handleAddProduct = (newProd: Omit<Product, 'id' | 'priceHistory' | 'status'>) => {
    const created: Product = {
      ...newProd,
      id: `prod-${Date.now()}`,
      status: 'active',
      priceHistory: [{ timestamp: new Date().toISOString(), price: newProd.currentPrice }],
    };

    setProducts((prev) => [created, ...prev]);
    addLog('success', `Added new product link: "${created.title}"`, `Initial Price: ${created.currentPrice.toFixed(2)} ${created.currency}`);
  };

  // Delete product
  const handleDeleteProduct = (id: string) => {
    const target = products.find((p) => p.id === id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    if (target) {
      addLog('info', `Usunięto produkt z listy: "${target.title}"`);
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
          onRunAgent={runFullAgentCheck}
          isRunning={isAgentRunning}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedColorBadge={selectedColorBadge}
          onColorBadgeChange={setSelectedColorBadge}
          scheduleInterval={scheduleInterval}
          onScheduleChange={setScheduleInterval}
          nextRunSeconds={nextRunSeconds}
        />

        {/* Integration Hub (Google Sheets & Gmail Panels) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <GoogleSheetsPanel
            sheetInfo={sheetInfo}
            onCreateSheet={handleCreateGoogleSheet}
            onSyncSheet={async () => {
              const tok = token || (await getAccessToken());
              if (sheetInfo && tok) await syncToGoogleSheet(sheetInfo.id, products, tok);
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
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
            >
              Add Product Link
            </button>
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
