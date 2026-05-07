import { describe, it, expect } from "vitest";
import { detectLanguage } from "@/lib/language";

describe("LANG-03: Language detection", () => {
  it("detects English text", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. This is a sample of English text used for language detection testing.";
    expect(detectLanguage(text)).toBe("en");
  });

  it("detects Spanish text", () => {
    const text =
      "El rápido zorro marrón salta sobre el perro perezoso. Esta es una muestra de texto en español utilizado para pruebas de detección de idioma.";
    expect(detectLanguage(text)).toBe("es");
  });

  it("detects French text", () => {
    const text =
      "Le rapide renard brun saute par-dessus le chien paresseux. Ceci est un exemple de texte en français utilisé pour les tests de détection de langue.";
    expect(detectLanguage(text)).toBe("fr");
  });

  it("detects German text", () => {
    const text =
      "Der schnelle braune Fuchs springt über den faulen Hund. Dies ist ein Beispieltext auf Deutsch, der für Spracherkennungstests verwendet wird.";
    expect(detectLanguage(text)).toBe("de");
  });

  it("returns 'und' for empty or very short text", () => {
    expect(detectLanguage("")).toBe("und");
    expect(detectLanguage("hi")).toBe("und");
    expect(detectLanguage("   ")).toBe("und");
  });

  it("returns 'und' for text shorter than 10 characters", () => {
    expect(detectLanguage("Hello")).toBe("und");
  });

  it("does not crash on mixed-language content", () => {
    const text =
      "This is English mixed with español et un peu de français. The content should not crash the detector.";
    const result = detectLanguage(text);
    expect(typeof result).toBe("string");
    expect(result.length).toBe(2);
  });
});
