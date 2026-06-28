import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

vi.mock("@/server/services/openrouter", () => ({
  getOpenRouterConfig: vi.fn(),
}));

vi.mock("@/server/services/settings", () => ({
  getSetting: vi.fn(),
}));

import { getShelfLlmConfig } from "../config";
import { getOpenRouterConfig } from "@/server/services/openrouter";
import { getSetting } from "@/server/services/settings";

describe("getShelfLlmConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the admin-tier key and model by default", async () => {
    vi.mocked(getOpenRouterConfig).mockResolvedValue({
      apiKey: "admin-key",
      model: "anthropic/claude-sonnet-4.6",
    });
    vi.mocked(getSetting).mockResolvedValue(null);

    const cfg = await getShelfLlmConfig();
    expect(cfg.apiKey).toBe("admin-key");
    expect(cfg.model).toBe("anthropic/claude-sonnet-4.6");
    expect(getOpenRouterConfig).toHaveBeenCalledWith("admin");
    expect(getSetting).toHaveBeenCalledWith("shelfKnowledgeModel");
  });

  it("overrides the model when shelfKnowledgeModel AppSetting is set", async () => {
    vi.mocked(getOpenRouterConfig).mockResolvedValue({
      apiKey: "admin-key",
      model: "default-model",
    });
    vi.mocked(getSetting).mockResolvedValue("qwen/qwen3-235b-a22b");

    const cfg = await getShelfLlmConfig();
    expect(cfg.apiKey).toBe("admin-key");       // key always admin
    expect(cfg.model).toBe("qwen/qwen3-235b-a22b"); // overridden
  });
});
