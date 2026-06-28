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
}): Promise<T> {
  const { apiKey, model } = await getShelfLlmConfig();
  const maxAttempts = (args.maxRetries ?? 1) + 1;
  const reminderPrompt = args.prompt + REMINDER;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await completeChat({
      apiKey,
      model,
      prompt: attempt === 1 ? args.prompt : reminderPrompt,
      systemMessage: args.systemMessage,
      jsonMode: true,
    });

    try {
      const parsed: unknown = JSON.parse(raw);
      if (args.validate(parsed)) return parsed;
      lastError = new Error(
        `LLM JSON failed schema validation: ${raw.slice(0, 200)}`
      );
    } catch (e) {
      lastError = e instanceof Error
        ? new Error(`LLM did not return parseable JSON: ${e.message}`)
        : new Error("LLM did not return parseable JSON");
    }

    if (attempt === maxAttempts) {
      throw lastError;
    }
  }

  // ponytail: unreachable — loop always returns or throws. Satisfies TS return.
  throw lastError ?? new Error("completeJson: exhausted retries");
}
