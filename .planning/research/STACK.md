# Stack Research

**Domain:** AI-powered ebook reader web app (EPUB parsing, AI explainers, TTS audio, role-based auth)
**Researched:** 2026-05-06
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
| ---------- | ------- | ------- | --------------- | ---------- |
| Next.js | 16.2.5 | Fullstack React framework | App Router is the 2025 standard for fullstack TypeScript apps. Server Components eliminate client JS for static content, API routes handle file uploads/AI calls, and streaming SSR improves perceived performance. | HIGH |
| React | 19.2.6 | UI library | Required peer of Next.js 16. React 19 introduces improved hooks, automatic memoization, and better Server Component integration. | HIGH |
| TypeScript | 6.0.3 | Type safety | Industry standard. Catches runtime errors at build time, essential for a data-heavy app with complex domain models (books, sections, explainers, audio). | HIGH |
| Tailwind CSS | 4.2.4 | Utility-first CSS | v4 introduces a CSS-first config (no `tailwind.config.js`), better performance, and native CSS cascade layers. Ideal for theme switching (light/dark/sepia) via CSS variables. | HIGH |
| Prisma | 5.22.0 | ORM & database schema | Best-in-class relation modeling for complex domains. The `epub_files` → `books` → `sections` → `explainers` → `audio_files` graph is exactly what Prisma excels at. Migrations are automatic and safe. **Pinned to 5.x** — see Version Compatibility note. | HIGH |
| SQLite | 3.x (via `better-sqlite3` or `libsql`) | Database | Zero-config for development, single-file deployment, sufficient for v1. Prisma supports SQLite natively. Migration path to PostgreSQL is trivial when scaling. | HIGH |
| Better Auth | 1.6.9 | Authentication & authorization | The 2025 successor to NextAuth. Framework-agnostic, built-in Prisma adapter, role/organization support via plugins, session management, and admin capabilities out of the box. No separate auth service needed. | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
| ------- | ------- | ------- | ----------- | ---------- |
| `@likecoin/epub-ts` | 0.6.3 | EPUB parsing & rendering | **Primary EPUB engine.** Drop-in replacement for `epubjs` with full TypeScript strict mode, 1 dependency (`jszip`), 970+ tests, and active maintenance. Server-side parsing via `@likecoin/epub-ts/node` with `linkedom`. | HIGH |
| `react-reader` | 2.0.15 | React EPUB reader component | Wraps `epubjs`/`epub-ts` into a React-friendly API with pagination, theming hooks, and location tracking. Use for the Reader view with excellent typography. | HIGH |
| `@openrouter/ai-sdk-provider` | 2.9.0 | OpenRouter AI SDK provider | Official OpenRouter provider for the Vercel AI SDK. Gives structured access to 300+ models with unified streaming API, perfect for tiered AI (Regular/Pro model selection). | HIGH |
| `ai` | 4.4.3 | Vercel AI SDK core | Industry-standard AI SDK for streaming text generation, structured output (`generateObject`), and tool calling. Handles retries, timeouts, and response parsing. | HIGH |
| `elevenlabs` | 1.59.0 | ElevenLabs TTS SDK | Official SDK. Type-safe, handles voice selection, streaming audio generation, and pronunciation dictionaries. Admin-configurable voice/model selection. | HIGH |
| `@fal-ai/client` | 1.10.1 | fal.ai client | Official TypeScript client for fal.ai endpoints (alternative TTS/audio generation). Supports queue-based generation for long-form audio. | HIGH |
| `@tanstack/react-query` | 5.100.9 | Server state management | The standard for caching async server state. Critical for caching explainer/audio existence checks, book lists, and section content. Prevents redundant API calls. | HIGH |
| `zustand` | 5.0.13 | Client state management | Lightweight (1KB) for UI state: reader theme, current location, sidebar open/close. No boilerplate vs Redux; no re-render issues vs Context. | HIGH |
| shadcn/ui | latest (via CLI) | Component library | Radix UI primitives + Tailwind. Copy-paste components (not a dependency). Perfect for admin panel, forms, dialogs, tables, and dropdowns. | HIGH |
| `lucide-react` | 1.14.0 | Icon library | De facto React icon standard. 1000+ icons, tree-shakeable, consistent stroke width. | HIGH |
| `zod` | 4.4.3 | Schema validation | Already a peer dependency of Better Auth v1.6.9. Use for API input validation, form validation, and typed environment variables. | HIGH |
| `class-variance-authority` | 0.7.1 | Component variant styling | shadcn/ui dependency. Creates type-safe Tailwind component variants (e.g., button sizes, alert types). | HIGH |
| `clsx` + `tailwind-merge` | 2.1.1 / 3.5.0 | Conditional class merging | shadcn/ui dependency. Essential for dynamic Tailwind class composition without conflicts. | HIGH |
| `sonner` | 2.0.7 | Toast notifications | Lightweight, beautiful toasts for async operation feedback ("Explainer generated", "Audio ready", upload progress). | MEDIUM |

### Development Tools

| Tool | Purpose | Notes |
| ---- | ------- | ----- |
| `prisma` (CLI) | Database migrations & client generation | Run `npx prisma migrate dev` after schema changes. `prisma generate` creates typed client. |
| `@better-auth/cli` | Auth schema generation | Generates Prisma schema extensions for Better Auth tables (users, sessions, accounts, etc.). |
| `shadcn` (CLI) | Component scaffolding | `npx shadcn add dialog table dropdown-menu` etc. Installs Radix + Tailwind variants into your codebase. |
| TypeScript `strict` | Compile-time correctness | Enable in `tsconfig.json`. Non-negotiable for a project of this complexity. |

## Installation

```bash
# Core framework & runtime
npm install next@16.2.5 react@19.2.6 react-dom@19.2.6
npm install -D typescript@6.0.3 @types/node@22 @types/react@19 @types/react-dom@19

# Styling
npm install tailwindcss@4.2.4

# Database & ORM
npm install prisma@5.22.0 @prisma/client@5.22.0
npm install -D prisma@5.22.0

# Authentication
npm install better-auth@1.6.9
npm install -D @better-auth/cli

# EPUB processing
npm install @likecoin/epub-ts@0.6.3 react-reader@2.0.15 jszip@3.10.1

# AI & TTS
npm install ai@4.4.3 @openrouter/ai-sdk-provider@2.9.0
npm install elevenlabs@1.59.0 @fal-ai/client@1.10.1

# State management & data fetching
npm install @tanstack/react-query@5.100.9 zustand@5.0.13

# UI primitives & utilities (shadcn manages these, but core deps below)
npm install lucide-react@1.14.0 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.5.0 zod@4.4.3 sonner@2.0.7

# Dev dependencies
npm install -D eslint eslint-config-next@16.2.5
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
| ----------- | ----------- | ----------------------- |
| `@likecoin/epub-ts` | `epubjs` 0.3.93 | Never for new projects. `epubjs` is unmaintained (last stable release 2022), untyped, 132KB gzipped vs 57KB, and `locations.generate()` is 99% slower. |
| `@likecoin/epub-ts` | `epub` (Node.js parser) 2.1.1 | Only if you need *zero* client-side EPUB rendering and only server-side text extraction. But `@likecoin/epub-ts/node` already handles server parsing. |
| Prisma 5.22.0 | Drizzle ORM 0.45.2 | Drizzle is lighter and more SQL-native. Use if you need extreme query optimization or prefer SQL-first. Prisma wins for rapid schema iteration, migrations, and complex relation graphs. |
| Better Auth 1.6.9 | NextAuth.js 4.24.14 | NextAuth is stable but lacks built-in roles, organizations, and admin features without heavy customization. Better Auth is the modern standard. |
| SQLite (dev) | PostgreSQL 16+ | Use PostgreSQL from day one if you need concurrent writes, row-level security, or plan to deploy to Vercel/Render immediately. SQLite is fine for single-tenant v1. |
| `@tanstack/react-query` | SWR 2.3.3 | SWR is lighter but has fewer features. Use React Query for its mutation caching, optimistic updates, and devtools — critical for explainer/audio generation UX. |
| `zustand` | Jotai 2.20.0 | Jotai's atom model is elegant but overkill for this project's client state. Zustand's store model matches reader/reader-ui state better. |
| shadcn/ui | Material UI / Chakra | shadcn/ui gives full ownership of components (no dependency lock-in) and integrates natively with Tailwind v4. Critical for custom light/dark/sepia theming. |

## What NOT to Use

| Avoid | Why | Use Instead |
| ----- | --- | ----------- |
| `epubjs` 0.3.93 (stable) | Unmaintained since 2022, no TypeScript types, 56% larger bundle, `locations.generate()` is 1700ms vs 10ms in `@likecoin/epub-ts`. Alpha branch (0.5.x) has not shipped. | `@likecoin/epub-ts` 0.6.3 |
| Prisma 7.8.0 | Completely new client architecture. `PrismaClient` constructor no longer accepts `datasourceUrl` or `datasources` options. Breaks runtime database configuration. | Prisma 5.22.0 |
| NextAuth.js v4 | No built-in role-based access control. Requires custom adapter code for roles/permissions. Auth flow is cookie-only and harder to extend. | Better Auth 1.6.9 |
| `mammoth` 1.12.0 | DOCX parser, not EPUB. Out of scope for v1 (EPUB only). | N/A — not needed |
| `@react-pdf/renderer` 4.5.1 | PDF generation library, not EPUB reader. Irrelevant for this project. | N/A |
| `crypto-js` 4.2.0 | Legacy, larger bundle. Node.js built-in `crypto` module provides native `createHash('md5')` with zero dependencies. | Node.js `crypto` |
| `formidable` 3.5.4 | Overkill for EPUB uploads. Next.js App Router Route Handlers support native `FormData` and `File` parsing via `request.formData()`. | Native Web APIs |
| Redux / Redux Toolkit | Boilerplate-heavy for this app's client state needs. Reader UI state is simple (theme, location, sidebar). | Zustand |

## Stack Patterns by Variant

**If deploying to Vercel:**
- Use `@vercel/blob` or S3-compatible storage (Cloudflare R2) for EPUB/audio file storage
- Use `@vercel/kv` (Redis) or Upstash Redis for caching explainer/audio generation status
- SQLite will not persist across serverless invocations — migrate to PostgreSQL (Neon/Supabase) or use `libsql` (Turso)

**If self-hosting on a single server:**
- SQLite is perfectly viable for production
- Store EPUBs and audio files on local filesystem (e.g., `./data/uploads/`)
- Use Node.js `crypto` for MD5 hashing, no external service needed

**If adding mobile app in v2:**
- Better Auth supports Expo/React Native via `@better-auth/expo`
- `@likecoin/epub-ts` works in React Native (pure JS, no DOM dependency)
- React Query and Zustand are cross-platform

## Version Compatibility

| Package A | Compatible With | Notes |
| --------- | --------------- | ----- |
| Prisma 5.22.0 | `@prisma/client` 5.22.0 | Must match exactly. CLI and client are version-locked. |
| Prisma 5.22.0 | Better Auth 1.6.9 | Better Auth peer dependency accepts `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0`. 5.22.0 satisfies this. |
| Better Auth 1.6.9 | Zod 4.4.3 | Better Auth depends on `zod@^4.3.6`. Do not install Zod 3.x. |
| Next.js 16.2.5 | React 19.2.6 | Next.js 16 requires React 19. Do not downgrade React. |
| Next.js 16.2.5 | Tailwind CSS 4.2.4 | Supported. Ensure `postcss` config uses `@tailwindcss/postcss` (v4 plugin). |
| `ai` 4.4.3 | `@openrouter/ai-sdk-provider` 2.9.0 | Provider is maintained by OpenRouter and tracks AI SDK v4.x. |
| `@likecoin/epub-ts` 0.6.3 | `jszip` 3.10.1 | Only runtime dependency. Already satisfied by npm resolution. |
| `react-reader` 2.0.15 | `epubjs` / `@likecoin/epub-ts` | `react-reader` peer-depends on `epubjs` but `@likecoin/epub-ts` is API-compatible. May need alias in bundler config. |

**Critical Warning:** Prisma 7.x uses a new client architecture that removes `datasourceUrl` from the `PrismaClient` constructor. If you need runtime database URL configuration (e.g., for testing vs production), you **must** stay on Prisma 5.x or use environment-variable-based configuration in `schema.prisma`.

## Confidence Notes

**HIGH confidence:** Next.js, React, TypeScript, Tailwind, Prisma 5.x, Better Auth, `@likecoin/epub-ts`, Vercel AI SDK, ElevenLabs SDK, React Query, Zustand, shadcn/ui — these are all industry-standard, actively maintained, and well-documented choices with clear migration paths.

**MEDIUM confidence:** `react-reader` — it is well-maintained but wraps `epubjs` which is unmaintained. The `@likecoin/epub-ts` API compatibility mitigates this risk. If `react-reader` breaks, a custom React wrapper around `@likecoin/epub-ts` is feasible (~200 LOC).

**MEDIUM confidence:** `sonner` — toast library choice is low-stakes and easily swappable.

## Sources

- `npm view` registry queries (2026-05-06) — verified all version numbers directly from npm
- `@likecoin/epub-ts` README — performance benchmarks, Node.js export confirmation
- `better-auth` package README — peer dependencies, Prisma adapter, plugin ecosystem
- Previous project failure memory: Prisma 7.8.0 `datasourceUrl` incompatibility
- Next.js skill `/opt/homebrew/lib/node_modules/pi-superpowers-plus/skills/nextjs/SKILL.md` — App Router recommendation
- Better Auth skill `/Volumes/My Shared Files/Dev/.cursor/skills/Software_Engineering/Authentication/better-auth/SKILL.md` — role support, admin features, adapter patterns

---

*Stack research for: AI-powered ebook reader (BusyReader)*
*Researched: 2026-05-06*
