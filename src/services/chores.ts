// Chores: the chart, who did what, whose turn, and the Hall of Shame.
// Pure helpers (pickChore, whoseTurn, rankShame, countStreak) are exported so chores.test.ts can run them without a DB.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { normName as norm, pickByName } from "@/lib/fuzzy";
import { listMembers } from "./members";
import type { Ctx } from "./types";

const { chores, choreLogs, members } = schema;

export type ChoreStatus = {
  choreId: string;
  name: string;
  everyDays: number;
  lastDoneBy: string | null;
  lastDoneAt: Date | null;
  overdue: boolean;
  whoseTurn: string | null;
};
export type ShameRow = { memberId: string; name: string; daysSinceLastChore: number | null; choresThisWeek: number };

const DAY = 24 * 60 * 60 * 1000;

// ---------- pure bits ----------

/** Fuzzy chore picker: exact -> starts with -> contains either way; shortest name wins a tie (see lib/fuzzy.ts). */
export function pickChore<T extends { name: string }>(query: string, candidates: T[]): T | undefined {
  return pickByName(candidates, query, (c) => c.name);
}

/**
 * Whose turn: the active member whose most recent log for this chore is the oldest.
 * Members who have never done it come first; ties break by name. Null when nobody lives here.
 */
export function whoseTurn(
  people: Array<{ id: string; name: string }>,
  lastDoneByMember: Map<string, Date>,
): string | null {
  const ordered = [...people].sort((a, b) => {
    const ta = lastDoneByMember.get(a.id)?.getTime() ?? -Infinity;
    const tb = lastDoneByMember.get(b.id)?.getTime() ?? -Infinity;
    return ta - tb || a.name.localeCompare(b.name);
  });
  return ordered[0]?.name ?? null;
}

/** Worst first: fewest chores this week, then longest since last chore (never = worst), then name. */
export function rankShame<T extends ShameRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.choresThisWeek - b.choresThisWeek ||
      (b.daysSinceLastChore ?? Infinity) - (a.daysSinceLastChore ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}

/** Streak: consecutive most-recent logs (newest first) of one chore done by `memberId`. */
export function countStreak(doersNewestFirst: string[], memberId: string): number {
  let n = 0;
  for (const id of doersNewestFirst) {
    if (id !== memberId) break;
    n++;
  }
  return n;
}

/** Overdue first, then by name. */
export function sortStatus<T extends { overdue: boolean; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.name.localeCompare(b.name));
}

export function isOverdue(lastDoneAt: Date | null, everyDays: number, now = new Date()): boolean {
  if (!lastDoneAt) return true;
  return now.getTime() - lastDoneAt.getTime() > everyDays * DAY;
}

export const daysSince = (d: Date, now = new Date()) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));

// ---------- DB ----------

async function householdChores(householdId: string) {
  return db.select().from(chores).where(eq(chores.householdId, householdId));
}

/** All logs for the house, newest first, with the doer's name. */
async function householdLogs(householdId: string) {
  return db
    .select({
      choreId: choreLogs.choreId,
      memberId: choreLogs.memberId,
      memberName: members.name,
      doneAt: choreLogs.doneAt,
    })
    .from(choreLogs)
    .innerJoin(chores, eq(choreLogs.choreId, chores.id))
    .innerJoin(members, eq(choreLogs.memberId, members.id))
    .where(eq(chores.householdId, householdId))
    .orderBy(desc(choreLogs.doneAt));
}

/** Adds a chore; same name (case-insensitive) already on the chart just updates its cadence. */
export async function addChore(ctx: Ctx, input: { name: string; everyDays: number }): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new Error("Chore needs a name.");
  const everyDays = Math.max(1, Math.round(Number(input.everyDays) || 7));
  const existing = (await householdChores(ctx.householdId)).find((c) => norm(c.name) === norm(name));
  if (existing) {
    await db.update(chores).set({ everyDays }).where(eq(chores.id, existing.id));
    return;
  }
  await db.insert(chores).values({ householdId: ctx.householdId, name, everyDays });
}

/** Fuzzy-matches the chore by name; creates it (every 7 days) if unknown. Logs it for ctx.actorId by default. */
export async function logChore(ctx: Ctx, input: { chore: string; memberId?: string }): Promise<{ chore: string; streak: number }> {
  const memberId = input.memberId ?? ctx.actorId;
  const people = await listMembers(ctx);
  if (!people.some((m) => m.id === memberId)) throw new Error("That person doesn't live here.");

  const query = input.chore.trim();
  if (!query) throw new Error("Which chore?");
  let chore = pickChore(query, await householdChores(ctx.householdId));
  if (!chore) {
    [chore] = await db.insert(chores).values({ householdId: ctx.householdId, name: query, everyDays: 7 }).returning();
  }

  await db.insert(choreLogs).values({ choreId: chore.id, memberId });
  const recent = await db
    .select({ memberId: choreLogs.memberId })
    .from(choreLogs)
    .where(eq(choreLogs.choreId, chore.id))
    .orderBy(desc(choreLogs.doneAt));
  return { chore: chore.name, streak: Math.max(1, countStreak(recent.map((r) => r.memberId), memberId)) };
}

export async function choreStatus(ctx: Pick<Ctx, "householdId">): Promise<ChoreStatus[]> {
  const [chart, logs, people] = await Promise.all([
    householdChores(ctx.householdId),
    householdLogs(ctx.householdId),
    listMembers(ctx),
  ]);
  const now = new Date();
  const rows = chart.map((c) => {
    const mine = logs.filter((l) => l.choreId === c.id); // newest first
    const latest = mine[0];
    const lastByMember = new Map<string, Date>();
    for (const l of mine) if (!lastByMember.has(l.memberId)) lastByMember.set(l.memberId, l.doneAt);
    return {
      choreId: c.id,
      name: c.name,
      everyDays: c.everyDays,
      lastDoneBy: latest?.memberName ?? null,
      lastDoneAt: latest?.doneAt ?? null,
      overdue: isOverdue(latest?.doneAt ?? null, c.everyDays, now),
      whoseTurn: whoseTurn(people, lastByMember),
    };
  });
  return sortStatus(rows);
}

/** Sorted worst first. */
export async function hallOfShame(ctx: Pick<Ctx, "householdId">): Promise<ShameRow[]> {
  const [people, logs] = await Promise.all([listMembers(ctx), householdLogs(ctx.householdId)]);
  const now = new Date();
  const weekAgo = now.getTime() - 7 * DAY;
  const rows = people.map((m) => {
    const mine = logs.filter((l) => l.memberId === m.id);
    return {
      memberId: m.id,
      name: m.name,
      daysSinceLastChore: mine[0] ? daysSince(mine[0].doneAt, now) : null,
      choresThisWeek: mine.filter((l) => l.doneAt.getTime() >= weekAgo).length,
    };
  });
  return rankShame(rows);
}

/** Removes a chore and its history. Dashboard-only housekeeping. */
export async function removeChore(ctx: Ctx, input: { choreId: string }): Promise<void> {
  const [c] = await db
    .select({ id: chores.id })
    .from(chores)
    .where(and(eq(chores.id, input.choreId), eq(chores.householdId, ctx.householdId)));
  if (!c) return;
  await db.delete(choreLogs).where(inArray(choreLogs.choreId, [c.id]));
  await db.delete(chores).where(eq(chores.id, c.id));
}
