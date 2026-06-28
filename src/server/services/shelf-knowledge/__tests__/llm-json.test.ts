import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/services/openrouter", () => ({
  completeChat: vi.fn(),
}));

vi.mock("../config", () => ({
  getShelfLlmConfig: vi.fn(),
}));

import { completeChat } from "@/server/services/openrouter";
import { getShelfLlmConfig } from "../config";
import { completeJson } from "../llm-json";

const isString = (x: unknown): x is string => typeof x === "string";

describe("completeJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getShelfLlmConfig).mockResolvedValue({
      apiKey: "admin-key",
      model: "test-model",
    });
  });

  it("happy path: returns parsed value when validate passes", async () => {
    vi.mocked(completeChat).mockResolvedValueOnce('"hello"');

    const result = await completeJson({
      prompt: "say hi",
      validate: isString,
    });

    expect(result).toBe("hello");
    expect(completeChat).toHaveBeenCalledTimes(1);
    expect(completeChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: "admin-key",
        model: "test-model",
        jsonMode: true,
        prompt: "say hi",
      })
    );
  });

  it("malformed JSON → retry once with reminder appended → returns parsed value", async () => {
    vi.mocked(completeChat)
      .mockResolvedValueOnce("not-json")
      .mockResolvedValueOnce('"ok"');

    const result = await completeJson({
      prompt: "p",
      validate: isString,
    });

    expect(result).toBe("ok");
    expect(completeChat).toHaveBeenCalledTimes(2);

    const secondArgs = vi.mocked(completeChat).mock.calls[1][0];
    expect(secondArgs.prompt).not.toBe("p");
    expect(secondArgs.prompt).toContain("p");
    expect(secondArgs.prompt.toLowerCase()).toContain("valid json");
  });

  it("malformed JSON twice → throws after retry", async () => {
    vi.mocked(completeChat).mockResolvedValue("not-json");

    await expect(
      completeJson({ prompt: "p", validate: isString })
    ).rejects.toThrow();
    expect(completeChat).toHaveBeenCalledTimes(2);
  });

  it("validate rejects → retry → validate passes → returns", async () => {
    vi.mocked(completeChat)
      .mockResolvedValueOnce("123") // valid JSON, but fails isString
      .mockResolvedValueOnce('"good"');

    const result = await completeJson({
      prompt: "p",
      validate: isString,
    });

    expect(result).toBe("good");
    expect(completeChat).toHaveBeenCalledTimes(2);
  });

  it("completeChat throws → propagates without retry", async () => {
    vi.mocked(completeChat).mockRejectedValue(new Error("API down"));

    await expect(
      completeJson({ prompt: "p", validate: isString })
    ).rejects.toThrow("API down");
    expect(completeChat).toHaveBeenCalledTimes(1);
  });
});
