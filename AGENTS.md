# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src/` using the Next.js App Router.
- `src/app/` handles UI routes and API endpoints (see `src/app/api/summary/route.ts`).
- Shared parsing utilities sit in `src/lib/`.
- Static assets stay in `public/`; styling is centralized in `src/app/globals.css`.
- Root configs (`next.config.ts`, `eslint.config.mjs`, `tsconfig.json`) drive build, lint, and TypeScript settings.

## Build, Test, and Development Commands
- `npm install` syncs dependencies for Node 18+.
- `npm run dev` boots the Turbopack dev server with hot reload.
- `npm run build` produces the production bundle.
- `npm run start` serves that bundle for smoke checks.
- `npm run lint` runs ESLint with `next/core-web-vitals` and TypeScript rules.

## Coding Style & Naming Conventions
- TypeScript-first: add explicit return types on exported utilities and components.
- Keep modules cohesive; place reusable logic in `src/lib` instead of deep component imports.
- camelCase for values, PascalCase for components, kebab-case for filesystem routes unless Next enforces otherwise.
- Two-space indentation, single quotes in TS/TSX, trailing commas where allowed.
- Prefer Tailwind utilities configured via `@theme inline` in `globals.css` before adding custom CSS.

## Testing Guidelines
- No automated suite yet—introduce unit specs with new logic to avoid regressions.
- Stage future tests in `src/lib/__tests__/` or co-locate `*.test.ts`; add `vitest` or `jest` when ready.
- Exercise `parseReplayData` with captured battle logs and assert both HTML and text summaries.
- Describe manual verification (e.g., paste a replay URL and confirm rendered turns) in PR notes until automated coverage exists.

## Commit & Pull Request Guidelines
- History currently uses plain subjects (`Initial commit from Create Next App`); continue with clear, sentence-case summaries.
- Prefix optional scopes (`parser:`) when touching a single module and keep bodies wrapped at ~72 characters.
- Every PR needs a short changelog, check results (`npm run lint`, manual smoke), and screenshots or GIFs for UI adjustments.
- Link related issues and highlight config or schema changes in a dedicated checklist.

## Environment & Secrets
- Store local secrets in `.env.local`; keep them out of version control.
- Document new environment variables and rotation steps in `README.md` and mention them in the PR.
