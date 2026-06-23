import { requireAuth } from "@/lib/auth-guards";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await requireAuth();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { text, lang = "en-us" } = await req.json();
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const { phonemize } = await import("phonemizer");
    const phonemes = await phonemize(text, lang);
    return Response.json({ phonemes: phonemes.join(" ") });
  } catch (err) {
    console.error("[POST /api/tts/phonemize]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Phonemization failed" },
      { status: 500 },
    );
  }
}
