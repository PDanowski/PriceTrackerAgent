import { describe, it, expect } from 'vitest';
import { Product } from '../src/types';

function filterProducts(
  products: Product[],
  searchQuery: string,
  selectedColorBadge: string
): Product[] {
  return products.filter((product) => {
    const matchesSearch =
      !searchQuery.trim() ||
      product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.category && product.category.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesBadge =
      selectedColorBadge === 'all' ||
      (selectedColorBadge === 'none'
        ? !product.colorBadge
        : product.colorBadge === selectedColorBadge);

    return matchesSearch && matchesBadge;
  });
}

describe('Product Filter Suite', () => {
  const sampleProducts: Product[] = [
    {
      id: 'p1',
      title: 'Słuchawki Sony WH-1000XM5',
      url: 'https://sony.pl/headphones',
      currentPrice: 1499,
      previousPrice: 1599,
      lowestPrice: 1399,
      currency: 'zł',
      inStock: true,
      lastChecked: null,
      priceHistory: [],
      category: 'Elektronika',
      colorBadge: 'emerald',
      status: 'active',
    },
    {
      id: 'p2',
      title: 'Buty Adidas Rapidfit',
      url: 'https://adidas.pl/buty',
      currentPrice: 299,
      previousPrice: null,
      lowestPrice: 299,
      currency: 'zł',
      inStock: true,
      lastChecked: null,
      priceHistory: [],
      category: 'Obuwie',
      colorBadge: 'indigo',
      status: 'active',
    },
    {
      id: 'p3',
      title: 'Kawa Ziarnista Arabica 1kg',
      url: 'https://sklep.pl/kawa',
      currentPrice: 89,
      previousPrice: null,
      lowestPrice: 89,
      currency: 'zł',
      inStock: true,
      lastChecked: null,
      priceHistory: [],
      status: 'active',
    },
  ];

  it('filters products by title search query', () => {
    const res = filterProducts(sampleProducts, 'Sony', 'all');
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('p1');
  });

  it('filters products by category search query', () => {
    const res = filterProducts(sampleProducts, 'Obuwie', 'all');
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('p2');
  });

  it('filters products by color badge', () => {
    const res = filterProducts(sampleProducts, '', 'emerald');
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('p1');
  });

  it('filters products with no color badge when "none" selected', () => {
    const res = filterProducts(sampleProducts, '', 'none');
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('p3');
  });
});
