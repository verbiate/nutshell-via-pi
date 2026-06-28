import { db } from "@/server/db";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ponytail: extracted so the single-pass streamExplainer and the two-pass
// pass-2 messages array share one source of truth for the system persona.
export const EXPLAINER_SYSTEM_MESSAGE =
  "You are an expert literary analyst. Your task is to explain the provided text accurately, without adding outside information.";

export interface StreamExplainerOptions {
  prompt: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface CompleteChatOptions {
  apiKey: string;
  model: string;
  prompt: string;
  systemMessage?: string;
  temperature?: number;
  maxTokens?: number;
  // ponytail: response_format json_object — caller checks the model supports it.
  jsonMode?: boolean;
  // ponytail: OpenRouter reasoning effort. Some models (e.g. gemini-3.1-flash-lite)
  // reason by default, burning the max_tokens budget on hidden thinking and
  // truncating the visible JSON. "minimal" disables it for mechanical tasks.
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export class OpenRouterError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = "OpenRouterError";
  }
}

/**
 * Fetch OpenRouter config for a user type. Falls back to env var and
 * hardcoded defaults to preserve existing Explainer functionality.
 */
export async function getOpenRouterConfig(userType: string) {
  const config = await db.openRouterConfig.findUnique({ where: { userType } });
  return {
    apiKey: config?.apiKey || process.env.OPENROUTER_API_KEY || "",
    model:
      config?.model ||
      (userType === "pro"
        ? "anthropic/claude-sonnet-4.6"
        : "google/gemini-2.0-flash-001"),
  };
}

export async function* streamExplainer(
  options: StreamExplainerOptions
): AsyncGenerator<string, void, unknown> {
  const apiKey = options.apiKey;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured", 500);
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "Nutshell",
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "system",
          content: EXPLAINER_SYSTEM_MESSAGE,
        },
        { role: "user", content: options.prompt },
      ],
      stream: true,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new OpenRouterError(
      `OpenRouter error ${response.status}: ${errorBody}`,
      response.status
    );
  }

  if (!response.body) {
    throw new OpenRouterError("OpenRouter response has no body", 500);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        if (!data) continue;
        try {
          const chunk = JSON.parse(data);
          const text = chunk.choices?.[0]?.delta?.content || "";
          if (text) yield text;
        } catch {
          // Skip malformed SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream a generic chat completion from OpenRouter. Used by the admin
 * Playground. Caller builds the full messages array (including any system
 * messages). Order is preserved as given.
 */
export async function* streamChat(
  options: StreamChatOptions
): AsyncGenerator<string, void, unknown> {
  if (!options.apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured", 500);
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "Nutshell Playground",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new OpenRouterError(
      `OpenRouter error ${response.status}: ${errorBody}`,
      response.status
    );
  }

  if (!response.body) {
    throw new OpenRouterError("OpenRouter response has no body", 500);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;
        if (!data) continue;
        try {
          const chunk = JSON.parse(data);
          const text = chunk.choices?.[0]?.delta?.content || "";
          if (text) yield text;
        } catch {
          // Skip malformed SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---- Two-pass book explainer ----

export interface BookTwoPassEvent {
  type: "status" | "chunk";
  // "explaining" = pass 1 (hidden) running; "refining" = pass 2 (streamed) running.
  stage?: "explaining" | "refining";
  chunk?: string;
}

export interface StreamBookTwoPassOptions {
  pass1Prompt: string;
  // ponytail: pass-2 prompt is built from pass-1's output, which is accumulated
  // inside this function. Caller hands a builder so it stays the owner of how
  // {{previous_response}} + {{book_text}} get filled — streamBookTwoPass stays
  // agnostic about prompt-builder.ts. streamExplainer adds the system message
  // internally on pass 2, preserving persona consistency between passes.
  buildPass2Prompt: (pass1Response: string) => string | Promise<string>;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Run a two-pass book explainer. Pass 1 generates a full explanation
 * (accumulated server-side, NEVER yielded to the caller). Pass 2 refines
 * pass 1's output; its chunks are yielded.
 *
 * Pass 2 is now token-pattern: the caller's buildPass2Prompt callback inlines
 * {{previous_response}} (and {{book_text}} etc.) into the pass-2 template,
 * and pass 2 runs as a single streamExplainer call. The earlier 4-message
 * chat array is gone — pass 2 sees pass 1's draft only because the caller
 * inlined it into the prompt body. Status events bracket each phase so the
 * client UI can show progress during the silent pass-1 window.
 */
export async function* streamBookTwoPass(
  options: StreamBookTwoPassOptions
): AsyncGenerator<BookTwoPassEvent, void, unknown> {
  // Pass 1: accumulate, do not surface. Reuses streamExplainer so the pass-1
  // request shape (system message, temperature, max_tokens) matches one-pass.
  yield { type: "status", stage: "explaining" };
  let pass1Response = "";
  for await (const chunk of streamExplainer({
    prompt: options.pass1Prompt,
    apiKey: options.apiKey,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  })) {
    pass1Response += chunk;
  }

  // Pass 2: token-pattern refinement. Caller inlines pass-1 output via the
  // callback; streamExplainer wraps the resulting prompt with the system
  // persona, so pass 2 has the same shape as pass 1.
  yield { type: "status", stage: "refining" };
  const pass2Prompt = await options.buildPass2Prompt(pass1Response);
  for await (const chunk of streamExplainer({
    prompt: pass2Prompt,
    apiKey: options.apiKey,
    model: options.model,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  })) {
    yield { type: "chunk", chunk };
  }
}

/**
 * One-shot (non-streaming) chat completion. Returns the full message content
 * as a string. Caller parses (e.g. JSON.parse when jsonMode is set).
 *
 * ponytail: exists because metadata extraction wants a structured JSON reply,
 * not streamed prose. Mirrors streamExplainer's request shape and error
 * handling; only the body and parse path differ.
 */
export async function completeChat(
  options: CompleteChatOptions
): Promise<string> {
  if (!options.apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured", 500);
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      ...(options.systemMessage
        ? [{ role: "system", content: options.systemMessage }]
        : []),
      { role: "user", content: options.prompt },
    ],
    stream: false,
    temperature: options.temperature ?? 0,
    max_tokens: options.maxTokens ?? 2048,
  };
  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  if (options.reasoningEffort) {
    body.reasoning = { effort: options.reasoningEffort };
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "Nutshell",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new OpenRouterError(
      `OpenRouter error ${response.status}: ${errorBody}`,
      response.status
    );
  }

  const json = await response.json();
  const content: string = json.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new OpenRouterError("OpenRouter returned empty content", 500);
  }
  return content;
}
