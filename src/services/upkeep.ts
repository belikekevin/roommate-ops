// Recurring home upkeep: filters, smoke alarms, the dryer vent nobody thinks about.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pickByName as fuzzyPick } from "@/lib/fuzzy";
import type { Ctx } from "./types";

const { maintenance } = schema;

export type MaintenanceStatus = "overdue" | "due-soon" | "ok";

export type MaintenanceItem = {
  id: string;
  item: string;
  everyDays: number;
  lastDone: Date | null;
  nextDue: Date | null;
  status: MaintenanceStatus;
};

/** "Due soon" window: items due within this many days show up on the Home card and in the Kevin Report. */
export const DUE_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The usual suspects, offered when a house has no battle plan yet. */
export const DEFAULT_ITEMS: ReadonlyArray<{ item: string; everyDays: number }> = [
  { item: "Replace HVAC filter", everyDays: 90 },
  { item: "Test smoke alarms", everyDays: 180 },
  { item: "Clean dryer vent", everyDays: 180 },
  { item: "Descale coffee maker", everyDays: 60 },
  { item: "Check fire extinguisher", everyDays: 365 },
];

// ---------- pure helpers (unit-tested, no DB) ----------

const norm = (s: string) => s.trim().toLowerCase();

/** lastDone + everyDays. Never done -> null, which the callers read as "due now". */
export function nextDueDate(lastDone: Date | null, everyDays: number): Date | null {
  if (!lastDone) return null;
  return new Date(lastDone.getTime() + everyDays * DAY_MS);
}

/** Never done or past due -> overdue; within DUE_SOON_DAYS -> due-soon; otherwise ok. */
export function statusFor(nextDue: Date | null, now: Date = new Date()): MaintenanceStatus {
  if (!nextDue) return "overdue";
  const delta = nextDue.getTime() - now.getTime();
  if (delta <= 0) return "overdue";
  if (delta <= DUE_SOON_DAYS * DAY_MS) return "due-soon";
  return "ok";
}

/** Row -> MaintenanceItem with nextDue + status filled in. */
export function withSchedule<T extends { lastDone: Date | null; everyDays: number }>(
  row: T,
  now: Date = new Date(),
): T & { nextDue: Date | null; status: MaintenanceStatus } {
  const nextDue = nextDueDate(row.lastDone, row.everyDays);
  return { ...row, nextDue, status: statusFor(nextDue, now) };
}

/** Soonest first; never-done (nextDue null) sorts before everything, then by name as a tiebreak. */
export function compareByNextDue(a: { nextDue: Date | null; item: string }, b: { nextDue: Date | null; item: string }): number {
  if (!a.nextDue && !b.nextDue) return a.item.localeCompare(b.item);
  if (!a.nextDue) return -1;
  if (!b.nextDue) return 1;
  return a.nextDue.getTime() - b.nextDue.getTime() || a.item.localeCompare(b.item);
}

/** Fuzzy upkeep-item picker: exact -> starts with -> contains either way; shortest name wins a tie (see lib/fuzzy.ts). */
export function pickByName<T extends { item: string }>(items: readonly T[], query: string): T | undefined {
  return fuzzyPick(items, query, (m) => m.item);
}

// ---------- DB-backed services ----------

async function rows(householdId: string) {
  return db.select().from(maintenance).where(eq(maintenance.householdId, householdId));
}

/** Add an upkeep item. Same name (case-insensitive) already tracked -> just update its cadence. */
export async function addMaintenance(ctx: Ctx, input: { item: string; everyDays: number }): Promise<void> {
  const item = input.item.trim();
  const everyDays = Math.max(1, Math.round(input.everyDays));
  if (!item) throw new Error("Upkeep item needs a name.");
  const existing = (await rows(ctx.householdId)).find((m) => norm(m.item) === norm(item));
  if (existing) {
    await db.update(maintenance).set({ everyDays }).where(eq(maintenance.id, existing.id));
    return;
  }
  await db.insert(maintenance).values({ householdId: ctx.householdId, item, everyDays });
}

/** Mark an item done now. Fuzzy name match; unknown names throw with the list of known items so Kevin can ask. */
export async function markDone(ctx: Ctx, input: { item: string }): Promise<void> {
  const all = await rows(ctx.householdId);
  const match = pickByName(all, input.item);
  if (!match) {
    const known = all.map((m) => `"${m.item}"`).join(", ");
    throw new Error(
      all.length
        ? `No upkeep item matches "${input.item}". Known items: ${known}.`
        : `No upkeep item matches "${input.item}" and nothing is tracked yet. Add it first.`,
    );
  }
  await db
    .update(maintenance)
    .set({ lastDone: new Date() })
    .where(and(eq(maintenance.id, match.id), eq(maintenance.householdId, ctx.householdId)));
}

/** Every item with nextDue + status, soonest first (never-done first). */
export async function listMaintenance(ctx: Pick<Ctx, "householdId">): Promise<MaintenanceItem[]> {
  const now = new Date();
  return (await rows(ctx.householdId))
    .map((r) => withSchedule({ id: r.id, item: r.item, everyDays: r.everyDays, lastDone: r.lastDone }, now))
    .sort(compareByNextDue);
}

/** Items overdue or due within the next 7 days, soonest first. Home card + Kevin Report read this. */
export async function dueMaintenance(ctx: Pick<Ctx, "householdId">): Promise<MaintenanceItem[]> {
  return (await listMaintenance(ctx)).filter((m) => m.status !== "ok");
}

/** Seed the usual suspects, skipping any the house already tracks. Returns how many were added. */
export async function addDefaults(ctx: Ctx): Promise<number> {
  const have = new Set((await rows(ctx.householdId)).map((m) => norm(m.item)));
  const missing = DEFAULT_ITEMS.filter((d) => !have.has(norm(d.item)));
  if (missing.length) {
    await db.insert(maintenance).values(missing.map((d) => ({ householdId: ctx.householdId, ...d })));
  }
  return missing.length;
}
