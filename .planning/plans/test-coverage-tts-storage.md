# Plan: Test Coverage for TTS and Storage Services

**Branch:** `add-tts-storage-tests` (from `baf518e`)
**Goal:** Close the two highest-risk test gaps identified in the graph analysis — the paid-API path (`tts.ts`) and the file-persistence path (`local.ts`).

## Global Constraints

- **Test framework:** Vitest, matching existing `src/server/services/__tests__/*.test.ts` convention
- **Test file location:** Co-located `__tests__/` directories next to the module under test
- **Mocking pattern:** `vi.mock("@/server/db", ...)` factory style (see `explainer.test.ts:1-32` for the canonical pattern)
- **No new dependencies** — use only what's already installed (vitest, @types/node)
- **Pure functions get pure-function tests; orchestration gets mocked-dependency tests**
- **Every test must assert something meaningful** — no `expect(true).toBe(true)` filler
- **Do NOT modify production code in `tts.ts`, `local.ts`, `tts-providers.ts`** — tests only. If a bug is found, flag it in the report; don't fix it in this plan.

## Source files under test

- `src/server/services/tts.ts` (267 lines) — exports: `computeTtsContentHash`, `chunkText`, `getTtsAudio`, `createTtsAudio`, `getTtsProviderConfig`, `generateTtsAudio`
- `src/server/storage/local.ts` (60 lines) — exports: `LocalStorage` class, `storage` singleton

## Reference patterns

- `src/server/services/__tests__/explainer.test.ts` — orchestration test with db/storage/epub-ts mocks
- `src/server/services/__tests__/reader.test.ts` — db mock factory pattern
- `src/test-setup.ts` — sets `process.env.STORAGE_PATH = "./test-uploads"`

---

## Task 1: Tests for `src/server/services/tts.ts`

**File to create:** `src/server/services/__tests__/tts.test.ts`

**Model recommendation:** standard (multi-concern, integration-style orchestration tests)

### 1A. Pure-function tests (no mocks)

**`computeTtsContentHash(text: string): string`**
- Returns 64-char lowercase hex (SHA-256)
- Deterministic: same input → same output
- Different inputs → different outputs (collision sanity, not exhaustive)
- Empty string still produces a valid hash

**`chunkText(text: string, maxChars: number): string[]`**
- `maxChars <= 0` throws `"maxChars must be positive"`
- Text under maxChars → single chunk `[text]`
- Splits at `\n\n` paragraph boundaries
- Splits at `\n` single newline when no `\n\n`
- Long paragraph with no paragraph breaks → splits at word boundary, never mid-word
- Single chunk where one word exceeds maxChars → that word becomes its own chunk (word boundary rule still holds; don't infinite-loop)
- Whitespace handling: trailing/leading whitespace on chunks is trimmed when split at word boundary
- Concatenating chunks with appropriate separators reconstructs the meaningful content (informational, not strict equality)

### 1B. Cache-lookup helpers (db mocks)

**`getTtsAudio({ contentHash, language, voiceId, model })`**
- Calls `db.ttsAudio.findUnique` with the composite unique key `contentHash_language_voiceId_model`
- Returns whatever Prisma returns (pass-through)

**`createTtsAudio(data)`**
- Calls `db.ttsAudio.create` with `data`
- Returns whatever Prisma returns (pass-through)

**`getTtsProviderConfig(provider, userType)`**
- Calls `db.ttsProviderConfig.findUnique` with `provider_userType` composite key
- Returns whatever Prisma returns (pass-through)

### 1C. Orchestration: `generateTtsAudio` (mock everything)

Mock `@/server/db`, `@/server/storage/local`, `./section-extractor`, `./tts-providers`. Tests:

1. **Book not found** — `db.epubFile.findUnique` returns null → throws `"Book not found"`
2. **Empty section text** — `extractSectionText` returns `"   "` → throws `"Section text is empty"`
3. **No provider configured** — both `elevenlabs` and `fal` configs return null or have null apiKey → throws with `statusCode: 503`
4. **Cache hit** — `getTtsAudio` returns existing row → returns `{ cached: true, audioId, url }`, **provider never called**, **storage.write never called**
5. **Cache miss, elevenlabs** — provider config resolves to elevenlabs; `callElevenLabs` returns a Buffer; assert: `storage.write` called once with concatenated buffer, `createTtsAudio` called, returns `{ cached: false, ... }`
6. **Cache miss, fal fallback** — elevenlabs config has null apiKey, fal config valid; assert `callFalAi` used (not `callElevenLabs`)
7. **Multi-chunk** — section text long enough to split into 3 chunks → `callElevenLabs` called 3 times, `storage.write` called once with `Buffer.concat` of all three
8. **Race condition (P2002)** — `createTtsAudio` rejects with `{ code: "P2002" }`; second `getTtsAudio` returns the winner's row; returns `{ cached: true, ... }` with the winner's id
9. **Non-P2002 error rethrown** — `createTtsAudio` rejects with something else → propagates

**Self-check:** every test asserts at least one concrete value (call args, return shape, throw message, or call count). No tautologies.

---

## Task 2: Tests for `src/server/storage/local.ts`

**File to create:** `src/server/storage/__tests__/local.test.ts`

**Model recommendation:** cheap (single file, clear spec, real filesystem)

### Approach: real temp directory

Use Node's `os.tmpdir()` + `fs.mkdtempSync` for test isolation. Set `process.env.STORAGE_PATH` per-test (or instantiate `new LocalStorage(tmpDir)` directly since `STORAGE_ROOT` is captured at module load — prefer constructing `new LocalStorage()` after setting the env var via vi.resetModules + dynamic import, OR test the class directly by refactoring `STORAGE_ROOT` resolution).

**Simplest path:** since `STORAGE_ROOT` is a module-level const, use `vi.resetModules()` + dynamic import in `beforeEach` to re-evaluate with a fresh tmpdir. Or stub `process.env.STORAGE_PATH` before each dynamic import.

### Tests

**`write(relativePath, data)`**
- Writes a Buffer to disk under storage root + relativePath
- Writes a string to disk equivalently
- Creates parent directories (nested `a/b/c/file.txt` works)
- Returns the relative path (NOT the full path) — callers store this verbatim
- Round-trip: write then read returns the same bytes

**`read(storedPath)`**
- Reads a file that was written via `write`
- Handles legacy full-path format: a storedPath starting with `${STORAGE_ROOT}/` is used as-is, not double-prefixed
- Throws ENOENT naturally on missing file (don't catch — let it propagate)

**`exists(storedPath)`**
- Returns `true` for a file that exists
- Returns `false` for a file that doesn't (no throw)

**`delete(storedPath)`**
- Removes the file
- Does NOT throw if the file is missing (silent `.catch(() => {})`)

**`getUrl(relativePath)`**
- Returns `/api/files/${relativePath}` (no leading slash tricks, no double slashes for clean input)

### Self-check

Every test asserts a concrete observable: file contents on disk, return value, presence/absence of file. No mock assertions of mock state only.

---

## Task 3: Investigate `prompt-builder` dynamic import (NOT dispatched — done by controller)

Between Task 1 and Task 2 dispatch (or after both), the controller reads `src/server/services/explainer.ts` lines around the `await import("./prompt-builder")` calls, checks whether the route is edge/serverless, and decides:

- **If a static import is safe:** open a separate small task or PR (not in this plan's scope) — flag for the user
- **If the dynamic import is load-bearing:** add a clarifying comment to replace the misleading "avoid cycles" note

This is research only. No code changes in this plan.

---

## Out of scope

- Tests for `openrouter.ts`, `section-extractor.ts`, `tts-providers.ts` — lower stakes, deferred
- `reader-client.tsx` refactor — YAGNI
- The 6 missing graph nodes — cosmetic
- Any production code changes — tests only
