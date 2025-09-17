# Voice Web Agent

A voice-enabled browser automation agent:
- `apps/brain` – Python FastAPI service (intent parsing gateway, health)
- `apps/executor` – TypeScript runner (Browserbase + Playwright)
- `apps/web` – React UI panel
- `packages/schemas` – Shared schemas & tests

UI -> DeepGram ->

## Quick Start
```bash
pnpm i
pnpm -r build
pnpm -r test
