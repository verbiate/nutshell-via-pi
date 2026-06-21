---
name: nutshell-codebase-guide
description: Use when working on, onboarding to, or answering questions about the Nutshell / BusyReader codebase — the AI-powered EPUB web reader with Explainers, TTS audio, the MD5-deduplicated Universal Library, and content-hash caching. Covers Next.js App Router, Prisma/SQLite, better-auth RBAC, OpenRouter, and ElevenLabs/fal.ai. Load when touching books, reader, explainers, TTS, admin, auth, or storage code.
---

# Nutshell / BusyReader Codebase Guide

---

## Self-update protocol (MANDATORY on load)

This skill uses **per-section timestamps**. Each claim section ends with a line
like `_Verified YYYY-MM-DD against <source>._`

On every load:

1. Scan all section timestamps in this file.
2. For each section whose timestamp is **>1 day old**, run the audit-and-update
   step for *that section only* (see scope table below).
3. **If the section's claims still match the live source** → bump its timestamp
   to today (cheap "still fresh" confirmation).
4. **If the section's claims are stale** → edit the section in place to match
   the source, then bump its timestamp to today.
5. After all stale sections have been processed: if any edits were made, report
   a one-line summary of what changed. Otherwise, silent.

### Audit scope per section

| Section (in this file) | When stale, verify against |
|---|---|
| Stack | `package.json` deps + devDeps |
| The one mental model / two-tier library / cache keys | Live `src/server/db/schema.prisma` + `services/explainer.ts` + `services/tts.ts` |
| Repo navigation | `glob` of `src/`, `src/components/`, `src/app/api/`; check for new siblings |
| The auth gate | `src/middleware.ts` + `src/lib/auth-guards.ts` (file exists, fan-in count) |
| First-day tour (8 stops) | File existence of each stop |
| Reference files (`architecture.md`, `data-model.md`, `api-and-ops.md`) | Each has its own per-file stamp at top — audit only when that file is loaded on-demand |

### Rules

- **Evidence first.** Every edit must be backed by a grep, glob, or file-read
  result — no inferred or remembered claims.
- **Don't fabricate.** If a claim can't be verified, leave it intact and append
  ` (?unverified)` rather than guessing.
- **Preserve curation.** Add new paths/models/flows; don't delete existing
  context unless the live source contradicts it.
- **Edit in place. Do NOT commit.** Leave changes in the working tree for the
  user to review with `git diff`.
- **Always bump the section's timestamp** when you process it, whether or not
  content changed.

> Time horizon is `>1 day`. Tunable: find-and-replace across this skill folder.

---

## What this is

An **AI-powered EPUB web reader**. Users upload EPUBs and get AI-generated
**Explainers** (never "summaries" — hard product rule), **text-to-speech audio**,
bookmarks/highlights/search, and three reading themes — on top of a polished
reader. Status: **v1.0 shipped May 2026** (6 phases, 25/25 plans, 47/52
requirements verified, 5 deferred). Active post-v1.0 iteration since — chiefly
the Nutshell rename + visual identity overhaul, reader UX redesign (tool rail
→ sidebar/chrome/panel architecture), bookshelf↔reader scene transitions, and a
`/design-system` gallery with a CDN-loaded Tweakpane token tuner. See
`.planning/STATE.md` for the live milestone status and
`git log --since=2026-05-08` for post-v1.0 activity.

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
    `contentHash = SHA-256(promptType + "\x00" + sourceText + "\x00" + String(promptVersion))`
    — null-byte separators prevent field-boundary collisions; `String()` coerces
    the prompt version. Language and tier are separate columns *because they're
    not in the hash* — same book in 13 languages = one `contentHash`, 13 cache
    rows.
  - TTS: `(contentHash, language, voiceId, model)` where
    `contentHash = SHA-256(sourceText)` (no prompt — TTS has none).
- **Tiered quality**: `User.role` ∈ `regular | pro | admin`; OpenRouter model +
  TTS provider/voice are admin-configured per tier.

If a feature touches books, AI output, or reader state, this model is the
context. Full detail in `data-model.md`.

_Verified 2026-06-21 against `src/server/db/schema.prisma` + `services/explainer.ts` + `services/tts.ts`._

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
| Animation | GSAP 3.15 + `@gsap/react` 2.1 + Lenis 1.3 (smooth scroll); Tweakpane loaded CDN-only in `/design-system` |
| Tests | Vitest 4 + Playwright 1.59 |

_Verified 2026-06-21 against `package.json`._

## Repo navigation

```
src/
  middleware.ts            # edge session-cookie gate (no Prisma access)
  app/
    (auth)/ (library)/ (reader)/ admin/ profile/   # route groups = NOT url segments
    design-system/         # dev-only gallery + Tweakpane token tuner (post-v1.0)
    api/                   # REST handlers — see api-and-ops.md
    layout.tsx page.tsx globals.css
  components/
    reader/ library/ explainer/ admin/ auth/ profile/ ui/   # ui/ = shadcn
    transitions/           # scene-transition.tsx (GSAP bookshelf↔reader handoff, post-v1.0)
    providers.tsx          # root client wrapper: QueryClient + Theme + Tooltip + SceneTransition
  hooks/                   # session, tts-playback, media-query, mobile, prefers-reduced-motion
  lib/ types/              # lib/reader/ holds position-tracking.ts + progress.ts
  server/
    db/                    # schema.prisma (NON-DEFAULT path), migrations, prisma client
    services/              # ALL business logic — see architecture.md
    storage/               # pluggable storage adapter (interface in types.ts, local FS in local.ts)
.planning/                 # GSD: PROJECT/REQUIREMENTS/ROADMAP/STATE/phases/
.task-reports/             # post-v1.0 per-task review notes (design-system, Tweakpane, etc.)
docs/superpowers/plans/    # post-v1.0 plan docs
.understand-anything/knowledge-graph.json   # nodes/edges/layers/tour of the codebase
data/uploads/              # local EPUB/TXT/cover storage (STORAGE_PATH)
```

**Post-v1.0 reader redesign** (replaces the old tool-rail, commit `4960292`):
top glassmorphism chrome (`reader-chrome.tsx`, `h-12`, hide-on-idle) + left
sidebar rail (`reader-sidebar.tsx`) hosting a panel system (`reader-panel.tsx`
+ bookmarks/highlights/search/book-settings/themes/tts panels).

_Verified 2026-06-21 against `src/` filesystem._

## The auth gate (read before any protected work)

Nothing is anonymous. Two layers:

1. **Edge middleware** `src/middleware.ts:11` — cheap cookie check; redirects
   unauthenticated users from `/my-library`, `/book/*`, `/admin/*`.
2. **Server guards** `src/lib/auth-guards.ts` — `requireAuth` / `requireAdmin`
   at the top of **every** API handler (most-depended file, 42 fan-in).

Cookie name: `better-auth.session_token`.

_Verified 2026-06-21 against `src/middleware.ts` + `src/lib/auth-guards.ts`._

## First-day reading order (the 8-stop tour)

From `.understand-anything/knowledge-graph.json` `tour[]`:

1. `AGENTS.md` + `package.json` — agent profile + stack
2. `src/middleware.ts` + `src/lib/auth-guards.ts` — the gate
3. `src/server/db/schema.prisma` — Universal/Personal split
4. `api/books/upload/route.ts` + `services/epub-processor.ts` — ingest + dedup
5. `components/reader/reader-client.tsx` + `epub-viewer.tsx` — the reader (CFI)
6. `api/explainers/route.ts` + `services/explainer.ts` — cache-first AI
7. `api/tts/generate/route.ts` + `services/tts.ts` — multi-provider TTS
8. `services/admin.ts` + `AuditLog` — access control & provenance

_Verified 2026-06-21 against file existence._

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
