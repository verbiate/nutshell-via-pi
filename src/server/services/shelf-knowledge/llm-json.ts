import { completeChat } from "@/server/services/openrouter";
import { getShelfLlmConfig } from "./config";

// ponytail: schema-agnostic structured-JSON completion. Caller supplies
// `validate` as a type guard so this module stays free of any schema/zod dep.
// Retries parse/validate failures once with a reminder appended; lets
// completeChat errors (API/network) propagate without retry — those aren't
// malformed-LLM-output failures.
const REMINDER =
  "\n\nRespond with valid JSON matching the requested schema.";

export async function completeJson<T>(args: {
  prompt: string;
  systemMessage?: string;
  validate: (x: unknown) => x is T;
  maxRetries?: number;
  // ponytail: default 8192 — concept/theme JSON for a single chunk easily
  // exceeds completeChat's 4096 default (truncation → invalid JSON → fail).
  // Raise per-call if a caller emits larger structures.
  maxTokens?: number;
  // ponytail: pass-through to completeChat. Set "minimal" for mechanical tasks
  // on reasoning-enabled models (else reasoning eats the output budget).
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  // ponytail: optional last-resort salvage. When JSON.parse fails (typically
  // because the provider's output-token cap truncated the JSON mid-structure),
  // completeJson calls this with the raw string; if it returns a non-null
  // value, that's used as the parsed result (then `validate` runs on it).
  // Caller-supplied because salvage is schema-specific (e.g. close a concepts
  // array at the last complete item).
  salvage?: (raw: string) => unknown | null;
}): Promise<T> {
  const { apiKey, model } = await getShelfLlmConfig();
  const maxAttempts = (args.maxRetries ?? 1) + 1;
  const reminderPrompt = args.prompt + REMINDER;
  const maxTokens = args.maxTokens ?? 8192;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await completeChat({
      apiKey,
      model,
      prompt: attempt === 1 ? args.prompt : reminderPrompt,
      systemMessage: args.systemMessage,
      jsonMode: true,
      maxTokens,
      reasoningEffort: args.reasoningEffort,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // ponytail: provider output-cap truncation? Try the caller's salvage
      // (recovers the leading complete items before truncation). Falls through
      // to retry if salvage isn't supplied or also fails.
      const salvaged = args.salvage ? args.salvage(raw) : null;
      if (salvaged !== null && salvaged !== undefined) {
        parsed = salvaged;
      } else {
        lastError = e instanceof Error
          ? new Error(`LLM did not return parseable JSON: ${e.message}`)
          : new Error("LLM did not return parseable JSON");
        if (attempt === maxAttempts) throw lastError;
        continue;
      }
    }
    if (args.validate(parsed)) return parsed;
    lastError = new Error(
      `LLM JSON failed schema validation: ${raw.slice(0, 200)}`
    );
    if (attempt === maxAttempts) throw lastError;
  }

  // ponytail: unreachable — loop always returns or throws. Satisfies TS return.
  throw lastError ?? new Error("completeJson: exhausted retries");
}
