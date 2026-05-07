import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    promptTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: { getSession: vi.fn() },
    $Infer: { Session: {} },
  },
}));

import { db } from "@/server/db";
import { requireAdmin, AuthError } from "@/lib/auth-guards";
import { getAllUsers, changeUserRole, updatePromptTemplate, getAuditLogs } from "@/server/services/admin";

describe("ADM-01..07: Admin Panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ADM-01: User list", () => {
    it("returns paginated user list", async () => {
      vi.mocked(db.user.findMany).mockResolvedValue([]);
      vi.mocked(db.user.count).mockResolvedValue(0);

      const result = await getAllUsers(1, 20);
      expect(result).toEqual({ users: [], total: 0, page: 1, pageSize: 20 });
      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: "desc" },
        })
      );
    });

    it("filters by search term", async () => {
      vi.mocked(db.user.findMany).mockResolvedValue([]);
      vi.mocked(db.user.count).mockResolvedValue(0);

      await getAllUsers(1, 20, "test");
      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: "test" } },
              { email: { contains: "test" } },
            ],
          },
        })
      );
    });
  });

  describe("ADM-02: Role change", () => {
    it("updates user role and creates audit log", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        role: "regular",
      } as any);
      vi.mocked(db.user.update).mockResolvedValue({} as any);
      vi.mocked(db.auditLog.create).mockResolvedValue({} as any);

      const result = await changeUserRole("admin-1", "user-1", "pro");

      expect(result.changed).toBe(true);
      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { role: "pro" },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: "admin-1",
          action: "USER_ROLE_CHANGED",
          entityType: "user",
          entityId: "user-1",
          oldValue: "regular",
          newValue: "pro",
        }),
      });
    });

    it("does nothing if role unchanged", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        role: "pro",
      } as any);

      const result = await changeUserRole("admin-1", "user-1", "pro");
      expect(result.changed).toBe(false);
      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("ADM-04/05: Prompt template update", () => {
    it("updates template content, increments version, and audits", async () => {
      vi.mocked(db.promptTemplate.findUnique).mockResolvedValue({
        type: "book",
        content: "old content",
        version: 1,
      } as any);
      vi.mocked(db.promptTemplate.update).mockResolvedValue({} as any);
      vi.mocked(db.auditLog.create).mockResolvedValue({} as any);

      await updatePromptTemplate("admin-1", "book", "new content");

      expect(db.promptTemplate.update).toHaveBeenCalledWith({
        where: { type: "book" },
        data: { content: "new content", version: { increment: 1 } },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "PROMPT_TEMPLATE_UPDATED",
          oldValue: "old content",
          newValue: "new content",
        }),
      });
    });
  });

  describe("ADM-06: Audit log query", () => {
    it("returns paginated audit logs with actor info", async () => {
      vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(db.auditLog.count).mockResolvedValue(0);

      const result = await getAuditLogs(1, 20);
      expect(result).toEqual({ logs: [], total: 0, page: 1, pageSize: 20 });
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { actor: expect.any(Object) },
          orderBy: { createdAt: "desc" },
        })
      );
    });
  });

  describe("ADM-07: Server-side role guards", () => {
    it("requireAdmin throws 403 for regular users", async () => {
      const { auth } = await import("@/lib/auth");
      vi.mocked(auth.api.getSession).mockResolvedValue({
        user: { id: "u1", role: "regular" } as any,
        session: {} as any,
      });

      await expect(requireAdmin()).rejects.toThrow(AuthError);
      try {
        await requireAdmin();
      } catch (e) {
        expect((e as AuthError).statusCode).toBe(403);
      }
    });
  });
});
