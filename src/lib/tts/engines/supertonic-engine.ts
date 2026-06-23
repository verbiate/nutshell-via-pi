import { SUPERTONIC_VOICES } from "../voices/supertonic";
import { SUPERTONIC_LANGUAGES } from "../languages";
import { createTransformersEngine } from "./transformers-engine";

const MODEL_ID = "Supertone/supertonic-3";

function voiceUrl(voiceId: string): string {
  return `https://huggingface.co/${MODEL_ID}/resolve/main/voice_styles/${voiceId}.bin`;
}

export const supertonicEngine = createTransformersEngine({
  engineId: "supertonic",
  label: "Free (Faster)",
  modelId: MODEL_ID,
  dtype: "q8",
  getVoices: () =>
    SUPERTONIC_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      gender: v.gender,
    })),
  supportsLanguage: (lang) => SUPERTONIC_LANGUAGES.has(lang),
  voiceOptions: (voiceId) => ({
    speaker_embeddings: voiceUrl(voiceId),
  }),
  synthesisOverrides: { num_inference_steps: 5 },
});
