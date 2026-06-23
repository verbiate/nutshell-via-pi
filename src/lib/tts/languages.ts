export const KOKORO_LANGUAGES = new Set([
  "en", "es", "fr", "hi", "it", "ja", "pt", "zh"
]);

export const SUPERTONIC_LANGUAGES = new Set([
  "ar","bg","hr","cs","da","nl","en","et","fi","fr","de","el","hi","hu","id",
  "it","ja","ko","lv","lt","pl","pt","ro","ru","sk","sl","es","sv","tr","uk","vi"
]);

export const TTS_LANGUAGES = new Set([...KOKORO_LANGUAGES, ...SUPERTONIC_LANGUAGES]);

export type EngineId = "kokoro" | "supertonic" | "cloud" | "browser";

export function defaultEngineForLanguage(lang: string): EngineId {
  return KOKORO_LANGUAGES.has(lang) ? "kokoro" : "supertonic";
}

export function engineSupportsLanguage(engine: EngineId, lang: string): boolean {
  if (engine === "cloud" || engine === "browser") return true;
  return engine === "kokoro"
    ? KOKORO_LANGUAGES.has(lang)
    : SUPERTONIC_LANGUAGES.has(lang);
}
