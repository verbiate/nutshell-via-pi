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

export async function getLatestExplainer(params: ExplainerLookup) {
  // ponytail: versioned cache — return the highest version for the 4-axis key.
  // New discussions always read the latest; existing discussions keep their
  // pinned version via thread.explainerId.
  return db.explainer.findFirst({
    where: {
      contentHash: params.contentHash,
      language: params.language,
      contentType: params.contentType,
      tier: params.tier,
    },
    orderBy: { version: "desc" },
  });
}

/**
 * Single source of truth for the explainer cache key. Both generation paths
 * (explainer.ts + explainer-threads.ts) call this so the hash can never drift
 * between writer and reader. bookMd5 is folded in only for section/passage;
 * twoPass + metadata salts are optional.
 */
export interface ContentHashInput {
  type: "book" | "section" | "passage";
  sourceText: string;
  bookMd5: string;
  promptVersion: number;
  twoPassVersion?: number;
  metadataVersion?: string;
}

export function computeExplainerContentHash(input: ContentHashInput): string {
  const { type, sourceText, bookMd5, promptVersion, twoPassVersion, metadataVersion } = input;
  const parts: string[] = [];
  if (twoPassVersion) parts.push(`twoPass:${twoPassVersion}`);
  if (metadataVersion) parts.push(`meta:${metadataVersion}`);
  const extraSalt = parts.length > 0 ? parts.join("|") : undefined;
  const includeBookMd5 = type === "section" || type === "passage";
  return computeContentHash(
    sourceText,
    promptVersion,
    type,
    includeBookMd5 ? bookMd5 : undefined,
    extraSalt
  );
}

export async function createExplainer(data: ExplainerCreateInput) {
  // ponytail: versioned insert. nextVersion = max(existing) + 1 so a re-reroll
  // creates a fresh row instead of overwriting. A concurrent create racing on
  // the same version throws P2002; callers handle it by re-reading the latest.
  const latest = await db.explainer.findFirst({
    where: {
      contentHash: data.contentHash,
      language: data.language,
      contentType: data.contentType,
      tier: data.tier,
    },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  return db.explainer.create({ data: { ...data, version } });
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
    metadataVersion?: string;
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

  // Compute content hash for cache lookup via the single-source-of-truth
  // helper (same formula the threaded path uses, so writer/reader never drift).
  const contentHash = computeExplainerContentHash({
    type,
    sourceText: promptData.sourceText,
    bookMd5: promptData.bookMd5,
    promptVersion: promptData.promptVersion,
    metadataVersion: promptData.metadataVersion,
  });

  // Check cache
  const cached = await getLatestExplainer({
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
