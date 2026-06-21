# API & Ops

_Verified 2026-06-21 against `src/app/api/` + `.env.example`._

## API surface (`src/app/api/`)

App Router route handlers; all protected handlers call `requireAuth` /
`requireAdmin` first.

| Domain | Routes | Notes |
|---|---|---|
| `books/` | `GET /books`, `POST /books/upload` | Upload = ingestion entry; streaming MD5 hash |
| `explainers/` | `GET`, `POST /explainers`; `POST /explainers/generate` (SSE); `GET /explainers/history` | Cache-first, content-hash keyed |
| `tts/` | `POST /tts/generate`, `GET /tts/audio` | Cache-first, multi-provider |
| `reader/` | `bookmarks`, `highlights`, `position`, `txt` (+ `[id]` variants) | Per-user reader state |
| `admin/` | `users`, `users/[id]`, `books`, `prompts`, `config`, `audit` | `requireAdmin`-gated, audited |
| `auth/[...all]` | better-auth handler | Google OAuth flow |
| `user/language` | `GET`, `PATCH` | User's `preferredLanguage` |
| `files/[[...path]]` | `GET` | Catch-all static asset server (images/CSS/HTML) for book assets; access-verified |

## Environment variables (`.env.example`)

```
DATABASE_URL="file:./dev.db"
BETTER_AUTH_SECRET=""
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
STORAGE_PATH="./data/uploads"
OPENROUTER_API_KEY=sk-or-v1-...
APP_URL=http://localhost:3000
```

ElevenLabs / fal.ai API keys and per-tier model selection are **not** in env —
they're set in-app via `/admin/config` and stored in the DB
(`TtsProviderConfig`, `OpenRouterConfig`).

**Key/model resolution precedence** (important — this is the "env vs DB" answer):
- **OpenRouter** (`services/openrouter.ts:26`, `getOpenRouterConfig`): DB
  `OpenRouterConfig.apiKey` for the tier **wins** → falls back to
  `process.env.OPENROUTER_API_KEY` → then `""`. Model falls back to hardcoded
  defaults (`anthropic/claude-sonnet-4.6` pro, `google/gemini-2.0-flash-001`
  regular). So env is the baseline default; `/admin/config` overrides per tier.
- **TTS** (`services/tts.ts:170`): no env fallback — provider is chosen by
  scanning `TtsProviderConfig` rows for the tier (`elevenlabs` tried before
  `fal`), first one with an `apiKey` wins. If none configured → 503.

## Run locally

```bash
pnpm install
cp .env.example .env       # then fill in BETTER_AUTH_SECRET + Google OAuth + OPENROUTER_API_KEY
pnpm db:generate           # prisma generate --schema=src/server/db/schema.prisma
pnpm db:push               # apply schema to SQLite (or db:migrate for migrations)
pnpm db:seed               # seed (npx tsx prisma/seed.ts)
pnpm dev                   # next dev --turbopack
```

Non-default schema path: every Prisma command needs
`--schema=src/server/db/schema.prisma` (already wired into the npm scripts).

## Testing

- **Unit/integration**: Vitest, co-located as `__tests__/` next to routes,
  services, and components.
  - `pnpm test` (run once) / `pnpm test:watch`
  - Coverage concentrates on API routes + services (caching, auth guards,
    upload, dedup).
- **E2E**: Playwright specs in `e2e/` — `admin.spec.ts`, `auth.spec.ts`,
  `library.spec.ts`. Run `pnpm playwright`.
  - Config: `playwright.config.ts`.

When adding logic with a branch/loop/parser/money-or-security path, add a test
alongside it in `__tests__/`.

## "Don't break" rules (conventions)

- **Never call Explainers "summaries."** The product term is sacred — appears in
  copy, prompts, and code naming.
- **Pinned versions — don't bump blindly**: Prisma **5.22** (NOT 7),
  better-auth **1.6.9**, `@likecoin/epub-ts` **0.6.3**, Next **16**.
- **Schema path is non-default**: `src/server/db/schema.prisma`. Prisma CLI
  commands need `--schema=`.
- **Universal Library is invisible to non-admins** — users only ever see their
  Personal Library.
- **Every new protected handler** must call `requireAuth` / `requireAdmin`
  first. Middleware is NOT enough.
- **Every admin mutation** must write an `AuditLog` row (actor + action + entity
  + old/new JSON).
- **CFI is the source of truth for position** across font/viewport changes;
  `paragraphIndex + charOffset` is the persisted bridge.
- **Cache keys include `promptVersion`** — editing a `PromptTemplate` and
  bumping its `version` auto-invalidates exactly the affected Explainers. Don't
  hand-roll invalidation.
- **GSD workflow in use** (`/gsd-help`). `.planning/` is authoritative for scope;
  update `STATE.md` / `ROADMAP.md` at phase transitions.

## Reader UI conventions

- Reader chrome: glassmorphism (`h-12`), reading progress bar (`h-1`).
- Three themes: **light → sepia → dark**; `ThemeToggle` is mount-gated.
- Post-v1.0: top chrome + left sidebar (`reader-sidebar.tsx`) + panel system
  (`reader-panel.tsx`) replaces the old tool-rail. See `architecture.md` flow #2.
- `BookCard` shows cover + reading-progress bar + hover effects; `RoleBadge`
  shows Pro/Admin tier.

## Deferred / out of scope (not bugs)

- **POL-04** Cost tracking dashboard — deferred, not v1.
- **TTS-08** TTS waveform visualizer + Pro full-book download — deferred.
- **LANG-04 partial** — TTS voice respects the **book's** language, not the
  user's preference.
- **Out of scope entirely**: native mobile, PDF/DOCX, social features, realtime
  collaboration, offline/PWA, in-app payments, cross-library semantic search.

## Where status lives

- `.planning/STATE.md` — phase progress (v1.0 = 6/6 phases complete).
- `.planning/ROADMAP.md` — phase goals, requirements, success criteria.
- `.planning/PROJECT.md` — "What This Is" + key decisions.
- `.task-reports/` — post-v1.0 per-task review notes (design-system expansion,
  Tweakpane integration, etc.). One report file per task in a feature batch.
- `docs/superpowers/plans/` — post-v1.0 implementation plan docs (e.g.
  `2026-06-17-nutshell-foundations.md`, `2026-06-19-tweakpane-design-system.md`).
- `git log --since=2026-05-08` — every commit since v1.0 shipped.
