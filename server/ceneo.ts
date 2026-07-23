import * as cheerio from 'cheerio';

const ACCESSORY_WORDS = ['etui', 'case', 'pokrowiec', 'szkło', 'folia', 'kabel', 'pasek', 'ładowarka', 'adapter', 'uchwyt', 'obudowa', 'osłona', 'przejściówka', 'stojak', 'bateria', 'poduszka', 'stelaż'];

// Helper to search Ceneo directly by scraping Ceneo search HTML or product pages
export async function searchDirectCeneo(cleanQuery: string, keyWords: string[]): Promise<{ price: number; title?: string; ceneoUrl?: string } | null> {
  try {
    const searchTerms = keyWords.slice(0, 6).join(' ');
    if (!searchTerms || searchTerms.length < 2) return null;

    const queryLower = cleanQuery.toLowerCase();
    const queryHasAccessory = ACCESSORY_WORDS.some((w) => queryLower.includes(w));

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
    let highestScore = -100;

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

        // Heavy penalty if candidate title contains accessory words when the user's search query did not
        if (!queryHasAccessory && ACCESSORY_WORDS.some((acc) => titleLower.includes(acc))) {
          score -= 15;
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

    if (bestResult && highestScore >= 1 && bestResult.price > 0) {
      return bestResult;
    }

    return null;
  } catch {
    return null;
  }
}

// Helper to search Ceneo price comparator as a fallback when direct e-commerce site scraping is blocked
export async function searchCeneoFallback(queryTitle: string): Promise<{ price: number; title?: string; ceneoUrl?: string } | null> {
  try {
    const cleanQuery = queryTitle.replace(/[^\w\s\u00C0-\u024F]/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanQuery || cleanQuery.length < 3) return null;

    const queryLower = cleanQuery.toLowerCase();
    const queryHasAccessory = ACCESSORY_WORDS.some((w) => queryLower.includes(w));

    // Polish stop words to ignore when extracting key terms
    const stopWords = new Set(['dla', 'ze', 'z', 'do', 'i', 'w', 'na', 'o', 'od', 'za', 'po', 'pod', 'przed']);
    const words = cleanQuery.split(' ');
    const keyWords = words.filter((w) => !stopWords.has(w.toLowerCase()) && w.length > 1);

    // 1. First priority: Direct Ceneo Search
    const directResult = await searchDirectCeneo(cleanQuery, keyWords);
    if (directResult && directResult.price > 0) {
      return directResult;
    }

    // Build targeted search queries preserving key features
    const searchQueries = [
      `${cleanQuery} ceneo cena`,
      `ceneo ${keyWords.slice(0, 8).join(' ')}`,
      `${keyWords.slice(0, 6).join(' ')} ceneo`,
    ];

    let bestResult: { price: number; title?: string; ceneoUrl?: string } | null = null;
    let highestScore = -100;

    for (const q of searchQueries) {
      // 2. Yahoo Search Engine
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
            }
            if (!ceneoUrl && rawLink.includes('ceneo.pl') && !rawLink.includes('yahoo.com')) {
              ceneoUrl = rawLink;
            }

            if (ceneoUrl.startsWith('//')) {
              ceneoUrl = 'https:' + ceneoUrl;
            } else if (ceneoUrl && !ceneoUrl.startsWith('http')) {
              ceneoUrl = 'https://' + ceneoUrl.replace(/^\/+/, '');
            }

            if (!ceneoUrl || !ceneoUrl.includes('ceneo.pl')) return;

            const combined = (title + ' ' + snippet).trim();
            if (/pepper|kod rabatowy|kupon|zniżk|okazj|rabat|promocj/i.test(combined)) return;

            // Strip out shipping costs, installments, delivery promos before matching product price
            const cleanSnippetText = combined
              .replace(/(?:dostawa|przesyłka|wysyłka|paczkomat)\s*(?:od)?\s*\d+[\d\s,]*[\.,]?\d*\s*(?:zł|PLN)/gi, '')
              .replace(/(?:raty?|miesiąc|mies\.?)\s*(?:od)?\s*\d+[\d\s,]*[\.,]?\d*\s*(?:zł|PLN)/gi, '')
              .replace(/rabat\s*\d+[\d\s,]*[\.,]?\d*\s*(?:zł|PLN)/gi, '');

            const priceMatch = cleanSnippetText.match(/(?:od\s*)?(\d+[\d\s,]*[\.,]?\d*)\s*(?:zł|PLN)/i);
            if (!priceMatch) return;

            const rawNum = priceMatch[1].replace(/\s+/g, '').replace(',', '.');
            const val = parseFloat(rawNum);
            if (isNaN(val) || val <= 0 || val > 100000) return;

            let score = 0;
            const combinedLower = combined.toLowerCase();

            for (const kw of keyWords) {
              if (combinedLower.includes(kw.toLowerCase())) {
                score += 2;
              }
            }

            score += 5;

            if (!queryHasAccessory && ACCESSORY_WORDS.some((acc) => combinedLower.includes(acc))) {
              score -= 15;
            }

            if (score > highestScore) {
              highestScore = score;
              bestResult = {
                price: val,
                title: title.replace(/\s*-\s*Ceneo.*$/i, '').replace(/\s*-\s*Ceny.*$/i, '').replace(/[\.\. ]+$/g, '').trim() || undefined,
                ceneoUrl,
              };
            }
          });

          if (bestResult && bestResult.price > 0 && highestScore >= 7) {
            return bestResult;
          }
        }
      } catch (err) {
        // Fallback to next query
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
            if (rawUrl.includes('uddg=')) {
              try {
                const match = rawUrl.match(/uddg=([^&]+)/);
                if (match) {
                  const decoded = decodeURIComponent(match[1]);
                  if (decoded.includes('ceneo.pl')) ceneoUrl = decoded;
                }
              } catch {}
            }
            if (!ceneoUrl && rawUrl.includes('ceneo.pl') && !rawUrl.includes('duckduckgo.com')) {
              ceneoUrl = rawUrl;
            }

            if (ceneoUrl.startsWith('//')) {
              ceneoUrl = 'https:' + ceneoUrl;
            } else if (ceneoUrl && !ceneoUrl.startsWith('http')) {
              ceneoUrl = 'https://' + ceneoUrl.replace(/^\/+/, '');
            }

            if (!ceneoUrl || !ceneoUrl.includes('ceneo.pl')) return;

            const combined = (t + ' ' + s).trim();
            if (/pepper|kod rabatowy|kupon|zniżk|okazj|rabat|promocj/i.test(combined)) return;

            // Strip out shipping costs, installments, delivery promos before matching product price
            const cleanSnippetText = combined
              .replace(/(?:dostawa|przesyłka|wysyłka|paczkomat)\s*(?:od)?\s*\d+[\d\s,]*[\.,]?\d*\s*(?:zł|PLN)/gi, '')
              .replace(/(?:raty?|miesiąc|mies\.?)\s*(?:od)?\s*\d+[\d\s,]*[\.,]?\d*\s*(?:zł|PLN)/gi, '')
              .replace(/rabat\s*\d+[\d\s,]*[\.,]?\d*\s*(?:zł|PLN)/gi, '');

            const priceMatch = cleanSnippetText.match(/(?:od\s*)?(\d+[\d\s,]*[\.,]?\d*)\s*(?:zł|PLN)/i);
            if (!priceMatch) return;

            const rawNum = priceMatch[1].replace(/\s+/g, '').replace(',', '.');
            const val = parseFloat(rawNum);
            if (isNaN(val) || val <= 0 || val > 100000) return;

            let score = 0;
            const combinedLower = combined.toLowerCase();

            for (const kw of keyWords) {
              if (combinedLower.includes(kw.toLowerCase())) score += 2;
            }
            score += 5;

            if (!queryHasAccessory && ACCESSORY_WORDS.some((acc) => combinedLower.includes(acc))) {
              score -= 15;
            }

            if (score > highestScore) {
              highestScore = score;
              bestResult = {
                price: val,
                title: t.replace(/\s*-\s*Ceneo.*$/i, '').replace(/\s*-\s*Ceny.*$/i, '').replace(/[\.\. ]+$/g, '').trim() || undefined,
                ceneoUrl,
              };
            }
          });

          if (bestResult && bestResult.price > 0 && highestScore >= 7) {
            return bestResult;
          }
        }
      } catch (err) {
        // Continue
      }
    }

    if (bestResult && bestResult.price > 0 && highestScore > 0) {
      return bestResult;
    }

    const fallbackCeneoUrl = `https://www.ceneo.pl/;szukaj-${encodeURIComponent(keyWords.slice(0, 5).join(' '))}`;
    return { price: 0, ceneoUrl: fallbackCeneoUrl };
  } catch (err) {
    console.warn('Ceneo price fallback warning:', err);
    return null;
  }
}

