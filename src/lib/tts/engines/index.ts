import type { EngineId } from "../languages";
import type { TtsEngine } from "../types";
import { kokoroEngine } from "./kokoro-engine";
import { supertonicEngine } from "./supertonic-engine";

export const ENGINES: Record<EngineId, TtsEngine | null> = {
  kokoro: kokoroEngine,
  supertonic: supertonicEngine,
  cloud: null,
  browser: null,
};

export async function getEngine(id: EngineId): Promise<TtsEngine> {
  const e = ENGINES[id];
  if (!e) throw new Error(`Engine "${id}" not available`);
  return e;
}
