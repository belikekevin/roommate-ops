// AgentMail webhook plumbing for /api/agentmail. No SDK and no DB in here, so both halves are unit-tested:
//   verifyWebhookSignature()  AgentMail delivers webhooks through Svix; each request carries svix-id, svix-timestamp
//                             and svix-signature headers, signed with the webhook's secret ("whsec_...").
//   inboundFromWebhook()      the `message.received` event body -> the fields services/leasing.handleInboundEmail takes.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Svix rejects deliveries whose timestamp is more than five minutes off (replay protection); so do we. */
const TOLERANCE_SECONDS = 5 * 60;

export type SignedRequest = {
  /** The webhook's signing secret, as AgentMail shows it: "whsec_" + base64 key. */
  secret: string;
  id: string | null;
  /** Unix seconds, as sent in the svix-timestamp header. */
  timestamp: string | null;
  /** The svix-signature header: one or more space-separated "v1,<base64>" entries. */
  signature: string | null;
  /** The raw request body, byte for byte as received (not re-serialized JSON). */
  body: string;
  now?: Date;
};

/**
 * True when one of the request's v1 signatures is HMAC-SHA256(key, `${id}.${timestamp}.${body}`) and the timestamp
 * is within five minutes of now. Missing headers, a malformed secret or a stale timestamp all return false.
 */
export function verifyWebhookSignature({ secret, id, timestamp, signature, body, now = new Date() }: SignedRequest): boolean {
  if (!id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now.getTime() / 1000 - seconds) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.trim().replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(/\s+/).some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

export type WebhookEmail = {
  from: string;
  /** The inbox that received it (AgentMail inbox ids are the inbox's address), which is how the household is found. */
  to: string;
  subject: string;
  text: string;
  threadId?: string;
  receivedAt?: Date;
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
/** "Display Name <user@host>" -> "user@host". */
const bareAddress = (v: string | undefined) => v?.match(/<([^<>]+)>\s*$/)?.[1]?.trim() ?? v?.trim();

/**
 * Map an AgentMail webhook body to an inbound email, or null when it is not one. The wire format is snake_case:
 *   { type: "event", event_type: "message.received", event_id, message: { inbox_id, thread_id, message_id, timestamp,
 *     from, to: string[], subject?, text?, extracted_text?, preview?, ... }, thread: { ... } }
 * Only `message.received` is mapped. Sent/delivered/bounced events and the spam, blocked and unauthenticated variants of
 * a received message are ignored, so they are never announced in the group. Every field is read defensively: this is
 * an HTTP body, not a typed value.
 */
export function inboundFromWebhook(payload: unknown): WebhookEmail | null {
  if (!isObject(payload)) return null;
  const eventType = str(payload.event_type);
  if (eventType && eventType !== "message.received") return null;
  const msg = payload.message;
  if (!isObject(msg)) return null;

  const recipients = Array.isArray(msg.to) ? msg.to : [msg.to];
  const ts = str(msg.timestamp) ?? str(msg.created_at);
  const parsed = ts ? new Date(ts) : undefined;
  return {
    from: str(msg.from) ?? "",
    to: str(msg.inbox_id) ?? bareAddress(str(recipients[0])) ?? "",
    subject: str(msg.subject) ?? "",
    text: str(msg.text) ?? str(msg.extracted_text) ?? str(msg.preview) ?? "",
    threadId: str(msg.thread_id) ?? (isObject(payload.thread) ? str(payload.thread.thread_id) : undefined),
    // The mail's own time, so the stored row carries it and the inbox poll recognises the message as already stored.
    receivedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined,
  };
}
