import { describe, it, expect, vi, afterEach } from "vitest";

// openrouter.ts imports @/server/db at module load. Mock it so no Prisma client
// is constructed during this streamer-focused test.
vi.mock("@/server/db", () => ({
  db: {
    openRouterConfig: { findUnique: vi.fn() },
  },
}));

import { streamBookTwoPass } from "@/server/services/openrouter";

// Build a fake SSE Response whose body yields `tokens` as OpenRouter-style
// chat-completion streaming chunks, then a [DONE] terminator.
function sseResponse(tokens: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const t of tokens) {
        const payload = JSON.stringify({
          choices: [{ delta: { content: t } }],
        });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("streamBookTwoPass", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("hides pass-1 output and yields only pass-2 chunks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(["PASS", "ONE", "-HIDDEN"]))
      .mockResolvedValueOnce(sseResponse(["FINAL", "OUTPUT"]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const events: Array<{ type: string; stage?: string; chunk?: string }> = [];
    let collected = "";
    for await (const e of streamBookTwoPass({
      pass1Prompt: "explain this book",
      buildPass2Prompt: () => "refine: PASS ONE -HIDDEN",
      apiKey: "k",
      model: "m",
    })) {
      events.push(e);
      if (e.type === "chunk" && e.chunk) collected += e.chunk;
    }

    // ponytail: the whole point of two-pass is pass 1 is hidden. This is the
    // invariant most likely to silently break on refactor — guard it hard.
    expect(collected).toBe("FINALOUTPUT");
    expect(collected).not.toContain("PASS");
    expect(collected).not.toContain("HIDDEN");

    // Both passes hit OpenRouter exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Status events bracket the two phases so the UI can show progress.
    const stages = events
      .filter((e) => e.type === "status")
      .map((e) => e.stage);
    expect(stages).toEqual(["explaining", "refining"]);
  });

  it("inlines pass-1 response into the pass-2 prompt via the builder", async () => {
    // Token-pattern: pass-1 output reaches pass-2 only because the caller's
    // buildPass2Prompt callback inlines it into the template body. Pass 2 is
    // then a single streamExplainer call — no assistant turn, no chat array.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(["INTERMEDIATE"]))
      .mockResolvedValueOnce(sseResponse(["FINAL"]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const buildPass2Prompt = vi.fn(
      (pass1Response: string) => `REFINE(${pass1Response})`
    );

    for await (const _ of streamBookTwoPass({
      pass1Prompt: "P1PROMPT",
      buildPass2Prompt,
      apiKey: "k",
      model: "m",
    })) {
      void _;
    }

    // Builder was called exactly once with pass-1's accumulated output.
    expect(buildPass2Prompt).toHaveBeenCalledTimes(1);
    expect(buildPass2Prompt).toHaveBeenCalledWith("INTERMEDIATE");

    // Second fetch call is pass 2. Its body must be a single-user-message
    // streamExplainer request whose user content is the builder's return
    // value — NOT a 4-message chat array.
    const pass2Body = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string
    );
    expect(pass2Body.messages).toEqual([
      { role: "system", content: expect.any(String) },
      { role: "user", content: "REFINE(INTERMEDIATE)" },
    ]);
  });
});
