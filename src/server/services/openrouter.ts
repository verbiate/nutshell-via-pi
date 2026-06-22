import { db } from "@/server/db";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

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
          content:
            "You are an expert literary analyst. Your task is to explain the provided text accurately, without adding outside information.",
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
