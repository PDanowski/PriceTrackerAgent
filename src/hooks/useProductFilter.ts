import { useState, useMemo } from 'react';
import { Product } from '../types';

export function useProductFilter(products: Product[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColorBadge, setSelectedColorBadge] = useState('all');

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch =
        !searchQuery.trim() ||
        product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (product.category && product.category.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesBadge =
        selectedColorBadge === 'all' ||
        (selectedColorBadge === 'none' ? !product.colorBadge : product.colorBadge === selectedColorBadge);

      return matchesSearch && matchesBadge;
    });
  }, [products, searchQuery, selectedColorBadge]);

  return {
    searchQuery,
    setSearchQuery,
    selectedColorBadge,
    setSelectedColorBadge,
    filteredProducts,
  };
}
