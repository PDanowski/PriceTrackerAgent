# 🤖 AI Software Development Life Cycle (AI SDLC) Guidelines

This repository enforces an AI SDLC framework for automated coding assistants and human collaborators to ensure consistent code quality, safety, modularity, and operational reliability.

---

## 📐 Core Engineering Principles

### 1. **Modular Architecture & File Size Limits (SOLID Principles)**
- **500-Line Limit**: No source file should exceed 500 lines of code. Split large files into modular components, hooks, services, utilities, and helper modules.
- **SOLID Design Principles**:
  - **Single Responsibility (SRP)**: Each component, module, or class must have a single, well-defined responsibility.
  - **Open/Closed (OCP)**: Modules and services should be open for extension (e.g., store scraper strategy registry) but closed for modification.
  - **Liskov Substitution (LSP)**: Implementations of abstractions or interfaces must be fully interchangeable.
  - **Interface Segregation (ISP)**: Keep interfaces small, focused, and cohesive without forcing components to depend on unused methods.
  - **Dependency Inversion (DIP)**: High-level modules and hooks depend on abstractions or service abstractions, not tightly coupled concretions.
- **Separation of Concerns**: Keep UI components (`src/components/`), custom hooks (`src/hooks/`), business/agent logic (`server/agentTask.ts`), web scraping engines (`server/scraper/`), and type definitions (`src/types.ts`) cleanly isolated.

### 2. **Security & Credentials Management**
- **Zero Secrets in Code**: Never commit or hardcode API keys, passwords, or tokens in source code or configuration files.
- **Environment Discipline**: Always declare required environment variables in `.env.example` and load secrets via `process.env` on the server side.

### 3. **Scope Discipline & Minimal Intent**
- **Respect User Scope**: Implement exactly what is requested. Avoid adding unsolicited feature bloat, extra navigation tabs, or unnecessary third-party services.
- **Clear & Scannable Interfaces**: Maintain high-contrast visual design, fluid layouts, and complete event handlers for all UI controls.

---

## 🔄 Verification & Quality Lifecycle

Before declaring any feature or bug fix complete:

1. **Mandatory Test Execution & Reflection**:
   - **Execute Unit Tests After Each Change**: Run `npm test` (or `vitest`) after every code change to ensure zero regressions.
   - **Test Reflection**: Every new or edited functionality, hook, utility, or business logic modification MUST be reflected in unit/integration tests.
2. **Type Checking & Linting**: Run `npm run lint` (or `tsc --noEmit`) to verify zero syntax and type errors.
3. **Build Compilation**: Perform a complete application build (`npm run build` / `compile_applet`) to verify production bundle integrity.
4. **Documentation Sync**: Keep `README.md` updated whenever new APIs, scripts, or architectural features are introduced.

---

## 🛠️ Concurrency & State Management Rules

- **Deterministic Progress Tracking**: Avoid race conditions when tracking multi-worker parallel jobs. Use atomic completion counters rather than mutating worker-specific positions.
- **Safe State Synchronization**: Prevent background server sync polling from overwriting actively running client-side agent loops.
