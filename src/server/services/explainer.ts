import { db } from "@/server/db";
import crypto from "crypto";
import { OpenRouterError } from "./openrouter";

export interface ExplainerLookup {
  contentHash: string;
  language: string;
  contentType: "book" | "section" | "passage";
  tier: "regular" | "pro" | "admin";
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
  promptType: string,
  bookMd5?: string,
  extraSalt?: string
): string {
  // ponytail: bookMd5 added so that the same section/passage text in two
  // different books gets distinct cache rows. Without it, a public-domain
  // Bible chapter quoted in two books would share an explainer — wrong, since
  // 'connections to other parts' should differ. Book type omits it (sourceText
  // IS the book, so already unique per book).
  //
  // extraSalt: used by two-pass book explainers so the refined (pass-2) cache
  // row never collides with the one-pass book row, and a pass-2 template edit
  // (bumping its version) invalidates independently of the book template.
  const hash = crypto.createHash("sha256");
  hash.update(promptType);
  hash.update("\x00");
  hash.update(sourceText);
  if (bookMd5) {
    hash.update("\x00");
    hash.update(bookMd5);
  }
  hash.update("\x00");
  hash.update(String(promptVersion));
  if (extraSalt) {
    hash.update("\x00");
    hash.update(extraSalt);
  }
  return hash.digest("hex");
}

// Lazy imports to avoid circular dependency
async function getPromptBuilder() {
  const { buildBookPrompt, buildSectionPrompt } = await import("./prompt-builder");
  return { buildBookPrompt, buildSectionPrompt };
}

async function getBuildPassagePrompt() {
  const { buildPassagePrompt } = await import("./prompt-builder");
  return buildPassagePrompt;
}

async function getStreamExplainer() {
  const { streamExplainer, getOpenRouterConfig } = await import("./openrouter");
  return { streamExplainer, getOpenRouterConfig };
}

export interface GenerateExplainerParams {
  bookId: string;
  type: "book" | "section" | "passage";
  language: string;
  tier: "regular" | "pro" | "admin";
  sectionHref?: string;
  passageText?: string;
}

export async function* generateExplainer(
  params: GenerateExplainerParams
): AsyncGenerator<string, void, unknown> {
  const { bookId, type, language, tier, sectionHref, passageText } = params;

  // Build prompt and get source text
  let promptData: {
    prompt: string;
    sourceText: string;
    bookText: string;
    bookMd5: string;
    promptVersion: number;
  };
  const { buildBookPrompt, buildSectionPrompt } = await getPromptBuilder();

  if (type === "book") {
    promptData = await buildBookPrompt(bookId, language);
  } else if (type === "passage") {
    if (!passageText) {
      throw new Error("passageText is required for passage-level explainer");
    }
    const buildPassagePrompt = await getBuildPassagePrompt();
    promptData = await buildPassagePrompt(bookId, passageText, language);
  } else {
    if (!sectionHref) {
      throw new Error("sectionHref is required for section-level explainer");
    }
    const sectionData = await buildSectionPrompt(bookId, sectionHref, language);
    promptData = {
      prompt: sectionData.prompt,
      sourceText: sectionData.sourceText,
      bookText: sectionData.bookText,
      bookMd5: sectionData.bookMd5,
      promptVersion: sectionData.promptVersion,
    };
  }

  // Compute content hash for cache lookup. Include bookMd5 for section/passage
  // so the same snippet in two different books doesn't share a cache row.
  const contentHash = computeContentHash(
    promptData.sourceText,
    promptData.promptVersion,
    type,
    type === "section" || type === "passage" ? promptData.bookMd5 : undefined
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

  // Resolve API key and model by tier
  const { streamExplainer, getOpenRouterConfig } = await getStreamExplainer();
  const { apiKey, model } = await getOpenRouterConfig(tier);
  if (!apiKey) throw new OpenRouterError("OpenRouter API key not configured", 500);
  const maxTokens = type === "book" ? 4096 : 2048;

  // Size guard: combined source + book text against the ~900K-token ceiling.
  // ponytail: book type has sourceText === bookText, so the sum double-counts —
  // use just sourceText for that case. For section/passage, both contribute.
  const APPROX_CHARS_PER_TOKEN = 4;
  const maxChars = 900_000 * APPROX_CHARS_PER_TOKEN;
  const combinedChars =
    type === "book"
      ? promptData.sourceText.length
      : promptData.sourceText.length + promptData.bookText.length;
  if (combinedChars > maxChars) {
    throw new OpenRouterError(
      `This ${type === "book" ? "book" : type === "section" ? "section" : "passage"} is too large to explain with full-book context.`,
      400
    );
  }

  // Stream from OpenRouter and accumulate
  let fullContent = "";
  for await (const chunk of streamExplainer({
    prompt: promptData.prompt,
    apiKey,
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
