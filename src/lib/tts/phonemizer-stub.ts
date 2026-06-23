// ponytail: stub so Turbopack doesn't load the real phonemizer (whose
// Emscripten code crashes in the browser). kokoro-js imports this at module
// level, but we never call its generate() — we use the server-side
// /api/tts/phonemize endpoint instead. Aliased via next.config.ts.
export async function phonemize(): Promise<string[]> {
  return [];
}
export async function list_voices(): Promise<never[]> {
  return [];
}
