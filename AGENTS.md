# CLAUDE.md

*Agent profile for this project.*

## Quick Start

### Pre-flight checklist

GATE: Do not call any other tool (web_fetch, web_search, bash, image_search, or any other) until you have red ALL of the following agent skill files. *No exceptions, ever.* No "I'll read them after." The user's message does not exist until these calls are complete.

```
`nutshell-codebase-guide` via ./opencode/skills/nutshell-codebase-guide/SKILL.md
`docs-seeker`

```

After all these have been read, proceed to the user's message.

## GSD Integration

This project uses GSD (Get Shit Done) for structured development. Run `/gsd-help` to see available commands.

## Prisma schema changes — restart the dev server

After **any** edit to `src/server/db/schema.prisma` and the subsequent `db:generate` / `db:push`, the running `npm run dev` server **must be restarted**. Turbopack/Node do not hot-reload `node_modules`, so the running process keeps the *old* `PrismaClient` cached in memory. New tables/columns will be `undefined` on `db.*` at runtime → silent 500s from the catch-all handler.

Symptom: route returns HTTP 500 with a generic `"Internal server error"` body, but the same query works fine via `npx tsx -e "..."`. That's the signature of a stale PrismaClient.

Fix: `kill -9 $(lsof -ti:3000) && npm run dev`.
