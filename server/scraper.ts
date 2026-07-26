import * as cheerio from 'cheerio';
import { GoogleGenAI, Type } from '@google/genai';
import { searchCeneoFallback } from './ceneo';

// Initialize Gemini API client lazily if key is available
export function getGeminiClient() {
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

// Helper to extract clean human-readable title from URL path slug
export function cleanTitleFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    // Handle Ceneo search / path slugs
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

    // Handle Amazon product URL slugs (e.g. /Apple-iPhone-15-128GB-Czarny/dp/B0CHX1P7P4)
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

    // Handle Adidas product URL slugs (e.g. /buty-cloudfoam-flex-rapidfit/HP6993.html)
    if (u.hostname.includes('adidas.')) {
      const segs = u.pathname.split('/').filter(Boolean);
      if (segs.length >= 2) {
        const titleSeg = segs[segs.length - 2];
        const cleaned = decodeURIComponent(titleSeg)
          .replace(/\.html?$/i, '')
          .replace(/[-_]/g, ' ')
          .trim();
        if (cleaned && cleaned.length > 2 && !/^\d+$/.test(cleaned)) {
          return cleaned.split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ');
        }
      }
    }

    const lastSeg = u.pathname.split('/').filter(Boolean).pop() || '';
    // Remove trailing numeric offer IDs
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

export async function scrapeProductDetails(url: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  const targetFetchUrl = url;
  const isAmazon = parsedUrl.hostname.includes('amazon.');

  // User-agent pool and header generator for avoiding bot blocks
  const USER_AGENT_POOL = [
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

  const getRandomHeaders = (uaIndex: number) => {
    const agentObj = USER_AGENT_POOL[(uaIndex + Math.floor(Math.random() * USER_AGENT_POOL.length)) % USER_AGENT_POOL.length];
    const headers: Record<string, string> = {
      'User-Agent': agentObj.ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': isAmazon ? 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7' : 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };
    if (agentObj.secUa) {
      headers['Sec-Ch-Ua'] = agentObj.secUa;
      headers['Sec-Ch-Ua-Mobile'] = agentObj.mobile;
      headers['Sec-Ch-Ua-Platform'] = agentObj.platform;
    }
    return headers;
  };

  let html = '';
  let fetchError = '';
  let isAccessDeniedOrBlocked = false;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff with jitter on retries (e.g. ~600ms, ~1500ms)
        const backoffMs = Math.pow(2, attempt) * 400 + Math.floor(Math.random() * 300);
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      const headers = getRandomHeaders(attempt);
      const response = await fetch(targetFetchUrl, {
        headers,
        redirect: 'follow',
      });

      if (response.status === 403 || response.status === 401 || response.status === 429 || response.status === 503) {
        isAccessDeniedOrBlocked = true;
        fetchError = `HTTP ${response.status} Access Denied / Anti-bot`;
        continue;
      }

      if (response.ok) {
        const fetchedHtml = await response.text();
        const lowerHtml = fetchedHtml.toLowerCase();
        const isBotCheckPage =
          fetchedHtml.length < 500 ||
          lowerHtml.includes('<title>just a moment...</title>') ||
          lowerHtml.includes('<title>attention required!') ||
          lowerHtml.includes('<title>access denied</title>') ||
          lowerHtml.includes('<title>robot check</title>') ||
          (fetchedHtml.length < 15000 &&
            (lowerHtml.includes('cf-browser-verification') ||
             lowerHtml.includes('cf-challenge') ||
             lowerHtml.includes('cdn-cgi/challenge-platform') ||
             lowerHtml.includes('__cf_chl_opt') ||
             lowerHtml.includes('g-recaptcha') ||
             lowerHtml.includes('captcha') ||
             lowerHtml.includes('enable javascript')));

        if (isBotCheckPage) {
          isAccessDeniedOrBlocked = true;
          fetchError = 'Bot detection / Captcha page returned';
          continue;
        }

        html = fetchedHtml;
        fetchError = '';
        isAccessDeniedOrBlocked = false;
        break; // Successfully fetched product page HTML
      } else {
        fetchError = `HTTP status ${response.status}`;
      }
    } catch (err: any) {
      fetchError = err.message || 'Network fetch failed';
    }
  }

  let scrapedTitle = '';
  let scrapedPrice = 0;
  let scrapedCurrency = '';
  let scrapedInStock = true;
  let scrapedImage = '';

  if (html) {
    const $clean = cheerio.load(html);
    $clean('aside, footer, nav, .recommended, .suggestions, .suggested-products, .related-products, .similar-items, #recommendations, .cross-sell, .up-sell, [data-component="carousel"]').remove();
    $clean('.a-text-price, .a-text-strike, del, s, .strike, .old-price, .basisPrice, .original-price, [data-a-stripe], .listPrice, #listPrice, #priceblock_listprice, .was-price, .rrp-price').remove();

    const resolveUrl = (imgSrc: string | undefined): string => {
      if (!imgSrc) return '';
      try {
        if (imgSrc.startsWith('{') && imgSrc.includes('http')) {
          const keys = Object.keys(JSON.parse(imgSrc));
          if (keys.length > 0) imgSrc = keys[0];
        }
        if (imgSrc.includes(',') && (imgSrc.includes('w') || imgSrc.includes('x') || imgSrc.includes('.jpg') || imgSrc.includes('.png') || imgSrc.includes('.webp'))) {
          const parts = imgSrc.split(',').map((s) => s.trim().split(' ')[0]).filter(Boolean);
          if (parts.length > 0) imgSrc = parts[parts.length - 1];
        }
        return new URL(imgSrc, parsedUrl.href).href;
      } catch {
        return imgSrc;
      }
    };

    const extractMainProductImage = ($c: cheerio.CheerioAPI): string => {
      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[property="og:image:secure_url"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
        'meta[property="product:image"]',
        'meta[name="product:image"]',
        'link[rel="image_src"]',
        '[itemprop="image"]',
      ];

      for (const sel of metaSelectors) {
        const el = $c(sel).first();
        const content = el.attr('content') || el.attr('href') || el.attr('src');
        if (content) {
          const lower = content.toLowerCase();
          if (!lower.includes('logo') && !lower.includes('icon') && !lower.includes('avatar') && !lower.includes('placeholder')) {
            const res = resolveUrl(content);
            if (res && (res.startsWith('http://') || res.startsWith('https://'))) return res;
          }
        }
      }

      const mainImageSelectors = [
        '#landingImage',
        '#imgBlkFront',
        '#main-image',
        '.main-image img',
        'img.main-image',
        '.product-main-image img',
        '.product-image-main img',
        '.product-featured-image',
        '.featured-image img',
        '.product__media-item img',
        '.product-gallery img',
        '.product-single__photo',
        '.pdp-main-image',
        '.woocommerce-product-gallery__image img',
        'img[data-zoom-image]',
        'img[data-large-img]',
        'img[data-old-hires]',
        'img[data-a-dynamic-image]',
        '.product-image img',
        '.product-photo img',
        '#product-image',
        'main img',
        '#main img',
        '#content img',
      ];

      for (const sel of mainImageSelectors) {
        const img = $c(sel).first();
        if (img.length > 0) {
          const rawSrc =
            img.attr('data-old-hires') ||
            img.attr('data-a-dynamic-image') ||
            img.attr('data-zoom-image') ||
            img.attr('data-large-img') ||
            img.attr('data-high-res-src') ||
            img.attr('data-src') ||
            img.attr('data-original') ||
            img.attr('data-lazy-src') ||
            img.attr('srcset') ||
            img.attr('src');

          if (rawSrc) {
            const lower = rawSrc.toLowerCase();
            if (!lower.includes('logo') && !lower.includes('icon') && !lower.includes('badge') && !lower.includes('banner')) {
              const res = resolveUrl(rawSrc);
              if (res && (res.startsWith('http://') || res.startsWith('https://'))) return res;
            }
          }
        }
      }

      const allImgs = $c('img').toArray();
      for (const element of allImgs) {
        const img = $c(element);
        const src = img.attr('src') || img.attr('data-src') || img.attr('srcset');
        if (src) {
          const lowerSrc = src.toLowerCase();
          if (
            (lowerSrc.includes('product') || lowerSrc.includes('media') || lowerSrc.includes('gallery') || lowerSrc.includes('photos') || lowerSrc.includes('catalog') || lowerSrc.includes('upload')) &&
            !lowerSrc.includes('logo') &&
            !lowerSrc.includes('icon') &&
            !lowerSrc.includes('sprite')
          ) {
            const res = resolveUrl(src);
            if (res && (res.startsWith('http://') || res.startsWith('https://'))) return res;
          }
        }
      }

      return '';
    };

    // 1. Try JSON-LD schema on clean markup
    $clean('script[type="application/ld+json"]').each((_, el) => {
      try {
        const content = $clean(el).contents().text();
        if (!content) return;
        const json = JSON.parse(content);
        
        const processLdNode = (item: any) => {
          if (!item || typeof item !== 'object') return;

          if (item['@graph'] && Array.isArray(item['@graph'])) {
            item['@graph'].forEach(processLdNode);
          }

          const rawTypes = item['@type'];
          const types = Array.isArray(rawTypes) ? rawTypes : [rawTypes];
          if (types.some((t: any) => typeof t === 'string' && (t === 'Product' || t.includes('Product')))) {
            if (item.name && (!scrapedTitle || scrapedTitle.length < 3)) {
              scrapedTitle = item.name;
            }
            if (item.image && !scrapedImage) {
              const rawImg = Array.isArray(item.image)
                ? item.image[0]
                : typeof item.image === 'object'
                ? item.image.url || item.image.contentUrl
                : item.image;
              scrapedImage = resolveUrl(rawImg);
            }
            const offers = item.offers;
            if (offers) {
              const offerList = Array.isArray(offers)
                ? offers
                : offers.offers && Array.isArray(offers.offers)
                ? offers.offers
                : [offers];

              for (const offer of offerList) {
                if (!offer) continue;
                const rawPrice = offer.price ?? offer.lowPrice ?? offer.highPrice ?? offer.priceAmount;
                if (rawPrice !== undefined && rawPrice !== null && (!scrapedPrice || scrapedPrice === 0)) {
                  const parsedP = parsePriceString(rawPrice);
                  if (parsedP > 0) {
                    scrapedPrice = parsedP;
                  }
                }
                if (offer.priceCurrency && !scrapedCurrency) {
                  const pc = String(offer.priceCurrency).trim();
                  scrapedCurrency = pc === 'PLN' ? 'zł' : pc === 'EUR' ? '€' : pc === 'USD' ? '$' : pc === 'GBP' ? '£' : pc;
                }
                if (offer.availability) {
                  scrapedInStock = String(offer.availability).includes('InStock');
                }
              }
            }
          }
        };

        if (Array.isArray(json)) {
          json.forEach(processLdNode);
        } else {
          processLdNode(json);
        }
      } catch {}
    });

    // 2. OpenGraph & Meta currency / title / image
    if (!scrapedTitle) {
      scrapedTitle =
        $clean('meta[property="og:title"]').attr('content') ||
        $clean('title').text().trim() ||
        parsedUrl.hostname;
    }

    if (!scrapedCurrency) {
      const metaCurrency =
        $clean('meta[property="product:price:currency"]').attr('content') ||
        $clean('meta[property="og:price:currency"]').attr('content') ||
        $clean('meta[name="currency"]').attr('content') ||
        $clean('meta[itemprop="priceCurrency"]').attr('content');
      if (metaCurrency) {
        const mc = metaCurrency.trim();
        scrapedCurrency = mc === 'PLN' ? 'zł' : mc === 'EUR' ? '€' : mc === 'USD' ? '$' : mc === 'GBP' ? '£' : mc;
      }
    }

    if (!scrapedImage) {
      scrapedImage = extractMainProductImage($clean);
    }

    if (!scrapedPrice) {
      const ogPrice =
        $clean('meta[property="product:price:amount"]').attr('content') ||
        $clean('meta[property="og:price:amount"]').attr('content') ||
        $clean('meta[name="twitter:data1"]').attr('content') ||
        $clean('meta[itemprop="price"]').attr('content') ||
        $clean('[itemprop="price"]').attr('content') ||
        $clean('[itemprop="price"]').attr('data-price-amount') ||
        $clean('[data-price-amount]').attr('data-price-amount');
      if (ogPrice) {
        const match = ogPrice.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)/);
        if (match && match[1]) {
          const parsedVal = parsePriceString(match[1]);
          if (parsedVal > 0) {
            scrapedPrice = parsedVal;
          }
        }
      }
    }

    // 3. Cheerio DOM selector heuristics
    if (parsedUrl.hostname.includes('adidas.')) {
      const adzTitle = $clean('[data-auto-id="product-title"], h1.product-title, h1').first().text().trim();
      if (adzTitle && adzTitle.length > 2) {
        scrapedTitle = adzTitle;
      }

      const adidasPriceSelectors = [
        '[data-auto-id="product-price"]',
        '[data-auto-id="gl-price-item"]',
        '.gl-price-item--sale',
        '.gl-price-item',
        '[data-testid="product-price"]',
        '.pd-price',
        '.product-price',
        '.price___1Tf20',
      ];
      for (const sel of adidasPriceSelectors) {
        if (scrapedPrice > 0) break;
        $clean(sel).each((_, el) => {
          const txt = $clean(el).text().trim();
          if (txt) {
            const m = txt.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)/);
            if (m && m[1]) {
              const p = parsePriceString(m[1]);
              if (p > 0) {
                scrapedPrice = p;
                return false;
              }
            }
          }
        });
      }

      if (!scrapedPrice || scrapedPrice === 0) {
        const adidasRegexes = [
          /"unit_sale_price"\s*:\s*\[?"?([\d\.\,]+)"?/i,
          /"sale_price"\s*:\s*"?([\d\.\,]+)"?/i,
          /"salePrice"\s*:\s*"?([\d\.\,]+)"?/i,
          /"priceValue"\s*:\s*"?([\d\.\,]+)"?/i,
          /"product_unit_sale_price"\s*:\s*"?([\d\.\,]+)"?/i,
          /"price"\s*:\s*"?([\d\.\,]+)"?/i,
        ];
        for (const reg of adidasRegexes) {
          const match = html.match(reg);
          if (match && match[1]) {
            const val = parsePriceString(match[1]);
            if (val > 0 && val < 100000) {
              scrapedPrice = val;
              break;
            }
          }
        }
      }
    }

    if (parsedUrl.hostname.includes('amazon.')) {
      const amzTitle = $clean('#productTitle, #title, h1').first().text().trim();
      if (amzTitle && amzTitle.length > 2) {
        scrapedTitle = amzTitle;
      }

      const amzPriceSelectors = [
        '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#corePrice_desktop .a-price:not(.a-text-price) .a-offscreen',
        '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
        '#corePrice_mobile_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#corePriceDisplay_mobile_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#apex_mobile_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#apex_desktop .priceToPay .a-offscreen',
        '#corePrice_desktop .priceToPay .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
        '#corePrice_feature_div .priceToPay .a-offscreen',
        '#price_inside_buybox',
        '#newBuyBoxPrice',
        '#priceblock_dealprice',
        '#priceblock_ourprice',
        '#priceblock_saleprice',
        '.apexPriceToPay .a-offscreen',
        '.priceToPay .a-offscreen',
        '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
        '#price .a-price:not(.a-text-price) .a-offscreen',
        '#buybox .a-price:not(.a-text-price) .a-offscreen',
        '.a-price.a-size-medium.a-color-price .a-offscreen',
        '.a-price.a-size-large .a-offscreen',
        '.a-price:not(.a-text-price) .a-offscreen',
        '.a-color-price',
      ];

      for (const sel of amzPriceSelectors) {
        const txt = $clean(sel).first().text().trim();
        if (txt) {
          const match = txt.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)/);
          if (match && match[1]) {
            const parsedVal = parsePriceString(match[1]);
            if (parsedVal > 0) {
              scrapedPrice = parsedVal;
              break;
            }
          }
        }
      }

      if (!scrapedPrice || scrapedPrice === 0) {
        $clean('.a-price:not(.a-text-price)').each((_, el) => {
          if (scrapedPrice > 0) return;
          const $el = $clean(el);
          const off = $el.find('.a-offscreen').first().text().trim();
          if (off) {
            const m = off.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)/);
            if (m && m[1]) {
              const p = parsePriceString(m[1]);
              if (p > 0) {
                scrapedPrice = p;
                return;
              }
            }
          }
          const whole = $el.find('.a-price-whole').first().text().trim();
          const fraction = $el.find('.a-price-fraction').first().text().trim();
          if (whole) {
            const cleanW = whole.replace(/[^\d]/g, '');
            const cleanF = fraction ? fraction.replace(/[^\d]/g, '') : '00';
            if (cleanW) {
              const p = parsePriceString(`${cleanW}.${cleanF}`);
              if (p > 0) {
                scrapedPrice = p;
              }
            }
          }
        });
      }

      if (!scrapedPrice || scrapedPrice === 0) {
        const jsonPriceRegexes = [
          /"priceAmount"\s*:\s*([\d\.]+)/,
          /"buyingPrice"\s*:\s*([\d\.]+)/,
          /"priceToPay"\s*:\s*([\d\.]+)/,
          /"displayPrice"\s*:\s*"([^"]+)"/,
          /"price"\s*:\s*([\d\.]+)/,
          /"amount"\s*:\s*([\d\.]+)/,
        ];
        for (const reg of jsonPriceRegexes) {
          const match = html.match(reg);
          if (match && match[1]) {
            const val = parsePriceString(match[1]);
            if (val > 0 && val < 500000) {
              scrapedPrice = val;
              break;
            }
          }
        }
      }
    }

    if (!scrapedPrice || !scrapedCurrency) {
      const priceTextSelectors = [
        '.priceToPay .a-offscreen',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '[itemprop="price"]',
        '[data-price-amount]',
        '[data-price-type="finalPrice"]',
        '.price-box .price',
        '.price-box',
        '.cena_brutto',
        '.cena-main',
        '.price_val',
        '.product_price',
        '.product-price-primary',
        '.main-product .price',
        'main .price',
        '#price',
        '[data-price]',
        '.product-price',
        '.price-val',
        '.price',
        '.cena',
        '.cenag',
      ];
      for (const sel of priceTextSelectors) {
        const txt = $clean(sel).first().text().trim();
        if (txt) {
          const match = txt.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)\s*([a-zA-Z\$€£złPLN¥Kč]+)?/i);
          if (match && match[1] && (!scrapedPrice || scrapedPrice === 0)) {
            const parsedVal = parsePriceString(match[1]);
            if (parsedVal > 0) {
              scrapedPrice = parsedVal;
            }
          }

          if (!scrapedCurrency) {
            const lowerTxt = txt.toLowerCase();
            if (lowerTxt.includes('zł') || lowerTxt.includes('pln')) scrapedCurrency = 'zł';
            else if (txt.includes('€') || lowerTxt.includes('eur')) scrapedCurrency = '€';
            else if (txt.includes('£') || lowerTxt.includes('gbp')) scrapedCurrency = '£';
            else if (txt.includes('$') || lowerTxt.includes('usd')) scrapedCurrency = '$';
            else if (lowerTxt.includes('chf')) scrapedCurrency = 'CHF';
            else if (lowerTxt.includes('kč') || lowerTxt.includes('czk')) scrapedCurrency = 'Kč';
          }

          if (scrapedPrice > 0 && scrapedCurrency) break;
        }
      }
    }

    if (parsedUrl.hostname.includes('ceneo.pl')) {
      if (!scrapedPrice || scrapedPrice === 0) {
        const dataPrice = $clean('.product-offer-summary__price [data-price], .price-format [data-price], [data-price]').first().attr('data-price');
        if (dataPrice) {
          const p = parseFloat(dataPrice);
          if (!isNaN(p) && p > 0) scrapedPrice = p;
        }
      }
      if (!scrapedPrice || scrapedPrice === 0) {
        const valTxt = $clean('.price-format .value, .product-offer-summary__price .value').first().text().trim();
        const pennyTxt = $clean('.price-format .penny, .product-offer-summary__price .penny').first().text().trim();
        if (valTxt) {
          const raw = valTxt.replace(/\s+/g, '') + (pennyTxt ? '.' + pennyTxt.replace(',', '') : '');
          const p = parseFloat(raw.replace(',', '.'));
          if (!isNaN(p) && p > 0) scrapedPrice = p;
        }
      }
      if (!scrapedTitle || scrapedTitle.includes('Ceneo') || scrapedTitle === 'ceneo.pl') {
        const ogTitle = $clean('meta[property="og:title"]').attr('content') || $clean('h1.product-top__title, h1').first().text().trim();
        if (ogTitle) scrapedTitle = ogTitle.replace(/\s*-\s*Ceneo.*$/i, '').trim();
      }
    }
  }

  // 4. Gemini AI Fallback if price or currency missing or fetch blocked
  const ai = getGeminiClient();
  if ((!scrapedPrice || !scrapedCurrency || !scrapedTitle || fetchError) && ai) {
    try {
      const bodySnippet = html ? cheerio.load(html)('main, #main, #content, body').text().slice(0, 4000) : '';
      const prompt = `Extract product details for main item at URL "${parsedUrl.href}".
CRITICAL INSTRUCTION: Identify ONLY the actual buying price to pay (sale price) for the MAIN product. Do NOT extract strikethrough list prices, recommended RRP, unit prices, or shipping costs.
Parse the exact currency symbol or code (e.g. "zł", "PLN", "€", "$", "£", "CHF") as displayed on the webpage.

Page text snippet:
"""${bodySnippet}"""`;

      const schema = {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Main product name or title',
          },
          price: {
            type: Type.NUMBER,
            description: 'Current purchasing price numeric value (e.g. 1499.00)',
          },
          currency: {
            type: Type.STRING,
            description: 'Exact currency symbol or code extracted from page (e.g. zł, $, €, £, CHF, PLN)',
          },
          inStock: {
            type: Type.BOOLEAN,
            description: 'Availability status (true if available to buy, false if out of stock)',
          },
          imageUrl: {
            type: Type.STRING,
            description: 'Optional absolute image URL for product',
          },
        },
        required: ['title', 'price', 'currency', 'inStock'],
      };

      // Try models in sequence if rate-limited (429)
      const modelsToTry = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash'];
      let textResp = '';

      for (const modelName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: schema,
            },
          });
          textResp = response.text?.trim() || '';
          if (textResp) break;
        } catch (modelErr: any) {
          const errText = modelErr?.message || String(modelErr);
          if (errText.includes('429') || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quota')) {
            console.warn(`⚠️ Gemini model '${modelName}' quota/rate limit reached (429). Trying fallback model...`);
            continue;
          }
          throw modelErr;
        }
      }

      if (textResp) {
        const parsed = JSON.parse(textResp);

        if (parsed.title && !scrapedTitle) scrapedTitle = parsed.title;
        if (parsed.price && (!scrapedPrice || scrapedPrice === 0)) scrapedPrice = parseFloat(parsed.price);
        if (parsed.currency && !scrapedCurrency) {
          const c = String(parsed.currency).trim();
          scrapedCurrency = c === 'PLN' ? 'zł' : c === 'EUR' ? '€' : c === 'USD' ? '$' : c === 'GBP' ? '£' : c;
        }
        if (typeof parsed.inStock === 'boolean') scrapedInStock = parsed.inStock;
        if (parsed.imageUrl && !scrapedImage) scrapedImage = parsed.imageUrl;
      }
    } catch (geminiErr: any) {
      const msg = geminiErr?.message || String(geminiErr);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        console.warn('⚠️ Gemini API rate limit / quota exhausted across all models. Proceeding with standard web scraping fallbacks.');
      } else {
        console.warn('Gemini structured response extraction warning:', msg);
      }
    }
  }

  if (!scrapedCurrency) {
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname.endsWith('.pl')) {
      scrapedCurrency = 'zł';
    } else if (hostname.endsWith('.de') || hostname.endsWith('.fr') || hostname.endsWith('.es') || hostname.endsWith('.it')) {
      scrapedCurrency = '€';
    } else if (hostname.endsWith('.uk') || hostname.endsWith('.co.uk')) {
      scrapedCurrency = '£';
    } else {
      scrapedCurrency = 'zł';
    }
  }

  const isCeneoUrl = parsedUrl.hostname.includes('ceneo.pl');
  const isAllegroUrl = parsedUrl.hostname.includes('allegro.pl');
  const isAmazonUrl = parsedUrl.hostname.includes('amazon.');

  if (!scrapedTitle || scrapedTitle.length < 3 || scrapedTitle.includes('403') || scrapedTitle.includes('Cloudflare') || scrapedTitle === 'allegro.pl' || scrapedTitle === 'amazon.pl') {
    scrapedTitle = cleanTitleFromUrl(parsedUrl.href);
  }

  if (scrapedTitle && (scrapedTitle.toLowerCase().includes('amazon.') || scrapedTitle.startsWith('Amazon'))) {
    scrapedTitle = scrapedTitle
      .replace(/^Amazon\.[a-z\.]+\s*:\s*/i, '')
      .replace(/^Amazon\s*:\s*/i, '')
      .replace(/\s*:\s*Amazon\.[a-z\.]+\s*:\s*.*$/i, '')
      .replace(/\s*:\s*Amazon\.[a-z\.]+/i, '')
      .replace(/\s*:\s*Amazon$/i, '')
      .replace(/\s*:\s*(Elektronika|Electronics|Dom|Kuchnia|Sklep|Książki)\s*$/i, '')
      .trim();
  }

  if (scrapedTitle && (scrapedTitle.includes('| adidas') || scrapedTitle.includes('- adidas') || scrapedTitle.includes('adidas Poland') || scrapedTitle.includes('adidas PL'))) {
    scrapedTitle = scrapedTitle
      .replace(/\s*\|\s*adidas.*$/i, '')
      .replace(/\s*-\s*adidas.*$/i, '')
      .replace(/^adidas\s+/i, '')
      .trim();
  }

  const isBotBlocked = isAccessDeniedOrBlocked || !!fetchError || !html || html.length < 500 || (scrapedPrice === 0 && (html.toLowerCase().includes('captcha') || html.toLowerCase().includes('robot check')));
  let fetchedFromCeneo = false;
  const finalTrackedUrl = parsedUrl.href;

  const needsPriceFallback = !scrapedPrice || scrapedPrice === 0;

  // ONLY attempt searchCeneoFallback if primary site price scraping failed AND genuine access denied / bot block occurred
  if (needsPriceFallback && (isAllegroUrl || isAmazonUrl || isBotBlocked || !isCeneoUrl)) {
    let ceneoResult = await searchCeneoFallback(scrapedTitle);

    if (!ceneoResult || !ceneoResult.price || ceneoResult.price === 0) {
      const simplifiedTitle = scrapedTitle.replace(/[^\w\s\u00C0-\u024F]/gi, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 4).join(' ');
      if (simplifiedTitle && simplifiedTitle.length > 3) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const retryResult = await searchCeneoFallback(simplifiedTitle);
        if (retryResult && retryResult.price > 0) {
          ceneoResult = retryResult;
        }
      }
    }

    if (ceneoResult && ceneoResult.price && ceneoResult.price > 0) {
      scrapedPrice = ceneoResult.price;
      fetchedFromCeneo = true;
      if (!scrapedCurrency) scrapedCurrency = 'zł';

      const isBadTitle = ceneoResult.title && /pepper|kod rabatowy|kupon|zniżk|okazj|rabat|promocj/i.test(ceneoResult.title);
      if (ceneoResult.title && ceneoResult.title.length > 5 && !isBadTitle) {
        if (!scrapedTitle || scrapedTitle.length < 5 || scrapedTitle === 'allegro.pl' || scrapedTitle === 'amazon.pl') {
          scrapedTitle = ceneoResult.title;
        }
      }
    }
  }

  const needsManualPrice = !scrapedPrice || scrapedPrice === 0;

  let scrapeWarning: string | undefined;
  if (fetchedFromCeneo && !isCeneoUrl) {
    scrapeWarning = `Nie udało się bezpośrednio odczytać ceny ze strony sklepu. Pobrano szacowaną cenę (${scrapedPrice.toFixed(2)} ${scrapedCurrency || 'zł'}) z Ceneo dla "${scrapedTitle}". Adres strony pozostał oryginalny.`;
  } else if (needsManualPrice) {
    scrapeWarning = isAllegroUrl
      ? 'Serwis Allegro stosuje ochronę anty-bot, a Ceneo nie zwróciło cen. Wpisz cenę ręcznie.'
      : isAmazonUrl
      ? 'Strona Amazon wymagała weryfikacji anty-bot i Ceneo nie znalazło jednoznacznej ceny. Sprawdź i wpisz cenę ręcznie.'
      : 'Nie udało się automatycznie odczytać ceny z tej strony. Sprawdź i wpisz cenę ręcznie.';
  }

  return {
    title: scrapedTitle,
    price: scrapedPrice,
    currency: scrapedCurrency,
    inStock: scrapedInStock,
    imageUrl: scrapedImage,
    url: finalTrackedUrl,
    fetchedAt: new Date().toISOString(),
    needsManualPrice,
    scrapeWarning,
    fetchedFromCeneo,
    overrodeUrlToCeneo: false,
  };
}
