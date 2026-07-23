import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { searchCeneoFallback } from './ceneo';

// Initialize Gemini API client lazily if key is available
export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
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

    const lastSeg = u.pathname.split('/').filter(Boolean).pop() || '';
    // Remove trailing numeric offer IDs
    const cleanedSlug = lastSeg
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

  // Attempt to fetch product HTML with realistic browser headers
  let html = '';
  let fetchError = '';
  const isAmazon = parsedUrl.hostname.includes('amazon.');
  let targetFetchUrl = parsedUrl.href;
  if (isAmazon) {
    const asinMatch = parsedUrl.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asinMatch && asinMatch[1]) {
      targetFetchUrl = `https://${parsedUrl.hostname}/dp/${asinMatch[1]}`;
    }
  }

  try {
    const getHeaders = (uaType: number) => ({
      'User-Agent': uaType === 0
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept-Language': isAmazon ? 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7' : 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    });

    let response = await fetch(targetFetchUrl, {
      headers: getHeaders(0),
      redirect: 'follow',
    });

    if (response.ok) {
      html = await response.text();
    }

    if (isAmazon && (!response.ok || !html || html.includes('Captcha') || html.includes('Robot Check') || html.length < 1500)) {
      await new Promise((r) => setTimeout(r, 350));
      const retryRes = await fetch(targetFetchUrl, {
        headers: getHeaders(1),
        redirect: 'follow',
      });
      if (retryRes.ok) {
        const retryHtml = await retryRes.text();
        if (retryHtml && retryHtml.length > 1500 && !retryHtml.includes('Captcha')) {
          html = retryHtml;
          fetchError = '';
        }
      }
    }

    if (!response.ok && !html) {
      fetchError = `HTTP status ${response.status}`;
    }
  } catch (err: any) {
    fetchError = err.message || 'Network fetch failed';
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
        const json = JSON.parse(content);
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type'] === 'http://schema.org/Product') {
            if (item.name) scrapedTitle = item.name;
            if (item.image) {
              const rawImg = Array.isArray(item.image)
                ? item.image[0]
                : typeof item.image === 'object'
                ? item.image.url
                : item.image;
              scrapedImage = resolveUrl(rawImg);
            }
            const offers = item.offers;
            if (offers) {
              const offer = Array.isArray(offers) ? offers[0] : offers;
              if (offer.price) scrapedPrice = parseFloat(offer.price);
              if (offer.priceCurrency) {
                const pc = offer.priceCurrency.trim();
                scrapedCurrency = pc === 'PLN' ? 'zł' : pc === 'EUR' ? '€' : pc === 'USD' ? '$' : pc === 'GBP' ? '£' : pc;
              }
              if (offer.availability) {
                scrapedInStock = offer.availability.includes('InStock');
              }
            }
          }
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
        $clean('meta[itemprop="price"]').attr('content') ||
        $clean('[itemprop="price"]').attr('content') ||
        $clean('[itemprop="price"]').attr('data-price-amount') ||
        $clean('[data-price-amount]').attr('data-price-amount');
      if (ogPrice) {
        const match = ogPrice.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)/);
        if (match && match[1]) {
          const parsedVal = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
          if (!isNaN(parsedVal) && parsedVal > 0) {
            scrapedPrice = parsedVal;
          }
        }
      }
    }

    // 3. Cheerio DOM selector heuristics
    if (parsedUrl.hostname.includes('amazon.')) {
      const amzTitle = $clean('#productTitle').first().text().trim();
      if (amzTitle && amzTitle.length > 2) {
        scrapedTitle = amzTitle;
      }

      const amzPriceSelectors = [
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
      ];

      for (const sel of amzPriceSelectors) {
        const txt = $clean(sel).first().text().trim();
        if (txt) {
          const match = txt.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)/);
          if (match && match[1]) {
            const cleanedNumStr = match[1].replace(/\s/g, '').replace(',', '.');
            const parsedVal = parseFloat(cleanedNumStr);
            if (!isNaN(parsedVal) && parsedVal > 0) {
              scrapedPrice = parsedVal;
              break;
            }
          }
        }
      }

      if (!scrapedPrice || scrapedPrice === 0) {
        const whole = $clean('.priceToPay .a-price-whole, #corePrice_feature_div .a-price-whole').first().text().trim();
        const fraction = $clean('.priceToPay .a-price-fraction, #corePrice_feature_div .a-price-fraction').first().text().trim();
        if (whole) {
          const cleanW = whole.replace(/[^\d]/g, '');
          const cleanF = fraction ? fraction.replace(/[^\d]/g, '') : '00';
          if (cleanW) {
            const p = parseFloat(`${cleanW}.${cleanF}`);
            if (!isNaN(p) && p > 0) {
              scrapedPrice = p;
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
            const cleanedNumStr = match[1].replace(/\s/g, '').replace(',', '.');
            const parsedVal = parseFloat(cleanedNumStr);
            if (!isNaN(parsedVal) && parsedVal > 0) {
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
"""${bodySnippet}"""

Return a JSON object with strictly these keys:
{
  "title": "main product name",
  "price": number (e.g. 1499.00),
  "currency": "exact currency symbol or code extracted from page (e.g. zł, $, €, £, CHF)",
  "inStock": boolean,
  "imageUrl": "optional absolute image url"
}
Return ONLY valid JSON.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
      });

      const textResp = response.text || '';
      const cleanJson = textResp.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.title && !scrapedTitle) scrapedTitle = parsed.title;
      if (parsed.price && (!scrapedPrice || scrapedPrice === 0)) scrapedPrice = parseFloat(parsed.price);
      if (parsed.currency && !scrapedCurrency) {
        const c = parsed.currency.trim();
        scrapedCurrency = c === 'PLN' ? 'zł' : c === 'EUR' ? '€' : c === 'USD' ? '$' : c === 'GBP' ? '£' : c;
      }
      if (typeof parsed.inStock === 'boolean') scrapedInStock = parsed.inStock;
      if (parsed.imageUrl && !scrapedImage) scrapedImage = parsed.imageUrl;
    } catch (geminiErr: any) {
      // Quietly swallow Gemini errors as optional fallback
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

  const isBotBlocked = !!fetchError || !html || html.length < 500 || (scrapedPrice === 0 && (html.includes('captcha') || html.includes('Robot Check')));
  let fetchedFromCeneo = false;
  let finalTrackedUrl = parsedUrl.href;
  let overrodeUrlToCeneo = false;

  const needsPriceFallback = !scrapedPrice || scrapedPrice === 0;

  // ONLY attempt searchCeneoFallback if we don't have a valid scraped price yet!
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

      if (ceneoResult.ceneoUrl) {
        finalTrackedUrl = ceneoResult.ceneoUrl;
        if (isAllegroUrl || isAmazonUrl) {
          overrodeUrlToCeneo = true;
        }
      }
    }
  }

  const needsManualPrice = !scrapedPrice || scrapedPrice === 0;

  let scrapeWarning: string | undefined;
  if (overrodeUrlToCeneo) {
    scrapeWarning = `Serwis ${isAllegroUrl ? 'Allegro' : 'sklepu'} stosuje ochronę anty-bot. Cenę (${scrapedPrice.toFixed(2)} zł) oraz adres do śledzenia przełączono na porównywarkę Ceneo (${finalTrackedUrl}).`;
  } else if (fetchedFromCeneo && !isCeneoUrl) {
    scrapeWarning = `Nie udało się bezpośrednio odczytać ceny ze strony sklepu. Pobrano cenę (${scrapedPrice.toFixed(2)} ${scrapedCurrency || 'zł'}) z porównywarki Ceneo dla "${scrapedTitle}".`;
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
    overrodeUrlToCeneo,
  };
}
