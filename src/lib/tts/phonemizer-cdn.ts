// ponytail: kokoro-js imports phonemizer via ESM, but the Emscripten code
// crashes in the browser (both Turbopack-bundled and native CDN import).
// The phonemizer works correctly in Node.js, so we proxy through a server
// endpoint that runs the full kokoro-js m() pipeline (normalize → split →
// phonemize → post-process). The browser receives ready-to-tokenize IPA.

export async function phonemize(text: string, voice: string): Promise<string> {
  const res = await fetch("/api/tts/phonemize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    throw new Error(`Phonemize request failed: ${res.status}`);
  }
  const data = await res.json();
  return data.phonemes as string;
}
