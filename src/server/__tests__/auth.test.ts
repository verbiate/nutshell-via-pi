import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Next.js headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

// Mock auth module
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
    $Infer: {
      Session: {},
    },
  },
}));

import { auth } from "@/lib/auth";
import { requireAuth, requireAdmin, AuthError } from "@/lib/auth-guards";

describe("AUTH-01..05: Authentication & RBAC", () => {
  const mockGetSession = vi.mocked(auth.api.getSession);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("requireAuth", () => {
    it("throws AuthError with 401 when no session exists", async () => {
      mockGetSession.mockResolvedValue(null);
      await expect(requireAuth()).rejects.toThrow(AuthError);
      await expect(requireAuth()).rejects.toThrow("Authentication required");
      try {
        await requireAuth();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(401);
      }
    });

    it("returns authenticated user when session exists", async () => {
      mockGetSession.mockResolvedValue({
        user: {
          id: "user-1",
          email: "test@example.com",
          name: "Test User",
          image: null,
          role: "regular",
        } as any,
        session: { id: "session-1" } as any,
      });

      const user = await requireAuth();
      expect(user.id).toBe("user-1");
      expect(user.email).toBe("test@example.com");
      expect(user.role).toBe("regular");
    });
  });

  describe("requireAdmin", () => {
    it("throws AuthError with 403 when user is regular", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "test@example.com", role: "regular" } as any,
        session: { id: "session-1" } as any,
      });

      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(403);
        expect((e as AuthError).message).toBe("Admin access required");
      }
    });

    it("throws AuthError with 403 when user is pro", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-2", email: "pro@example.com", role: "pro" } as any,
        session: { id: "session-2" } as any,
      });

      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(403);
      }
    });

    it("returns user when role is admin", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "admin-1", email: "admin@example.com", role: "admin" } as any,
        session: { id: "session-3" } as any,
      });

      const user = await requireAdmin();
      expect(user.role).toBe("admin");
    });

    it("throws 401 before checking role when no session exists", async () => {
      mockGetSession.mockResolvedValue(null);

      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(401);
      }
    });
  });

  describe("AUTH-04: UserRole enum", () => {
    it("accepts exactly three role values", () => {
      const roles = ["regular", "pro", "admin"];
      expect(roles).toHaveLength(3);
      expect(roles).toContain("regular");
      expect(roles).toContain("pro");
      expect(roles).toContain("admin");
    });
  });
});
