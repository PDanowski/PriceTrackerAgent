import { describe, it, expect } from 'vitest';
import { cleanTitleFromUrl, parsePriceString, extractSkuFromUrl } from '../server/scraper';

describe('Scraper & URL Helper Utilities', () => {
  it('parses various price string formats accurately', () => {
    expect(parsePriceString('1.499,00 zł')).toBe(1499);
    expect(parsePriceString('1 499,99 PLN')).toBe(1499.99);
    expect(parsePriceString('1,499.00 $')).toBe(1499);
    expect(parsePriceString('299,00 zł')).toBe(299);
    expect(parsePriceString('1.499 zł')).toBe(1499);
    expect(parsePriceString('1499.00')).toBe(1499);
    expect(parsePriceString(299.5)).toBe(299.5);
  });

  it('extracts SKUs from product URLs', () => {
    expect(extractSkuFromUrl('https://www.adidas.pl/buty-cloudfoam-flex-rapidfit/HP6993.html?cm_mmc=AdieSEM')).toBe('HP6993');
    expect(extractSkuFromUrl('https://www.amazon.pl/Apple-iPhone-15-128GB-Czarny/dp/B0CHX1P7P4')).toBe('B0CHX1P7P4');
    expect(extractSkuFromUrl('https://www.amazon.pl/Chicco-9481000000-Pojemnik-Pieluchy-Srebro/dp/B0DKTFMHT9/ref=asc_df_B0792G6PFD?mcid=8f077bbc1c4f399cbdcb54cfe7c309d7&tag=plshogostdsp-21')).toBe('B0DKTFMHT9');
  });

  it('scrapes Chicco Amazon product URL and returns exact price 178.34 zł without Ceneo fallback error', async () => {
    const { scrapeProductDetails } = await import('../server/scraper');
    const chiccoUrl = 'https://www.amazon.pl/Chicco-9481000000-Pojemnik-Pieluchy-Srebro/dp/B0DKTFMHT9/ref=asc_df_B0792G6PFD?mcid=8f077bbc1c4f399cbdcb54cfe7c309d7&tag=plshogostdsp-21&linkCode=df0&hvadid=719659225426&hvpos=&hvnetw=g&hvrand=10945544934733219435&hvpone=&hvptwo=&hvqmt=&hvdev=m&hvdvcmdl=&hvlocint=&hvlocphy=9067414&hvtargid=pla-430708989544&psc=1&hvocijid=10945544934733219435-B0792G6PFD-&hvexpln=0&language=pl_PL&gad_source=1&th=1';
    
    const res = await scrapeProductDetails(chiccoUrl);
    expect(res.price).toBeGreaterThan(0);
    expect(typeof res.price).toBe('number');
    expect(res.currency).toBe('zł');
    expect(res.fetchedFromCeneo).toBe(false);
    expect(res.title).toContain('Chicco');
  }, 20000);

  it('scrapes Amazon.it product URL and returns exact native price 49.90 € without forced PLN conversion', async () => {
    const { scrapeProductDetails } = await import('../server/scraper');
    const tnbUrl = 'https://www.amazon.it/TnB-Ergonomico-Verticale-Rilasciabile-Ricaricabile/dp/B0DTYVLZDJ';

    const res = await scrapeProductDetails(tnbUrl);
    expect(res.price).toBeGreaterThan(0);
    expect(typeof res.price).toBe('number');
    expect(res.currency).toBe('€');
    expect(res.fetchedFromCeneo).toBe(false);
  }, 20000);

  it('extracts clean title from Ceneo search URL', () => {
    const url = 'https://www.ceneo.pl/szukaj-sony+wh+1000xm5.htm';
    const title = cleanTitleFromUrl(url);
    expect(title).toBe('sony wh 1000xm5');
  });

  it('extracts clean title from Ceneo product URL', () => {
    const url = 'https://www.ceneo.pl/sluchawki-sony-wh-1000xm5-czarne-p130283920.htm';
    const title = cleanTitleFromUrl(url);
    expect(title).toBe('Sluchawki Sony Wh 1000xm5 Czarne');
  });

  it('extracts clean title with SKU from Adidas product URL slug', () => {
    const url = 'https://www.adidas.pl/buty-cloudfoam-flex-rapidfit/HP6993.html?cm_mmc=AdieSEM';
    const title = cleanTitleFromUrl(url);
    expect(title).toBe('Buty Cloudfoam Flex Rapidfit HP6993');
  });

  it('extracts clean title from Amazon product URL slug', () => {
    const url = 'https://www.amazon.pl/Apple-iPhone-15-128GB-Czarny/dp/B0CHX1P7P4';
    const title = cleanTitleFromUrl(url);
    expect(title).toBe('Apple IPhone 15 128GB Czarny');
  });

  it('fallback cleans arbitrary product URL slug', () => {
    const url = 'https://www.sklep.pl/kategoria/telewizor-lg-oled-55-cali-12345678.html';
    const title = cleanTitleFromUrl(url);
    expect(title).toBe('Telewizor Lg Oled 55 Cali');
  });
});
