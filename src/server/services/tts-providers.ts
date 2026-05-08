/**
 * TTS Provider Clients for ElevenLabs and fal.ai.
 *
 * ElevenLabs: returns raw audio bytes from a streaming endpoint.
 * fal.ai: returns JSON with an audio URL that must be fetched separately.
 */

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const FAL_AI_URL = "https://fal.run";

export async function callElevenLabs(params: {
  text: string;
  voiceId: string;
  modelId: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const url = `${ELEVENLABS_TTS_URL}/${params.voiceId}/stream`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": params.apiKey,
    },
    body: JSON.stringify({
      text: params.text,
      model_id: params.modelId,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `ElevenLabs error ${response.status}: ${errorBody}`
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function callFalAi(params: {
  text: string;
  modelId: string;
  voiceId?: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const url = `${FAL_AI_URL}/${params.modelId}`;

  const body: Record<string, string> = {
    text: params.text,
  };
  if (params.voiceId) {
    body.voice = params.voiceId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Key ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(`fal.ai error ${response.status}: ${errorBody}`);
  }

  const json = await response.json() as { audio: { url: string } };
  const audioUrl = json.audio?.url;
  if (!audioUrl) {
    throw new Error("fal.ai response missing audio.url: " + JSON.stringify(json));
  }

  const audioRes = await fetch(audioUrl, { signal: params.signal });
  if (!audioRes.ok) {
    throw new Error(
      `Failed to download fal.ai audio from ${audioUrl}: ${audioRes.status}`
    );
  }

  return Buffer.from(await audioRes.arrayBuffer());
}
