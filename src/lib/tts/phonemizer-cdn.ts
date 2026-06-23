// ponytail: kokoro-js imports phonemizer via ESM, but the Emscripten code
// crashes in the browser (both Turbopack-bundled and native CDN import).
// The phonemizer works correctly in Node.js, so we proxy through a server
// endpoint. The browser sends chunk text, gets IPA phonemes back, then
// tokenizes and runs the Kokoro model locally.

let cached: ((text: string, lang?: string) => Promise<string[]>) | null = null;

function createPhonemizer() {
  return async (text: string, language = "en-us"): Promise<string[]> => {
    const res = await fetch("/api/tts/phonemize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang: language }),
    });
    if (!res.ok) {
      throw new Error(`Phonemize request failed: ${res.status}`);
    }
    const data = await res.json();
    return [data.phonemes];
  };
}

export async function phonemize(text: string, language = "en-us"): Promise<string[]> {
  if (!cached) cached = createPhonemizer();
  return cached(text, language);
}
