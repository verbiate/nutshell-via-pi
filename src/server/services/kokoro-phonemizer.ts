import { createRequire } from "module";

// ponytail: Turbopack's resolveAlias (next.config.ts) rewrites ANY literal
// "phonemizer" require/import — even routed through createRequire — to the
// browser stub (returns []), and throws "too dynamic" for non-literal args.
// The alias is needed client-side (kokoro-js's top-level import crashes the
// browser) but clobbers the server too. Building the require call inside
// new Function() hides the call site from Turbopack's static analyzer (same
// trick as the old CDN-import hide, commit 2690ob4), so Node resolves the real
// package from node_modules at runtime.
const require = createRequire(import.meta.url);
const callRequire = new Function("r", "s", "return r(s)") as (
  r: NodeRequire,
  s: string,
) => unknown;
const { phonemize: espeakPhonemize } = callRequire(require, "phonemizer") as {
  phonemize: (text: string, lang?: string) => Promise<string[]>;
};

// ponytail: exact port of kokoro-js's internal m() function — the full
// text → IPA pipeline that generate() runs before model inference. Without
// this normalization, the phonemizer receives raw text and produces wrong
// phonemes → garbled audio.

function numberToWords(e: string): string {
  if (e.includes(".")) return e;
  if (e.includes(":")) {
    const [h, m] = e.split(":").map(Number);
    return m === 0 ? `${h} o'clock` : m < 10 ? `${h} oh ${m}` : `${h} ${m}`;
  }
  const n = parseInt(e.slice(0, 4), 10);
  if (n < 1100 || (n % 1000) < 10) return e;
  const century = e.slice(0, 2);
  const rest = parseInt(e.slice(2, 4), 10);
  const s = e.endsWith("s") ? "s" : "";
  if ((n % 1000) >= 100 && (n % 1000) <= 999) {
    if (rest === 0) return `${century} hundred${s}`;
    if (rest < 10) return `${century} oh ${rest}${s}`;
  }
  return `${century} ${rest}${s}`;
}

function currencyToWords(e: string): string {
  const unit = e[0] === "$" ? "dollar" : "pound";
  if (isNaN(Number(e.slice(1)))) return `${e.slice(1)} ${unit}s`;
  if (!e.includes(".")) {
    const s = e.slice(1) === "1" ? "" : "s";
    return `${e.slice(1)} ${unit}${s}`;
  }
  const [whole, frac] = e.slice(1).split(".");
  const cents = parseInt(frac.padEnd(2, "0"), 10);
  const centWord = e[0] === "$"
    ? cents === 1 ? "cent" : "cents"
    : cents === 1 ? "penny" : "pence";
  return `${whole} ${unit}${whole === "1" ? "" : "s"} and ${cents} ${centWord}`;
}

function decimalToWords(e: string): string {
  const [whole, frac] = e.split(".");
  return `${whole} point ${frac.split("").join(" ")}`;
}

const PUNCT_CHARS = ";:,.!?¡¿—…\"«»\u201C\u201D(){}[]";
const PUNCT_RE = new RegExp(
  `(\\s*[${PUNCT_CHARS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`,
  "g",
);

function normalizeText(e: string): string {
  return e
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/«/g, "\u201C")
    .replace(/»/g, "\u201D")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/  +/, " ")
    .replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, numberToWords)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, currencyToWords)
    .replace(/\d*\.\d+/g, decimalToWords)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (s) => s.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

function splitOnPunctuation(text: string): Array<{ match: boolean; text: string }> {
  const segments: Array<{ match: boolean; text: string }> = [];
  let last = 0;
  for (const m of text.matchAll(PUNCT_RE)) {
    const matched = m[0];
    if ((m.index ?? 0) > last) {
      segments.push({ match: false, text: text.slice(last, m.index) });
    }
    if (matched.length > 0) {
      segments.push({ match: true, text: matched });
    }
    last = (m.index ?? 0) + matched.length;
  }
  if (last < text.length) {
    segments.push({ match: false, text: text.slice(last) });
  }
  return segments;
}

function postProcessPhonemes(s: string, lang: string): string {
  let i = s
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹoʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»\u201C\u201D ]|$)/g, "z");
  if (lang === "a") {
    i = i.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  }
  return i.trim();
}

export async function kokoroPhonemize(
  text: string,
  voiceFirstChar: string = "a",
): Promise<string> {
  const normalized = normalizeText(text);
  const segments = splitOnPunctuation(normalized);
  const espeakLang = voiceFirstChar === "a" ? "en-us" : "en";
  const phonemized = await Promise.all(
    segments.map(async ({ match, text: seg }) =>
      match ? seg : (await espeakPhonemize(seg, espeakLang)).join(" "),
    ),
  );
  return postProcessPhonemes(phonemized.join(""), voiceFirstChar);
}
