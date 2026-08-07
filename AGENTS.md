# 🤖 AI Software Development Life Cycle (AI SDLC) Guidelines

This repository enforces an AI SDLC framework for automated coding assistants and human collaborators to ensure consistent code quality, safety, modularity, and operational reliability.

---

## 📐 Core Engineering Principles

### 1. **Modular Architecture & File Size Limits**
- **500-Line Limit**: No source file should exceed 500 lines of code. Split large files into modular components, utilities, and helper modules.
- **Separation of Concerns**: Keep UI components (`src/components/`), business/agent logic (`server/agentTask.ts`), web scraping routines (`server/scraper.ts`), and type definitions (`src/types.ts`) cleanly isolated.

### 2. **Security & Credentials Management**
- **Zero Secrets in Code**: Never commit or hardcode API keys, passwords, or tokens in source code or configuration files.
- **Environment Discipline**: Always declare required environment variables in `.env.example` and load secrets via `process.env` on the server side.

### 3. **Scope Discipline & Minimal Intent**
- **Respect User Scope**: Implement exactly what is requested. Avoid adding unsolicited feature bloat, extra navigation tabs, or unnecessary third-party services.
- **Clear & Scannable Interfaces**: Maintain high-contrast visual design, fluid layouts, and complete event handlers for all UI controls.

---

## 🔄 Verification & Quality Lifecycle

Before declaring any feature or bug fix complete:

1. **Type Checking & Linting**: Run `npm run lint` (or `tsc --noEmit`) to verify zero syntax and type errors.
2. **Unit & Integration Testing**: Run `npm test` (or `vitest`) to ensure existing regression tests pass.
3. **Build Compilation**: Perform a complete application build (`npm run build` / `compile_applet`) to verify production bundle integrity.
4. **Documentation Sync**: Keep `README.md` updated whenever new APIs, scripts, or architectural features are introduced.

---

## 🛠️ Concurrency & State Management Rules

- **Deterministic Progress Tracking**: Avoid race conditions when tracking multi-worker parallel jobs. Use atomic completion counters rather than mutating worker-specific positions.
- **Safe State Synchronization**: Prevent background server sync polling from overwriting actively running client-side agent loops.
