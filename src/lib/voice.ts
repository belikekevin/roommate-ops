// Telegram voice note -> transcript, via an audio-capable chat model on OpenRouter
// (no Whisper endpoint needed). Feed the result through the normal text path.
// Docs: https://openrouter.ai/docs/features/multimodal/audio — input_audio formats include wav, mp3, ogg, m4a, aac, flac.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_STT_MODEL = "google/gemini-2.5-flash";

export const TRANSCRIBE_PROMPT =
  "Transcribe this voice note verbatim. Reply with only the transcript, no quotes, no commentary. If it's empty or unintelligible reply with an empty string.";

export type AudioFormat = "ogg" | "mp3" | "wav" | "m4a" | "aac" | "flac";

/** Map a MIME type (or file extension-ish string) to OpenRouter's input_audio.format. Telegram voice notes are ogg/opus. */
export function formatFromMime(mime?: string | null): AudioFormat {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (!m) return "ogg";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("aac")) return "aac";
  if (m.includes("flac")) return "flac";
  return "ogg";
}

/** The chat-completions body for a transcription request. Pure; tested in voice.test.ts. */
export function buildTranscriptionRequest(base64: string, format: AudioFormat, model = DEFAULT_STT_MODEL) {
  return {
    model,
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: TRANSCRIBE_PROMPT },
          { type: "input_audio" as const, input_audio: { data: base64, format } },
        ],
      },
    ],
    temperature: 0,
  };
}

/** Trim and strip one layer of wrapping quotes (models love to quote transcripts). */
export function cleanTranscript(raw: string | null | undefined): string {
  let t = (raw ?? "").trim();
  const pairs: [string, string][] = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["«", "»"],
  ];
  for (const [open, close] of pairs) {
    if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) {
      t = t.slice(open.length, t.length - close.length).trim();
      break;
    }
  }
  return t;
}

type ChatResponse = { choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[] };

function contentText(c: ChatResponse["choices"]): string {
  const content = c?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p?.text ?? "").join("");
  return "";
}

export async function transcribe(audio: ArrayBuffer, opts: { mime?: string; filename?: string } = {}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const format = formatFromMime(opts.mime ?? (opts.filename?.match(/\.(\w+)$/)?.[1] ?? null));
  const base64 = Buffer.from(audio).toString("base64");
  const body = buildTranscriptionRequest(base64, format, process.env.STT_MODEL || DEFAULT_STT_MODEL);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "Kevin",
  };
  if (process.env.APP_URL) headers["HTTP-Referer"] = process.env.APP_URL;

  const res = await fetch(OPENROUTER_URL, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`transcription failed: OpenRouter ${res.status} ${snippet}`);
  }
  const json = (await res.json()) as ChatResponse & { error?: { message?: string } };
  if (json.error) throw new Error(`transcription failed: OpenRouter error ${json.error.message ?? JSON.stringify(json.error)}`);
  return cleanTranscript(contentText(json.choices));
}
