---
name: nutshell-codebase-guide
description: Use when working on, onboarding to, or answering questions about the Nutshell / BusyReader codebase — the AI-powered EPUB web reader with Explainers, TTS audio, the MD5-deduplicated Universal Library, and content-hash caching. Covers Next.js App Router, Prisma/SQLite, better-auth RBAC, OpenRouter, and ElevenLabs/fal.ai. Load when touching books, reader, explainers, TTS, admin, auth, or storage code.
---

# Nutshell / BusyReader Codebase Guide

## What this is

An **AI-powered EPUB web reader**. Users upload EPUBs and get AI-generated
**Explainers** (never "summaries" — hard product rule), **text-to-speech audio**,
bookmarks/highlights/search, and three reading themes — on top of a polished
reader. Status: **v1.0 complete** (6 phases, 25/25 plans).

## The one mental model that matters

Two-tier library + generate-once caching:

- **Universal Library** = `EpubFile`, one row per unique book, deduplicated by
  `md5`. Invisible to non-admins.
- **Personal Library** ("My Library") = `UserBookAccess` join table granting a
  user access to a shared `EpubFile`. Each user has private position/bookmarks/
  highlights but shares the same book row.
- **Every AI output is cached globally** and shared across all readers with
  access. Generate once, serve many. The `contentHash` covers only the **source
  text**; the other axes live as separate columns in a composite unique key:
  - Explainer: `(contentHash, language, contentType, tier)` where
    `contentHash = SHA-256(promptType + sourceText + promptVersion)`. Language
    and tier are separate columns *because they're not in the hash* — same book
    in 13 languages = one `contentHash`, 13 cache rows.
  - TTS: `(contentHash, language, voiceId, model)` where
    `contentHash = SHA-256(sourceText)` (no prompt — TTS has none).
- **Tiered quality**: `User.role` ∈ `regular | pro | admin`; OpenRouter model +
  TTS provider/voice are admin-configured per tier.

If a feature touches books, AI output, or reader state, this model is the
context. Full detail in `data-model.md`.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 6 |
| DB | **SQLite + Prisma 5.22** (pinned — NOT 7) |
| Auth | better-auth 1.6.9 + Google OAuth, custom RBAC |
| LLM | OpenRouter (SSE streaming) |
| TTS | ElevenLabs + fal.ai (admin-configurable per tier) |
| UI | shadcn/ui 4 + Tailwind 4 + Radix, lucide-react |
| Data/state | TanStack Query 5, Zustand 5 |
| EPUB | `@likecoin/epub-ts` 0.6.3 |
| Tests | Vitest 4 + Playwright 1.59 |

## Repo navigation

```
src/
  middleware.ts            # edge session-cookie gate (no Prisma access)
  app/
    (auth)/ (library)/ (reader)/ admin/ profile/   # route groups = NOT url segments
    api/                   # REST handlers — see api-and-ops.md
    layout.tsx page.tsx globals.css
  components/              # reader/ library/ explainer/ admin/ auth/ ui/ (shadcn)
  hooks/ lib/ types/
  server/
    db/                    # schema.prisma (NON-DEFAULT path), migrations, prisma client
    services/              # ALL business logic — see architecture.md
    storage/               # pluggable storage adapter (local FS now)
.planning/                 # GSD: PROJECT/REQUIREMENTS/ROADMAP/STATE/phases/
.understand-anything/knowledge-graph.json   # nodes/edges/layers/tour of the codebase
data/uploads/              # local EPUB/TXT/cover storage (STORAGE_PATH)
```

## The auth gate (read before any protected work)

Nothing is anonymous. Two layers:

1. **Edge middleware** `src/middleware.ts:11` — cheap cookie check; redirects
   unauthenticated users from `/my-library`, `/book/*`, `/admin/*`.
2. **Server guards** `src/lib/auth-guards.ts` — `requireAuth` / `requireAdmin`
   at the top of **every** API handler (most-depended file, 42 fan-in).

Cookie name: `better-auth.session_token`.

## First-day reading order (the 8-stop tour)

From `.understand-anything/knowledge-graph.json` `tour[]`:

1. `package.json` — what & stack
2. `src/middleware.ts` + `src/lib/auth-guards.ts` — the gate
3. `src/server/db/schema.prisma` — Universal/Personal split
4. `api/books/upload/route.ts` + `services/epub-processor.ts` — ingest + dedup
5. `components/reader/reader-client.tsx` + `epub-viewer.tsx` — the reader (CFI)
6. `api/explainers/route.ts` + `services/explainer.ts` — cache-first AI
7. `api/tts/generate/route.ts` + `services/tts.ts` — multi-provider TTS
8. `services/admin.ts` + `AuditLog` — access control & provenance

## When to use this skill

Use when:
- Onboarding or asked "how does X work in this codebase"
- Touching books, reader, Explainers, TTS, admin, auth, or storage code
- Adding an API route, service, or DB model
- Debugging caching, dedup, position-tracking, or tier behavior

Skip when:
- The task is purely generic (no Nutshell-specific knowledge needed)
- You need *current* schema/columns — **read `schema.prisma` live**, don't trust
  any cached summary (it may have drifted since this skill was written)

## Reference files (load on demand)

- **`architecture.md`** — layers, request/auth path, service-layer table, 5 key flows traced
- **`data-model.md`** — 16 Prisma models explained + the two cache-key contracts
- **`api-and-ops.md`** — endpoint catalog, env vars, run/seed/test commands, conventions, deferred work

## Live sources of truth (these win over this skill)

- `src/server/db/schema.prisma` — current models, columns, unique constraints
- `.understand-anything/knowledge-graph.json` — nodes, edges, layers, tour
- `.planning/STATE.md` + `ROADMAP.md` — current project status
- `package.json` — pinned versions (do not bump blindly)
