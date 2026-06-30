import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { generateTtsForText } from "@/server/services/tts";
import { getCurrentUsage, incrementUsage } from "@/server/services/tts-usage";

/**
 * POST /api/tts/generate-text
 *
 * Body: { text: string; language?: string }
 *
 * Speaks arbitrary text (e.g. a discussion reply). Mirrors /api/tts/generate's
 * quota gate + cache semantics — the TtsAudio cache is keyed by
 * SHA-256(text), so repeated reads of the same reply hit the cache.
 */
const MAX_TEXT_CHARS = 20000;

export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    let body: { text?: string; language?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { text, language } = body;
    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 },
      );
    }
    if (text.length > MAX_TEXT_CHARS) {
      return NextResponse.json(
        { error: `Text exceeds the ${MAX_TEXT_CHARS}-character limit` },
        { status: 413 },
      );
    }

    const { used, limit } = await getCurrentUsage(user.id, user.role);
    if (used >= limit) {
      return NextResponse.json(
        { error: "Monthly TTS generation limit reached", used, limit },
        { status: 429 },
      );
    }

    const tier = user.role as "regular" | "pro" | "admin";

    const result = await generateTtsForText({
      text,
      language,
      tier,
      signal: request.signal,
    });

    await incrementUsage(user.id);

    return NextResponse.json({
      audioId: result.audioId,
      url: result.url,
      cached: result.cached,
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    if (error.message?.includes("TTS provider not configured")) {
      return NextResponse.json(
        { error: "Audio generation is not yet configured" },
        { status: 503 },
      );
    }
    console.error("[POST /api/tts/generate-text]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
