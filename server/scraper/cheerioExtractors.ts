import * as cheerio from 'cheerio';
import { parsePriceString } from './utils';

export function resolveUrl(imgSrc: string | undefined, href: string): string {
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
    return new URL(imgSrc, href).href;
  } catch {
    return imgSrc;
  }
}

export function extractMainProductImage($c: cheerio.CheerioAPI, href: string): string {
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
        const res = resolveUrl(content, href);
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
          const res = resolveUrl(rawSrc, href);
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
        const res = resolveUrl(src, href);
        if (res && (res.startsWith('http://') || res.startsWith('https://'))) return res;
      }
    }
  }

  return '';
}

export function extractAdidasPrice($clean: cheerio.CheerioAPI, html: string, targetSku: string | null): number {
  const $mainContainer = $clean('[data-auto-id="product-information"], [data-auto-id="pdp-main-content"], #main-content, main, #product-info, .pdp-main').first();
  const $context = $mainContainer.length > 0 ? $mainContainer : $clean('body');

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
  let price = 0;

  for (const sel of adidasPriceSelectors) {
    $context.find(sel).each((_, el) => {
      const txt = $clean(el).text().trim();
      if (txt) {
        const m = txt.match(/(\d[\d\s\.]*[\,\.]\d{2}|\d[\d\s]*)/);
        if (m && m[1]) {
          const p = parsePriceString(m[1]);
          if (p > 0) {
            price = p;
            return false;
          }
        }
      }
    });
    if (price > 0) break;
  }

  if (price === 0 && !targetSku) {
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
          price = val;
          break;
        }
      }
    }
  }

  return price;
}

export function extractAmazonPrice($clean: cheerio.CheerioAPI, html: string): number {
  const primaryPriceContainerSelectors = [
    '#corePriceDisplay_desktop_feature_div',
    '#corePrice_desktop',
    '#apex_desktop',
    '#corePriceDisplay_mobile_feature_div',
    '#corePrice_mobile_feature_div',
    '#apex_mobile_feature_div',
    '#corePrice_feature_div',
    '#price_inside_buybox',
    '#newBuyBoxPrice',
    '#priceblock_dealprice',
    '#priceblock_ourprice',
    '#priceblock_saleprice',
    '#buybox',
  ];

  const amzPriceSelectors = [
    '.priceToPay .a-offscreen',
    '.a-price:not(.a-text-price) .a-offscreen',
    '.apexPriceToPay .a-offscreen',
    '#price_inside_buybox',
    '#newBuyBoxPrice',
    '#priceblock_dealprice',
    '#priceblock_ourprice',
    '#priceblock_saleprice',
  ];

  let scrapedPrice = 0;

  for (const containerSel of primaryPriceContainerSelectors) {
    if (scrapedPrice > 0) break;
    const $container = $clean(containerSel).first();
    if ($container.length === 0) continue;

    for (const sel of amzPriceSelectors) {
      const txt = $container.find(sel).first().text().trim();
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
      const whole = $container.find('.a-price-whole').first().text().trim();
      const fraction = $container.find('.a-price-fraction').first().text().trim();
      if (whole) {
        const cleanW = whole.replace(/[^\d]/g, '');
        const cleanF = fraction ? fraction.replace(/[^\d]/g, '') : '00';
        if (cleanW) {
          const p = parsePriceString(`${cleanW}.${cleanF}`);
          if (p > 0) {
            scrapedPrice = p;
            break;
          }
        }
      }
    }
  }

  if (!scrapedPrice || scrapedPrice === 0) {
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

  return scrapedPrice;
}
