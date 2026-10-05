// Reminders. One-off and monthly nudges; the scheduler (src/jobs/scheduler.ts) delivers them.
import { and, asc, eq, isNull, like, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./types";
import { dollars } from "./types";
import { getHousehold } from "./members";

const { reminders, members } = schema;

export type Reminder = {
  id: string;
  householdId: string;
  text: string;
  dueAt: Date;
  memberId: string | null;
  memberName: string | null; // null = for everyone
  recurring: "monthly" | null;
};

/** Hour (UTC) the rent reminder fires: 14:00Z ≈ 9–10am US Eastern/Central, i.e. morning on rent day. */
export const RENT_HOUR_UTC = 14;

/**
 * Convention: the household's rent reminder is the row with
 *   recurring = 'monthly' AND member_id IS NULL AND text LIKE 'Rent $%' (i.e. starts with an amount, as we write it).
 * There is no dedicated column; syncRentReminder() keeps exactly one unsent row matching this.
 */
const RENT_TEXT_PREFIX = "Rent ";
const rentReminderFilter = (householdId: string) =>
  and(
    eq(reminders.householdId, householdId),
    isNull(reminders.sentAt),
    eq(reminders.recurring, "monthly"),
    isNull(reminders.memberId),
    like(reminders.text, `${RENT_TEXT_PREFIX}$%`),
  );

// ---------- pure date math (unit tested, no DB) ----------

/** Same time-of-day, one calendar month later, day-of-month clamped to 28 so it never skips a month. All in UTC. */
export function addOneMonth(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      Math.min(d.getUTCDate(), 28),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

/** Next `dueDay` (1-28) at RENT_HOUR_UTC strictly after `now`; if this month's moment already passed, next month's. */
export function nextRentDue(now: Date, dueDay: number): Date {
  const day = Math.min(28, Math.max(1, Math.round(dueDay)));
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, RENT_HOUR_UTC, 0, 0, 0));
  if (thisMonth.getTime() > now.getTime()) return thisMonth;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, RENT_HOUR_UTC, 0, 0, 0));
}

// ---------- queries ----------

const selectShape = {
  id: reminders.id,
  householdId: reminders.householdId,
  text: reminders.text,
  dueAt: reminders.dueAt,
  memberId: reminders.memberId,
  memberName: members.name,
  recurring: reminders.recurring,
};

const baseQuery = () => db.select(selectShape).from(reminders).leftJoin(members, eq(members.id, reminders.memberId));

const toReminder = (r: { memberName: string | null; recurring: "monthly" | null } & Omit<Reminder, "memberName" | "recurring">): Reminder => ({
  ...r,
  memberName: r.memberName ?? null,
  recurring: r.recurring ?? null,
});

export async function setReminder(
  ctx: Ctx,
  input: { text: string; dueAt: Date; memberId?: string; recurring?: "monthly" },
): Promise<Reminder> {
  const text = input.text.trim();
  if (!text) throw new Error("Reminder needs some text.");
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("That's not a real date.");

  let memberName: string | null = null;
  if (input.memberId) {
    const [m] = await db
      .select({ name: members.name })
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.householdId, ctx.householdId)));
    if (!m) throw new Error("That roommate doesn't live here.");
    memberName = m.name;
  }

  const [row] = await db
    .insert(reminders)
    .values({
      householdId: ctx.householdId,
      text,
      dueAt: input.dueAt,
      memberId: input.memberId ?? null,
      recurring: input.recurring ?? null,
    })
    .returning();

  return toReminder({ ...row, memberName });
}

export async function listReminders(ctx: Pick<Ctx, "householdId">): Promise<Reminder[]> {
  const rows = await baseQuery()
    .where(and(eq(reminders.householdId, ctx.householdId), isNull(reminders.sentAt)))
    .orderBy(asc(reminders.dueAt));
  return rows.map(toReminder);
}

export async function cancelReminder(ctx: Ctx, input: { reminderId: string }): Promise<void> {
  await db.delete(reminders).where(and(eq(reminders.id, input.reminderId), eq(reminders.householdId, ctx.householdId)));
}

/** Scheduler only: all households' unsent reminders with dueAt <= now. */
export async function dueReminders(now = new Date()): Promise<Reminder[]> {
  const rows = await baseQuery()
    .where(and(isNull(reminders.sentAt), lte(reminders.dueAt, now)))
    .orderBy(asc(reminders.dueAt));
  return rows.map(toReminder);
}

/** Scheduler only: set sent_at; if recurring monthly, insert next month's copy. */
export async function markSent(reminderId: string): Promise<void> {
  const [row] = await db
    .update(reminders)
    .set({ sentAt: new Date() })
    .where(and(eq(reminders.id, reminderId), isNull(reminders.sentAt)))
    .returning();
  if (!row || row.recurring !== "monthly") return;
  await db.insert(reminders).values({
    householdId: row.householdId,
    text: row.text,
    memberId: row.memberId,
    recurring: "monthly",
    dueAt: addOneMonth(row.dueAt),
  });
}

/** Creates/refreshes the monthly rent reminder from house settings. Call after settings change. */
export async function syncRentReminder(ctx: Pick<Ctx, "householdId">): Promise<void> {
  const house = await getHousehold(ctx.householdId);
  // Always clear first so there is never more than one (and none when rent is unset).
  await db.delete(reminders).where(rentReminderFilter(ctx.householdId));
  if (!house || house.rentCents == null || house.rentDueDay == null) return;
  await db.insert(reminders).values({
    householdId: ctx.householdId,
    text: `${RENT_TEXT_PREFIX}${dollars(house.rentCents)} due today. Pay up.`,
    dueAt: nextRentDue(new Date(), house.rentDueDay),
    memberId: null,
    recurring: "monthly",
  });
}
