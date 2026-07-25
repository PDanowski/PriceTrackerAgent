# 🏷️ Smart Price Tracker & Agent

A modern full-stack web application and automated background agent designed for real-time e-commerce product price tracking, price drop detection, Google Sheets export, and Gmail notifications.

---

## 🛠️ Technologies Used

### **Languages & Frameworks**
- **TypeScript** - End-to-end static typing for both client and server.
- **React 18 + Vite** - Fast SPA frontend with reactive state hooks and Lucide icons.
- **Node.js + Express** - Full-stack server handling web scraping, REST APIs, and background agent scheduling.
- **Tailwind CSS v4** - Modern utility-first styling with dark/light mode support and custom UI components.

### **Key Packages & Dependencies**
- **`@google/genai`** - Official Google Gemini AI SDK for intelligent scraping fallbacks and content extraction.
- **`cheerio`** - Fast HTML parsing and DOM manipulation for server-side scraping (JSON-LD, OpenGraph, microdata).
- **`lucide-react`** - Clean vector icon library.
- **`motion`** - Smooth animations for progress bars, notifications, and interactive modals.
- **`recharts`** - Interactive price history charts (min/max/average price trends over time).
- **`vitest`** - Unit testing framework for scraper logic and price math.

---

## 🤖 AI Usage in the App

This application leverages **Google Gemini AI** (`gemini-2.5-flash` / `@google/genai`) to ensure robust price tracking even when standard web scrapers fail due to non-standard HTML structures, complex dynamic rendering, or obfuscated product markup:

1. **Intelligent Web Scraping Fallback**: When HTML meta tags (JSON-LD, OpenGraph) or CSS selectors cannot extract a valid price, Gemini receives stripped HTML content to accurately identify product titles, current prices, currency, and availability.
2. **Dynamic Ceneo Matching**: Uses Gemini to analyze Ceneo search results and pick the exact matching offer URL for Polish store products.
3. **Smart Currency & Price Parsing**: AI-powered normalization of localized European price strings (e.g., `1 445,00 zł`, `1.445 PLN`, `€314.30`).

---

## 🚀 How to Run the App & Agent

### **1. Prerequisites**
- Node.js 18+ installed
- npm or yarn

### **2. Setup Environment Variables**
Create a `.env` file at the root of the project (refer to `.env.example`):
```env
# Optional: Google Gemini API Key for AI fallback scraping & smart extraction
GEMINI_API_KEY=your_gemini_api_key_here

# Required for Google Sheets & Gmail OAuth integration
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id
```

### **3. Install Dependencies**
```bash
npm install
```

### **4. Start Development Server & Background Agent**
Run the full-stack dev server (Express backend + Vite frontend on port `3000`):
```bash
npm run dev
```

### **5. Production Build & Start**
To build and start the compiled application:
```bash
npm run build
npm start
```

### **6. Running the Background Agent**
- In the web UI, navigate to the **Agent Control Panel**.
- Set your preferred check interval (e.g. 1 hour, 6 hours, 24 hours).
- Click **Start Agent**. The server background loop will automatically track prices, log history, sync with your connected Google Sheet, and send email alerts on detected price drops.
