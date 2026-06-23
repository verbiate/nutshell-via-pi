import type { EngineId } from "./languages";

// ponytail: per-language TTS prefs in one localStorage blob. Keyed by language
// only (shape from the spec); each browser profile is naturally per-user.
const KEY = "tts.pref.v1";

export interface TtsPref {
  engineId: EngineId;
  voiceId: string;
}

export type PartialTtsPref = Partial<TtsPref>;

// ponytail: read storage off globalThis so the helper works in browser AND in
// the node self-check below (which installs a throwaway store). Returns null
// when storage is absent (SSR / private mode) so callers can no-op safely.
function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s && typeof s.getItem === "function" ? s : null;
  } catch {
    return null;
  }
}

export function loadTtsPref(language: string): PartialTtsPref {
  const ls = storage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, TtsPref>;
    return all[language] ?? {};
  } catch {
    return {};
  }
}

export function saveTtsPref(language: string, pref: TtsPref): void {
  const ls = storage();
  if (!ls) return;
  try {
    const raw = ls.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, TtsPref>) : {};
    all[language] = pref;
    ls.setItem(KEY, JSON.stringify(all));
  } catch {
    // ponytail: private mode / quota — prefs are best-effort, never block playback.
  }
}

if (process.env.NODE_ENV !== "production") {
  // ponytail: smallest runnable self-check — round-trips save/load against a
  // throwaway in-memory store, then restores the global exactly. Runs on import
  // in non-prod; in node `window` is undefined so the real fns early-return and
  // never touch this store, making the override safe.
  const g = globalThis as any;
  const prev = Object.getOwnPropertyDescriptor(g, "localStorage");
  const prevVal = g.localStorage;
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  try {
    saveTtsPref("en", { engineId: "kokoro", voiceId: "af_bella" });
    const got = loadTtsPref("en");
    const ok =
      got.engineId === "kokoro" &&
      got.voiceId === "af_bella" &&
      loadTtsPref("xx").engineId === undefined;
    if (!ok) throw new Error("[tts/pref] self-check failed: round-trip lost data");
  } finally {
    if (prev) Object.defineProperty(g, "localStorage", prev);
    else if (prevVal === undefined) delete g.localStorage;
    else g.localStorage = prevVal;
  }
}
