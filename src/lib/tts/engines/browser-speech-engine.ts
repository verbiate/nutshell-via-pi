import type {
  SynthesizeOpts,
  TtsEngine,
  TtsSynthesisResult,
  TtsVoice,
} from "../types";

// ponytail: speechSynthesis lives on window in browsers and is missing in
// SSR/Node. Read it lazily via globalThis so the module can be imported
// anywhere without crashing (window === globalThis in browsers).
function getSpeechSynthesis(): SpeechSynthesis | null {
  const env = globalThis as unknown as { speechSynthesis?: SpeechSynthesis };
  return env.speechSynthesis ?? null;
}

function toVoice(v: SpeechSynthesisVoice): TtsVoice {
  return { id: v.voiceURI || v.name, label: v.name };
}

// ponytail: Chrome fires `voiceschanged` async on first call. Wait for it
// with a 1s ceiling so ensureLoaded never hangs the UI if the event never
// arrives (Safari sometimes skips it).
async function waitForVoices(
  s: SpeechSynthesis,
  timeoutMs = 1000,
): Promise<SpeechSynthesisVoice[]> {
  const existing = s.getVoices();
  if (existing.length > 0) return existing;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      s.removeEventListener("voiceschanged", onChange);
      clearTimeout(timer);
      resolve(s.getVoices());
    };
    const onChange = () => {
      if (s.getVoices().length > 0) finish();
    };
    s.addEventListener("voiceschanged", onChange);
    const timer = setTimeout(finish, timeoutMs);
  });
}

export const browserSpeechEngine: TtsEngine = {
  id: "browser",
  label: "Built-in (Browser)",
  supportsLanguage: () => true,

  getVoices(lang: string): TtsVoice[] {
    const s = getSpeechSynthesis();
    if (!s) return [];
    return s
      .getVoices()
      .filter((v) => v.lang.startsWith(lang))
      .map(toVoice);
  },

  async ensureLoaded(): Promise<void> {
    const s = getSpeechSynthesis();
    if (!s) {
      throw new Error("speechSynthesis is not available in this environment");
    }
    await waitForVoices(s);
  },

  async synthesize(
    text: string,
    opts: SynthesizeOpts,
  ): Promise<TtsSynthesisResult> {
    const s = getSpeechSynthesis();
    if (!s) {
      throw new Error("speechSynthesis is not available");
    }
    // ponytail: construct the utterance synchronously so callers (and tests)
    // can observe it before the async voice lookup resolves.
    const utter = new SpeechSynthesisUtterance(text);
    const voices = await waitForVoices(s);
    const match = voices.find((v) => (v.voiceURI || v.name) === opts.voiceId);
    if (match) {
      utter.voice = match;
      utter.lang = match.lang;
    } else {
      utter.lang = opts.lang;
    }
    if (typeof opts.speed === "number") utter.rate = opts.speed;

    // ponytail: fire-and-forget contract — synthesize resolves on `onend`,
    // signaling the hook to advance to the next chunk. The url is unused.
    return new Promise<TtsSynthesisResult>((resolve, reject) => {
      utter.onend = () => resolve({ kind: "url", url: "" });
      utter.onerror = (e) =>
        reject(new Error(`Speech synthesis failed: ${e.error ?? "unknown"}`));
      s.speak(utter);
    });
  },
};
