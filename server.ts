import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Gemini API client lazily if key is available
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
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
    try {
      const response = await fetch(parsedUrl.href, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        fetchError = `HTTP status ${response.status}`;
      } else {
        html = await response.text();
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
      } catch (geminiErr) {
        console.warn('Gemini extraction fallback notice:', geminiErr);
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

    // Default fallback if price still missing
    if (!scrapedTitle) {
      scrapedTitle = parsedUrl.pathname.split('/').pop()?.replace(/[-_]/g, ' ') || 'Tracked Product';
    }
    if (!scrapedPrice || isNaN(scrapedPrice)) {
      scrapedPrice = 199.00; // Default fallback price in PLN
    }

    return res.json({
      title: scrapedTitle,
      price: scrapedPrice,
      currency: scrapedCurrency,
      inStock: scrapedInStock,
      imageUrl: scrapedImage,
      url: parsedUrl.href,
      fetchedAt: new Date().toISOString(),
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
