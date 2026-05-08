import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guards";
import { verifyBookAccess } from "@/server/services/reader";
import { db } from "@/server/db";
import { storage } from "@/server/storage/local";

/**
 * GET /api/tts/audio?id=X&bookId=Y
 *
 * Serves cached TTS audio files. Auth-gated — user must have book access.
 * Content-Type is audio/mpeg for ElevenLabs MP3 output;
 * audio/wav is returned only for fal.ai models that output WAV.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const audioId = searchParams.get("id");
    const bookId = searchParams.get("bookId");

    if (!audioId || !bookId) {
      return NextResponse.json(
        { error: "id and bookId are required" },
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

    const audio = await db.ttsAudio.findUnique({ where: { id: audioId } });
    if (!audio) {
      return NextResponse.json({ error: "Audio not found" }, { status: 404 });
    }

    const buffer = await storage.read(audio.storagePath);
    const contentType =
      audio.provider === "fal" && audio.model?.includes("wav")
        ? "audio/wav"
        : "audio/mpeg";

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    if (error.statusCode === 401) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[GET /api/tts/audio]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
