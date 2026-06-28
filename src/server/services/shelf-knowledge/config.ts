import { getOpenRouterConfig } from "@/server/services/openrouter";
import { getSetting } from "@/server/services/settings";
import type { ShelfLlmConfig } from "./types";

/**
 * Resolve the LLM config the shelf-knowledge engine uses for compile + query.
 * Uses the ADMIN-tier key always ("use the Admin key by default"); the model is
 * the admin-tier model unless the AppSetting `shelfKnowledgeModel` overrides it.
 * The override is surfaced in the admin panel (Plan 3).
 */
export async function getShelfLlmConfig(): Promise<ShelfLlmConfig> {
  const admin = await getOpenRouterConfig("admin");
  const override = await getSetting("shelfKnowledgeModel");
  return { apiKey: admin.apiKey, model: override ?? admin.model };
}
