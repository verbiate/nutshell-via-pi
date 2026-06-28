import type { ContextSourceStrategy } from "./types";
import { OkfContextSource } from "./okf-context-source";

/**
 * Factory for the ContextSourceStrategy backing shelf discussions. Callers
 * (discussions.ts: streamShelfFirstTurn + rebuildSystemPrompt) never change —
 * they go through this single seam.
 *
 * Stage 1 (now): returns OkfContextSource (the real OKF wiki engine, Plan 2).
 * Plan 3's admin OKF/RAG toggle will select here between OkfContextSource and
 * (Stage 2) RagContextSource, based on an AppSetting.
 */
export function getContextSource(): ContextSourceStrategy {
  return new OkfContextSource();
}
