import React, { useState, useEffect, useRef } from 'react';
import { Product, CheckProgress, AgentLog } from '../types';
import { getSecondsUntilNextNoonCET } from '../utils/timeUtils';
import { recordDailyLowestPrice, getPreviousDayPrice } from '../utils/priceTrackerUtils';

export function usePriceChecker(
  products: Product[],
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>,
  sheetInfo: any,
  emailSettings: any,
  token: string | null
) {
  const [logs, setLogs] = useState<AgentLog[]>([
    {
      id: 'init-log',
      timestamp: new Date().toISOString(),
      type: 'info',
      message: 'Agent initialized & scheduled for 3-hour checks (recording daily lowest prices).',
      details: 'Isolating main product price, tracking history, recording daily minimums, and alerting when price drops by 5%+ vs previous day.',
    },
  ]);

  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const isAgentRunningRef = useRef(false);
  const [checkProgress, setCheckProgress] = useState<CheckProgress | null>(null);

  const [scheduleInterval, setScheduleInterval] = useState('3hr');
  const [nextRunSeconds, setNextRunSeconds] = useState(10800);
  const timerRef = useRef<any>(null);

  const addLog = (type: 'info' | 'success' | 'warning' | 'error', message: string, details?: string) => {
    const newLog: AgentLog = {
      id: Date.now().toString() + Math.random().toString().slice(2, 5),
      timestamp: new Date().toISOString(),
      type,
      message,
      details,
    };
    setLogs((prev) => [newLog, ...prev.slice(0, 79)]);
  };

  // Sync state with server
  const syncWithServer = async () => {
    if (isAgentRunningRef.current) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/agent/state', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        if (isAgentRunningRef.current) return;
        const serverState = await res.json();
        if (isAgentRunningRef.current) return;
        if (typeof serverState.isRunning === 'boolean' && !isAgentRunningRef.current) {
          setIsAgentRunning(serverState.isRunning);
          isAgentRunningRef.current = serverState.isRunning;
        }
        if (serverState.products && serverState.products.length > 0 && !isAgentRunningRef.current) {
          setProducts(serverState.products);
        }
        if (serverState.logs && serverState.logs.length > 0) {
          setLogs(serverState.logs);
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
    }
  };

  useEffect(() => {
    syncWithServer();
    const pollInterval = setInterval(syncWithServer, 10000);
    return () => clearInterval(pollInterval);
  }, []);

  const handleRunAgentCheck = async () => {
    if (isAgentRunningRef.current || products.length === 0) return;

    isAgentRunningRef.current = true;
    setIsAgentRunning(true);
    const totalCount = products.length;
    setCheckProgress({ current: 0, total: totalCount });
    addLog('info', `Starting parallel price check (4 processes) for ${totalCount} product(s)...`);

    let priceDropsDetected: Array<{ title: string; oldPrice: number; newPrice: number; currency: string; url: string }> = [];
    const updatedProducts: Product[] = [...products];
    const CONCURRENCY_LIMIT = 4;
    let nextProductIndex = 0;
    let completedCount = 0;

    const worker = async () => {
      while (nextProductIndex < totalCount) {
        const i = nextProductIndex++;
        const prod = updatedProducts[i];
        if (!prod) continue;

        const targetUrl = prod.url && prod.url.startsWith('http') ? prod.url : `https://${prod.url || ''}`;

        try {
          const res = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.price && data.price > 0) {
              const currentP = data.price;
              const lowestP = Math.min(prod.lowestPrice || currentP, currentP);
              const highestP = Math.max(prod.highestPrice || currentP, currentP);

              const newHistory = recordDailyLowestPrice(prod.priceHistory || [], currentP);
              const prevP = getPreviousDayPrice(newHistory) ?? prod.previousPrice;

              if (emailSettings.enabled && emailSettings.recipientEmail) {
                const dropPercent = prevP !== null && prevP > 0 ? ((prevP - currentP) / prevP) * 100 : 0;
                const minDropReq = emailSettings.minDropPercent || 5;

                const qualifiesDrop = prevP !== null && currentP < prevP && dropPercent >= minDropReq;
                const qualifiesTarget = prod.targetPrice && currentP <= prod.targetPrice;

                let triggerEmail = false;
                if (emailSettings.alertOnlyOnTargetHit) {
                  if (qualifiesTarget) triggerEmail = true;
                } else if (emailSettings.alertOnPriceDrop) {
                  if (qualifiesDrop || qualifiesTarget) triggerEmail = true;
                }

                if (triggerEmail && prevP !== null) {
                  priceDropsDetected.push({
                    title: data.title || prod.title,
                    oldPrice: prevP,
                    newPrice: currentP,
                    currency: data.currency || prod.currency || 'zł',
                    url: data.url || targetUrl,
                  });
                }
              }

              updatedProducts[i] = {
                ...prod,
                url: data.url || targetUrl,
                title: data.title || prod.title,
                currentPrice: currentP,
                previousPrice: prevP,
                lowestPrice: lowestP,
                highestPrice: highestP,
                currency: data.currency || prod.currency || 'zł',
                inStock: data.inStock !== undefined ? data.inStock : true,
                imageUrl: data.imageUrl || prod.imageUrl,
                lastChecked: new Date().toISOString(),
                needsManualPrice: data.needsManualPrice,
                scrapeWarning: data.scrapeWarning,
                priceHistory: newHistory,
                status: 'active',
              };

              addLog(
                'success',
                `Checked "${data.title || prod.title}": ${currentP} ${data.currency || 'zł'}${
                  data.fetchedFromCeneo ? ' (via Ceneo fallback)' : ''
                }`,
                data.scrapeWarning
              );
            } else {
              updatedProducts[i] = {
                ...prod,
                lastChecked: new Date().toISOString(),
                scrapeWarning: data.scrapeWarning || 'Unable to fetch current price',
                status: 'error',
              };
              addLog('warning', `Could not read price for "${prod.title}".`, data.scrapeWarning);
            }
          } else {
            updatedProducts[i] = {
              ...prod,
              lastChecked: new Date().toISOString(),
              scrapeWarning: 'Failed HTTP fetch',
              status: 'error',
            };
            addLog('error', `Failed to scrape "${prod.title}".`);
          }
        } catch (err: any) {
          updatedProducts[i] = {
            ...prod,
            lastChecked: new Date().toISOString(),
            scrapeWarning: err.message,
            status: 'error',
          };
          addLog('error', `Error checking "${prod.title}": ${err.message}`);
        } finally {
          completedCount++;
          setCheckProgress({
            current: completedCount,
            total: totalCount,
          });
        }
      }
    };

    const activeWorkerCount = Math.min(CONCURRENCY_LIMIT, totalCount);
    await Promise.all(Array.from({ length: activeWorkerCount }, () => worker()));

    setProducts(updatedProducts);

    addLog('success', `Completed parallel price checks for all ${totalCount} product(s).`);

    // Reset progress indicator
    setTimeout(() => {
      setCheckProgress(null);
    }, 1500);

    isAgentRunningRef.current = false;
    setIsAgentRunning(false);

    // Sync to server asynchronously
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
    }).catch((e) => console.warn('Failed to sync completed run to agent server:', e));
  };

  // Schedule Countdown timer effect
  useEffect(() => {
    if (scheduleInterval === 'manual') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setNextRunSeconds((prev) => {
        if (prev <= 1) {
          handleRunAgentCheck();
          return getInitialSeconds(scheduleInterval);
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [scheduleInterval, products]);

  const handleIntervalChange = (newInterval: string) => {
    setScheduleInterval(newInterval);
    const secs = getInitialSeconds(newInterval);
    setNextRunSeconds(secs);
    if (newInterval === 'manual') {
      addLog('info', 'Check schedule updated: Manual run only');
    } else {
      addLog('info', `Check schedule updated: Running automatically (${newInterval})`);
    }
  };

  return {
    logs,
    addLog,
    isAgentRunning,
    checkProgress,
    scheduleInterval,
    nextRunSeconds,
    handleRunAgentCheck,
    handleIntervalChange,
  };
}

function getInitialSeconds(interval: string): number {
  switch (interval) {
    case '15min': return 900;
    case '1hr': return 3600;
    case '3hr': return 10800;
    case '6hr': return 21600;
    case '12hr': return 43200;
    case '24hr': return 86400;
    case 'daily_noon_cet': return getSecondsUntilNextNoonCET();
    default: return 10800;
  }
}
