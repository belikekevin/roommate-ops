// Demo history for "Apt 4B": three weeks of roommate life so the dashboard and Kevin's context look lived-in.
//
//   npm run seed          first time (no-op if the house already has expenses)
//   npm run seed:demo     --reset: wipe this house's history and rebuild it (re-runnable, identical counts)
//
// Resolves the house: KEVIN_HOUSEHOLD_ID, else the household named "Apt 4B", else the first by created_at,
// else creates "Apt 4B" with Sam, Riley and Alex. --reset keeps the household row, members (and their
// Telegram links) and the `emails` table (real AgentMail history); everything else for this house is rebuilt.
// TELEGRAM_CHAT_ID binds the group: always on create, and on an existing house when --reset or it has no chat yet.
// A newly created house takes its leasing-office address from LEASING_EMAIL (default leasing@example.com) and Kevin's
// mailbox from AGENTMAIL_INBOX; both can be changed later under Roommates -> House settings.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../src/db";
import { estimate } from "../src/lib/prices";
import { money, chores as choresSvc, reminders as remindersSvc, upkeep } from "../src/services";
import { dollars, type Ctx } from "../src/services/types";

const { households, members, expenses, expenseSplits, settlements, chores, choreLogs, reminders, maintenance, cartItems, chatLog } = schema;

const RESET = process.argv.includes("--reset");
const HOUSE_NAME = "Apt 4B";
const TZ = "America/Chicago";
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = new Date();

/* ---------- time helpers ---------- */

/** `days` days (and `hours` hours) before now. */
const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * HOUR);

/** Offset (ms) of `tz` from UTC at instant `d`. */
function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant of wall-clock `y-m-d h:mi` in `tz` (two-pass offset correction handles DST edges). */
function zoned(y: number, m: number, d: number, h: number, mi: number, tz = TZ): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = new Date(guess - tzOffsetMs(new Date(guess), tz));
  return new Date(guess - tzOffsetMs(first, tz));
}

/** Calendar date (y, m, d) of `d` in `tz`, plus its weekday 0-6 (Sun-Sat). */
function localDate(d: Date, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday };
}

/** `h:mi` house-local time, `plusDays` days from today (house calendar). */
function localAt(plusDays: number, h: number, mi = 0): Date {
  const t = localDate(new Date(now.getTime() + plusDays * DAY));
  return zoned(t.y, t.m, t.d, h, mi);
}

/** Next Tuesday (strictly after today, house calendar) at `h:mi`. */
function nextWeekday(weekday: number, h: number, mi = 0): Date {
  const today = localDate(now).weekday;
  const delta = ((weekday - today + 7) % 7) || 7;
  return localAt(delta, h, mi);
}

/* ---------- resolve the house ---------- */

type House = typeof households.$inferSelect;

/** Bind TELEGRAM_CHAT_ID to an existing house when --reset, or when it has no group yet. Unchanged otherwise. */
async function bindChat(h: House): Promise<House> {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId || h.telegramChatId === chatId) return h;
  if (!RESET && h.telegramChatId) {
    console.log(`"${h.name}" keeps telegram chat ${h.telegramChatId} (pass --reset to rebind to TELEGRAM_CHAT_ID)`);
    return h;
  }
  const [updated] = await db.update(households).set({ telegramChatId: chatId }).where(eq(households.id, h.id)).returning();
  console.log(`bound "${h.name}" to telegram chat ${chatId}${h.telegramChatId ? ` (was ${h.telegramChatId})` : ""}`);
  return updated;
}

async function resolveHouse(): Promise<House> {
  const envId = process.env.KEVIN_HOUSEHOLD_ID;
  if (envId) {
    const [h] = await db.select().from(households).where(eq(households.id, envId));
    if (!h) throw new Error(`KEVIN_HOUSEHOLD_ID=${envId} does not exist.`);
    return bindChat(h);
  }
  const [named] = await db.select().from(households).where(eq(households.name, HOUSE_NAME)).orderBy(asc(households.createdAt)).limit(1);
  if (named) return bindChat(named);
  const [first] = await db.select().from(households).orderBy(asc(households.createdAt)).limit(1);
  if (first) return bindChat(first);
  const [created] = await db
    .insert(households)
    .values({
      name: HOUSE_NAME,
      rentCents: 250_000,
      rentDueDay: 1,
      leasingEmail: process.env.LEASING_EMAIL || "leasing@example.com",
      inboxAddress: process.env.AGENTMAIL_INBOX || null,
      telegramChatId: process.env.TELEGRAM_CHAT_ID || null,
    })
    .returning();
  console.log(`created household "${HOUSE_NAME}" ${created.id}${process.env.TELEGRAM_CHAT_ID ? "" : " (set TELEGRAM_CHAT_ID to bind your group)"}`);
  return created;
}

/**
 * Sam, Riley, Alex by name (case-insensitive, active or not). A missing one is added; an inactive one is reactivated
 * rather than duplicated. Existing rows (and telegram links) are otherwise untouched.
 */
async function resolveMembers(householdId: string) {
  const want = ["Sam", "Riley", "Alex"] as const;
  const have = await db.select().from(members).where(eq(members.householdId, householdId)).orderBy(asc(members.createdAt));
  const out = {} as Record<(typeof want)[number], string>;
  for (const name of want) {
    const same = have.filter((x) => x.name.toLowerCase() === name.toLowerCase());
    let m = same.find((x) => x.active) ?? same[0];
    if (!m) {
      [m] = await db.insert(members).values({ householdId, name }).returning();
      console.log(`added member ${name}`);
    } else if (!m.active) {
      await db.update(members).set({ active: true }).where(eq(members.id, m.id));
      console.log(`reactivated member ${m.name}`);
    }
    out[name] = m.id;
  }
  return out;
}

/* ---------- main ---------- */

const house = await resolveHouse();
const hid = house.id;
const who = await resolveMembers(hid);
const { Sam: S, Riley: R, Alex: A } = who;
const ctx: Ctx = { householdId: hid, actorId: S, source: "ui" };

const [{ n: existing }] = await db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.householdId, hid));
if (Number(existing) > 0 && !RESET) {
  console.log(`"${house.name}" (${hid}) already seeded; pass --reset to rebuild`);
  process.exit(0);
}

await db.transaction(async (tx) => {
  if (RESET) {
    const choreIds = tx.select({ id: chores.id }).from(chores).where(eq(chores.householdId, hid));
    const expenseIds = tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.householdId, hid));
    await tx.delete(choreLogs).where(inArray(choreLogs.choreId, choreIds));
    await tx.delete(chores).where(eq(chores.householdId, hid));
    await tx.delete(expenseSplits).where(inArray(expenseSplits.expenseId, expenseIds));
    await tx.delete(expenses).where(eq(expenses.householdId, hid));
    await tx.delete(settlements).where(eq(settlements.householdId, hid));
    await tx.delete(reminders).where(eq(reminders.householdId, hid));
    await tx.delete(maintenance).where(eq(maintenance.householdId, hid));
    await tx.delete(cartItems).where(eq(cartItems.householdId, hid));
    await tx.delete(chatLog).where(eq(chatLog.householdId, hid));
  }

  /* ----- money: 6 expenses + 2 settlements over 3 weeks ----- */
  type Src = "chat" | "ui" | "cart";
  const expense = async (daysAgo: number, hours: number, payerId: string, cents: number, description: string, source: Src, splits?: { memberId: string; cents: number }[]) => {
    const rows = splits ?? money.splitEvenly(cents, [S, R, A], payerId);
    const sum = rows.reduce((s, r) => s + r.cents, 0);
    if (sum !== cents) throw new Error(`${description}: splits ${sum} != ${cents}`);
    const [e] = await tx.insert(expenses).values({ householdId: hid, payerId, cents, description, source, createdAt: ago(daysAgo, hours) }).returning();
    await tx.insert(expenseSplits).values(rows.map((r) => ({ expenseId: e.id, memberId: r.memberId, cents: r.cents })));
  };
  await expense(21, 3, S, 250_000, "Rent", "ui");
  await expense(18, 5, R, 6_000, "Internet", "chat");
  await expense(15, 7, A, 8_640, "Groceries", "cart", [
    { memberId: S, cents: 3_120 },
    { memberId: R, cents: 2_960 },
    { memberId: A, cents: 2_560 },
  ]);
  await expense(9, 2, S, 4_200, "Pizza night", "chat");
  await expense(6, 6, R, 2_400, "Cleaning supplies", "ui");
  await expense(3, 4, A, 13_890, "Electricity", "chat");
  await tx.insert(settlements).values([
    { householdId: hid, fromId: A, toId: S, cents: 30_000, createdAt: ago(12, 1) },
    { householdId: hid, fromId: R, toId: S, cents: 12_000, createdAt: ago(5, 2) },
  ]);

  /* ----- chores: 4 on the chart, 18 logs. Sam 10 (last 1d), Riley 6 (last 2d), Alex 2 (last 9d). ----- */
  const chart = await tx
    .insert(chores)
    .values([
      { householdId: hid, name: "Dishes", everyDays: 1 },
      { householdId: hid, name: "Take out trash", everyDays: 3 },
      { householdId: hid, name: "Clean bathroom", everyDays: 7 },
      { householdId: hid, name: "Vacuum living room", everyDays: 7 },
    ])
    .returning();
  const chore = (name: string) => chart.find((c) => c.name === name)!.id;
  const dishes = chore("Dishes");
  const trash = chore("Take out trash");
  const bathroom = chore("Clean bathroom");
  const vacuum = chore("Vacuum living room");
  // [chore, member, daysAgo, hoursAgo on top]. Dishes yesterday (on track), bathroom 9d ago (overdue).
  const logs: [string, string, number, number][] = [
    [dishes, S, 0, 22],
    [dishes, S, 3, 1],
    [dishes, S, 5, 2],
    [dishes, S, 8, 3],
    [dishes, S, 12, 1],
    [dishes, S, 16, 2],
    [dishes, S, 19, 4],
    [dishes, R, 4, 2],
    [dishes, R, 7, 1],
    [dishes, A, 14, 3],
    [trash, R, 2, 5],
    [trash, R, 10, 4],
    [trash, R, 17, 2],
    [trash, S, 6, 1],
    [bathroom, A, 9, 6],
    [bathroom, S, 18, 5],
    [vacuum, S, 5, 4],
    [vacuum, R, 15, 3],
  ];
  await tx.insert(choreLogs).values(logs.map(([choreId, memberId, d, h]) => ({ choreId, memberId, doneAt: ago(d, h) })));

  /* ----- reminders (unsent). The monthly rent one is synced from house settings after commit. ----- */
  await tx.insert(reminders).values([
    { householdId: hid, text: "Trash goes out tonight", dueAt: nextWeekday(2, 20, 0), memberId: null },
    { householdId: hid, text: "Landlord inspection — tidy up", dueAt: localAt(5, 9, 0), memberId: null },
    { householdId: hid, text: "Venmo Sam for pizza", dueAt: localAt(1, 18, 0), memberId: A },
  ]);

  /* ----- cart (open); estimates from the price table so the seed matches what cart_add would compute ----- */
  await tx.insert(cartItems).values([
    { householdId: hid, name: "tortilla chips", qty: "3 bags", addedBy: S, shared: false, estCents: estimate("tortilla chips", "3 bags"), createdAt: ago(1, 4) },
    { householdId: hid, name: "oat milk", qty: "1", addedBy: R, shared: false, estCents: estimate("oat milk", "1"), createdAt: ago(1, 2) },
    { householdId: hid, name: "paper towels", qty: "1", addedBy: S, shared: true, estCents: estimate("paper towels", "1"), createdAt: ago(0, 20) },
    { householdId: hid, name: "eggs", qty: "1 dozen", addedBy: A, shared: false, estCents: estimate("eggs", "1 dozen"), createdAt: ago(0, 6) },
  ]);

  /* ----- group chatter, last 48h. memberId null = Kevin. ----- */
  const KEVIN = null;
  const chat: [string | null, number, string][] = [
    [R, 46, "did the electric bill come yet"],
    [A, 45.5, "paid it, $138.90. kevin split electricity 138.90"],
    [KEVIN, 45.4, "Electricity $138.90 logged, $46.30 each. Nobody cheats Kevin. 💡"],
    [S, 44, "thanks alex. bathroom's getting scary btw"],
    [R, 43.5, "that's you alex"],
    [A, 43, "lol it's on the list"],
    [S, 30, "landlord inspection friday morning, let's not look like animals"],
    [R, 29, "anyone need anything from Trader Joe's"],
    [S, 28.5, "chips, like 3 bags. we're out again"],
    [A, 28, "kevin add oat milk"],
    [KEVIN, 27.9, "Oat milk's in the cart. 🛒 Nobody cheats Kevin."],
    [R, 27.5, "paper towels too, shared"],
    [S, 22, "dishes done. you're welcome"],
    [R, 20, "trash is out"],
    [A, 5, "kevin who owes what"],
    [KEVIN, 4.9, "Riley pays Sam $747.23. Alex pays Sam $421.93. I've got a list and I'm checking it twice."],
    [A, 4.5, "ok ok, venmo tomorrow after work"],
  ];
  await tx.insert(chatLog).values(chat.map(([memberId, h, text]) => ({ householdId: hid, memberId, text, createdAt: ago(0, h) })));
});

/* ----- after commit: service calls (they use the shared db connection, so they must see committed rows) ----- */
await remindersSvc.syncRentReminder(ctx); // exactly one monthly rent reminder from house settings
await upkeep.addDefaults(ctx);
const lastDone: Record<string, Date | null> = {
  "Replace HVAC filter": ago(85), // due in 5d -> due-soon
  "Test smoke alarms": ago(200), // overdue (180)
  "Clean dryer vent": ago(40), // ok
  "Descale coffee maker": null, // never
  "Check fire extinguisher": ago(100), // ok
};
for (const [item, when] of Object.entries(lastDone)) {
  await db.update(maintenance).set({ lastDone: when }).where(and(eq(maintenance.householdId, hid), eq(maintenance.item, item)));
}

/* ---------- summary ---------- */

const count = async (table: any, where: any) => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  return Number(n);
};
const choreIdsQ = db.select({ id: chores.id }).from(chores).where(eq(chores.householdId, hid));
const counts = {
  expenses: await count(expenses, eq(expenses.householdId, hid)),
  settlements: await count(settlements, eq(settlements.householdId, hid)),
  chores: await count(chores, eq(chores.householdId, hid)),
  chore_logs: await count(choreLogs, inArray(choreLogs.choreId, choreIdsQ)),
  reminders: await count(reminders, eq(reminders.householdId, hid)),
  maintenance: await count(maintenance, eq(maintenance.householdId, hid)),
  cart_items: await count(cartItems, eq(cartItems.householdId, hid)),
  chat_log: await count(chatLog, eq(chatLog.householdId, hid)),
  emails: await count(schema.emails, eq(schema.emails.householdId, hid)),
};
const [balances, plan, shame, status, due] = await Promise.all([
  money.getBalances(ctx),
  money.getSettlePlan(ctx),
  choresSvc.hallOfShame(ctx),
  choresSvc.choreStatus(ctx),
  upkeep.dueMaintenance(ctx),
]);
const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);

console.log(`\n${RESET ? "rebuilt" : "seeded"} "${house.name}" ${hid}`);
console.log("  rows:", Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  "));
console.log("  balances:", balances.map((b) => `${b.name} ${b.cents >= 0 ? "+" : "-"}${dollars(Math.abs(b.cents))}`).join(", "));
console.log("  settle:  ", plan.length ? plan.map((t) => `${t.fromName} -> ${t.toName} ${dollars(t.cents)}`).join("; ") : "all square");
console.log("  shame:   ", shame.map((s) => `${s.name} (${s.choresThisWeek} this wk, last ${s.daysSinceLastChore ?? "never"}d)`).join(" > "));
console.log("  chores:  ", status.map((c) => `${c.name}${c.overdue ? " OVERDUE" : ""} [${c.whoseTurn}'s turn]`).join(", "));
console.log("  upkeep:  ", due.map((m) => `${m.item} (${m.status})`).join(", "));
console.log("  reminders:", (await remindersSvc.listReminders(ctx)).map((r) => `${fmt(r.dueAt)} ${r.text}${r.memberName ? ` (${r.memberName})` : ""}`).join(" | "));
process.exit(0);
