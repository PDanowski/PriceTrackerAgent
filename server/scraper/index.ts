import * as cheerio from 'cheerio';
import { searchCeneoFallback } from '../ceneo';
import { ScrapeResult } from './types';
import {
  getGeminiClient,
  parsePriceString,
  extractSkuFromUrl,
  cleanTitleFromUrl,
  getRandomHeaders,
} from './utils';
import { runGeminiScrapeFallback } from './geminiScraper';
import {
  resolveUrl,
  extractMainProductImage,
  extractAdidasPrice,
  extractAmazonPrice,
} from './cheerioExtractors';

export { getGeminiClient, parsePriceString, extractSkuFromUrl, cleanTitleFromUrl };

export async function scrapeProductDetails(url: string): Promise<ScrapeResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  let targetFetchUrl = url;
  const isAmazon = parsedUrl.hostname.includes('amazon.');
  const amazonAsin = extractSkuFromUrl(url);
  if (isAmazon && amazonAsin) {
    targetFetchUrl = `https://${parsedUrl.hostname}/dp/${amazonAsin}`;
  }

  let html = '';
  let fetchError = '';
  let isAccessDeniedOrBlocked = false;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt) * 400 + Math.floor(Math.random() * 300);
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      const headers = getRandomHeaders(attempt, parsedUrl, isAmazon);
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
        break;
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

  const targetSku = extractSkuFromUrl(targetFetchUrl);

  if (html) {
    const $clean = cheerio.load(html);
    $clean('aside, footer, nav, .recommended, .suggestions, .suggested-products, .related-products, .similar-items, #recommendations, .cross-sell, .up-sell, [data-component="carousel"], [data-auto-id="color-picker"], [data-auto-id="color-variations"], [class*="color-variation"], [class*="color_variation"], [class*="colour-variation"], [class*="variant-picker"], [class*="other-colors"], .product-variants, .variant-selector, .available-colors, .color-swatches, .swatches, .other-variants').remove();
    $clean('.a-text-price, .a-text-strike, del, s, .strike, .old-price, .basisPrice, .original-price, [data-a-stripe], .listPrice, #listPrice, #priceblock_listprice, .was-price, .rrp-price').remove();

    if (targetSku && html) {
      const skuRegex1 = new RegExp(`"${targetSku}"[\\s\\S]{1,600}?"(?:unit_sale_price|sale_price|salePrice|priceValue|price|amount)"\\s*:\\s*"?([\\d\\.\\,]+)"?`, 'i');
      const match1 = html.match(skuRegex1);
      if (match1 && match1[1]) {
        const val = parsePriceString(match1[1]);
        if (val > 0 && val < 100000) {
          scrapedPrice = val;
        }
      } else {
        const skuRegex2 = new RegExp(`"(?:unit_sale_price|sale_price|salePrice|priceValue|price|amount)"\\s*:\\s*"?([\\d\\.\\,]+)"?[\\s\\S]{1,600}?"${targetSku}"`, 'i');
        const match2 = html.match(skuRegex2);
        if (match2 && match2[1]) {
          const val = parsePriceString(match2[1]);
          if (val > 0 && val < 100000) {
            scrapedPrice = val;
          }
        }
      }
    }

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
              scrapedImage = resolveUrl(rawImg, parsedUrl.href);
            }
            const offers = item.offers;
            if (offers) {
              const offerList = Array.isArray(offers)
                ? offers
                : offers.offers && Array.isArray(offers.offers)
                ? offers.offers
                : [offers];

              let matchedOffer: any = null;
              if (targetSku) {
                matchedOffer = offerList.find((off: any) => {
                  if (!off) return false;
                  const offSku = String(off.sku || off.productID || off.identifier || off.mpn || off.url || '').toUpperCase();
                  return offSku.includes(targetSku);
                });
              }

              const candidateOffers = matchedOffer ? [matchedOffer] : offerList;

              for (const offer of candidateOffers) {
                if (!offer) continue;
                const isAggregateWithoutSkuMatch = !matchedOffer && (offer['@type'] === 'AggregateOffer' || (offer.lowPrice !== undefined && offer.price === undefined));
                
                const rawPrice = offer.price ?? offer.priceAmount ?? (isAggregateWithoutSkuMatch ? null : offer.lowPrice) ?? offer.lowPrice ?? offer.highPrice;

                if (rawPrice !== undefined && rawPrice !== null && (!scrapedPrice || scrapedPrice === 0 || matchedOffer)) {
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
      scrapedImage = extractMainProductImage($clean, parsedUrl.href);
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

    if (parsedUrl.hostname.includes('adidas.')) {
      const adzTitle = $clean('[data-auto-id="product-title"], h1.product-title, h1').first().text().trim();
      if (adzTitle && adzTitle.length > 2) {
        scrapedTitle = adzTitle;
      }
      const adzPrice = extractAdidasPrice($clean, html, targetSku);
      if (adzPrice > 0) scrapedPrice = adzPrice;
    }

    if (parsedUrl.hostname.includes('amazon.')) {
      const amzTitle = $clean('#productTitle, #title, h1').first().text().trim();
      if (amzTitle && amzTitle.length > 2) {
        scrapedTitle = amzTitle;
      }
      const amzPrice = extractAmazonPrice($clean, html);
      if (amzPrice > 0) scrapedPrice = amzPrice;
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

  const ai = getGeminiClient();
  const needsAiFallback = (!scrapedPrice || scrapedPrice === 0 || !scrapedTitle || fetchError);
  if (needsAiFallback && ai) {
    const aiRes = await runGeminiScrapeFallback(ai, parsedUrl, targetSku, html);
    if (aiRes.title && !scrapedTitle) scrapedTitle = aiRes.title;
    if (aiRes.price && (!scrapedPrice || scrapedPrice === 0)) scrapedPrice = aiRes.price;
    if (aiRes.currency && !scrapedCurrency) {
      const c = String(aiRes.currency).trim();
      scrapedCurrency = c === 'PLN' ? 'zł' : c === 'EUR' ? '€' : c === 'USD' ? '$' : c === 'GBP' ? '£' : c;
    }
    if (typeof aiRes.inStock === 'boolean') scrapedInStock = aiRes.inStock;
    if (aiRes.imageUrl && !scrapedImage) scrapedImage = aiRes.imageUrl;
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

  if (targetSku && scrapedTitle && !scrapedTitle.toUpperCase().includes(targetSku)) {
    scrapedTitle = `${scrapedTitle} ${targetSku}`;
  }

  const isBotBlocked = isAccessDeniedOrBlocked || !!fetchError || !html || html.length < 500 || (scrapedPrice === 0 && (html.toLowerCase().includes('captcha') || html.toLowerCase().includes('robot check')));
  let fetchedFromCeneo = false;
  const finalTrackedUrl = parsedUrl.href;

  const needsPriceFallback = !scrapedPrice || scrapedPrice === 0;
  const isPolishDomain = parsedUrl.hostname.endsWith('.pl') || parsedUrl.hostname.includes('ceneo.') || scrapedCurrency === 'zł' || scrapedCurrency === 'PLN';

  if (needsPriceFallback && isPolishDomain && (isAllegroUrl || isAmazonUrl || isBotBlocked || !isCeneoUrl)) {
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
    scrapeWarning = `Could not directly read price from store page. Retrieved estimated price (${scrapedPrice.toFixed(2)} ${scrapedCurrency || 'zł'}) from Ceneo for "${scrapedTitle}". Product URL remains original.`;
  } else if (needsManualPrice) {
    scrapeWarning = isAllegroUrl
      ? 'Allegro uses anti-bot protection and Ceneo did not return prices. Please enter price manually.'
      : isAmazonUrl
      ? 'Amazon page required anti-bot verification. Please check and enter price manually.'
      : 'Could not automatically read price from this page. Please check and enter price manually.';
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
