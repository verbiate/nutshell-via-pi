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

vi.mock("@/server/services/reader", () => ({
  verifyBookAccess: vi.fn(),
}));

vi.mock("@/server/services/explainer-threads", () => ({
  streamInitialThreadResponse: vi.fn(),
  listThreadsForBook: vi.fn(),
}));

import { POST, GET } from "@/app/api/explainers/threads/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { listThreadsForBook } from "@/server/services/explainer-threads";

describe("POST /api/explainers/threads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 SSE error when unauthenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue({ statusCode: 401 } as any);

    const req = new Request("http://localhost/api/explainers/threads", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", type: "passage", passageText: "hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("returns SSE 400 when bookId or type is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1", preferredLanguage: "en" } as any);

    const req = new Request("http://localhost/api/explainers/threads", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("bookId and type are required");
  });

  it("returns SSE 400 when type is passage but passageText missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1", preferredLanguage: "en" } as any);

    const req = new Request("http://localhost/api/explainers/threads", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", type: "passage" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("passageText is required");
  });

  it("returns 403 SSE when user lacks book access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1", preferredLanguage: "en" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);

    const req = new Request("http://localhost/api/explainers/threads", {
      method: "POST",
      body: JSON.stringify({
        bookId: "b1",
        type: "passage",
        passageText: "selected text",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/explainers/threads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when bookId is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);

    const req = new Request("http://localhost/api/explainers/threads");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when user lacks book access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);

    const req = new Request(
      "http://localhost/api/explainers/threads?bookId=b1"
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns threads list for accessible book", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(listThreadsForBook).mockResolvedValue([
      {
        id: "t1",
        type: "passage",
        passageText: "some text",
        updatedAt: new Date().toISOString(),
        explainer: { content: "...", modelId: "x" },
        _count: { messages: 2 },
      } as any,
    ]);

    const req = new Request(
      "http://localhost/api/explainers/threads?bookId=b1"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].id).toBe("t1");
  });
});
