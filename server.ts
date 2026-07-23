import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

// Resolve directory safely across ESM (dev) and CJS (production bundle)
const getDirname = () => {
  if (typeof __dirname !== 'undefined') return __dirname;
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};
const appDir = getDirname();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Gemini API client lazily if key is available
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// Helper to search Ceneo directly by scraping Ceneo search HTML or product pages
async function searchDirectCeneo(cleanQuery: string, keyWords: string[]): Promise<{ price: number; title?: string; ceneoUrl?: string } | null> {
  try {
    const searchTerms = keyWords.slice(0, 6).join(' ');
    if (!searchTerms || searchTerms.length < 2) return null;

    const searchUrl = `https://www.ceneo.pl/;szukaj-${encodeURIComponent(searchTerms)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const htmlText = await res.text();
    const finalResUrl = res.url || searchUrl;
    const $ = cheerio.load(htmlText);

    // Case 1: Direct Ceneo redirect to a single product page (e.g. /12345678 or -p.htm)
    if (!finalResUrl.includes('szukaj') && (finalResUrl.includes('-p.htm') || /\/\d+$/.test(finalResUrl))) {
      let price = 0;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).contents().text());
          const items = Array.isArray(json) ? json : [json];
          for (const item of items) {
            if (item['@type'] === 'Product' || item['@type'] === 'http://schema.org/Product') {
              const offer = item.offers ? (Array.isArray(item.offers) ? item.offers[0] : item.offers) : null;
              if (offer && offer.price) price = parseFloat(offer.price);
            }
          }
        } catch {}
      });

      if (!price) {
        const valAttr = $('[data-price]').first().attr('data-price') || $('.price-format .value').first().text().trim();
        const pennyAttr = $('.price-format .penny').first().text().trim();
        if (valAttr) {
          const cleanVal = valAttr.replace(/\s+/g, '') + (pennyAttr ? '.' + pennyAttr.replace(',', '') : '');
          price = parseFloat(cleanVal.replace(',', '.'));
        }
      }

      const pTitle = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim();
      if (price > 0) {
        return {
          price,
          title: pTitle ? pTitle.replace(/\s*-\s*Ceneo.*$/i, '').trim() : undefined,
          ceneoUrl: finalResUrl,
        };
      }
    }

    // Case 2: Ceneo Search Results Page
    let bestResult: { price: number; title?: string; ceneoUrl?: string } | null = null;
    let highestScore = -1;

    $('.cat-prod-row, .cat-prod-box, .product-card, div[data-pid]').each((_, el) => {
      const title = $(el).find('.cat-prod-row__name, .cat-prod-box__name, a.go-to-product, a[title]').first().text().trim() || $(el).find('a[title]').attr('title') || '';
      const relHref = $(el).find('a.go-to-product, a[href*="-p"]').first().attr('href') || $(el).find('a').first().attr('href') || '';
      if (!relHref) return;

      const ceneoUrl = relHref.startsWith('http') ? relHref : `https://www.ceneo.pl${relHref.startsWith('/') ? '' : '/'}${relHref}`;

      let price = 0;
      const dataPrice = $(el).attr('data-price') || $(el).find('[data-price]').first().attr('data-price');
      if (dataPrice) {
        price = parseFloat(dataPrice);
      }

      if (!price || isNaN(price)) {
        const valTxt = $(el).find('.price-format .value, .value').first().text().trim();
        const pennyTxt = $(el).find('.price-format .penny, .penny').first().text().trim();
        if (valTxt) {
          const rawNum = valTxt.replace(/\s+/g, '') + (pennyTxt ? '.' + pennyTxt.replace(',', '') : '');
          price = parseFloat(rawNum.replace(',', '.'));
        }
      }

      if (!price || isNaN(price)) {
        const rawTxt = $(el).find('.price, .cat-prod-row__price').text().trim();
        const m = rawTxt.match(/(\d[\d\s]*)[,\.]?(\d{2})?\s*zł/i);
        if (m) {
          const n = m[1].replace(/\s+/g, '') + (m[2] ? '.' + m[2] : '.00');
          price = parseFloat(n);
        }
      }

      if (price > 0) {
        let score = 0;
        const titleLower = title.toLowerCase();
        for (const kw of keyWords) {
          if (titleLower.includes(kw.toLowerCase())) score += 2;
        }

        if (score > highestScore) {
          highestScore = score;
          bestResult = {
            price,
            title: title ? title.replace(/\s*-\s*Ceneo.*$/i, '').trim() : undefined,
            ceneoUrl,
          };
        }
      }
    });

    if (bestResult && highestScore >= 2 && bestResult.price > 0) {
      return bestResult;
    }

    return null;
  } catch {
    return null;
  }
}

// Helper to search Ceneo price comparator as a fallback when direct e-commerce site scraping (e.g. Allegro) is blocked
async function searchCeneoFallback(queryTitle: string): Promise<{ price: number; title?: string; ceneoUrl?: string } | null> {
  try {
    const cleanQuery = queryTitle.replace(/[^\w\s\u00C0-\u024F]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanQuery || cleanQuery.length < 3) return null;

    // Polish stop words to ignore when extracting key terms
    const stopWords = new Set(['dla', 'ze', 'z', 'do', 'i', 'w', 'na', 'o', 'od', 'za', 'po', 'pod', 'przed']);
    const words = cleanQuery.split(' ');
    const keyWords = words.filter((w) => !stopWords.has(w.toLowerCase()) && w.length > 1);

    // 1. First priority: Direct Ceneo Search
    const directResult = await searchDirectCeneo(cleanQuery, keyWords);
    if (directResult && directResult.price > 0) {
      return directResult;
    }

    // Build targeted search queries preserving key features (avoiding arbitrary truncation of qualifiers like "stojak", "fotelik")
    const searchQueries = [
      `${cleanQuery} ceneo cena`,
      `ceneo ${keyWords.slice(0, 8).join(' ')}`,
      `${keyWords.slice(0, 6).join(' ')} ceneo`,
    ];

    let bestResult: { price: number; title?: string; ceneoUrl?: string } | null = null;
    let highestScore = -1;

    for (const q of searchQueries) {
      // 2. Yahoo Search Engine (reliable indexing of Ceneo prices and direct links)
      try {
        const yahooUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`;
        const res = await fetch(yahooUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8',
          },
        });

        if (res.ok) {
          const htmlText = await res.text();
          const $ = cheerio.load(htmlText);

          $('div.dd.algo, div.algo, li').each((_, el) => {
            const title = $(el).find('h3, .title').text().trim();
            const snippet = $(el).find('.compText, .abstract, p').text().trim();
            const rawLink = $(el).find('a').attr('href') || '';

            let ceneoUrl = '';
            if (rawLink.includes('RU=')) {
              try {
                const match = rawLink.match(/RU=([^/&]+)/);
                if (match) {
                  const decoded = decodeURIComponent(match[1]);
                  if (decoded.includes('ceneo.pl')) ceneoUrl = decoded;
                }
              } catch {}
            } else if (rawLink.includes('ceneo.pl')) {
              ceneoUrl = rawLink;
            }

            const combined = (title + ' ' + snippet).trim();
            const priceMatch = combined.match(/(?:od\s*)?(\d+[\d\s,]*[\.,]?\d*)\s*(?:zł|PLN)/i);
            if (!priceMatch) return;

            const rawNum = priceMatch[1].replace(/\s+/g, '').replace(',', '.');
            const val = parseFloat(rawNum);
            if (isNaN(val) || val <= 0 || val > 100000) return;

            // Score evaluation
            let score = 0;
            const combinedLower = combined.toLowerCase();
            const queryLower = cleanQuery.toLowerCase();

            for (const kw of keyWords) {
              if (combinedLower.includes(kw.toLowerCase())) {
                score += 2;
              }
            }

            if (ceneoUrl) score += 5;

            // Important qualifying terms penalty (e.g. "stojak", "stojakiem", "fotelik", "zestaw", "poduszka", "termometr")
            const qualifiers = ['stojak', 'stojakiem', 'fotelik', 'zestaw', 'poduszka', 'poduszką', 'termometr', '2w1', '3w1', 'stelaż'];
            for (const qual of qualifiers) {
              if (queryLower.includes(qual) && !combinedLower.includes(qual)) {
                score -= 8;
              }
            }

            if (score > highestScore) {
              highestScore = score;
              bestResult = {
                price: val,
                title: title.replace(/\s*-\s*Ceneo.*$/i, '').replace(/\s*-\s*Ceny.*$/i, '').replace(/[\.\. ]+$/g, '').trim() || undefined,
                ceneoUrl: ceneoUrl || `https://www.ceneo.pl/;szukaj-${encodeURIComponent(keyWords.slice(0, 5).join(' '))}`,
              };
            }
          });

          if (bestResult && bestResult.price > 0 && highestScore >= 6) {
            return bestResult;
          }
        }
      } catch (err) {
        // Fallback to next query / engine
      }

      // 3. DuckDuckGo HTML Fallback
      try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
        const res = await fetch(ddgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8',
          },
        });

        if (res.ok) {
          const htmlText = await res.text();
          const $ = cheerio.load(htmlText);

          $('.result__body').each((_, el) => {
            const t = $(el).find('.result__title').text().trim();
            const s = $(el).find('.result__snippet').text().trim();
            const rawUrl = $(el).find('a.result__url').attr('href') || $(el).find('a').first().attr('href') || '';

            let ceneoUrl = '';
            if (rawUrl.includes('ceneo.pl')) {
              ceneoUrl = rawUrl;
            } else if (rawUrl.includes('uddg=')) {
              try {
                const decoded = decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0]);
                if (decoded.includes('ceneo.pl')) ceneoUrl = decoded;
              } catch {}
            }

            const combined = (t + ' ' + s).trim();
            const priceMatch = combined.match(/(?:od\s*)?(\d+[\d\s,]*[\.,]?\d*)\s*(?:zł|PLN)/i);
            if (!priceMatch) return;

            const rawNum = priceMatch[1].replace(/\s+/g, '').replace(',', '.');
            const val = parseFloat(rawNum);
            if (isNaN(val) || val <= 0 || val > 100000) return;

            let score = 0;
            const combinedLower = combined.toLowerCase();
            const queryLower = cleanQuery.toLowerCase();

            for (const kw of keyWords) {
              if (combinedLower.includes(kw.toLowerCase())) score += 2;
            }
            if (ceneoUrl) score += 5;

            const qualifiers = ['stojak', 'stojakiem', 'fotelik', 'zestaw', 'poduszka', 'poduszką', 'termometr', '2w1', '3w1', 'stelaż'];
            for (const qual of qualifiers) {
              if (queryLower.includes(qual) && !combinedLower.includes(qual)) {
                score -= 8;
              }
            }

            if (score > highestScore) {
              highestScore = score;
              bestResult = {
                price: val,
                title: t.replace(/\s*-\s*Ceneo.*$/i, '').replace(/\s*-\s*Ceny.*$/i, '').replace(/[\.\. ]+$/g, '').trim() || undefined,
                ceneoUrl: ceneoUrl || `https://www.ceneo.pl/;szukaj-${encodeURIComponent(keyWords.slice(0, 5).join(' '))}`,
              };
            }
          });

          if (bestResult && bestResult.price > 0 && highestScore >= 6) {
            return bestResult;
          }
        }
      } catch (err) {
        // Continue
      }
    }

    if (bestResult && bestResult.price > 0) {
      return bestResult;
    }

    const fallbackCeneoUrl = `https://www.ceneo.pl/;szukaj-${encodeURIComponent(keyWords.slice(0, 5).join(' '))}`;
    return { price: 0, ceneoUrl: fallbackCeneoUrl };
  } catch (err) {
    console.warn('Ceneo price fallback warning:', err);
    return null;
  }
}

// Scrape endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid URL is required' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Attempt to fetch product HTML with realistic browser headers
    let html = '';
    let fetchError = '';
    const isAmazon = parsedUrl.hostname.includes('amazon.');
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

      let response = await fetch(parsedUrl.href, {
        headers: getHeaders(0),
        redirect: 'follow',
      });

      if (response.ok) {
        html = await response.text();
      }

      // Retry for Amazon if initial response is 503/403/captcha or truncated
      if (isAmazon && (!response.ok || !html || html.includes('Captcha') || html.includes('Robot Check') || html.length < 1500)) {
        await new Promise((r) => setTimeout(r, 350));
        const retryRes = await fetch(parsedUrl.href, {
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
      const $ = cheerio.load(html);

      // Remove non-main elements (suggested, related, recommended products, ads, footers) before scraping DOM
      const $clean = cheerio.load(html);
      $clean('aside, footer, nav, .recommended, .suggestions, .suggested-products, .related-products, .similar-items, #recommendations, .cross-sell, .up-sell, [data-component="carousel"]').remove();

      // Helper to turn relative image paths into full URLs
      const resolveUrl = (imgSrc: string | undefined): string => {
        if (!imgSrc) return '';
        try {
          // Handle data-a-dynamic-image JSON string (e.g. Amazon)
          if (imgSrc.startsWith('{') && imgSrc.includes('http')) {
            const keys = Object.keys(JSON.parse(imgSrc));
            if (keys.length > 0) imgSrc = keys[0];
          }
          // Handle srcset (pick last/highest resolution entry)
          if (imgSrc.includes(',') && (imgSrc.includes('w') || imgSrc.includes('x') || imgSrc.includes('.jpg') || imgSrc.includes('.png') || imgSrc.includes('.webp'))) {
            const parts = imgSrc.split(',').map((s) => s.trim().split(' ')[0]).filter(Boolean);
            if (parts.length > 0) imgSrc = parts[parts.length - 1];
          }
          return new URL(imgSrc, parsedUrl.href).href;
        } catch {
          return imgSrc;
        }
      };

      // Helper to extract main product image from DOM with deep selector heuristics
      const extractMainProductImage = ($c: cheerio.CheerioAPI): string => {
        // 1. Meta tag priority
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

        // 2. E-commerce main image selectors
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

        // 3. Fallback scan any img with product/media keywords in src
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
        } catch {
          // ignore JSON parse errors in custom scripts
        }
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

      // OpenGraph price
      if (!scrapedPrice) {
        const ogPrice =
          $clean('meta[property="product:price:amount"]').attr('content') ||
          $clean('meta[property="og:price:amount"]').attr('content');
        if (ogPrice) scrapedPrice = parseFloat(ogPrice.replace(',', '.'));
      }

      // 3. Cheerio DOM selector heuristics targeting main product area
      if (!scrapedPrice || !scrapedCurrency) {
        const priceTextSelectors = [
          '#priceblock_ourprice',
          '#priceblock_dealprice',
          '#corePrice_feature_div .a-offscreen',
          '.product-price-primary',
          '.main-product .price',
          'main .price',
          '#price',
          '[data-price]',
          '.product-price',
          '.a-price-whole',
          'span.a-offscreen',
          '.price-val',
          '.price',
          '.cena',
        ];
        for (const sel of priceTextSelectors) {
          const txt = $clean(sel).first().text().trim();
          if (txt) {
            // Match numbers like 1299,00 or 1 299 zł or $299.99
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
    }

    // 4. Gemini AI Fallback if price or currency missing or fetch blocked
    const ai = getGeminiClient();
    if ((!scrapedPrice || !scrapedCurrency || !scrapedTitle || fetchError) && ai) {
      try {
        const bodySnippet = html ? cheerio.load(html)('main, #main, #content, body').text().slice(0, 4000) : '';
        const prompt = `Extract product details for main item at URL "${parsedUrl.href}".
CRITICAL INSTRUCTION: Identify ONLY the price and currency of the MAIN subject product being viewed. Do NOT extract prices of suggested, related, or cross-sell products.
Parse the exact currency symbol or code (e.g. "zł", "PLN", "€", "$", "£", "CHF") as displayed on the webpage. Do NOT hardcode or assume the currency unless clearly indicated.

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
        // Quietly swallow Gemini quota or rate limit errors as this is an optional fallback
      }
    }

    // Dynamic currency domain fallback if still empty
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

    // Helper to extract clean human-readable title from URL path slug
    const cleanTitleFromUrl = (urlStr: string): string => {
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
            return cleaned.split(' ').map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '').join(' ');
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
        // Remove trailing numeric offer IDs (e.g. -18129101208 or _12345678)
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
    };

    const isCeneoUrl = parsedUrl.hostname.includes('ceneo.pl');
    const isAllegroUrl = parsedUrl.hostname.includes('allegro.pl');
    const isAmazonUrl = parsedUrl.hostname.includes('amazon.');

    // Default fallback if title still missing or unparsed or contains Cloudflare/bot warning
    if (!scrapedTitle || scrapedTitle.length < 3 || scrapedTitle.includes('403') || scrapedTitle.includes('Cloudflare') || scrapedTitle === 'allegro.pl' || scrapedTitle === 'amazon.pl') {
      scrapedTitle = cleanTitleFromUrl(parsedUrl.href);
    }

    // Clean Amazon brand noise from title
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

    const isBotBlocked = !!fetchError || !html || html.length < 1000 || html.includes('captcha') || html.includes('Challenge') || html.includes('Cloudflare');
    let fetchedFromCeneo = false;
    let finalTrackedUrl = parsedUrl.href;
    let overrodeUrlToCeneo = false;

    // Ceneo Price Comparator Fallback - Trigger if Allegro/Amazon/Ceneo OR if price is missing/bot-blocked on ANY site
    const shouldTryCeneoFallback = isCeneoUrl || isAllegroUrl || isAmazonUrl || isBotBlocked || !scrapedPrice || scrapedPrice === 0;

    if (shouldTryCeneoFallback && (!scrapedPrice || scrapedPrice === 0 || isBotBlocked || isCeneoUrl)) {
      let ceneoResult = await searchCeneoFallback(scrapedTitle);

      // Automatic retry with simplified keywords if initial Ceneo query produced no price
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

        if (ceneoResult.title && ceneoResult.title.length > 5 && (isAllegroUrl || !scrapedTitle || scrapedTitle.length < 5 || scrapedTitle.includes('Amazon'))) {
          scrapedTitle = ceneoResult.title;
        }

        if (ceneoResult.ceneoUrl && isAllegroUrl) {
          finalTrackedUrl = ceneoResult.ceneoUrl;
          overrodeUrlToCeneo = true;
        }
      }
    }

    const needsManualPrice = !scrapedPrice || scrapedPrice === 0;

    let scrapeWarning: string | undefined;
    if (overrodeUrlToCeneo) {
      scrapeWarning = `Serwis Allegro stosuje ochronę anty-bot. Cenę (${scrapedPrice.toFixed(2)} zł) oraz adres do automatycznego śledzenia podmieniono na link z porównywarki Ceneo (${finalTrackedUrl})!`;
    } else if (fetchedFromCeneo) {
      scrapeWarning = `Pobrano cenę (${scrapedPrice.toFixed(2)} ${scrapedCurrency || 'zł'}) z porównywarki Ceneo dla "${scrapedTitle}".`;
    } else if (needsManualPrice) {
      scrapeWarning = isAllegroUrl
        ? 'Serwis Allegro stosuje ochronę anty-bot, a Ceneo nie zwróciło cen. Wpisz cenę ręcznie.'
        : isAmazonUrl
        ? 'Strona Amazon wymagała weryfikacji anty-bot i Ceneo nie znalazło jednoznacznej ceny. Sprawdź i wpisz cenę ręcznie.'
        : 'Nie udało się automatycznie odczytać ceny z tej strony. Sprawdź i wpisz cenę ręcznie.';
    }

    return res.json({
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
    });
  } catch (error: any) {
    console.error('Error in /api/scrape:', error);
    return res.status(500).json({ error: error.message || 'Scrape operation failed' });
  }
});

// Google Sheets: Create Spreadsheet
app.post('/api/sheets/create', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.accessToken;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }

    const title = req.body.title || 'Product Price Tracker Agent Output';

    // Create spreadsheet using Google Sheets API
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [
          {
            properties: {
              title: 'Price Log',
              gridProperties: { frozenRowCount: 1 },
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Google Sheets API error: ${errText}` });
    }

    const data = await response.json();
    const spreadsheetId = data.spreadsheetId;
    const spreadsheetUrl = data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    // Populate header row
    const headers = [
      ['Product Title', 'Product URL', 'Current Price', 'Previous Price', 'Lowest Price', 'Target Price', 'In Stock', 'Last Checked', 'Price Delta'],
    ];

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Price Log!A1:I1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: headers }),
      }
    );

    return res.json({
      spreadsheetId,
      title,
      url: spreadsheetUrl,
      message: 'Created new Google Sheet successfully!',
    });
  } catch (error: any) {
    console.error('Error in /api/sheets/create:', error);
    return res.status(500).json({ error: error.message || 'Failed to create spreadsheet' });
  }
});

// Google Sheets: Sync Products Data
app.post('/api/sheets/sync', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.accessToken;
    const { spreadsheetId, products } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }
    if (!spreadsheetId) {
      return res.status(400).json({ error: 'Spreadsheet ID is required' });
    }
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: 'Products array is required' });
    }

    const formatPriceStr = (val: number | null, curr: string) => {
      if (val === null || val === undefined) return 'N/A';
      const formatted = val.toFixed(2);
      return curr === 'zł' || curr === 'PLN' ? `${formatted} zł` : `${curr}${formatted}`;
    };

    const rows = [
      ['Product Title', 'Product URL', 'Current Price', 'Previous Price', 'Lowest Recorded', 'In Stock', 'Last Checked', 'Status'],
      ...products.map((p: any) => [
        p.title,
        p.url,
        formatPriceStr(p.currentPrice, p.currency || 'zł'),
        p.previousPrice !== null ? formatPriceStr(p.previousPrice, p.currency || 'zł') : 'N/A',
        formatPriceStr(p.lowestPrice, p.currency || 'zł'),
        p.inStock ? 'In Stock' : 'Out of Stock',
        p.lastChecked ? new Date(p.lastChecked).toLocaleString() : 'Never',
        p.previousPrice && p.currentPrice < p.previousPrice ? '📉 PRICE DROP' : 'Stable',
      ]),
    ];

    const range = `Price Log!A1:H${rows.length}`;
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: rows }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Google Sheets sync error: ${errText}` });
    }

    // Also sync Daily Lowest History Log if history exists
    const dailyHistoryRows = [
      ['Date', 'Product Title', 'Daily Lowest Price', 'Currency', 'Recorded At'],
    ];
    products.forEach((p: any) => {
      if (Array.isArray(p.priceHistory)) {
        p.priceHistory.forEach((pt: any) => {
          const dateStr = pt.timestamp ? pt.timestamp.split('T')[0] : 'N/A';
          dailyHistoryRows.push([
            dateStr,
            p.title,
            pt.price !== undefined ? pt.price.toFixed(2) : '0.00',
            p.currency || 'zł',
            pt.timestamp ? new Date(pt.timestamp).toLocaleString() : 'N/A',
          ]);
        });
      }
    });

    if (dailyHistoryRows.length > 1) {
      const historyRange = `Daily History!A1:E${dailyHistoryRows.length}`;
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(historyRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: dailyHistoryRows }),
        }
      ).catch(() => {}); // Optional secondary sheet range update
    }

    return res.json({
      success: true,
      syncedCount: products.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/sheets/sync:', error);
    return res.status(500).json({ error: error.message || 'Failed to sync Google Sheet' });
  }
});

// Google Sheets: List existing sheets from Drive
app.get('/api/sheets/list', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.query.accessToken;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }

    const driveUrl = `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name,webViewLink,modifiedTime)&pageSize=15`;
    const response = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Drive API error: ${errText}` });
    }

    const data = await response.json();
    return res.json({ files: data.files || [] });
  } catch (error: any) {
    console.error('Error in /api/sheets/list:', error);
    return res.status(500).json({ error: error.message || 'Failed to list sheets' });
  }
});

// Gmail: Send Price Alert Notification Email
app.post('/api/email/send', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.accessToken;
    const { recipientEmail, subject, htmlBody } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Google Access Token is required' });
    }
    if (!recipientEmail) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }

    const encodeMimeHeader = (text: string) => {
      if (/[^\x00-\x7F]/.test(text)) {
        return `=?UTF-8?B?${Buffer.from(text, 'utf-8').toString('base64')}?=`;
      }
      return text;
    };

    const cleanSubject = subject || 'Powiadomienie o obniżce ceny';

    const rawMessage = [
      `To: ${recipientEmail}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${encodeMimeHeader(cleanSubject)}`,
      '',
      htmlBody || '<p>Product price update notification.</p>',
    ].join('\r\n');

    const encodedMessage = Buffer.from(rawMessage, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Gmail API error: ${errText}` });
    }

    const data = await response.json();
    return res.json({
      success: true,
      messageId: data.id,
      sentTo: recipientEmail,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/email/send:', error);
    return res.status(500).json({ error: error.message || 'Failed to send email' });
  }
});

// Vite Middleware & Static Server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
