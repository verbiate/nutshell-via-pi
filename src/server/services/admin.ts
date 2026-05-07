import { db } from "@/server/db";
import type { UserRole } from "@/types/book";

// ---- Audit Logging ----

interface AuditParams {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: string | null;
  newValue?: string | null;
}

async function auditLog({ actorId, action, entityType, entityId, oldValue, newValue }: AuditParams) {
  await db.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
    },
  });
}

// ---- User Management (ADM-01, ADM-02) ----

export async function getAllUsers(page = 1, pageSize = 20, search?: string) {
  const skip = (page - 1) * pageSize;
  const where = search
    ? {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
        _count: { select: { bookAccesses: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.user.count({ where }),
  ]);

  return { users, total, page, pageSize };
}

export async function changeUserRole(
  adminId: string,
  targetUserId: string,
  newRole: UserRole
) {
  // Get current user
  const targetUser = await db.user.findUnique({
    where: { id: targetUserId },
    select: { role: true },
  });

  if (!targetUser) {
    throw new Error("User not found");
  }

  const oldRole = targetUser.role;

  if (oldRole === newRole) {
    return { changed: false };
  }

  // Update role
  await db.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
  });

  // Audit log
  await auditLog({
    actorId: adminId,
    action: "USER_ROLE_CHANGED",
    entityType: "user",
    entityId: targetUserId,
    oldValue: oldRole,
    newValue: newRole,
  });

  return { changed: true, oldRole, newRole };
}

// ---- Universal Library (ADM-03) ----

export { getUniversalLibrary, getBookById } from "./library";

// ---- Prompt Templates (ADM-04, ADM-05) ----

export async function getPromptTemplates() {
  return db.promptTemplate.findMany({
    orderBy: { type: "asc" },
  });
}

export async function getPromptTemplate(type: string) {
  return db.promptTemplate.findUnique({ where: { type } });
}

export async function updatePromptTemplate(
  adminId: string,
  type: string,
  content: string
) {
  const existing = await db.promptTemplate.findUnique({ where: { type } });
  if (!existing) {
    throw new Error("Template not found");
  }

  const oldContent = existing.content;

  await db.promptTemplate.update({
    where: { type },
    data: {
      content,
      version: { increment: 1 },
    },
  });

  // Audit log
  await auditLog({
    actorId: adminId,
    action: "PROMPT_TEMPLATE_UPDATED",
    entityType: "prompt_template",
    entityId: type,
    oldValue: oldContent,
    newValue: content,
  });
}

// ---- Audit Log Query (ADM-06) ----

export async function getAuditLogs(page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize;
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.auditLog.count(),
  ]);

  return { logs, total, page, pageSize };
}
