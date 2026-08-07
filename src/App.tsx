import React, { useState } from 'react';
import { Product, ColorBadgeOption } from './types';
import { getAccessToken } from './auth';
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
import { useGoogleAuth } from './hooks/useGoogleAuth';
import { usePriceChecker } from './hooks/usePriceChecker';
import { useProducts } from './hooks/useProducts';
import { useProductFilter } from './hooks/useProductFilter';

export default function App() {
  const {
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
  } = useGoogleAuth((type, message, details) => {
    addLog(type, message, details);
  });

  const [products, setProducts] = useState<Product[]>(() => {
    try {
      const saved = localStorage.getItem('price_tracker_products');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse saved products:', e);
    }
    return [];
  });

  const {
    logs,
    addLog,
    isAgentRunning,
    checkProgress,
    scheduleInterval,
    nextRunSeconds,
    handleRunAgentCheck,
    handleIntervalChange,
  } = usePriceChecker(products, setProducts, sheetInfo, emailSettings, token);

  const {
    handleRestoreProducts,
    handleAddProduct,
    handleDeleteProduct,
    handleSetTargetPrice,
    handleUpdateBadgeColor,
    handleManualPriceOverride,
  } = useProducts(scheduleInterval, sheetInfo, emailSettings, token, addLog);

  const {
    searchQuery,
    setSearchQuery,
    selectedColorBadge,
    setSelectedColorBadge,
    filteredProducts,
  } = useProductFilter(products);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [historyModalProduct, setHistoryModalProduct] = useState<Product | null>(null);
  const [checkingProductId, setCheckingProductId] = useState<string | null>(null);
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);

  const handleCheckSingleProduct = async (id: string) => {
    const product = products.find((p) => p.id === id);
    if (!product) return;

    setCheckingProductId(id);
    addLog('info', `Checking current price for "${product.title}"...`);

    try {
      const targetUrl = product.url && product.url.startsWith('http') ? product.url : `https://${product.url || ''}`;
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.price && data.price > 0) {
          handleManualPriceOverride(id, data.price);
        } else {
          addLog('warning', `Could not read price for "${product.title}".`, data.scrapeWarning);
        }
      }
    } catch (err: any) {
      addLog('error', `Error checking "${product.title}": ${err.message}`);
    } finally {
      setCheckingProductId(null);
    }
  };

  const alertProductsCount = products.filter((p) => p.previousPrice !== null && p.currentPrice < p.previousPrice).length;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      <Header
        user={user}
        onSignIn={handleLogin}
        onSignOut={handleLogout}
        isLoggingIn={isLoggingIn}
        isAuthInitializing={isAuthInitializing}
        productCount={products.length}
        alertCount={alertProductsCount}
        sheetConnected={!!sheetInfo}
        emailEnabled={emailSettings.enabled}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!isAuthInitializing && !user && <GoogleAuthBanner onSignIn={handleLogin} isLoggingIn={isLoggingIn} />}

        <AgentControlPanel
          onRunAgent={handleRunAgentCheck}
          isRunning={isAgentRunning}
          isInitializing={isAuthInitializing}
          hasProducts={products.length > 0}
          checkProgress={checkProgress}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          onOpenBackupModal={() => setIsBackupModalOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedColorBadge={selectedColorBadge}
          onColorBadgeChange={setSelectedColorBadge}
          scheduleInterval={scheduleInterval}
          onScheduleChange={handleIntervalChange}
          nextRunSeconds={nextRunSeconds}
        />

        <CheckProgressBar progress={checkProgress} isRunning={isAgentRunning} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <GoogleSheetsPanel
            sheetInfo={sheetInfo}
            onCreateSheet={async () => {
              let tok = token || (await getAccessToken());
              if (!tok) {
                await handleLogin();
                tok = await getAccessToken();
              }
              if (!tok) return;

              setIsCreatingSheet(true);
              try {
                const res = await fetch('/api/sheets/create', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tok}`,
                  },
                  body: JSON.stringify({ products }),
                });

                if (res.ok) {
                  const data = await res.json();
                  setSheetInfo({
                    id: data.spreadsheetId,
                    name: data.title || 'Product Price Tracker',
                    url: data.spreadsheetUrl,
                    lastSynced: new Date().toISOString(),
                    autoSync: true,
                    syncedRowCount: products.length,
                  });
                  addLog('success', 'Created & connected new Google Sheet');
                }
              } catch (err: any) {
                addLog('error', 'Sheet creation error', err.message);
              } finally {
                setIsCreatingSheet(false);
              }
            }}
            onSyncSheet={async () => {
              let tok = token || (await getAccessToken());
              if (!tok) {
                await handleLogin();
                tok = await getAccessToken();
              }
              if (!tok || !sheetInfo) return;

              setIsSyncingSheet(true);
              try {
                const res = await fetch('/api/sheets/sync', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tok}`,
                  },
                  body: JSON.stringify({ spreadsheetId: sheetInfo.id, products }),
                });

                if (res.ok) {
                  setSheetInfo((prev) => (prev ? { ...prev, lastSynced: new Date().toISOString() } : null));
                  addLog('success', 'Synced products to Google Sheet');
                }
              } catch (err: any) {
                addLog('error', 'Sheet sync error', err.message);
              } finally {
                setIsSyncingSheet(false);
              }
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
              addLog('success', `Connected Google Sheet: ${name}`);
            }}
            onToggleAutoSync={(enabled) =>
              setSheetInfo((prev) => (prev ? { ...prev, autoSync: enabled } : null))
            }
            isSyncing={isSyncingSheet}
            isCreating={isCreatingSheet}
            userTokenAvailable={!!user || !!token}
            onPromptSignIn={handleLogin}
          />

          <EmailAlertsPanel
            settings={emailSettings}
            onUpdateSettings={(upd) => setEmailSettings((prev) => ({ ...prev, ...upd }))}
            onSendTestEmail={async (recipient) => {
              let tok = token || (await getAccessToken());
              if (!tok) {
                await handleLogin();
                tok = await getAccessToken();
              }
              if (!tok) return;

              setIsSendingTestEmail(true);
              try {
                const res = await fetch('/api/email/send', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${tok}`,
                  },
                  body: JSON.stringify({
                    recipientEmail: recipient,
                    subject: '🔔 Price Drop Alert Test',
                    htmlBody: '<p>Test email alert from Product Price Tracker Agent.</p>',
                  }),
                });

                if (res.ok) {
                  addLog('success', `Test email alert sent to ${recipient}`);
                }
              } catch (err: any) {
                addLog('error', 'Test email error', err.message);
              } finally {
                setIsSendingTestEmail(false);
              }
            }}
            isSendingTest={isSendingTestEmail}
            userTokenAvailable={!!user || !!token}
            userEmail={user?.email || undefined}
            onPromptSignIn={handleLogin}
          />
        </div>

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
                Add Product
              </button>
              <button
                onClick={() => setIsBackupModalOpen(true)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                Restore from Backup
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onCheckSinglePrice={handleCheckSingleProduct}
                onDeleteProduct={handleDeleteProduct}
                onOpenHistoryChart={(p) => setHistoryModalProduct(p)}
                onUpdateColorBadge={(id, colorBadge) => handleUpdateBadgeColor(id, colorBadge as ColorBadgeOption)}
                onUpdatePrice={(id, price) => handleManualPriceOverride(id, price)}
                isChecking={checkingProductId === product.id}
              />
            ))}
          </div>
        )}

        <AgentLogConsole logs={logs} onClearLogs={() => {}} />
      </main>

      <AddProductModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddProduct={handleAddProduct}
      />

      <PriceHistoryModal
        product={historyModalProduct}
        onClose={() => setHistoryModalProduct(null)}
      />

      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        products={products}
        onRestoreProducts={handleRestoreProducts}
      />

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
