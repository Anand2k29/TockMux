const baseUrl = () => (process.env.TOCKMUX_ELEVENLABS_URL || "https://api.elevenlabs.io").replace(/\/$/, "");

export const DEFAULT_MODEL = "eleven_multilingual_v2";
// A premade ElevenLabs voice. Set TOCKMUX_VOICE_ID or pass --voice-id to use one of your own.
export const DEFAULT_VOICE_ID = process.env.TOCKMUX_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

/** Read the real character usage for one API key. */
export async function fetchSubscription(apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(`${baseUrl()}/v1/user/subscription`, { headers: { "xi-api-key": apiKey } });
  if (!res.ok) {
    const err = await readError(res);
    return { ok: false, status: res.status, kind: classify(res.status, err), message: err.message };
  }
  const j = await res.json();
  return {
    ok: true,
    characterCount: Number(j.character_count ?? 0),
    characterLimit: Number(j.character_limit ?? 0),
    tier: j.tier || "unknown",
    resetUnix: j.next_character_count_reset_unix || null
  };
}

async function readError(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not json */
  }
  const d = body?.detail;
  const message = typeof d === "string" ? d : d?.message || body?.message || `HTTP ${res.status}`;
  const status = typeof d === "object" ? d?.status : undefined;
  return { message, status };
}

/** Map an API failure to what the pool should do next. */
export function classify(httpStatus, err = {}) {
  const text = `${err.status || ""} ${err.message || ""}`.toLowerCase();
  if (text.includes("quota") || text.includes("character limit") || text.includes("exceeds your")) return "exhausted";
  if (httpStatus === 402) return "exhausted";
  if (httpStatus === 401 || httpStatus === 403) return "invalid";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500) return "server";
  return "other";
}

/** Convert one chunk of text to speech. */
export async function requestSpeech({ apiKey, text, voiceId = DEFAULT_VOICE_ID, modelId = DEFAULT_MODEL, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl()}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: modelId })
  });
  if (!res.ok) {
    const err = await readError(res);
    return { ok: false, status: res.status, kind: classify(res.status, err), message: err.message };
  }
  return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
}
