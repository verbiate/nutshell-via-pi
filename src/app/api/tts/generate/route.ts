import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { generateTtsAudio } from "@/server/services/tts";

/**
 * POST /api/tts/generate
 *
 * Body: { bookId: string; sectionHref: string }
 *
 * Returns cached audio metadata instantly on cache hit,
 * or generates, caches, and returns new audio on cache miss.
 * The client shows a spinner during the request (wait-with-feedback pattern),
 * satisfying TTS-07 functionally without an async job queue.
 * request.signal propagates cancellation to the TTS provider fetch chain.
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    let body: { bookId?: string; sectionHref?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { bookId, sectionHref } = body;
    if (!bookId || !sectionHref) {
      return NextResponse.json(
        { error: "bookId and sectionHref are required" },
        { status: 400 }
      );
    }

    const hasAccess = await verifyBookAccess(user.id, bookId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "You do not have access to this book" },
        { status: 403 }
      );
    }

    // ponytail: respect user's actual tier (regular/pro/admin) — see threads/route.ts
    const tier = user.role as "regular" | "pro" | "admin";

    // Pass request.signal for cancellation support
    const result = await generateTtsAudio({
      bookId,
      sectionHref,
      tier,
      signal: request.signal,
    });

    return NextResponse.json({
      audioId: result.audioId,
      url: result.url,
      cached: result.cached,
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    if (error.statusCode === 403) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (error.message?.includes("TTS provider not configured")) {
      return NextResponse.json(
        { error: "Audio generation is not yet configured" },
        { status: 503 }
      );
    }
    console.error("[POST /api/tts/generate]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
