---
name: learnop-bust-next-after-prisma-generate
description: Use when starting, restarting, or warming up the Nutshell dev server (`next dev --turbopack` on port 3000) — especially after running `prisma generate`, `prisma migrate dev`, `prisma db push`, or editing `src/server/db/schema.prisma`. Runs the cache-safe dev script `scripts/dev.sh` that busts the `.next` Turbopack cache when the Prisma schema has changed since the last start, preventing stale-client 500s. Also use when diagnosing `PrismaClientValidationError: Unknown argument X` or `PrismaClientKnownRequestError P2022: column does not exist` errors after a schema change — those are stale-client symptoms, not real bugs.
---

# Bust .next after Prisma schema changes

## What this is

The deterministic way to start the Nutshell dev server without hitting
stale-Prisma-client 500s. Bundles a single script that encodes the lesson
below as executable logic.

## The lesson (read once, then trust the script)

Next.js Turbopack caches bundled server code under `.next/dev/server/chunks/`.
That cache includes the **generated Prisma client**. When `prisma generate`
or `prisma migrate dev` regenerates the client (new schema, dropped column,
renamed field), the `.next` cache is **not** invalidated — Turbopack keeps
serving the old bundle. The result is a split-brain where the schema,
migrations, DB, and generated client are all consistent, but the running
server uses a stale client and 500s on every query.

Symptoms (seen in the failing route's 500 response body, not the browser):

- `PrismaClientValidationError: Unknown argument \`X\`` — runtime sends a
  field the stale client doesn't know.
- `PrismaClientKnownRequestError [P2022]: column \`main.<Model>.<col>\` does
  not exist in the current database` — stale client SELECTs a dropped column.

**Fix:** stop the server, delete `.next`, restart. Or just use the script,
which automates the bust when it's actually needed.

## How to use

Run the bundled script from the repo root:

```bash
.opencode/skills/learnop-bust-next-after-prisma-generate/scripts/dev.sh
```

Or make it the default alias in the shell:

```bash
alias ndev='.opencode/skills/learnop-bust-next-after-prisma-generate/scripts/dev.sh'
```

The script:

1. Hashes `src/server/db/schema.prisma` (SHA-1).
2. Compares against `.next/.prisma-schema-sha1` (the sentinel written after
   the last clean start).
3. **Schema changed** → `rm -rf .next` and re-bundle from scratch.
4. **Schema unchanged** → keep `.next`, fast cold start.
5. Writes the new sentinel, then `exec pnpm dev`.

Content-hash-based, not mtime-based — robust to clock skew and `touch`.

## When to use

- "Start the dev server" / "run the app" / "restart Next"
- After any of: `prisma generate`, `prisma migrate dev`, `prisma db push`,
  editing `schema.prisma`
- Diagnosing `PrismaClientValidationError` or P2022 errors that appear
  inconsistent with the current schema (those are stale-client bugs, not
  code bugs — confirm by inspecting the route's 500 response body)

## When NOT to use

- Production (`next start`) — no Turbopack cache, no issue.
- Test runs (`vitest`, `playwright`) — they don't bundle through `.next`.
- The schema genuinely hasn't changed since the last green start — but the
  script's hash check handles that case for free, so just run it anyway.

## Manual fallback (if the script is unavailable)

```bash
# from repo root
rm -rf .next
pnpm dev    # next dev --turbopack -p 3000
```

Always bust `.next` after `prisma generate` or `prisma migrate dev`. The
rule of thumb: if you regenerated the client, regenerate the cache.

## Related

- `nutshell-codebase-guide` — overall codebase orientation, including the
  non-default schema path at `src/server/db/schema.prisma`.
