import { db } from "@/server/db";
import crypto from "crypto";
import { OpenRouterError } from "./openrouter";

export interface ExplainerLookup {
  contentHash: string;
  language: string;
  contentType: "book" | "section";
  tier: "regular" | "pro";
}

export interface ExplainerCreateInput {
  contentHash: string;
  language: string;
  contentType: string;
  tier: string;
  content: string;
  modelId: string;
  promptVersion: number;
  tokenCount?: number;
}

export async function getExplainer(params: ExplainerLookup) {
  return db.explainer.findUnique({
    where: {
      contentHash_language_contentType_tier: {
        contentHash: params.contentHash,
        language: params.language,
        contentType: params.contentType,
        tier: params.tier,
      },
    },
  });
}

export async function createExplainer(data: ExplainerCreateInput) {
  return db.explainer.create({ data });
}

export function computeContentHash(
  sourceText: string,
  promptVersion: number,
  promptType: string
): string {
  const hash = crypto.createHash("sha256");
  hash.update(promptType);
  hash.update("\x00");
  hash.update(sourceText);
  hash.update("\x00");
  hash.update(String(promptVersion));
  return hash.digest("hex");
}

// Lazy imports to avoid circular dependency
async function getPromptBuilder() {
  const { buildBookPrompt, buildSectionPrompt } = await import("./prompt-builder");
  return { buildBookPrompt, buildSectionPrompt };
}

async function getStreamExplainer() {
  const { streamExplainer, REGULAR_MODEL, PRO_MODEL } = await import("./openrouter");
  return { streamExplainer, REGULAR_MODEL, PRO_MODEL };
}

export interface GenerateExplainerParams {
  bookId: string;
  type: "book" | "section";
  language: string;
  tier: "regular" | "pro";
  sectionHref?: string;
}

export async function* generateExplainer(
  params: GenerateExplainerParams
): AsyncGenerator<string, void, unknown> {
  const { bookId, type, language, tier, sectionHref } = params;

  // Build prompt and get source text
  let promptData: {
    prompt: string;
    sourceText: string;
    promptVersion: number;
  };
  const { buildBookPrompt, buildSectionPrompt } = await getPromptBuilder();

  if (type === "book") {
    promptData = await buildBookPrompt(bookId, language);
  } else {
    if (!sectionHref) {
      throw new Error("sectionHref is required for section-level explainer");
    }
    const sectionData = await buildSectionPrompt(bookId, sectionHref, language);
    promptData = {
      prompt: sectionData.prompt,
      sourceText: sectionData.sourceText,
      promptVersion: sectionData.promptVersion,
    };
  }

  // Compute content hash for cache lookup
  const contentHash = computeContentHash(
    promptData.sourceText,
    promptData.promptVersion,
    type
  );

  // Check cache
  const cached = await getExplainer({
    contentHash,
    language,
    contentType: type,
    tier,
  });

  if (cached) {
    yield cached.content;
    return;
  }

  // Select model by tier
  const { streamExplainer, REGULAR_MODEL, PRO_MODEL } = await getStreamExplainer();
  const model = tier === "pro" ? PRO_MODEL : REGULAR_MODEL;
  const maxTokens = type === "book" ? 4096 : 2048;

  // Guard against books that exceed context window
  const APPROX_CHARS_PER_TOKEN = 4;
  const maxChars = 900_000 * APPROX_CHARS_PER_TOKEN; // ~900K tokens for Gemini Flash
  if (promptData.sourceText.length > maxChars) {
    throw new OpenRouterError(
      `This ${type === "book" ? "book" : "section"} is too large for an AI explainer.`,
      400
    );
  }

  // Stream from OpenRouter and accumulate
  let fullContent = "";
  for await (const chunk of streamExplainer({
    prompt: promptData.prompt,
    model,
    maxTokens,
  })) {
    fullContent += chunk;
    yield chunk;
  }

  // Cache the complete result
  await createExplainer({
    contentHash,
    language,
    contentType: type,
    tier,
    content: fullContent,
    modelId: model,
    promptVersion: promptData.promptVersion,
  });
}
