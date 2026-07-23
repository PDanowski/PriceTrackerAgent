import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { sheetsRouter } from './server/sheets';
import { emailRouter } from './server/email';
import { scrapeProductDetails } from './server/scraper';

// Resolve directory safely across ESM (dev) and CJS (production bundle)
const getDirname = () => {
  if (typeof __dirname !== 'undefined') return __dirname;
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
};

const app = express();
app.use(express.json());

const PORT = 3000;

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount modular Routers
app.use('/api/sheets', sheetsRouter);
app.use('/api/email', emailRouter);

// Product Scraping endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid URL is required' });
    }

    const scrapedData = await scrapeProductDetails(url);
    return res.json(scrapedData);
  } catch (error: any) {
    console.error('Error in /api/scrape:', error);
    return res.status(500).json({ error: error.message || 'Scrape operation failed' });
  }
});

// Vite Middleware & Static Server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
