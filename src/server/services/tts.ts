import { db } from "@/server/db";
import { storage } from "@/server/storage/local";
import crypto from "crypto";
import { extractSectionText } from "./section-extractor";
import { callElevenLabs, callFalAi } from "./tts-providers";

export interface TtsAudioLookup {
  contentHash: string;
  language: string;
  voiceId: string;
  model: string;
}

export interface TtsAudioCreateInput {
  contentHash: string;
  language: string;
  voiceId: string;
  model: string;
  provider: string;
  storagePath: string;
  fileSize?: number;
}

export interface GenerateTtsParams {
  bookId: string;
  sectionHref: string;
  tier: "regular" | "pro" | "admin";
  signal?: AbortSignal;
}

export interface GenerateTtsForTextParams {
  text: string;
  language?: string;
  tier: "regular" | "pro" | "admin";
  signal?: AbortSignal;
}

export interface GenerateTtsResult {
  cached: boolean;
  audioId: string;
  url: string;
}

/**
 * SHA-256 hash of raw source text only (no prompt version — TTS doesn't use prompts).
 */
export function computeTtsContentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Split text into chunks under maxChars, packing paragraphs together where
 * possible. Paragraphs are separated by preserved \n inside a chunk when they
 * fit; if a single paragraph exceeds maxChars, split at the nearest word
 * boundary. Never truncates mid-word.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (maxChars <= 0) throw new Error("maxChars must be positive");
  if (text.length <= maxChars) return [text];

  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }
    if (current.length + 1 + para.length <= maxChars) {
      current += "\n" + para;
    } else {
      chunks.push(current);
      current = para;
    }
  }
  if (current) chunks.push(current);

  // Split any over-long paragraph at a word boundary.
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      result.push(chunk);
    } else {
      result.push(...splitAtWordBoundary(chunk, maxChars));
    }
  }
  return result;
}

function splitAtWordBoundary(text: string, maxChars: number): string[] {
  const words = text.split(/(\s+)/);
  const result: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.trim() === "") {
      current += word;
      continue;
    }
    if ((current + word).length > maxChars) {
      if (current.trim()) result.push(current.trim());
      current = word;
    } else {
      current += word;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/**
 * Look up a cached TTS audio entry by composite unique key.
 * Prisma unique key: contentHash_language_voiceId_model
 */
export async function getTtsAudio(params: TtsAudioLookup) {
  return db.ttsAudio.findUnique({
    where: {
      contentHash_language_voiceId_model: {
        contentHash: params.contentHash,
        language: params.language,
        voiceId: params.voiceId,
        model: params.model,
      },
    },
  });
}

/**
 * Create a TtsAudio cache entry.
 */
export async function createTtsAudio(data: TtsAudioCreateInput) {
  return db.ttsAudio.create({ data });
}

/**
 * Look up TTS provider configuration for a given provider and user type.
 * Prisma unique key: provider_userType
 */
export async function getTtsProviderConfig(
  provider: "elevenlabs" | "fal",
  userType: string
) {
  return db.ttsProviderConfig.findUnique({
    where: {
      provider_userType: { provider, userType },
    },
  });
}

/**
 * Cache-first TTS audio generation orchestrator.
 *
 * Flow:
 * 1. Fetch book row to get epubPath and language
 * 2. Extract section text via existing epub-ts spine traversal
 * 3. Hand off to synthesizeAndCache (hash → provider → cache → store)
 *
 * On concurrent cache-miss race: unique constraint error is caught and the
 * existing row is returned (same pattern as Explainer cache).
 */
export async function generateTtsAudio(
  params: GenerateTtsParams
): Promise<GenerateTtsResult> {
  const { bookId, sectionHref, tier, signal } = params;

  // 1. Fetch book
  const book = await db.epubFile.findUnique({ where: { id: bookId } });
  if (!book) throw new Error("Book not found");

  // 2. Extract section text
  const sourceText = await extractSectionText(book.epubPath, sectionHref, {
    forTts: true,
  });
  if (!sourceText.trim()) throw new Error("Section text is empty");

  // 3. Synthesize + cache (language from book metadata)
  return synthesizeAndCache(sourceText, book.language || "en", tier, signal);
}

/**
 * Speak arbitrary text (e.g. a discussion reply). Same cache + providers as
 * generateTtsAudio, just without the book/section-extraction prefix. The
 * TtsAudio cache is keyed by contentHash = SHA-256(text), so a reply spoken
 * by two users hits the same cached audio row.
 */
export async function generateTtsForText(
  params: GenerateTtsForTextParams
): Promise<GenerateTtsResult> {
  const { text, language = "en", tier, signal } = params;
  const clean = text?.trim();
  if (!clean) throw new Error("Text is empty");
  return synthesizeAndCache(clean, language, tier, signal);
}

/**
 * Shared core: hash → resolve provider → cache lookup → chunk + synthesize →
 * store → write cache row. Used by both the section path (text from EPUB) and
 * the arbitrary-text path (text from caller).
 */
async function synthesizeAndCache(
  sourceText: string,
  language: string,
  tier: "regular" | "pro" | "admin",
  signal?: AbortSignal,
): Promise<GenerateTtsResult> {
  // 3. Compute content hash
  const contentHash = computeTtsContentHash(sourceText);

  // 4. Resolve provider config — try elevenlabs first, then fal
  const providers = ["elevenlabs", "fal"] as const;
  let providerConfig: { apiKey: string | null; model: string | null; voiceId: string | null } | null = null;
  let selectedProvider: string | null = null;

  for (const provider of providers) {
    const config = await getTtsProviderConfig(provider, tier);
    if (config?.apiKey) {
      providerConfig = config;
      selectedProvider = provider;
      break;
    }
  }

  if (!providerConfig || !selectedProvider || !providerConfig.apiKey) {
    const err = new Error("TTS provider not configured for tier: " + tier);
    (err as any).statusCode = 503;
    throw err;
  }

  const voiceId = providerConfig.voiceId || "";
  const model = providerConfig.model || "";

  // 5. Check cache
  const cached = await getTtsAudio({ contentHash, language, voiceId, model });
  if (cached) {
    return {
      cached: true,
      audioId: cached.id,
      url: storage.getUrl(cached.storagePath),
    };
  }

  // 6. Cache miss — generate audio
  const MAX_CHARS = 5000; // ElevenLabs multilingual v2 safe default
  const chunks = chunkText(sourceText, MAX_CHARS);

  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    let audioBuffer: Buffer;
    if (selectedProvider === "elevenlabs") {
      if (!voiceId) throw new Error("ElevenLabs voiceId is required");
      audioBuffer = await callElevenLabs({
        text: chunk,
        voiceId,
        modelId: model,
        apiKey: providerConfig.apiKey!,
        signal,
      });
    } else {
      audioBuffer = await callFalAi({
        text: chunk,
        modelId: model,
        voiceId: voiceId || undefined,
        apiKey: providerConfig.apiKey!,
        signal,
      });
    }
    buffers.push(audioBuffer);
  }

  // Concatenate all chunk buffers
  const concatenatedBuffer = Buffer.concat(buffers);

  // Storage path: tts/${contentHash}/${voiceId}_${model}.mp3
  const storagePath = `tts/${contentHash}/${voiceId}_${model}.mp3`;
  await storage.write(storagePath, concatenatedBuffer);

  // 7. Write cache entry (handle race condition)
  try {
    const newRow = await createTtsAudio({
      contentHash,
      language,
      voiceId,
      model,
      provider: selectedProvider,
      storagePath,
      fileSize: concatenatedBuffer.length,
    });
    return {
      cached: false,
      audioId: newRow.id,
      url: storage.getUrl(storagePath),
    };
  } catch (err: any) {
    // Prisma unique constraint error (P2002) — another request wrote the cache first
    if (err?.code === "P2002") {
      const existing = await getTtsAudio({ contentHash, language, voiceId, model });
      if (existing) {
        return {
          cached: true,
          audioId: existing.id,
          url: storage.getUrl(existing.storagePath),
        };
      }
    }
    throw err;
  }
}
