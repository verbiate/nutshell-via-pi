import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(m: string, s: number) {
      super(m);
      this.statusCode = s;
    }
  },
}));

vi.mock("@/server/services/discussions", () => ({
  streamFollowup: vi.fn(),
}));

import { POST } from "@/app/api/discussions/[id]/messages/route";
import { requireAuth } from "@/lib/auth-guards";
import { streamFollowup } from "@/server/services/discussions";

// ponytail: the only non-trivial new logic in this route is parsing + validating
// the `attachments` body field and threading it into streamFollowup. Service-
// level persistence is exercised via the route contract here (mocked generator),
// which is the smallest check that fails if the wiring breaks.
describe("POST /api/discussions/[id]/messages — attachments", () => {
  beforeEach(() => vi.clearAllMocks());

  async function consume(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = "";
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    return out;
  }

  it("threads valid section attachments through to streamFollowup", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(streamFollowup).mockImplementation((async function* () {
      yield { type: "done" };
    }()) as any);

    const req = new Request("http://localhost/api/discussions/d1/messages", {
      method: "POST",
      body: JSON.stringify({
        content: "hello",
        attachments: [
          { type: "section", sectionHref: "ch1.xhtml" },
          { type: "section", sectionHref: "ch2.xhtml" },
        ],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "d1" }) });
    await consume(res.body!);

    expect(streamFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        discussionId: "d1",
        userId: "u1",
        userMessage: "hello",
        newAttachments: [
          { type: "section", sectionHref: "ch1.xhtml" },
          { type: "section", sectionHref: "ch2.xhtml" },
        ],
      })
    );
  });

  it("filters out malformed attachments and omits newAttachments when none valid", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(streamFollowup).mockImplementation((async function* () {
      yield { type: "done" };
    }()) as any);

    const req = new Request("http://localhost/api/discussions/d1/messages", {
      method: "POST",
      body: JSON.stringify({
        content: "hello",
        attachments: [
          { type: "passage", sectionHref: "ch1.xhtml" }, // wrong type
          { type: "section", sectionHref: "" }, // empty href
          { type: "section" }, // missing href
          "not-an-object",
        ],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "d1" }) });
    await consume(res.body!);

    const call = vi.mocked(streamFollowup).mock.calls[0][0];
    expect(call.newAttachments).toBeUndefined();
  });

  it("sends no newAttachments key when body omits attachments", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(streamFollowup).mockImplementation((async function* () {
      yield { type: "done" };
    }()) as any);

    const req = new Request("http://localhost/api/discussions/d1/messages", {
      method: "POST",
      body: JSON.stringify({ content: "hello" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "d1" }) });
    await consume(res.body!);

    expect(vi.mocked(streamFollowup).mock.calls[0][0].newAttachments).toBeUndefined();
  });
});
