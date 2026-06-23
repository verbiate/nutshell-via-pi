// ponytail: kokoro-js imports phonemizer via ESM, but Turbopack breaks the
// Emscripten initialization (var A=void 0!==A?A:{} → A is always {} →
// A.FS_createPath is undefined → TypeError). Loading phonemizer from CDN via
// a runtime dynamic import bypasses Turbopack's module transform — the
// browser's native module system handles the Emscripten code correctly.
// The variable URL prevents Turbopack from resolving it at build time.

let cached: { phonemize: (text: string, lang?: string) => Promise<string[]> } | null = null;

async function loadPhonemizer() {
  if (cached) return cached;
  const url = "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js";
  const mod = await import(/* @vite-ignore */ url as string);
  cached = mod as typeof cached;
  return cached;
}

export async function phonemize(text: string, language = "en-us"): Promise<string[]> {
  const mod = await loadPhonemizer();
  if (!mod) throw new Error("Failed to load phonemizer from CDN");
  return mod.phonemize(text, language);
}
