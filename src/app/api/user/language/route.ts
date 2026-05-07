import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { db } from "@/server/db";

/**
 * PATCH /api/user/language
 *
 * Body: { language: string }
 *
 * Updates the authenticated user's preferred explainer language.
 * Returns the updated user object.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();

    let body: { language?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { language } = body;
    if (!language || typeof language !== "string" || language.length !== 2) {
      return NextResponse.json(
        { error: "language is required and must be a 2-character code" },
        { status: 400 }
      );
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: { preferredLanguage: language },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        preferredLanguage: true,
      },
    });

    return NextResponse.json({ user: updated });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[PATCH /api/user/language]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
