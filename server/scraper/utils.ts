import { GoogleGenAI } from '@google/genai';
import { UserAgentConfig } from './types';

// Initialize Gemini API client lazily if key is available
export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Helper to parse price strings safely with support for European (1.499,00 zł) and US (1,499.00 $) formats
export function parsePriceString(raw: string | number): number {
  if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
  if (!raw) return 0;

  let s = String(raw).trim();
  s = s.replace(/[^\d\,\.\s]/g, '').trim();
  if (!s) return 0;

  if (s.includes('.') && s.includes(',')) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/\,/g, '');
    }
  } else if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length === 2) {
      if (parts[1].length === 3 && parts[0].length <= 3 && !s.includes(' ')) {
        s = parts.join('');
      } else {
        s = parts[0].replace(/\s/g, '') + '.' + parts[1];
      }
    } else {
      s = s.replace(/\,/g, '');
    }
  } else if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length === 2) {
      if (parts[1].length === 3 && parts[0].length <= 3) {
        s = parts.join('');
      } else {
        s = parts[0].replace(/\s/g, '') + '.' + parts[1];
      }
    } else {
      s = s.replace(/\./g, '');
    }
  }

  s = s.replace(/\s/g, '');
  const val = parseFloat(s);
  return isNaN(val) ? 0 : val;
}

// Helper to extract SKU / Article Code from product URL
export function extractSkuFromUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const matchAdidas = u.pathname.match(/\/([A-Za-z0-9]{5,12})\.html?/i);
    if (matchAdidas && matchAdidas[1] && !/^(product|index|item|details|shop|catalog)$/i.test(matchAdidas[1])) {
      return matchAdidas[1].toUpperCase();
    }
    const matchAsin = u.pathname.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})/i);
    if (matchAsin && matchAsin[1]) {
      return matchAsin[1].toUpperCase();
    }
    const skuParam = u.searchParams.get('sku') || u.searchParams.get('article') || u.searchParams.get('pid') || u.searchParams.get('item');
    if (skuParam && skuParam.length >= 4) {
      return skuParam.toUpperCase();
    }
  } catch {}
  return null;
}

// Helper to extract clean human-readable title from URL path slug
export function cleanTitleFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('ceneo.pl')) {
      if (u.pathname.includes('szukaj-')) {
        const queryPart = u.pathname.split('szukaj-')[1] || '';
        return decodeURIComponent(queryPart.replace(/\.htm$/i, '').replace(/\+/g, ' ')).trim();
      }
      const lastSeg = u.pathname.split('/').filter(Boolean).pop() || '';
      const cleaned = lastSeg
        .replace(/-p\d+\.htm$/i, '')
        .replace(/\.htm$/i, '')
        .replace(/[-_]/g, ' ')
        .replace(/\d{7,}$/g, '')
        .trim();
      if (cleaned && cleaned.length > 2 && !/^\d+$/.test(cleaned)) {
        return cleaned.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
      }
    }

    if (u.hostname.includes('amazon.')) {
      const segs = u.pathname.split('/').filter(Boolean);
      const dpIdx = segs.findIndex((s) => s === 'dp' || s === 'product' || s === 'gp');
      if (dpIdx > 0 && !segs[dpIdx - 1].startsWith('-') && segs[dpIdx - 1].length > 2) {
        const rawSlug = segs[dpIdx - 1];
        const cleanedSlug = decodeURIComponent(rawSlug)
          .replace(/ref=.*$/i, '')
          .replace(/[-_]/g, ' ')
          .trim();
        if (cleanedSlug && cleanedSlug.length > 2 && !/^[A-Z0-9]{10}$/i.test(cleanedSlug)) {
          return cleanedSlug.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
        }
      }
    }

    if (u.hostname.includes('adidas.')) {
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs.length >= 2) {
        const titleSeg = segs[segs.length - 2];
        const lastSeg = segs[segs.length - 1].replace(/\.html?$/i, '');
        const cleaned = decodeURIComponent(titleSeg)
          .replace(/[-_]/g, ' ')
          .trim();
        if (cleaned && cleaned.length > 2 && !/^\d+$/.test(cleaned)) {
          const formatted = cleaned.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
          if (lastSeg && /^[A-Z0-9]{4,10}$/i.test(lastSeg) && !formatted.toUpperCase().includes(lastSeg.toUpperCase())) {
            return `${formatted} ${lastSeg.toUpperCase()}`;
          }
          return formatted;
        }
      }
    }

    const lastSeg = u.pathname.split('/').filter(Boolean).pop() || '';
    const cleanedSlug = lastSeg
      .replace(/\.html?$/i, '')
      .replace(/[-_]\d{7,}$/g, '')
      .replace(/[-_]/g, ' ')
      .trim();
    if (!cleanedSlug) return u.hostname;
    return cleanedSlug
      .split(' ')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
      .join(' ');
  } catch {
    return 'Śledzony Produkt';
  }
}

export const USER_AGENT_POOL: UserAgentConfig[] = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    platform: '"Windows"',
    secUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    platform: '"macOS"',
    secUa: '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
    mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    platform: '"Windows"',
    secUa: '',
    mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    platform: '"macOS"',
    secUa: '',
    mobile: '?0',
  },
  {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    platform: '"iOS"',
    secUa: '',
    mobile: '?1',
  },
  {
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36',
    platform: '"Android"',
    secUa: '"Chromium";v="125", "Not.A/Brand";v="24", "Google Chrome";v="125"',
    mobile: '?1',
  },
];

export function getRandomHeaders(uaIndex: number, parsedUrl: URL, isAmazon: boolean): Record<string, string> {
  const pool = isAmazon ? USER_AGENT_POOL.slice(0, 4) : USER_AGENT_POOL;
  const agentObj = pool[(uaIndex + Math.floor(Math.random() * pool.length)) % pool.length];
  const host = parsedUrl.hostname.toLowerCase();
  let amzLang = 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7';
  let amzCookie = '';

  if (isAmazon) {
    const sess1 = Math.floor(Math.random() * 8999999) + 1000000;
    const sess2 = Math.floor(Math.random() * 8999999) + 1000000;
    const ubid1 = Math.floor(Math.random() * 8999999) + 1000000;
    const ubid2 = Math.floor(Math.random() * 8999999) + 1000000;

    if (host.endsWith('.pl')) {
      amzLang = 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7';
      amzCookie = `session-id=258-${sess1}-${sess2}; i18n-prefs=PLN; lc-acbpl=pl_PL; ubid-acbpl=259-${ubid1}-${ubid2}`;
    } else if (host.endsWith('.it')) {
      amzLang = 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7';
      amzCookie = `session-id=258-${sess1}-${sess2}; i18n-prefs=EUR; lc-main=it_IT; ubid-main=259-${ubid1}-${ubid2}`;
    } else if (host.endsWith('.de')) {
      amzLang = 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7';
      amzCookie = `session-id=258-${sess1}-${sess2}; i18n-prefs=EUR; lc-main=de_DE; ubid-main=259-${ubid1}-${ubid2}`;
    } else if (host.endsWith('.es')) {
      amzLang = 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7';
      amzCookie = `session-id=258-${sess1}-${sess2}; i18n-prefs=EUR; lc-main=es_ES; ubid-main=259-${ubid1}-${ubid2}`;
    } else if (host.endsWith('.fr')) {
      amzLang = 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7';
      amzCookie = `session-id=258-${sess1}-${sess2}; i18n-prefs=EUR; lc-main=fr_FR; ubid-main=259-${ubid1}-${ubid2}`;
    } else if (host.endsWith('.uk') || host.endsWith('.co.uk')) {
      amzLang = 'en-GB,en;q=0.9,en-US;q=0.8';
      amzCookie = `session-id=258-${sess1}-${sess2}; i18n-prefs=GBP; lc-main=en_GB; ubid-main=259-${ubid1}-${ubid2}`;
    } else {
      amzLang = 'en-US,en;q=0.9';
      amzCookie = `session-id=258-${sess1}-${sess2}; i18n-prefs=USD; lc-main=en_US; ubid-main=259-${ubid1}-${ubid2}`;
    }
  }

  const headers: Record<string, string> = {
    'User-Agent': agentObj.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': isAmazon ? amzLang : 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
  if (isAmazon && amzCookie) {
    headers['Cookie'] = amzCookie;
  }
  if (agentObj.secUa) {
    headers['Sec-Ch-Ua'] = agentObj.secUa;
    headers['Sec-Ch-Ua-Mobile'] = agentObj.mobile;
    headers['Sec-Ch-Ua-Platform'] = agentObj.platform;
  }
  return headers;
}
