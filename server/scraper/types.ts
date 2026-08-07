export interface ScrapeResult {
  title: string;
  price: number;
  currency: string;
  inStock: boolean;
  imageUrl: string;
  url: string;
  fetchedAt: string;
  needsManualPrice: boolean;
  scrapeWarning?: string;
  fetchedFromCeneo: boolean;
  overrodeUrlToCeneo: boolean;
}

export interface UserAgentConfig {
  ua: string;
  platform: string;
  secUa: string;
  mobile: string;
}
