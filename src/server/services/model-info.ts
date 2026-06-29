import { db } from "@/server/db";

// ponytail: extracted from /api/admin/playground/model-info so the upload
// pipeline can resolve tier token limits via the same cache. Module-level
// cache survives across requests in the same Node process; resets on redeploy.

const FALLBACK_CONTEXT = 120_000;
const TTL_MS = 24 * 60 * 60 * 1000;

// Headroom reserved for prompt + response when computing the effective book
// token limit. 10K tokens is conservative for templates up to ~5K tokens +
// responses up to ~4K tokens.
const HEADROOM_TOKENS = 10_000;

let listCache: { fetchedAt: number; map: Map<string, number> } | null = null;

async function getListMap(): Promise<Map<string, number>> {
  if (listCache && Date.now() - listCache.fetchedAt < TTL_MS) {
    return listCache.map;
  }
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter list fetch failed: ${res.status}`);
  }
  const data = await res.json();
  const models: Array<{ id: string; context_length?: number }> = data?.data ?? [];
  const map = new Map<string, number>();
  for (const m of models) {
    if (typeof m.context_length === "number") {
      map.set(m.id, m.context_length);
    }
  }
  listCache = { fetchedAt: Date.now(), map };
  return map;
}

function stripVariant(slug: string): string {
  // ponytail: OpenRouter exposes :nitro, :thinking, etc. variants that share
  // the base model's context window. Strip the suffix for lookup.
  const colonIdx = slug.indexOf(":");
  return colonIdx > 0 ? slug.slice(0, colonIdx) : slug;
}

/**
 * Look up a model's full context window from OpenRouter's public model list.
 * Cached process-wide for 24h. Strips variant suffixes (`:nitro` etc.) before
 * lookup. Falls back to FALLBACK_CONTEXT on any error or unknown model.
 *
 * Returns `source` so callers can show "(assumed)" in UI when fallback was used.
 */
export async function getContextWindow(
  model: string
): Promise<{ contextLength: number; source: "cache" | "fetch" | "fallback" }> {
  const base = stripVariant(model);
  try {
    const map = await getListMap();
    const contextLength = map.get(base);
    if (typeof contextLength === "number") {
      return {
        contextLength,
        source:
          listCache && Date.now() - listCache.fetchedAt < TTL_MS
            ? "cache"
            : "fetch",
      };
    }
    return { contextLength: FALLBACK_CONTEXT, source: "fallback" };
  } catch {
    return { contextLength: FALLBACK_CONTEXT, source: "fallback" };
  }
}

/**
 * Resolve the effective token limit for a tier's book uploads, applying the
 * resolution chain:
 *   1. Admin override (`OpenRouterConfig.maxContextTokens`) → use as-is
 *   2. Tier's configured model's context_length via OpenRouter → use as-is
 *   3. Fallback: 128K
 *
 * Always subtracts HEADROOM_TOKENS to leave room for prompt + response.
 *
 * Returns the effective MAX BOOK SIZE in tokens (not the model's full window).
 */
export async function getTierBookTokenLimit(
  userType: string
): Promise<number> {
  const config = await db.openRouterConfig.findUnique({
    where: { userType },
    select: { model: true, maxContextTokens: true },
  });

  // 1. Admin override (use as-is, but still subtract headroom)
  if (config?.maxContextTokens && config.maxContextTokens > 0) {
    return Math.max(0, config.maxContextTokens - HEADROOM_TOKENS);
  }

  // 2. Model context window
  if (config?.model) {
    const { contextLength } = await getContextWindow(config.model);
    return Math.max(0, contextLength - HEADROOM_TOKENS);
  }

  // 3. Fallback (128K matches the most-restrictive common model context)
  return 128_000 - HEADROOM_TOKENS;
}

// ponytail: per-type OUTPUT budget fallbacks. Book answers are the deepest
// (whole-book synthesis), section/passage shorter (a single locus), shelf
// broad synthetic answers, so the defaults reflect that. Admin's
// `OpenRouterConfig.maxOutputTokens` overrides ALL types when set > 0.
// Upgrade path: split into per-type overrides if a tier needs different
// ceilings for book vs section vs shelf answers.
const DEFAULT_MAX_OUTPUT_TOKENS: Record<"book" | "section" | "passage" | "shelf", number> = {
  book: 4096,
  section: 2048,
  passage: 2048,
  shelf: 4096,
};

export async function getTierMaxOutputTokens(
  userType: string,
  type: "book" | "section" | "passage" | "shelf"
): Promise<number> {
  const config = await db.openRouterConfig.findUnique({
    where: { userType },
    select: { maxOutputTokens: true },
  });
  if (config?.maxOutputTokens && config.maxOutputTokens > 0) {
    return config.maxOutputTokens;
  }
  return DEFAULT_MAX_OUTPUT_TOKENS[type] ?? 4096;
}
