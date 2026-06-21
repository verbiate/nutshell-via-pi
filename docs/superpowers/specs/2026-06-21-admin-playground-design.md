# Admin Playground (OpenRouter chat testing)

**Date**: 2026-06-21
**Status**: Approved (Option A — includes global system-prompt storage)
**Scope**: OpenRouter only; TTS/fal.ai playground deferred

## Goal

Give admins a chat interface at `/admin/playground` to test OpenRouter models
against configured tier credentials, with an editable system prompt they can
"audition" locally and optionally persist as a global setting.

## User stories

1. As an admin, I can pick a tier (Regular / Pro / Admin) and chat using that
   tier's configured OpenRouter model + API key.
2. As an admin, I can enter a custom model name to test it against the Admin
   tier's API key (since custom models have no tier mapping).
3. As an admin, I see the configured model name for the selected tier as a
   badge so I know what I'm testing.
4. As an admin, I can edit a system prompt that gets sent with my messages.
5. As an admin, I can "Save as live" to persist the system prompt as a global
   setting, and "Revert" to drop my unsaved edits.
6. As an admin, switching tier or model clears the chat history (the previous
   conversation is no longer relevant context).

## Non-goals (YAGNI)

- Chat transcript persistence (cleared on unmount, never stored)
- TTS / fal.ai playground (structure allows adding later)
- Wiring the global system prompt into the explainer pipeline (future task)
- Audit-logging chat messages (only system-prompt saves are logged)
- Multi-user concurrent sessions

## Architecture

### Data model

New `AppSetting` KV table in `schema.prisma`:

```prisma
model AppSetting {
  key       String   @id
  value     String?
  updatedAt DateTime @updatedAt
}
```

Holds `globalSystemPrompt` now; future global settings reuse the table.

### Service layer

**`src/server/services/settings.ts`** (new):
- `getSetting(key: string): Promise<string | null>`
- `setSetting(key: string, value: string | null): Promise<void>`

**`src/server/services/openrouter.ts`** — add `streamChat()` alongside
`streamExplainer()` (which is left untouched to avoid regressing explainers):

```ts
streamChat({
  apiKey: string,
  model: string,
  systemPrompt?: string,   // omitted from request body when empty/undefined
  messages: { role: "user" | "assistant", content: string }[],
  temperature?: number,    // default 0.7
  maxTokens?: number,      // default 4096
}): AsyncGenerator<string>
```

Same SSE parsing loop, headers, and `OpenRouterError` semantics as
`streamExplainer`. Differences: caller controls the messages array; no
hardcoded literary system prompt; system message included only when
`systemPrompt` is non-empty.

### API

**`POST /api/admin/playground/chat`** (SSE, admin-only)

Request body:
```ts
{
  tier: "regular" | "pro" | "admin",
  model?: string,            // custom override; forces Admin-tier key
  systemPrompt?: string,
  messages: { role: "user" | "assistant", content: string }[]
}
```

Resolution (key always comes from Admin tier — the admin is the one testing, so billing is always to the admin key; tier selection only picks the model):
- Custom `model` provided → use Admin-tier API key + the supplied model
- Otherwise → use Admin-tier API key + the selected tier's configured model

Response: `text/event-stream` with `data: {"chunk": "..."}\n\n` events,
terminated by `data: [DONE]\n\n`. Errors emitted as
`data: {"error": "..."}\n\n` (matches `api/explainers/generate/route.ts`
pattern).

**`GET /api/admin/system-prompt`** (admin-only) → `{ prompt: string | null }`

**`PUT /api/admin/system-prompt`** (admin-only) — body `{ prompt: string | null }`
→ upserts `AppSetting["globalSystemPrompt"]` and writes an `AuditLog` entry
(`action: "UPDATE_GLOBAL_SYSTEM_PROMPT"`, `entityType: "AppSetting"`).

### UI

**Sidebar** (`src/components/admin/admin-sidebar.tsx`) — add 6th entry:
`{ label: "Playground", icon: FlaskConical, href: "/admin/playground" }`.

**`/admin/playground/page.tsx`** — single-file client component (~250 lines).

Layout:
1. Header: title + tier toggle (Regular / Pro / Admin) + model badge +
   custom-model input
2. System prompt panel: collapsible `<textarea>` preloaded from
   `/api/admin/system-prompt`, with "Save as live" + "Revert" buttons
3. Chat area: scrollable message list (user right, assistant left)
4. Composer: textarea + Send + Stop + Clear

State:
- `messages: { role: "user" | "assistant", content: string }[]`
- `tier: "regular" | "pro" | "admin"` — default `"admin"`
- `customModel: string` — default `""`
- `systemPrompt: string` — initialized from GET, edited locally
- `savedPrompt: string` — last value persisted server-side (drives "dirty" UI)
- `input: string`
- `streaming: boolean`

Behaviors:
| Action | Effect |
|---|---|
| Switch tier | `setMessages([])` |
| Custom model field change | `setMessages([])` |
| Edit system prompt textarea | Local only; takes effect on next send |
| Click "Save as live" | PUT system-prompt; refresh `savedPrompt` |
| Click "Revert" | Reload textarea from `savedPrompt` |
| Click "Clear" | `setMessages([])` |
| Click "Send" | Append user msg; POST to chat endpoint; stream chunks into a new assistant msg |
| Click "Stop" during stream | AbortController; keep partial assistant msg |

Streaming client mirrors `explainer-panel.tsx:147-179` (`getReader()` +
TextDecoder + SSE line parser).

## Edge cases / errors

- Tier has no API key → emit `{error: "No API key configured for admin tier"}` (Admin tier is the only key used; if it's missing, nothing works)
- Empty `messages` array → 400 from route before contacting OpenRouter
- OpenRouter 4xx (bad model name, key invalid) → surfaced via
  `OpenRouterError.message` as `{error: ...}`
- Client aborts → AbortController cancels fetch; partial assistant message
  remains in UI
- Migration drift on dev.db → handled by `prisma migrate dev`

## Testing

One smoke test at
`src/app/api/admin/playground/chat/__tests__/route.test.ts`, mirroring
`api/admin/config/__tests__/route.test.ts`:
- 401 when unauthenticated
- 403 when non-admin
- 400 when `messages` missing/empty
- 400 when `tier` missing/invalid

No page-component tests (Ponytail — UI is straightforward).

## Files touched

| File | Change |
|---|---|
| `src/server/db/schema.prisma` | + `AppSetting` model |
| `src/server/db/migrations/<ts>_add_app_setting/migration.sql` | new |
| `src/server/services/settings.ts` | new (~20 lines) |
| `src/server/services/openrouter.ts` | + `streamChat()` (~50 lines) |
| `src/app/api/admin/system-prompt/route.ts` | new (GET + PUT, ~80 lines) |
| `src/app/api/admin/playground/chat/route.ts` | new (SSE POST, ~100 lines) |
| `src/components/admin/admin-sidebar.tsx` | +1 nav item |
| `src/app/admin/playground/page.tsx` | new (~250 lines) |
| `src/app/api/admin/playground/chat/__tests__/route.test.ts` | new smoke test |

## Future work (not in this task)

- Wire `globalSystemPrompt` into explainer pipeline (replace hardcoded
  literary prompt, with literary prompt as default fallback)
- Add TTS / fal.ai tabs to the playground
- Optional per-tier system prompts (current: single global)
- Chat transcript persistence / sharing
