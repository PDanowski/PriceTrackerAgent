import { describe, it, expect } from 'vitest';
import { cleanTitleFromUrl, parsePriceString } from '../server/scraper';

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

  it('extracts clean title from Adidas product URL slug', () => {
    const url = 'https://www.adidas.pl/buty-cloudfoam-flex-rapidfit/HP6993.html?cm_mmc=AdieSEM';
    const title = cleanTitleFromUrl(url);
    expect(title).toBe('Buty Cloudfoam Flex Rapidfit');
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
