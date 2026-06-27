import { db } from "@/server/db";
import type { UserRole } from "@/types/book";
import { getSetting, setSetting } from "./settings";

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

// ---- Two-pass book explainer toggle ----

// Default pass-2 instruction. Keep in sync with prisma/seed.ts — seed is the
// source of truth for fresh installs; this constant is the fallback used when
// an admin flips the toggle on for a DB that hasn't been re-seeded. Token-
// pattern: {{previous_response}} carries pass-1's draft, {{book_text}} lets
// the model re-ground in the source.
const DEFAULT_BOOK_PASS2_CONTENT =
  "You are refining a first-draft book explainer. Below is the source book, then a first-draft explanation of it. Rewrite the explanation into a polished, well-structured overview that a reader can absorb quickly.\n\nBook: \"{{title}}\" by {{author}} (source language: {{language}})\nWrite the refined explanation in {{target_language}}.\n\nSource book:\n---\n{{book_text}}\n---\n\nFirst-draft explanation:\n---\n{{previous_response}}\n---\n\nTighten the prose, remove redundancy, and use clear structure where it helps. Preserve the key themes, tone, and insights of the first draft. Do NOT introduce information that was not in the first draft or the source book.";

// ponytail: stored as the bookTwoPassEnabled AppSetting ("true"/"false").
// Surfaced in the Prompt Templates admin page alongside the book_pass2 row.
export async function getBookTwoPassEnabled(): Promise<boolean> {
  return (await getSetting("bookTwoPassEnabled")) === "true";
}

export async function updateBookTwoPassEnabled(
  adminId: string,
  enabled: boolean
) {
  const oldValue = await getSetting("bookTwoPassEnabled");
  const newValue = enabled ? "true" : "false";
  await setSetting("bookTwoPassEnabled", newValue);

  if (enabled) {
    // ponytail: ensure the pass-2 template exists so the next book explainer
    // doesn't 500 with "book_pass2 prompt template not found" on a DB that was
    // toggled without a re-seed. Upsert with update:{} preserves admin edits;
    // only creates with the default when the row is missing.
    await db.promptTemplate.upsert({
      where: { type: "book_pass2" },
      update: {},
      create: {
        type: "book_pass2",
        content: DEFAULT_BOOK_PASS2_CONTENT,
        version: 2,
      },
    });
  }

  await auditLog({
    actorId: adminId,
    action: "BOOK_TWOPASS_TOGGLED",
    entityType: "app_setting",
    entityId: "bookTwoPassEnabled",
    oldValue,
    newValue,
  });
}

// ---- Explainer Cache Purge ----

export async function purgeExplainerCache(adminId: string, explainerId: string) {
  const explainer = await db.explainer.findUnique({
    where: { id: explainerId },
  });
  if (!explainer) {
    throw new Error("Explainer not found");
  }

  // ponytail: under versioning, deleting one version would cascade-delete every
  // discussion pinned to it. If a newer/other version of the same cache key
  // exists, reassign those discussions to it first so readers keep their
  // conversation (just on the surviving version). If no other version exists,
  // the discussions cascade as before — purge is the destructive nuke; reroll is
  // the gentle tool.
  const replacement = await db.explainer.findFirst({
    where: {
      contentHash: explainer.contentHash,
      language: explainer.language,
      contentType: explainer.contentType,
      tier: explainer.tier,
      NOT: { id: explainer.id },
    },
    orderBy: { version: "desc" },
  });
  if (replacement) {
    await db.discussion.updateMany({
      where: { explainerId: explainer.id },
      data: { explainerId: replacement.id },
    });
  }

  await db.explainer.delete({ where: { id: explainerId } });

  await auditLog({
    actorId: adminId,
    action: "EXPLAINER_CACHE_PURGED",
    entityType: "explainer",
    entityId: explainerId,
    oldValue: JSON.stringify({
      contentHash: explainer.contentHash,
      language: explainer.language,
      contentType: explainer.contentType,
      tier: explainer.tier,
      version: explainer.version,
    }),
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
