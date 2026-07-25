import { describe, it, expect, beforeEach } from 'vitest';
import {
  addProductToList,
  removeProductFromList,
  updateProductPrice,
  saveProductsToStorage,
  loadProductsFromStorage,
  buildGoogleSheetsRows,
} from '../src/utils/productManager';
import { Product } from '../src/types';

// Mock localStorage implementation for Node test environment
class MockStorage implements Storage {
  private store: Record<string, string> = {};
  get length() {
    return Object.keys(this.store).length;
  }
  clear() {
    this.store = {};
  }
  getItem(key: string) {
    return this.store[key] || null;
  }
  key(index: number) {
    return Object.keys(this.store)[index] || null;
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  setItem(key: string, value: string) {
    this.store[key] = value;
  }
}

describe('Product Manager Suite', () => {
  let mockStorage: MockStorage;
  let initialProducts: Product[];

  beforeEach(() => {
    mockStorage = new MockStorage();
    initialProducts = [
      {
        id: 'prod-1',
        title: 'Sony WH-1000XM5 Słuchawki Bezprzewodowe',
        url: 'https://www.sony.pl/headphones/wh-1000xm5',
        currentPrice: 1499,
        previousPrice: 1599,
        lowestPrice: 1399,
        currency: 'zł',
        inStock: true,
        lastChecked: new Date().toISOString(),
        priceHistory: [{ timestamp: new Date().toISOString(), price: 1499 }],
        status: 'active',
      },
    ];
  });

  it('adds a new product to the list', () => {
    const newProductInput = {
      title: 'Buty Cloudfoam Flex Rapidfit',
      url: 'https://www.adidas.pl/buty-cloudfoam-flex-rapidfit/HP6993.html',
      currentPrice: 299,
      previousPrice: null,
      lowestPrice: 299,
      currency: 'zł',
      inStock: true,
      lastChecked: null,
    };

    const updatedList = addProductToList(initialProducts, newProductInput);

    expect(updatedList.length).toBe(2);
    expect(updatedList[0].title).toBe('Buty Cloudfoam Flex Rapidfit');
    expect(updatedList[0].id).toBeDefined();
    expect(updatedList[0].priceHistory.length).toBe(1);
    expect(updatedList[0].priceHistory[0].price).toBe(299);
  });

  it('removes a product from the list by ID', () => {
    const updatedList = removeProductFromList(initialProducts, 'prod-1');
    expect(updatedList.length).toBe(0);
  });

  it('reloads price and updates currentPrice, previousPrice, lowestPrice, and history', () => {
    const reloadedList = updateProductPrice(initialProducts, 'prod-1', {
      price: 1299,
      title: 'Sony WH-1000XM5 - Okazja',
      inStock: true,
    });

    const updatedProduct = reloadedList.find((p) => p.id === 'prod-1')!;
    expect(updatedProduct.currentPrice).toBe(1299);
    expect(updatedProduct.previousPrice).toBe(1499);
    expect(updatedProduct.lowestPrice).toBe(1299);
    expect(updatedProduct.title).toBe('Sony WH-1000XM5 - Okazja');
    expect(updatedProduct.status).toBe('alert');
  });

  it('ensures product list stays untouched after app restart (Storage Persistence)', () => {
    const customList: Product[] = [
      ...initialProducts,
      {
        id: 'prod-2',
        title: 'Myszka Logitech MX Master 3S',
        url: 'https://www.logitech.com/mx-master-3s',
        currentPrice: 399,
        previousPrice: 449,
        lowestPrice: 399,
        currency: 'zł',
        inStock: true,
        lastChecked: new Date().toISOString(),
        priceHistory: [],
        status: 'active',
      },
    ];

    // 1. Save list to storage
    saveProductsToStorage(customList, mockStorage);

    // 2. Simulate App Restart by loading from storage with fallback
    const loadedList = loadProductsFromStorage(initialProducts, mockStorage);

    // 3. Verify list remains untouched and intact
    expect(loadedList.length).toBe(2);
    expect(loadedList[0].title).toBe('Sony WH-1000XM5 Słuchawki Bezprzewodowe');
    expect(loadedList[1].title).toBe('Myszka Logitech MX Master 3S');
  });

  it('formats product list correctly for Google Sheets storage sync', () => {
    const sheetRows = buildGoogleSheetsRows(initialProducts);

    expect(sheetRows.length).toBe(2); // 1 header + 1 product row
    expect(sheetRows[0][0]).toBe('Nazwa Produktu');
    expect(sheetRows[1][0]).toBe('Sony WH-1000XM5 Słuchawki Bezprzewodowe');
    expect(sheetRows[1][1]).toBe(1499);
    expect(sheetRows[1][2]).toBe(1599);
    expect(sheetRows[1][3]).toBe(1399);
    expect(sheetRows[1][4]).toBe('zł');
    expect(sheetRows[1][5]).toBe('W magazynie');
  });
});
