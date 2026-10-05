// Every group message is logged so Kevin knows what happened between mentions.
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { chatLog, members } = schema;

export async function logMessage(householdId: string, memberId: string | null, text: string) {
  await db.insert(chatLog).values({ householdId, memberId, text });
}

/** Recent group chatter as "[Name] text" lines, oldest first. */
export async function recentChatter(householdId: string, sinceMinutes = 120, limit = 30): Promise<string[]> {
  const since = new Date(Date.now() - sinceMinutes * 60_000);
  const rows = await db
    .select({ text: chatLog.text, name: members.name })
    .from(chatLog)
    .leftJoin(members, eq(chatLog.memberId, members.id))
    .where(and(eq(chatLog.householdId, householdId), gt(chatLog.createdAt, since)))
    .orderBy(desc(chatLog.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => `[${r.name ?? "Kevin"}] ${r.text}`);
}

/** When Kevin last spoke in this chat (his rows have memberId null), or null if never. Opens the attention window. */
export async function lastKevinReplyAt(householdId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: chatLog.createdAt })
    .from(chatLog)
    .where(and(eq(chatLog.householdId, householdId), isNull(chatLog.memberId)))
    .orderBy(desc(chatLog.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * Human messages (memberId NOT NULL) logged strictly after `since`. The router logs the incoming message before it
 * asks, so when called with lastKevinReplyAt() the result already counts the message being handled (first follow-up = 1).
 */
export async function humanMessagesSince(householdId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatLog)
    .where(and(eq(chatLog.householdId, householdId), isNotNull(chatLog.memberId), gt(chatLog.createdAt, since)));
  return Number(row?.n ?? 0);
}
