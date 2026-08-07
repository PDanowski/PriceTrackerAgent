# 🤖 AI Software Development Life Cycle (AI SDLC) Documentation

This document outlines the software engineering principles, AI integration patterns, state management strategies, and operational practices established for this application.

---

## 📐 Core Engineering & Architecture Rules

### 1. **Modular Architecture & File Size Limits**
- **500-Line Limit**: No source file should exceed 500 lines of code. Large components or utilities are decomposed into distinct, cohesive modules.
- **Clean Isolation**:
  - `src/components/`: Modular UI presentation components.
  - `src/utils/`: Pure helper functions, formatting tools, and CSV/JSON handlers.
  - `server/`: Express API server routines, scraper engines (`scraper.ts`), and agent task automation (`agentTask.ts`).
  - `src/types.ts`: Global TypeScript interfaces and data models.

### 2. **Security & Credentials Management**
- **Server-Side API Proxying**: Third-party credentials and AI API keys (`GEMINI_API_KEY`) are kept strictly on the server (`server.ts` / `server/`). They are never exposed to the client bundle.
- **Environment Discipline**: All required environment keys are defined in `.env.example` with zero hardcoded values in code.

---

## 🤖 Gemini API Usage Patterns

1. **SDK Standard**: Uses the modern `@google/genai` SDK (`GoogleGenAI`) in server-side scrapers.
2. **AI Fallback Scraping**: When DOM metadata, JSON-LD, microdata, or CSS selector parsing fails on complex store structures, raw HTML fragments are sent to Gemini to extract structured JSON containing `title`, `currentPrice`, `currency`, and `availability`.
3. **Graceful Degradation**: If `GEMINI_API_KEY` is absent or quota is exceeded, the scraper falls back safely to traditional CSS/heuristic extractors without breaking worker tasks.

---

## ⚡ Concurrency & State Management Strategies

### 1. **Deterministic Parallel Job Progress Tracking**
- Multi-process parallel checks (e.g., 4 concurrent workers) use an atomic **completed count** (`completedCount++`) rather than tracking mutable worker slots or indices.
- This prevents visual jitter (e.g., progress jumping between 8/14, 3/14, and 10/14) caused by asynchronous worker completion order.

### 2. **Race-Condition Prevention During Synchronization**
- When the client-side agent loop is actively running (`isAgentRunningRef.current === true`), background server synchronization polling (`syncWithServer`) is paused.
- This guarantees that server-side state updates do not overwrite active client memory or trigger state flickering during active price check runs.

### 3. **Dual-Layer Persistence**
- **Client Storage**: Fast local state (`localStorage`) keeps UI responsive across reloads.
- **Google Workspace & Cloud Sync**: Optional OAuth integration syncs results to Google Sheets, sends price drop alerts via Gmail, and maintains cloud backups on Google Drive (`Price_Tracker_Products_Backup.json`).

---

## 🔄 Quality & Verification Lifecycle

Before committing changes or declaring tasks complete:
1. **Type Safety & Linting**: `npm run lint` (`tsc --noEmit`)
2. **Unit Testing**: `npm test` (`vitest`)
3. **Applet Compilation**: `compile_applet` / `npm run build`
4. **Documentation Alignment**: Maintain updated `README.md`, `AGENTS.md`, and `AI_SDLC.md`.
