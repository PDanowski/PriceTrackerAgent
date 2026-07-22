const cheerio = require('cheerio');

async function testSwisscows(q) {
  try {
    const url = 'https://swisscows.com/en/web?query=' + encodeURIComponent(q);
    console.log('Fetching Swisscows:', url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8'
      }
    });
    console.log('Status:', res.status);
    const html = await res.text();
    console.log('HTML len:', html.length);

    // Look for prices
    const matches = html.match(/(\d+[\d\s,]*[\.,]?\d*)\s*(?:zł|PLN)/gi);
    console.log('Price matches in Swisscows HTML:', matches);

    // Look for Ceneo URLs
    const ceneoUrls = html.match(/https?:\/\/(?:www\.)?ceneo\.pl\/[^\s"'\>]+/gi);
    console.log('Ceneo URLs in Swisscows:', ceneoUrls);

    const $ = cheerio.load(html);
    console.log('Text snippet:', $('body').text().replace(/\s+/g, ' ').slice(0, 500));
  } catch(e) {
    console.error(e);
  }
}

testSwisscows('primabobo wanienka skladana lux ze stojakiem ceneo cena');
