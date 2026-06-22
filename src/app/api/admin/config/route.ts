import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guards";
import { db } from "@/server/db";

/**
 * GET /api/admin/config?category=openrouter|elevenlabs|fal
 *
 * Returns provider config rows for the given category.
 * Admin-only.
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    const mask = (val?: string | null) => {
      if (!val) return null;
      if (val.length <= 12) return "***";
      return val.slice(0, 4) + "..." + val.slice(-4);
    };

    if (!category || !["openrouter", "elevenlabs", "fal"].includes(category)) {
      return NextResponse.json(
        { error: "category must be openrouter, elevenlabs, or fal" },
        { status: 400 }
      );
    }

    if (category === "openrouter") {
      const configs = await db.openRouterConfig.findMany();
      return NextResponse.json({
        configs: configs.map((c: { apiKey: string | null }) => ({
          ...c,
          apiKey: mask(c.apiKey),
        })),
      });
    }

    const configs = await db.ttsProviderConfig.findMany({
      where: { provider: category },
    });
    return NextResponse.json({
      configs: configs.map((c: { apiKey: string | null }) => ({
        ...c,
        apiKey: mask(c.apiKey),
      })),
    });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    if (error.statusCode === 403)
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/config
 *
 * Body: { category, userType, apiKey?, model?, voiceId? }
 *
 * Upserts OpenRouterConfig or TtsProviderConfig row and creates an AuditLog
 * entry with masked API key (first 4 + last 4 chars visible).
 * Admin-only.
 */
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = await request.json();
    const { category, userType, apiKey, model, voiceId, maxContextTokens } = body as {
      category: "openrouter" | "elevenlabs" | "fal";
      userType: string;
      apiKey?: string;
      model?: string;
      voiceId?: string;
      maxContextTokens?: number | null;
    };

    if (!category || !userType) {
      return NextResponse.json(
        { error: "category and userType are required" },
        { status: 400 }
      );
    }

    // Mask API key for audit log: show first 4 and last 4 chars
    const mask = (val?: string) => {
      if (!val) return null;
      if (val.length <= 12) return "***";
      return val.slice(0, 4) + "..." + val.slice(-4);
    };

    if (category === "openrouter") {
      const existing = await db.openRouterConfig.findUnique({
        where: { userType },
      }) as { apiKey: string | null; model: string | null; maxContextTokens: number | null } | null;
      // ponytail: maxContextTokens nullable. `undefined` means "don't touch";
      // `null` means "clear the override" (use model lookup / 128K fallback).
      const maxContextTokensValue =
        maxContextTokens === undefined ? undefined : maxContextTokens;
      await db.openRouterConfig.upsert({
        where: { userType },
        create: {
          userType,
          apiKey: apiKey ?? null,
          model: model ?? null,
          maxContextTokens: maxContextTokensValue ?? null,
        },
        update: {
          apiKey: apiKey !== undefined ? apiKey : undefined,
          model: model !== undefined ? model : undefined,
          maxContextTokens: maxContextTokensValue,
        },
      });
      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE_OPENROUTER_CONFIG",
          entityType: "OpenRouterConfig",
          entityId: userType,
          oldValue: existing
            ? JSON.stringify({
                apiKey: mask(existing.apiKey ?? undefined),
                model: existing.model,
                maxContextTokens: existing.maxContextTokens,
              })
            : null,
          newValue: JSON.stringify({
            apiKey: mask(apiKey),
            model,
            maxContextTokens: maxContextTokensValue ?? null,
          }),
        },
      });
    } else {
      const existing = await db.ttsProviderConfig.findUnique({
        where: { provider_userType: { provider: category, userType } },
      }) as { apiKey: string | null; model: string | null; voiceId: string | null } | null;
      await db.ttsProviderConfig.upsert({
        where: { provider_userType: { provider: category, userType } },
        create: {
          provider: category,
          userType,
          apiKey: apiKey ?? null,
          model: model ?? null,
          voiceId: voiceId ?? null,
        },
        update: {
          apiKey: apiKey !== undefined ? apiKey : undefined,
          model: model !== undefined ? model : undefined,
          voiceId: voiceId !== undefined ? voiceId : undefined,
        },
      });
      await db.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE_TTS_CONFIG",
          entityType: "TtsProviderConfig",
          entityId: `${category}:${userType}`,
          oldValue: existing
            ? JSON.stringify({
                apiKey: mask(existing.apiKey ?? undefined),
                model: existing.model,
                voiceId: existing.voiceId,
              })
            : null,
          newValue: JSON.stringify({
            apiKey: mask(apiKey),
            model,
            voiceId,
          }),
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.statusCode === 401)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    if (error.statusCode === 403)
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
