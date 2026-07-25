import { describe, it, expect } from 'vitest';
import { recordDailyLowestPrice, buildPriceDropEmailHtml } from '../src/utils/priceTrackerUtils';

describe('Price Tracker Utilities', () => {
  it('records initial daily price in history', () => {
    const history: Array<{ timestamp: string; price: number }> = [];
    const updated = recordDailyLowestPrice(history, 299);

    expect(updated.length).toBe(1);
    expect(updated[0].price).toBe(299);
  });

  it('updates daily record if a new lower price is found on the same day', () => {
    const todayISO = new Date().toISOString();
    const history = [{ timestamp: todayISO, price: 350 }];

    const updated = recordDailyLowestPrice(history, 299);

    expect(updated.length).toBe(1);
    expect(updated[0].price).toBe(299);
  });

  it('ignores higher prices on the same day to maintain daily lowest price', () => {
    const todayISO = new Date().toISOString();
    const history = [{ timestamp: todayISO, price: 299 }];

    const updated = recordDailyLowestPrice(history, 350);

    expect(updated.length).toBe(1);
    expect(updated[0].price).toBe(299);
  });

  it('generates email HTML for price drops', () => {
    const drops = [
      {
        title: 'Buty Cloudfoam Flex Rapidfit',
        oldPrice: 350,
        newPrice: 280,
        currency: 'zł',
        url: 'https://www.adidas.pl/buty-cloudfoam-flex-rapidfit/HP6993.html',
      },
    ];

    const html = buildPriceDropEmailHtml(drops);

    expect(html).toContain('Price Drop Alert!');
    expect(html).toContain('Buty Cloudfoam Flex Rapidfit');
    expect(html).toContain('zł350.00');
    expect(html).toContain('zł280.00');
    expect(html).toContain('-20.0%');
  });
});
