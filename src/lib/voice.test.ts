// Pure helpers only; no network. Run: npx tsx --test src/lib/voice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTranscriptionRequest, cleanTranscript, DEFAULT_STT_MODEL, formatFromMime, TRANSCRIBE_PROMPT } from "./voice";

test("formatFromMime: Telegram voice notes (ogg/opus) -> ogg, and the default is ogg", () => {
  assert.equal(formatFromMime("audio/ogg"), "ogg");
  assert.equal(formatFromMime("audio/ogg; codecs=opus"), "ogg");
  assert.equal(formatFromMime("audio/opus"), "ogg");
  assert.equal(formatFromMime(undefined), "ogg");
  assert.equal(formatFromMime(""), "ogg");
  assert.equal(formatFromMime("application/octet-stream"), "ogg");
});

test("formatFromMime: common types", () => {
  assert.equal(formatFromMime("audio/mpeg"), "mp3");
  assert.equal(formatFromMime("audio/mp3"), "mp3");
  assert.equal(formatFromMime("audio/wav"), "wav");
  assert.equal(formatFromMime("audio/x-wav"), "wav");
  assert.equal(formatFromMime("audio/mp4"), "m4a");
  assert.equal(formatFromMime("audio/m4a"), "m4a");
  assert.equal(formatFromMime("audio/x-m4a"), "m4a");
  assert.equal(formatFromMime("AUDIO/WAV"), "wav");
});

test("buildTranscriptionRequest: OpenRouter input_audio shape, temperature 0, default model", () => {
  const req = buildTranscriptionRequest("QUJD", "ogg");
  assert.equal(req.model, DEFAULT_STT_MODEL);
  assert.equal(req.temperature, 0);
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, "user");
  const [text, audio] = req.messages[0].content;
  assert.deepEqual(text, { type: "text", text: TRANSCRIBE_PROMPT });
  assert.deepEqual(audio, { type: "input_audio", input_audio: { data: "QUJD", format: "ogg" } });
  assert.match(TRANSCRIBE_PROMPT, /verbatim/i);
});

test("buildTranscriptionRequest: explicit model and format are passed through", () => {
  const req = buildTranscriptionRequest("AAAA", "wav", "google/gemini-2.5-flash-lite");
  assert.equal(req.model, "google/gemini-2.5-flash-lite");
  assert.equal(req.messages[0].content[1].input_audio?.format, "wav");
  assert.equal(JSON.parse(JSON.stringify(req)).messages[0].content[1].input_audio.data, "AAAA", "serialises cleanly");
});

test("cleanTranscript: trims and strips one layer of wrapping quotes", () => {
  assert.equal(cleanTranscript('  "Kevin, add milk to the cart"  \n'), "Kevin, add milk to the cart");
  assert.equal(cleanTranscript("“check the work order”"), "check the work order");
  assert.equal(cleanTranscript("'hi'"), "hi");
  assert.equal(cleanTranscript('she said "hi" to me'), 'she said "hi" to me', "inner quotes are kept");
  assert.equal(cleanTranscript('"'), '"', "a lone quote is not a wrapped string");
  assert.equal(cleanTranscript(""), "");
  assert.equal(cleanTranscript(undefined), "");
});
