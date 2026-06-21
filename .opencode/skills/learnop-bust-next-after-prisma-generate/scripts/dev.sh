#!/usr/bin/env bash
# ponytail: cache-safe dev server starter for Nutshell.
#
# Busts the .next Turbopack cache ONLY when the Prisma schema has changed
# since the last successful start. This is the exact condition that produces
# stale-client 500s after `prisma generate` / `prisma migrate dev`:
#   - PrismaClientValidationError: "Unknown argument `X`"
#     (generated client knows an old field the runtime no longer sends)
#   - PrismaClientKnownRequestError P2022: "column `main.<Model>.<col>`
#     does not exist in the current database"
#     (generated client still SELECTs a column the migration dropped)
#
# Mechanism: hash schema.prisma; store the hash in .next/.prisma-schema-sha1
# after each clean start. On the next start, compare. Differ → bust.
# Content-based (not mtime-based) so it's robust to clock skew and `touch`.
#
# Ceiling: hashes schema source, not the generated client itself. Misses the
# pathological case where someone runs `prisma generate` without a schema
# change and the previously-generated client was already stale. Upgrade path:
# if that ever bites, hash .prisma/client/schema.prisma instead.

set -euo pipefail

# Resolve repo root from script location: scripts/ -> skill/ -> .opencode/ -> repo/
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo_root"

schema_src="src/server/db/schema.prisma"
next_cache=".next"
sentinel="$next_cache/.prisma-schema-sha1"

[[ -f "$schema_src" ]] || {
  echo "[dev] $schema_src not found — is this the repo root?" >&2
  exit 1
}

schema_sha="$(shasum -a 1 < "$schema_src" | awk '{print $1}')"

if [[ -d "$next_cache" && -f "$sentinel" ]]; then
  last_sha="$(cat "$sentinel" 2>/dev/null || echo "")"
  if [[ "$last_sha" == "$schema_sha" ]]; then
    echo "[dev] schema unchanged ($schema_sha) — keeping .next cache"
  else
    echo "[dev] schema changed since last start — busting .next"
    echo "[dev]   was: ${last_sha:0:12}"
    echo "[dev]   now: ${schema_sha:0:12}"
    rm -rf "$next_cache"
  fi
else
  echo "[dev] no sentinel — treating as fresh start"
fi

# Write sentinel BEFORE pnpm dev so a crashed start still records the schema
# we attempted to bundle. A failed start will at worst skip a bust next time,
# which surfaces immediately as a normal stale-client error.
mkdir -p "$next_cache"
echo "$schema_sha" > "$sentinel"

echo "[dev] starting next dev --turbopack -p 3000"
exec pnpm dev
