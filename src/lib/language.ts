import { franc } from "franc";

/**
 * Detect the language of a text sample using franc.
 * Returns ISO 639-1 code, or "und" if detection fails or is uncertain.
 */
export function detectLanguage(text: string): string {
  if (!text || text.trim().length < 10) {
    return "und";
  }

  try {
    const detected = franc(text, { minLength: 10 });

    // franc returns ISO 639-3 codes; map common ones to 639-1
    const iso639to1: Record<string, string> = {
      eng: "en",
      spa: "es",
      fra: "fr",
      deu: "de",
      vie: "vi",
      cmn: "zh",
      jpn: "ja",
      kor: "ko",
      por: "pt",
      ita: "it",
      rus: "ru",
      ara: "ar",
      hin: "hi",
      tha: "th",
      nld: "nl",
      pol: "pl",
      tur: "tr",
      ukr: "uk",
      ron: "ro",
      hun: "hu",
      ces: "cs",
      swe: "sv",
      dan: "da",
      fin: "fi",
      ell: "el",
      heb: "he",
      ind: "id",
      msa: "ms",
      tgl: "tl",
      und: "und",
    };

    // franc may return an array of possible languages
    if (Array.isArray(detected)) {
      for (const lang of detected) {
        if (iso639to1[lang]) return iso639to1[lang];
      }
      return "und";
    }

    return iso639to1[detected] || "und";
  } catch {
    return "und";
  }
}
