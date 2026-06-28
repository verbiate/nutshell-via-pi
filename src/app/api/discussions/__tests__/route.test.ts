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

vi.mock("@/server/services/discussions", () => ({
  streamInitialDiscussionResponse: vi.fn(),
  listDiscussionsForBook: vi.fn(),
  listAllDiscussionsForUser: vi.fn(),
}));

import { POST, GET } from "@/app/api/discussions/route";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { listDiscussionsForBook, listAllDiscussionsForUser } from "@/server/services/discussions";

describe("POST /api/discussions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 SSE error when unauthenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue({ statusCode: 401 } as any);

    const req = new Request("http://localhost/api/discussions", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1", type: "passage", passageText: "hi" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("returns SSE 400 when bookId or type is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1", preferredLanguage: "en" } as any);

    const req = new Request("http://localhost/api/discussions", {
      method: "POST",
      body: JSON.stringify({ bookId: "b1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("type is required");
  });

  it("returns SSE 400 when type is passage but passageText missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1", preferredLanguage: "en" } as any);

    const req = new Request("http://localhost/api/discussions", {
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

    const req = new Request("http://localhost/api/discussions", {
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

describe("GET /api/discussions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists ALL user discussions when bookId is absent (homepage tab)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(listAllDiscussionsForUser).mockResolvedValue([
      {
        id: "t1",
        type: "book",
        updatedAt: new Date().toISOString(),
        _count: { messages: 0 },
      } as any,
    ]);

    const req = new Request("http://localhost/api/discussions");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(listAllDiscussionsForUser).toHaveBeenCalledWith("u1");
    expect(vi.mocked(verifyBookAccess)).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.discussions).toHaveLength(1);
    expect(body.discussions[0].id).toBe("t1");
  });

  it("returns 403 when user lacks book access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(false);

    const req = new Request(
      "http://localhost/api/discussions?bookId=b1"
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns discussions list for accessible book", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "u1" } as any);
    vi.mocked(verifyBookAccess).mockResolvedValue(true);
    vi.mocked(listDiscussionsForBook).mockResolvedValue([
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
      "http://localhost/api/discussions?bookId=b1"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.discussions).toHaveLength(1);
    expect(body.discussions[0].id).toBe("t1");
  });
});
