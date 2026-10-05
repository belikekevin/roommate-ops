// Leasing office email + the shared inbox. AgentMail (lib/agentmail.ts) holds the mailbox; the emails table keeps a
// local copy of what was sent/received, which is how a reply that arrives by webhook, poll and dashboard is announced once.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import * as mail from "@/lib/agentmail";
import { getHousehold } from "./members";
import type { Ctx } from "./types";

const { emails, households } = schema;

export type InboundEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  threadId?: string;
  /** When the mail provider says it arrived (webhook payload timestamp). Stored as createdAt so the poll recognises the row. */
  receivedAt?: Date;
};
export type { MailThread, MailMessage } from "@/lib/agentmail";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/* ---------- dedupe: is this received message already in `emails`? ----------
 * We don't store AgentMail's message id, and rows come from three writers: the webhook (createdAt = now, body = raw text),
 * the poll and openThread (createdAt = message timestamp, body = extracted text). So a received message counts as stored
 * when an `in` row in the same thread has the same timestamp, OR the same normalized subject+body (first 300 chars),
 * OR the same normalized subject and a createdAt within 10 minutes AFTER the message timestamp (a webhook row). */

type StoredRow = { createdAt: Date; subject: string; body: string };
type ReceivedMsg = { at: Date; subject: string; text: string };

const WEBHOOK_LAG_MS = 10 * 60 * 1000;
const TEXT_KEY_CHARS = 300;

const normText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const textKey = (subject: string, body: string) => `${normText(subject)}\n${normText(body)}`.slice(0, TEXT_KEY_CHARS);

export function isStoredEmail(stored: StoredRow[], m: ReceivedMsg): boolean {
  const at = m.at.getTime();
  const subj = normText(m.subject);
  const key = textKey(m.subject, m.text);
  return stored.some((r) => {
    const rowAt = r.createdAt.getTime();
    if (rowAt === at) return true;
    if (textKey(r.subject, r.body) === key) return true;
    return normText(r.subject) === subj && rowAt >= at && rowAt - at <= WEBHOOK_LAG_MS;
  });
}

/** The `in` rows of one thread, for isStoredEmail(). */
async function storedInThread(householdId: string, threadId: string): Promise<StoredRow[]> {
  return db
    .select({ createdAt: emails.createdAt, subject: emails.subject, body: emails.body })
    .from(emails)
    .where(and(eq(emails.householdId, householdId), eq(emails.threadId, threadId), eq(emails.direction, "in")));
}

async function addresses(householdId: string) {
  const house = await getHousehold(householdId);
  return { inbox: norm(house?.inboxAddress) || norm(process.env.AGENTMAIL_INBOX) || null, leasing: norm(house?.leasingEmail) || null };
}

export async function sendToLeasing(ctx: Ctx, input: { subject: string; body: string; threadId?: string }): Promise<{ threadId: string | null }> {
  if (!process.env.AGENTMAIL_API_KEY) throw new Error("AgentMail isn't configured (AGENTMAIL_API_KEY), so Kevin can't send mail yet.");
  const { inbox, leasing } = await addresses(ctx.householdId);
  if (!inbox) throw new Error("Kevin has no inbox yet. Set it in Roommates → House settings.");
  if (!leasing) throw new Error("No leasing office email yet. Set it in Roommates → House settings.");
  const { threadId } = await mail.sendEmail({ from: inbox, to: leasing, subject: input.subject, text: input.body, threadId: input.threadId });
  await db.insert(emails).values({ householdId: ctx.householdId, direction: "out", subject: input.subject, body: input.body, threadId });
  return { threadId };
}

export async function createWorkOrder(ctx: Ctx, input: { issue: string; location?: string; urgency?: "low" | "normal" | "urgent" }): Promise<{ threadId: string | null }> {
  return sendToLeasing(ctx, {
    subject: `Work order: ${input.issue}`,
    body: `Hi, we'd like to report an issue${input.location ? ` in the ${input.location}` : ""}: ${input.issue}. Urgency: ${input.urgency ?? "normal"}. Thanks, the residents (sent by Kevin)`,
  });
}

/** Store it, return a short group summary. Caller posts it via channel.send and may set reminders. */
export async function handleInboundEmail(email: InboundEmail): Promise<{ householdId: string; summary: string } | null> {
  const to = norm(email.to);
  if (!to) return null;
  // Match case-insensitively; a house with no inbox of its own falls back to the shared AGENTMAIL_INBOX, same as sending does.
  const all = await db.select().from(households);
  const house =
    all.find((h) => norm(h.inboxAddress) === to) ??
    (norm(process.env.AGENTMAIL_INBOX) === to ? (all.find((h) => !h.inboxAddress) ?? all[0]) : undefined);
  if (!house) return null;
  const receivedAt = email.receivedAt && !Number.isNaN(email.receivedAt.getTime()) ? email.receivedAt : undefined;
  if (email.threadId) {
    // The poll (or an earlier delivery of this webhook) may have stored it already; don't insert or announce it twice.
    const stored = await storedInThread(house.id, email.threadId);
    if (isStoredEmail(stored, { at: receivedAt ?? new Date(), subject: email.subject, text: email.text })) return null;
  }
  await db.insert(emails).values({
    householdId: house.id,
    direction: "in",
    subject: email.subject,
    body: email.text,
    threadId: email.threadId,
    ...(receivedAt ? { createdAt: receivedAt } : {}),
  });
  return { householdId: house.id, summary: summarize(email.subject, email.text) };
}

const summarize = (subject: string, text: string) => {
  const gist = text.replace(/\s+/g, " ").trim();
  return `"${subject}"\n${gist.length > 200 ? `${gist.slice(0, 200)}…` : gist}`;
};

// ---- Shared inbox (dashboard): read straight from AgentMail so every roommate sees the same mailbox and unread state.

export async function inboxThreads(ctx: Pick<Ctx, "householdId">): Promise<mail.MailThread[]> {
  const { inbox } = await addresses(ctx.householdId);
  return inbox ? mail.listThreads(inbox) : [];
}

export async function unreadCount(ctx: Pick<Ctx, "householdId">): Promise<number> {
  const { inbox } = await addresses(ctx.householdId);
  return inbox ? mail.unreadCount(inbox) : 0;
}

/** Opening a thread marks it read for everyone and copies received messages into the emails table (if missing). */
export async function openThread(ctx: Pick<Ctx, "householdId">, threadId: string): Promise<mail.MailMessage[]> {
  const { inbox } = await addresses(ctx.householdId);
  if (!inbox) return [];
  const messages = await mail.getThread(inbox, threadId);
  const unread = messages.filter((m) => m.unread).map((m) => m.messageId);
  if (unread.length) await mail.markRead(inbox, unread);
  // The webhook or the poll may already have stored some of them (see isStoredEmail for the matching rules).
  const stored = await storedInThread(ctx.householdId, threadId);
  const missing = messages.filter((m) => !m.sent && !isStoredEmail(stored, m));
  if (missing.length) {
    await db.insert(emails).values(missing.map((m) => ({ householdId: ctx.householdId, direction: "in" as const, subject: m.subject, body: m.text, threadId, createdAt: m.at })));
  }
  return messages.map((m) => ({ ...m, unread: false }));
}

// ---- "Kevin, check the work order": a read-only glance at the mailbox. Marks nothing read.

export type LeasingThreadStatus = {
  threadId: string;
  subject: string;
  lastFrom: "kevin" | "office";
  lastAt: Date;
  lastPreview: string;
  unread: boolean;
  messageCount: number;
};

const DETAIL_THREADS = 3;

export async function leasingStatus(ctx: Pick<Ctx, "householdId">): Promise<{ threads: LeasingThreadStatus[] }> {
  const { inbox } = await addresses(ctx.householdId);
  if (!inbox || !process.env.AGENTMAIL_API_KEY) return { threads: [] };
  const threads = await mail.listThreads(inbox, 10);
  const details = await Promise.all(
    threads.slice(0, DETAIL_THREADS).map(async (t) => {
      try {
        const messages = await mail.getThread(inbox, t.threadId);
        const last = [...messages].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
        if (!last) return null;
        return { threadId: t.threadId, lastFrom: last.sent ? ("kevin" as const) : ("office" as const), lastAt: last.at, lastPreview: last.text };
      } catch (e) {
        console.error(`leasing: getThread ${t.threadId} failed`, e);
        return null;
      }
    }),
  );
  const byId = new Map(details.filter((d): d is NonNullable<typeof d> => !!d).map((d) => [d.threadId, d]));
  return {
    threads: threads.map((t) => {
      const d = byId.get(t.threadId);
      // Without the detail fetch we guess from the thread: an unread thread was last touched by the office.
      return {
        threadId: t.threadId,
        subject: t.subject,
        lastFrom: d?.lastFrom ?? (t.unread ? "office" : "kevin"),
        lastAt: d?.lastAt ?? t.at,
        lastPreview: gist(d?.lastPreview ?? t.preview),
        unread: t.unread,
        messageCount: t.messageCount,
      };
    }),
  };
}

const gist = (text: string, max = 200) => {
  const g = text.replace(/\s+/g, " ").trim();
  return g.length > max ? `${g.slice(0, max)}…` : g;
};

// ---- Scheduler poll: new mail from the office -> group chat. Marks nothing read (the dashboard badge keeps counting).

type PollState = { seenThreadAt: Map<string, number> }; // `${householdId}:${threadId}` -> thread.at when we last looked
function pollState(): PollState {
  const g = globalThis as { __kevinMailPollState?: PollState };
  return (g.__kevinMailPollState ??= { seenThreadAt: new Map() });
}

/**
 * Copies any received message not yet in `emails` into it and returns one summary per NEW message. Only unread threads
 * are examined, and a thread is only re-fetched when its `at` moved since the last poll, so an idle inbox costs one list call.
 */
export async function pollInbox(householdId: string): Promise<{ summary: string; threadId: string }[]> {
  if (!process.env.AGENTMAIL_API_KEY) return [];
  const { inbox } = await addresses(householdId);
  if (!inbox) return [];
  const s = pollState();
  const threads = await mail.listThreads(inbox, 25);
  const out: { summary: string; threadId: string }[] = [];
  for (const t of threads) {
    const key = `${householdId}:${t.threadId}`;
    if (!t.unread) {
      s.seenThreadAt.set(key, t.at.getTime());
      continue;
    }
    if (s.seenThreadAt.get(key) === t.at.getTime()) continue; // unchanged since we last looked
    const messages = await mail.getThread(inbox, t.threadId);
    const stored = await storedInThread(householdId, t.threadId);
    const fresh = messages.filter((m) => !m.sent && !isStoredEmail(stored, m)).sort((a, b) => a.at.getTime() - b.at.getTime());
    if (fresh.length) {
      await db.insert(emails).values(fresh.map((m) => ({ householdId, direction: "in" as const, subject: m.subject, body: m.text, threadId: t.threadId, createdAt: m.at })));
      for (const m of fresh) out.push({ threadId: t.threadId, summary: `📬 Leasing office replied — ${summarize(m.subject, m.text)}` });
    }
    s.seenThreadAt.set(key, t.at.getTime());
  }
  return out;
}
