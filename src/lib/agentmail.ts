// Thin AgentMail client: send from Kevin's inbox and read its threads. Inbound mail reaches the app through the
// scheduler's inbox poll (services/leasing.pollInbox) and, optionally, the webhook at /api/agentmail.
// Inbox ids are the inbox's email address (e.g. kevin@agentmail.to).
import { AgentMailClient } from "agentmail";

let _client: AgentMailClient | null = null;
function client(): AgentMailClient | null {
  if (!process.env.AGENTMAIL_API_KEY) return null;
  return (_client ??= new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY }));
}

export type MailMessage = {
  messageId: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  at: Date;
  sent: boolean; // sent by Kevin's inbox
  unread: boolean;
};

export type MailThread = {
  threadId: string;
  subject: string;
  preview: string;
  senders: string[];
  at: Date;
  messageCount: number;
  unread: boolean;
};

/** Sends a new email, or replies in-thread (to the thread's latest message) when threadId is set. */
export async function sendEmail(input: { from: string; to: string; subject: string; text: string; threadId?: string }): Promise<{ threadId: string | null }> {
  const c = client();
  if (!c) return { threadId: null };
  if (input.threadId) {
    const thread = await c.inboxes.threads.get(input.from, input.threadId);
    const r = await c.inboxes.messages.reply(input.from, thread.lastMessageId, { text: input.text, to: [input.to] });
    return { threadId: r.threadId };
  }
  const r = await c.inboxes.messages.send(input.from, { to: [input.to], subject: input.subject, text: input.text });
  return { threadId: r.threadId };
}

export async function listThreads(inbox: string, limit = 25): Promise<MailThread[]> {
  const c = client();
  if (!c) return [];
  const r = await c.inboxes.threads.list(inbox, { limit });
  return r.threads.map((t) => ({
    threadId: t.threadId,
    subject: t.subject ?? "(no subject)",
    preview: t.preview ?? "",
    senders: t.senders,
    at: new Date(t.timestamp),
    messageCount: t.messageCount,
    unread: t.labels.includes("unread"),
  }));
}

export async function getThread(inbox: string, threadId: string): Promise<MailMessage[]> {
  const c = client();
  if (!c) return [];
  const t = await c.inboxes.threads.get(inbox, threadId);
  return t.messages.map((m) => ({
    messageId: m.messageId,
    threadId: m.threadId,
    from: m.from,
    to: m.to,
    subject: m.subject ?? "(no subject)",
    text: m.extractedText ?? m.text ?? m.preview ?? "",
    at: new Date(m.timestamp),
    sent: m.labels.includes("sent"),
    unread: m.labels.includes("unread"),
  }));
}

export async function markRead(inbox: string, messageIds: string[]): Promise<void> {
  const c = client();
  if (!c) return;
  await Promise.all(messageIds.map((id) => c.inboxes.messages.update(inbox, id, { addLabels: ["read"], removeLabels: ["unread"] })));
}

export async function unreadCount(inbox: string): Promise<number> {
  const c = client();
  if (!c) return 0;
  const r = await c.inboxes.messages.list(inbox, { labels: ["unread"], limit: 50 });
  return r.count;
}
