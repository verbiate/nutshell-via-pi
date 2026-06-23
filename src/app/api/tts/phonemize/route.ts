import { requireAuth } from "@/lib/auth-guards";
import { kokoroPhonemize } from "@/server/services/kokoro-phonemizer";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await requireAuth();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { text, voice = "af_bella" } = await req.json();
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  try {
    // ponytail: full kokoro-js m() pipeline — normalize, split on punctuation,
    // phonemize each segment via eSpeak NG, post-process IPA. The voice ID's
    // first char determines en-us ("a") vs en-gb ("b") phonemization.
    const voiceFirstChar = voice.charAt(0);
    const phonemes = await kokoroPhonemize(text, voiceFirstChar);
    return Response.json({ phonemes });
  } catch (err) {
    console.error("[POST /api/tts/phonemize]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Phonemization failed" },
      { status: 500 },
    );
  }
}
