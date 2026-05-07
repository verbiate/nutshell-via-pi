import { db } from "@/server/db";
import crypto from "crypto";

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
