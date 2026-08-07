# 🏷️ Smart Price Tracker & Agent

A feature-rich full-stack web application and automated background agent designed for real-time e-commerce product price tracking, price drop alerts via Gmail, Google Sheets data export, and Google Drive cloud backups.

---

## ✨ Key Features

- 🕵️ **Parallel E-Commerce Price Checker**: Automated multi-process worker pool (4 parallel tasks) that periodically checks prices across Allegro, Amazon, Ceneo, Media Expert, RTV EURO AGD, X-Kom, Morele, Empire/Castorama, Zalando, eBay, and generic web stores.
- 🤖 **AI-Powered Fallback & Smart Scraping**: Integrates Google Gemini (`@google/genai`) to extract titles, current prices, and availability from complex dynamic HTML structures when standard DOM meta tags or CSS selectors fail.
- 📊 **Google Sheets Integration**: Synchronize tracked product data (title, current price, lowest price, availability, link, last check time) to custom or automatically created Google Sheets spreadsheets in real-time.
- ☁️ **Google Drive Backup & Restore**: Automatic background synchronization of product database (`Price_Tracker_Products_Backup.json`) directly to user's Google Drive, plus local JSON file export/import and browser cache auto-restore options.
- 📧 **Gmail Price Drop Alerts**: Automatic email notifications sent directly through user's Gmail OAuth connection whenever a product price drops significantly (≥5%).
- 🏷️ **Color Badges & Filter Controls**: Tag products with custom color badges (Blue, Green, Purple, Amber, Rose, Indigo, Cyan, Slate) and filter or search through products instantaneously.
- 📈 **Interactive Price History Charts**: View daily minima, historical price drop percentages, and trend visualizers powered by Recharts.
- ⚡ **Manual Price Override**: Override prices manually whenever stores enforce strict anti-bot protections.

---

## 🛠️ Tech Stack & Architecture

### **Frontend**
- **React 18 / 19 & Vite** - Fast SPA with state hooks, responsive modals, and Lucide icons.
- **Tailwind CSS v4** - Utility-first styling with modern UI components and light layout aesthetics.
- **Recharts** - Dynamic price history visualization and analytics.
- **Motion (`motion/react`)** - Smooth transitions and progress animations.

### **Backend**
- **Node.js & Express** - Full-stack API routes (`/api/*`) for web scraping, agent control, and Google Workspace integrations.
- **Cheerio** - Fast HTML parsing and DOM extraction (JSON-LD, OpenGraph, microdata).
- **Esbuild** - Bundles TypeScript backend into a CJS standalone server (`dist/server.cjs`) for production.

### **Integrations**
- **Google Workspace APIs**: Google Sheets API v4, Google Drive API v3, and Gmail API v1.
- **Google GenAI SDK**: `@google/genai` for server-side AI fallback extractions.

---

## 🚀 Getting Started

### **1. Prerequisites**
- **Node.js**: v18.0 or higher
- **npm**: v9.0 or higher

### **2. Environment Configuration**
Create a `.env` file in the root directory (refer to `.env.example`):

```env
# Optional: Google Gemini API Key for AI fallback scraping & extraction
GEMINI_API_KEY=your_gemini_api_key_here

# Required for Google Workspace OAuth (Sheets, Drive, Gmail)
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
```

### **3. Installation**
Install all dependencies:
```bash
npm install
```

### **4. Development**
Run the development server on `http://localhost:3000` (Express backend with Vite middleware):
```bash
npm run dev
```

### **5. Production Build & Start**
To build the application and start the production server:
```bash
npm run build
npm start
```

### **6. Code Linting & Testing**
Validate TypeScript typing and run unit test suites:
```bash
# Type check code
npm run lint

# Run Vitest unit tests
npm test
```

---

## ⚙️ Background Agent Scheduling

1. Open the application in your browser.
2. In the top panel, select your desired **Check Schedule** (e.g., *Every 1 hour*, *Every 3 hours*, *Every 6 hours*, *Daily at 12:00 PM*, or *Manual run only*).
3. Click **Run Price Check** to launch an immediate check, or leave the agent running to continuously monitor products and dispatch email/spreadsheet updates automatically.

---

## 🤖 AI SDLC & Project Guidelines

This repository follows standard AI SDLC guidelines documented in [`AGENTS.md`](./AGENTS.md) and [`AI_SDLC.md`](./AI_SDLC.md):
- **Continuous Quality Verification**: Automated linting (`npm run lint`), build validation (`npm run build`), and vitest testing (`npm test`).
- **500-Line Code Discipline**: Files are kept modular and under 500 lines of code.
- **Credential Security**: Zero hardcoded credentials or API keys committed to repository.
- **State Synchronization**: Isolated background agent state management and deterministic job progress tracking.

---

## 📄 License

MIT License. Designed and built with Google AI Studio.
