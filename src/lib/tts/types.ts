export interface TtsVoice {
  id: string;
  label: string;
  gender?: "female" | "male";
  region?: "US" | "GB";
}

export interface SynthesizeOpts {
  voiceId: string;
  lang: string;
  speed?: number;
}

export type TtsSynthesisResult =
  | { kind: "audioBuffer"; buffer: AudioBuffer }
  | { kind: "url"; url: string };

export interface TtsEngine {
  readonly id: string;
  readonly label: string;
  getVoices(lang: string): TtsVoice[];
  supportsLanguage(lang: string): boolean;
  ensureLoaded(onProgress?: (pct: number) => void): Promise<void>;
  synthesize(text: string, opts: SynthesizeOpts): Promise<TtsSynthesisResult>;
  dispose?(): void;
}
