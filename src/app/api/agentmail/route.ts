// AgentMail inbound webhook (event `message.received`): store the mail, post a summary into the house's group chat.
//
// Optional. The scheduler's inbox poll (jobs/scheduler.ts -> services/leasing.pollInbox) is the primary path and finds
// the same messages within a minute; the webhook only makes the announcement immediate, and a message that arrives
// both ways is stored and announced once (services/leasing.isStoredEmail).
//
// Authentication: set AGENTMAIL_WEBHOOK_SECRET to the webhook's signing secret ("whsec_...", shown when the webhook is
// created) and every delivery must carry a valid Svix signature. When it is unset the signature is NOT checked and
// anyone who can reach this URL can post a fake "leasing office" message into the chat, so set it on a public deployment.
import { inboundFromWebhook, verifyWebhookSignature } from "@/lib/agentmail-webhook";
import { handleInboundEmail } from "@/services/leasing";
import { telegram } from "@/channels/telegram";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // The signature covers the exact bytes sent, so read the body as text before parsing it.
  const body = await req.text();
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (secret) {
    const valid = verifyWebhookSignature({
      secret,
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
      body,
    });
    if (!valid) return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Events that are not a received message are acknowledged and dropped, so AgentMail doesn't retry them.
  const email = inboundFromWebhook(payload);
  const res = email ? await handleInboundEmail(email) : null;
  if (res) await telegram.send(res.householdId, { text: `📬 Leasing office: ${res.summary}` });
  return Response.json({ ok: true });
}
