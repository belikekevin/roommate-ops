// AgentMail webhook helpers: signature check + payload mapping. No network, no DB.
// Run: npx tsx --test src/lib/agentmail-webhook.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { inboundFromWebhook, verifyWebhookSignature } from "./agentmail-webhook";

/* ---------- verifyWebhookSignature ---------- */

// The worked example from Svix's "verifying webhooks manually" documentation.
const signed = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1614265330",
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  body: '{"test": 2432232314}',
  now: new Date(1614265330 * 1000),
};

test("signature: the Svix reference example verifies", () => {
  assert.equal(verifyWebhookSignature(signed), true);
});

test("signature: any matching v1 entry in a rotated list is enough; other versions are skipped", () => {
  assert.equal(verifyWebhookSignature({ ...signed, signature: `v1,AAAA v2,BBBB ${signed.signature}` }), true);
  assert.equal(verifyWebhookSignature({ ...signed, signature: signed.signature.replace("v1,", "v2,") }), false);
});

test("signature: a changed body, id, timestamp or secret fails", () => {
  assert.equal(verifyWebhookSignature({ ...signed, body: '{"test":2432232314}' }), false);
  assert.equal(verifyWebhookSignature({ ...signed, id: "msg_other" }), false);
  assert.equal(verifyWebhookSignature({ ...signed, timestamp: "1614265331" }), false);
  assert.equal(verifyWebhookSignature({ ...signed, secret: "whsec_c29tZSBvdGhlciBzZWNyZXQ=" }), false);
});

test("signature: missing headers, an empty secret or junk never verify", () => {
  assert.equal(verifyWebhookSignature({ ...signed, id: null }), false);
  assert.equal(verifyWebhookSignature({ ...signed, timestamp: null }), false);
  assert.equal(verifyWebhookSignature({ ...signed, signature: null }), false);
  assert.equal(verifyWebhookSignature({ ...signed, signature: "v1," }), false);
  assert.equal(verifyWebhookSignature({ ...signed, signature: "not a signature" }), false);
  assert.equal(verifyWebhookSignature({ ...signed, timestamp: "yesterday" }), false);
  assert.equal(verifyWebhookSignature({ ...signed, secret: "whsec_" }), false);
});

test("signature: timestamps more than five minutes from now are rejected (replays)", () => {
  const at = (offsetSeconds: number) => new Date((1614265330 + offsetSeconds) * 1000);
  assert.equal(verifyWebhookSignature({ ...signed, now: at(299) }), true);
  assert.equal(verifyWebhookSignature({ ...signed, now: at(-299) }), true);
  assert.equal(verifyWebhookSignature({ ...signed, now: at(301) }), false);
  assert.equal(verifyWebhookSignature({ ...signed, now: at(-301) }), false);
});

/* ---------- inboundFromWebhook ---------- */

const received = {
  type: "event",
  event_type: "message.received",
  event_id: "evt_1",
  message: {
    inbox_id: "kevin@agentmail.to",
    thread_id: "thr_1",
    message_id: "<msg-1@mail.example>",
    labels: ["received", "unread"],
    timestamp: "2026-10-04T15:30:00.000Z",
    from: "Leasing Office <leasing@example.com>",
    to: ["Kevin <kevin@agentmail.to>"],
    subject: "Re: Work order: kitchen sink is leaking",
    preview: "A plumber will come by",
    text: "A plumber will come by Tuesday morning.\n\n> Hi, we'd like to report an issue",
    extracted_text: "A plumber will come by Tuesday morning.",
    size: 1234,
    updated_at: "2026-10-04T15:30:01.000Z",
    created_at: "2026-10-04T15:30:01.000Z",
  },
  thread: { inbox_id: "kevin@agentmail.to", thread_id: "thr_1", message_count: 2 },
};

test("payload: message.received maps to an inbound email keyed by the receiving inbox", () => {
  assert.deepEqual(inboundFromWebhook(received), {
    from: "Leasing Office <leasing@example.com>",
    to: "kevin@agentmail.to",
    subject: "Re: Work order: kitchen sink is leaking",
    text: "A plumber will come by Tuesday morning.\n\n> Hi, we'd like to report an issue",
    threadId: "thr_1",
    receivedAt: new Date("2026-10-04T15:30:00.000Z"),
  });
});

test("payload: falls back field by field when optional parts are missing", () => {
  const { inbox_id: _inbox, thread_id: _thread, timestamp: _ts, text: _text, subject: _subject, ...rest } = received.message;
  const email = inboundFromWebhook({ ...received, message: rest });
  assert.equal(email?.to, "kevin@agentmail.to", "first recipient, display name stripped");
  assert.equal(email?.threadId, "thr_1", "thread id from the thread object");
  assert.equal(email?.receivedAt?.toISOString(), "2026-10-04T15:30:01.000Z", "created_at when there is no timestamp");
  assert.equal(email?.text, "A plumber will come by Tuesday morning.", "extracted_text when there is no text");
  assert.equal(email?.subject, "");
});

test("payload: a bare { message } body without event_type is still mapped", () => {
  const email = inboundFromWebhook({ message: { from: "a@example.com", to: ["kevin@agentmail.to"], subject: "Hi", text: "Hello", thread_id: "t" } });
  assert.deepEqual(email, { from: "a@example.com", to: "kevin@agentmail.to", subject: "Hi", text: "Hello", threadId: "t", receivedAt: undefined });
});

test("payload: other events and malformed bodies are ignored", () => {
  for (const event_type of ["message.sent", "message.delivered", "message.bounced", "message.received.spam", "message.received.blocked", "domain.verified"]) {
    assert.equal(inboundFromWebhook({ ...received, event_type }), null, event_type);
  }
  assert.equal(inboundFromWebhook({ type: "event", event_type: "message.received" }), null, "no message");
  assert.equal(inboundFromWebhook({ event_type: "message.received", message: "nope" }), null);
  assert.equal(inboundFromWebhook(null), null);
  assert.equal(inboundFromWebhook("message.received"), null);
  assert.equal(inboundFromWebhook([received]), null);
});

test("payload: wrong-typed fields become empty values instead of throwing", () => {
  const email = inboundFromWebhook({ event_type: "message.received", message: { from: 42, to: "kevin@agentmail.to", subject: null, text: {}, timestamp: "not a date" } });
  assert.deepEqual(email, { from: "", to: "kevin@agentmail.to", subject: "", text: "", threadId: undefined, receivedAt: undefined });
});
