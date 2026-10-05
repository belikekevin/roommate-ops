// Integration tests for every Kevin tool against the real dev DB (no LLM involved).
// Run: npm run test:tools   (tsx --env-file=.env --test src/agent/tools/tools.dbtest.ts)
// Not named *.test.ts on purpose: `npm test` runs without .env and must not pick this up.
//
// Isolation: `before` creates a throwaway household ("Test House <ts>") with 3 members; `after` deletes every row
// that references it and asserts the DB is clean. The seeded "Apt 4B" rows are never touched.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { isValidationError } from "@mastra/core/tools";
import { db, schema } from "@/db";
import type { Ctx } from "@/services/types";
import type { Balance, Expense, Transfer } from "@/services/money";
import type { ChoreStatus, ShameRow } from "@/services/chores";
import type { Reminder } from "@/services/reminders";
import type { MaintenanceItem } from "@/services/upkeep";
import type { CartItem } from "@/services/cart";
import { makeTools, type ToolOutbox } from "./index";

type Tools = ReturnType<typeof makeTools>;
type ToolId = keyof Tools;
type ToolInput<K extends ToolId> = Parameters<NonNullable<Tools[K]["execute"]>>[0];
type AnyTool = { id: string; execute?: (input: unknown) => Promise<unknown> };

const NAMES = ["Sam", "Riley", "Alex"] as const;

let householdId: string;
let member: Record<(typeof NAMES)[number], string>;
let ctx: Ctx;
let outbox: ToolOutbox;
let tools: Tools;
const covered = new Set<string>();

/** Call a tool's execute the way the agent runtime would: Mastra validates the input and builds a synthetic context. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run<K extends ToolId>(id: K, input: ToolInput<K>): Promise<any> {
  covered.add(id);
  const tool = tools[id] as unknown as AnyTool;
  assert.ok(tool.execute, `${id} has no execute`);
  const out = await tool.execute(input);
  if (isValidationError(out)) throw new Error(`${id} rejected input: ${JSON.stringify(out)}`);
  return out;
}

type HouseTable = PgTable & { householdId: PgColumn };
const count = async (table: HouseTable) =>
  Number((await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.householdId, householdId)))[0].n);

describe("Kevin tools against the dev DB", () => {
  before(async () => {
    const [house] = await db.insert(schema.households).values({ name: `Test House ${Date.now()}` }).returning();
    householdId = house.id;
    const rows = await db
      .insert(schema.members)
      .values(NAMES.map((name) => ({ householdId, name })))
      .returning();
    member = Object.fromEntries(rows.map((r) => [r.name, r.id])) as typeof member;
    ctx = { householdId, actorId: member.Sam, source: "chat" };
    outbox = { buttons: [] };
    tools = makeTools(ctx, outbox);
  });

  after(async () => {
    try {
      if (!householdId) return;
      const choreIds = (await db.select({ id: schema.chores.id }).from(schema.chores).where(eq(schema.chores.householdId, householdId))).map((c) => c.id);
      if (choreIds.length) await db.delete(schema.choreLogs).where(inArray(schema.choreLogs.choreId, choreIds));
      await db.delete(schema.chores).where(eq(schema.chores.householdId, householdId));
      await db.delete(schema.expenses).where(eq(schema.expenses.householdId, householdId)); // expense_splits cascade
      await db.delete(schema.settlements).where(eq(schema.settlements.householdId, householdId));
      await db.delete(schema.reminders).where(eq(schema.reminders.householdId, householdId));
      await db.delete(schema.maintenance).where(eq(schema.maintenance.householdId, householdId));
      await db.delete(schema.cartItems).where(eq(schema.cartItems.householdId, householdId));
      await db.delete(schema.chatLog).where(eq(schema.chatLog.householdId, householdId));
      await db.delete(schema.emails).where(eq(schema.emails.householdId, householdId));
      await db.delete(schema.members).where(eq(schema.members.householdId, householdId));
      await db.delete(schema.households).where(eq(schema.households.id, householdId));

      // Verify nothing is left behind.
      const tables: [string, HouseTable][] = [
        ["expenses", schema.expenses],
        ["settlements", schema.settlements],
        ["reminders", schema.reminders],
        ["maintenance", schema.maintenance],
        ["cart_items", schema.cartItems],
        ["chat_log", schema.chatLog],
        ["emails", schema.emails],
        ["members", schema.members],
        ["chores", schema.chores],
      ];
      for (const [name, t] of tables) assert.equal(await count(t), 0, `leftover rows in ${name}`);
      const [orphans] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.expenseSplits)
        .leftJoin(schema.expenses, eq(schema.expenseSplits.expenseId, schema.expenses.id))
        .where(sql`${schema.expenses.id} is null`);
      assert.equal(Number(orphans.n), 0, "orphan expense_splits");
      const house = await db.select().from(schema.households).where(eq(schema.households.id, householdId));
      assert.equal(house.length, 0, "test household still exists");
    } finally {
      await db.$client.end();
    }
  });

  // ---------- members ----------

  test("list_members returns the 3 test roommates", async () => {
    const names: string[] = await run("list_members", {});
    assert.deepEqual([...names].sort(), [...NAMES].sort());
  });

  test("unknown roommate name throws a helpful error listing the roommates", async () => {
    await assert.rejects(run("log_expense", { amount: 10, description: "pizza", payer: "Buzz" }), /No roommate named "Buzz".*Sam/);
    await assert.rejects(run("log_chore", { chore: "dishes", who: "Marv" }), /No roommate named "Marv"/);
    await assert.rejects(run("set_reminder", { text: "x", dueAt: new Date().toISOString(), who: "Harry" }), /No roommate named "Harry"/);
  });

  test("schema validation: negative dollars never reach the service", async () => {
    const tool = tools.log_expense as unknown as AnyTool;
    const out = await tool.execute!({ amount: -5, description: "nope" });
    assert.ok(isValidationError(out), "expected a ValidationError object");
    assert.equal(await count(schema.expenses), 0);
  });

  // ---------- money ----------

  test("log_expense: '$60 internet' -> 6000 cents, 3 even splits, payer = sender", async () => {
    const e: Expense = await run("log_expense", { amount: 60, description: "internet" });
    assert.equal(e.cents, 6000);
    assert.equal(e.payerName, "Sam");
    assert.equal(e.splits?.length, 3);
    for (const s of e.splits ?? []) assert.equal(s.cents, 2000);

    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id));
    assert.equal(row.cents, 6000);
    assert.equal(row.payerId, member.Sam);
    assert.equal(row.source, "chat");
    const splits = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, e.id));
    assert.equal(splits.length, 3);
    assert.equal(splits.reduce((s, r) => s + r.cents, 0), 6000);
  });

  test("log_expense: payer by name, split among a subset, odd cent goes to the payer", async () => {
    const e: Expense = await run("log_expense", { amount: 10.01, description: "beer", payer: "Riley", splitAmong: ["Riley", "Alex"] });
    assert.equal(e.cents, 1001);
    assert.equal(e.payerName, "Riley");
    const by = Object.fromEntries((e.splits ?? []).map((s) => [s.name, s.cents]));
    assert.deepEqual(by, { Riley: 501, Alex: 500 });
  });

  test("get_balances: who owes what + settle plan (cents, nets to zero)", async () => {
    const { balances, settlePlan }: { balances: Balance[]; settlePlan: Transfer[] } = await run("get_balances", {});
    const by = Object.fromEntries(balances.map((b) => [b.name, b.cents]));
    // internet: S +4000, R -2000, A -2000. beer: R +500, A -500.
    assert.deepEqual(by, { Sam: 4000, Riley: -1500, Alex: -2500 });
    assert.equal(balances.reduce((s, b) => s + b.cents, 0), 0);
    assert.equal(settlePlan.reduce((s, t) => s + t.cents, 0), 4000);
    for (const t of settlePlan) assert.equal(t.toName, "Sam");
    assert.equal(settlePlan[0].fromName, "Alex", "biggest debtor pays first");
  });

  test("settle_up: 'Alex paid Sam back $25' zeroes Alex", async () => {
    const r = await run("settle_up", { to: "Sam", amount: 25, from: "Alex" });
    assert.deepEqual(r, { ok: true });
    const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, householdId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cents, 2500);
    assert.equal(rows[0].fromId, member.Alex);
    assert.equal(rows[0].toId, member.Sam);
    const { balances }: { balances: Balance[] } = await run("get_balances", {});
    assert.equal(balances.find((b) => b.name === "Alex")?.cents, 0);
    assert.equal(balances.find((b) => b.name === "Sam")?.cents, 1500);
  });

  test("settle_up: default payer is the sender; paying yourself is rejected", async () => {
    await assert.rejects(run("settle_up", { to: "Sam", amount: 1 }), /yourself/);
    await run("settle_up", { to: "Riley", amount: 1 });
    const mine = await db.select().from(schema.settlements).where(eq(schema.settlements.fromId, member.Sam));
    assert.equal(mine.length, 1);
    assert.equal(mine[0].cents, 100);
    assert.equal(mine[0].toId, member.Riley);
  });

  test("list_expenses: newest first with splits; limit respected", async () => {
    const list: Expense[] = await run("list_expenses", {});
    assert.equal(list.length, 2);
    assert.equal(list[0].description, "beer");
    assert.equal(list[1].description, "internet");
    assert.equal(list[1].splits?.length, 3);
    const one: Expense[] = await run("list_expenses", { limit: 1 });
    assert.equal(one.length, 1);
  });

  // ---------- chores ----------

  test("add_chore puts chores on the chart; same name again updates the cadence", async () => {
    assert.deepEqual(await run("add_chore", { name: "Dishes", everyDays: 1 }), { ok: true, chore: "Dishes", everyDays: 1 });
    await run("add_chore", { name: "Take out trash", everyDays: 3 });
    await run("add_chore", { name: "take out trash", everyDays: 2 });
    const chart = await db.select().from(schema.chores).where(eq(schema.chores.householdId, householdId));
    assert.deepEqual(
      chart.map((c) => [c.name, c.everyDays]).sort(),
      [
        ["Dishes", 1],
        ["Take out trash", 2],
      ],
    );
  });

  test("log_chore: 'the dishes' fuzzy-matches Dishes for the sender; 'trash' for Alex by name", async () => {
    const r: { chore: string; streak: number } = await run("log_chore", { chore: "the dishes" });
    assert.equal(r.chore, "Dishes");
    assert.equal(r.streak, 1);
    const r2: { chore: string; streak: number } = await run("log_chore", { chore: "the dishes" });
    assert.equal(r2.streak, 2, "two in a row by the same person");
    const r3: { chore: string; streak: number } = await run("log_chore", { chore: "trash", who: "Alex" });
    assert.equal(r3.chore, "Take out trash");

    const logs = await db
      .select({ memberId: schema.choreLogs.memberId, name: schema.chores.name })
      .from(schema.choreLogs)
      .innerJoin(schema.chores, eq(schema.choreLogs.choreId, schema.chores.id))
      .where(eq(schema.chores.householdId, householdId));
    assert.equal(logs.length, 3);
    assert.equal(logs.filter((l) => l.memberId === member.Sam && l.name === "Dishes").length, 2);
    assert.equal(logs.filter((l) => l.memberId === member.Alex && l.name === "Take out trash").length, 1);
    assert.equal((await db.select().from(schema.chores).where(eq(schema.chores.householdId, householdId))).length, 2, "no new chore was created");
  });

  test("log_chore: an unknown chore is added to the chart (every 7 days)", async () => {
    const r: { chore: string } = await run("log_chore", { chore: "watered the plants" });
    assert.equal(r.chore, "watered the plants");
    const [c] = await db
      .select()
      .from(schema.chores)
      .where(and(eq(schema.chores.householdId, householdId), eq(schema.chores.name, "watered the plants")));
    assert.equal(c.householdId, householdId);
    assert.equal(c.everyDays, 7);
  });

  test("chore_status: last done by, whose turn, Hall of Shame worst first", async () => {
    const { chores, shame }: { chores: ChoreStatus[]; shame: ShameRow[] } = await run("chore_status", {});
    const dishes = chores.find((c) => c.name === "Dishes");
    assert.equal(dishes?.lastDoneBy, "Sam");
    assert.equal(dishes?.overdue, false);
    assert.ok(dishes?.whoseTurn === "Alex" || dishes?.whoseTurn === "Riley", "someone who hasn't done dishes is up next");
    const trash = chores.find((c) => c.name === "Take out trash");
    assert.equal(trash?.lastDoneBy, "Alex");
    // Riley did nothing -> worst. Then Alex (1) before Sam (3).
    assert.deepEqual(
      shame.map((s) => s.name),
      ["Riley", "Alex", "Sam"],
    );
    assert.equal(shame[0].daysSinceLastChore, null);
    assert.equal(shame[0].choresThisWeek, 0);
    assert.equal(shame[2].choresThisWeek, 3);
  });

  // ---------- reminders ----------

  let trashReminderId: string;

  test("set_reminder: for Riley by name; monthly for everyone", async () => {
    const due = new Date(Date.now() + 3 * 24 * 3600_000);
    const r: Reminder = await run("set_reminder", { text: "Trash goes out at 8pm", dueAt: due.toISOString(), who: "Riley" });
    trashReminderId = r.id;
    assert.equal(r.memberName, "Riley");
    assert.equal(r.memberId, member.Riley);
    assert.equal(r.recurring, null);
    assert.equal(r.dueAt.getTime(), due.getTime());

    const rent: Reminder = await run("set_reminder", { text: "Rent is due", dueAt: due.toISOString(), monthly: true });
    assert.equal(rent.memberId, null);
    assert.equal(rent.recurring, "monthly");

    const rows = await db.select().from(schema.reminders).where(eq(schema.reminders.householdId, householdId));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.sentAt === null));
  });

  test("set_reminder: bad date is rejected by the service", async () => {
    await assert.rejects(run("set_reminder", { text: "x", dueAt: "next tuesday-ish" }), /not a real date/);
  });

  test("list_reminders: upcoming, soonest first", async () => {
    const list: Reminder[] = await run("list_reminders", {});
    assert.deepEqual(list.map((r) => r.text).sort(), ["Rent is due", "Trash goes out at 8pm"]);
    assert.equal(list.find((r) => r.id === trashReminderId)?.memberName, "Riley");
  });

  test("cancel_reminder: by text, then by id; unknown throws with the list", async () => {
    const c: { id: string; cancelled: string } = await run("cancel_reminder", { text: "trash goes" });
    assert.equal(c.id, trashReminderId);
    const left: Reminder[] = await run("list_reminders", {});
    assert.equal(left.length, 1);
    await assert.rejects(run("cancel_reminder", { text: "nothing like this" }), /No upcoming reminder matches.*Rent is due/);
    await run("cancel_reminder", { reminderId: left[0].id });
    assert.equal(await count(schema.reminders), 0);
    await assert.rejects(run("cancel_reminder", { text: "rent" }), /no upcoming reminders/);
  });

  // ---------- upkeep ----------

  test("add_maintenance + maintenance_status: never done = overdue", async () => {
    assert.deepEqual(await run("add_maintenance", { item: "Replace HVAC filter", everyDays: 90 }), { ok: true });
    await run("add_maintenance", { item: "Test smoke alarms", everyDays: 180 });
    const all: MaintenanceItem[] = await run("maintenance_status", {});
    assert.deepEqual(all.map((m) => [m.item, m.status]).sort(), [
      ["Replace HVAC filter", "overdue"],
      ["Test smoke alarms", "overdue"],
    ]);
    const due: MaintenanceItem[] = await run("maintenance_status", { dueOnly: true });
    assert.equal(due.length, 2);
  });

  test("maintenance_done: fuzzy 'hvac filter' marks it done; unknown item throws with known items", async () => {
    await run("maintenance_done", { item: "hvac filter" });
    const [row] = await db
      .select()
      .from(schema.maintenance)
      .where(and(eq(schema.maintenance.householdId, householdId), eq(schema.maintenance.item, "Replace HVAC filter")));
    assert.ok(row.lastDone && Date.now() - row.lastDone.getTime() < 60_000, "lastDone set to now");
    const due: MaintenanceItem[] = await run("maintenance_status", { dueOnly: true });
    assert.deepEqual(
      due.map((m) => m.item),
      ["Test smoke alarms"],
    );
    const all: MaintenanceItem[] = await run("maintenance_status", {});
    const hvac = all.find((m) => m.item === "Replace HVAC filter");
    assert.equal(hvac?.status, "ok");
    assert.ok(hvac?.nextDue && hvac.nextDue.getTime() - row.lastDone!.getTime() === 90 * 86_400_000);
    await assert.rejects(run("maintenance_done", { item: "gutters" }), /No upkeep item matches "gutters".*Replace HVAC filter/);
  });

  // ---------- report ----------

  test("kevin_report: ready-to-post text built from every card", async () => {
    const r: { text: string } = await run("kevin_report", {});
    assert.equal(typeof r.text, "string");
    assert.match(r.text, /The Kevin Report/);
    assert.match(r.text, /Riley pays Sam \$16\.00/, "settle plan from the ledger (1500 + the $1 Sam sent Riley)");
    assert.match(r.text, /Chores on track/);
    assert.match(r.text, /Wet Bandits watchlist: Riley/);
    assert.match(r.text, /Nothing scheduled/);
    assert.match(r.text, /Overdue upkeep: Test smoke alarms/);
    assert.doesNotMatch(r.text, /Replace HVAC filter/);
    assert.ok(r.text.split("\n").length <= 12, "stays short");
  });

  // ---------- leasing (never sends real mail) ----------

  test("create_work_order / email_leasing throw the configured error when AGENTMAIL_API_KEY is unset", async () => {
    const saved = process.env.AGENTMAIL_API_KEY;
    process.env.AGENTMAIL_API_KEY = "";
    try {
      await assert.rejects(run("create_work_order", { issue: "the sink is leaking", location: "kitchen", urgency: "urgent" }), /AGENTMAIL_API_KEY/);
      await assert.rejects(run("email_leasing", { subject: "Parking", body: "Can we get a second spot?" }), /AGENTMAIL_API_KEY/);
    } finally {
      if (saved === undefined) delete process.env.AGENTMAIL_API_KEY;
      else process.env.AGENTMAIL_API_KEY = saved;
    }
    assert.equal(await count(schema.emails), 0, "nothing logged to emails");
  });

  // Inbox buttons only exist with an absolute APP_URL (Telegram drops a reply whose button URL is relative).
  const inboxBase = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  const expectInboxButton = (threadId?: string) => {
    if (!/^https?:\/\//i.test(inboxBase)) return assert.equal(outbox.buttons.length, 0, "no APP_URL -> no button (never a relative URL)");
    assert.equal(outbox.buttons.length, 1);
    assert.equal(outbox.buttons[0].url, `${inboxBase}/inbox${threadId ? `?thread=${encodeURIComponent(threadId)}` : ""}`);
    assert.match(outbox.buttons[0].url, /^https?:\/\/[^/]+\/inbox/, "absolute, single slash before /inbox");
  };

  test("leasing_status: { threads: [] } without AGENTMAIL_API_KEY; with it, a threads array + the inbox button", async (t) => {
    const saved = process.env.AGENTMAIL_API_KEY;
    process.env.AGENTMAIL_API_KEY = "";
    try {
      outbox.buttons.length = 0;
      assert.deepEqual(await run("leasing_status", {}), { threads: [] });
      expectInboxButton();
    } finally {
      if (saved === undefined) delete process.env.AGENTMAIL_API_KEY;
      else process.env.AGENTMAIL_API_KEY = saved;
    }
    if (!process.env.AGENTMAIL_API_KEY) return t.skip("AGENTMAIL_API_KEY not set; live status not checked");
    // The throwaway house has no inboxAddress, so addresses() falls back to AGENTMAIL_INBOX (may be empty -> []).
    outbox.buttons.length = 0;
    const r: { threads: { threadId: string; lastFrom: "kevin" | "office"; unread: boolean; messageCount: number }[] } = await run("leasing_status", {});
    assert.ok(Array.isArray(r.threads));
    for (const th of r.threads) {
      assert.ok(th.lastFrom === "kevin" || th.lastFrom === "office");
      assert.equal(typeof th.unread, "boolean");
      assert.ok(th.messageCount >= 1);
    }
    expectInboxButton(r.threads[0]?.threadId);
    assert.equal(await count(schema.emails), 0, "status is read-only");
  });

  // ---------- cart (simulated store: estimates from lib/prices, checkout at /cart/checkout) ----------

  type CartAdd = { items: CartItem[]; addedTotalCents: number; addedTotal: string; cartItemCount: number; cartTotalCents: number; cartTotal: string };
  type CartView = { groups: Record<string, CartItem[]>; itemCount: number; estTotalCents: number; estTotal: string };
  const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");

  test("cart_add: '3 bags of chips for me' + a shared item; estimates from the catalog; buttons attached", async () => {
    outbox.buttons.length = 0;
    const added: CartAdd = await run("cart_add", { items: [{ name: "chips", qty: "3 bags" }] });
    assert.equal(added.items.length, 1);
    assert.equal(added.items[0].name, "chips");
    assert.equal(added.items[0].qty, "3 bags");
    assert.equal(added.items[0].addedByName, "Sam");
    assert.equal(added.items[0].estCents, 3 * 449, "3 x catalog price of chips");
    assert.equal(added.addedTotalCents, 3 * 449, "total of the items just added");
    assert.equal(added.addedTotal, "$13.47");
    assert.equal(added.cartTotalCents, 3 * 449, "first add into an empty cart: cart total = added total");
    assert.equal(added.cartItemCount, 1);
    if (appUrl) {
      assert.deepEqual(
        outbox.buttons.map((b) => b.url).sort(),
        [`${appUrl}/cart`, `${appUrl}/cart/checkout`].sort(),
        "View cart + Checkout buttons",
      );
      assert.ok(outbox.buttons.some((b) => /view cart/i.test(b.text)));
      assert.ok(outbox.buttons.some((b) => /checkout/i.test(b.text)));
    } else {
      assert.equal(outbox.buttons.length, 0, "no APP_URL -> no buttons");
    }

    const second: CartAdd = await run("cart_add", { items: [{ name: "dish soap" }], shared: true });
    assert.equal(second.addedTotalCents, 349, "addedTotal is only the new item");
    assert.equal(second.cartTotalCents, 1347 + 349, "cartTotal is the whole open cart");
    assert.equal(second.cartItemCount, 2);
    const rows = await db.select().from(schema.cartItems).where(eq(schema.cartItems.householdId, householdId));
    assert.equal(rows.length, 2);
    const chips = rows.find((r) => r.name === "chips");
    assert.equal(chips?.qty, "3 bags");
    assert.equal(chips?.addedBy, member.Sam);
    assert.equal(chips?.shared, false);
    assert.equal(chips?.status, "open");
    assert.equal(chips?.estCents, 1347);
    const soap = rows.find((r) => r.name === "dish soap");
    assert.equal(soap?.shared, true);
    assert.equal(soap?.qty, "1");
    assert.equal(soap?.estCents, 349);
  });

  test("cart_view groups open items by who added them, with the estimated total", async () => {
    const view: CartView = await run("cart_view", {});
    const all = Object.values(view.groups).flat();
    assert.deepEqual(all.map((i) => i.name).sort(), ["chips", "dish soap"]);
    assert.ok(Object.keys(view.groups).some((k) => k === "Sam"), "a group for the sender");
    assert.ok(Object.keys(view.groups).some((k) => /shared/i.test(k)), "a Shared group");
    assert.equal(view.groups.Shared?.[0]?.name, "dish soap");
    assert.equal(view.itemCount, 2);
    assert.equal(view.estTotalCents, 1347 + 349);
    assert.equal(view.estTotal, "$16.96");
  });

  test("cart_remove by name", async () => {
    await run("cart_add", { items: [{ name: "oat milk", qty: "2" }] });
    assert.deepEqual(await run("cart_remove", { name: "Oat Milk" }), { removed: true });
    assert.deepEqual(await run("cart_remove", { name: "caviar" }), { removed: false });
    const open = await db.select().from(schema.cartItems).where(eq(schema.cartItems.householdId, householdId));
    assert.deepEqual(open.filter((r) => r.status === "open").map((r) => r.name).sort(), ["chips", "dish soap"]);
  });

  test("cart_checkout links to the simulated store and attaches the Checkout button via the outbox", async (t) => {
    outbox.buttons.length = 0;
    const r: { itemCount: number; linkAttached: boolean; url?: unknown } = await run("cart_checkout", {});
    assert.equal(r.itemCount, 2);
    assert.ok(!("url" in r), "no url in the tool result: the model must not paste links, the button carries it");
    if (r.linkAttached) {
      assert.equal(outbox.buttons.length, 1);
      assert.equal(outbox.buttons[0].text, "Checkout");
      assert.equal(outbox.buttons[0].url, `${appUrl}/cart/checkout`, "our own checkout page, never a third-party store");
      assert.match(outbox.buttons[0].url ?? "", /^https?:\/\//);
      await run("cart_checkout", {});
      assert.equal(outbox.buttons.length, 1, "calling it twice does not duplicate the button");
    } else {
      assert.equal(outbox.buttons.length, 0);
      t.diagnostic("APP_URL not set; checkout button not attached");
    }
  });

  test("cart_purchased: one expense split by who added what (shared split evenly), items marked purchased", async () => {
    const before = await count(schema.expenses);
    const e: Expense = await run("cart_purchased", { total: 30 });
    assert.equal(e.cents, 3000);
    assert.equal(e.payerName, "Sam");
    assert.match(e.description, /Groceries \(2 items\)/);
    assert.equal(await count(schema.expenses), before + 1);
    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id));
    assert.equal(row.source, "cart");
    const splits = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, e.id));
    assert.equal(splits.reduce((s, r) => s + r.cents, 0), 3000);
    assert.equal(splits.length, 3, "chips -> Sam, dish soap -> everyone");
    const cents = Object.fromEntries(splits.map((s) => [s.memberId, s.cents]));
    // weights: Sam 1347 + 349/3, Riley 349/3, Alex 349/3 (of 1696), scaled to 3000.
    assert.ok(cents[member.Sam] >= 2588 && cents[member.Sam] <= 2590, `Sam got ${cents[member.Sam]}`);
    assert.ok(Math.abs(cents[member.Riley] - cents[member.Alex]) <= 1, "shared item split evenly");
    assert.ok(cents[member.Riley] >= 205 && cents[member.Riley] <= 206);
    const items = await db.select().from(schema.cartItems).where(eq(schema.cartItems.householdId, householdId));
    assert.ok(items.filter((r) => r.name !== "oat milk").every((r) => r.status === "purchased"), "cart items marked purchased");
    const view: CartView = await run("cart_view", {});
    assert.deepEqual(view.groups, {});
    assert.equal(view.estTotalCents, 0);
  });

  test("cart_purchased: payer by name; people with nothing in the cart are left out of the split; empty cart throws", async () => {
    await run("cart_add", { items: [{ name: "milk" }] });
    const e: Expense = await run("cart_purchased", { total: 5, payer: "Riley" });
    assert.equal(e.payerName, "Riley");
    assert.equal(e.cents, 500);
    assert.deepEqual(
      (e.splits ?? []).map((s) => [s.name, s.cents]),
      [["Sam", 500]],
      "Sam's milk, paid by Riley: only Sam owes",
    );
    await assert.rejects(run("cart_purchased", { total: 5 }), /cart is empty/i);
    await assert.rejects(run("cart_purchased", { total: 5, payer: "Buzz" }), /No roommate named "Buzz"/);
  });

  test("cart_purchased: a double-click charges once; a failed purchase leaves the items open", async () => {
    await run("cart_add", { items: [{ name: "bread" }] });
    const before = await count(schema.expenses);
    const [first, second] = await Promise.allSettled([run("cart_purchased", { total: 4 }), run("cart_purchased", { total: 4 })]);
    const ok = [first, second].filter((r) => r.status === "fulfilled");
    const failed = [first, second].filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1, "exactly one of two concurrent purchases wins");
    assert.equal(failed.length, 1);
    assert.match(String((failed[0] as PromiseRejectedResult).reason), /cart is empty/i);
    assert.equal(await count(schema.expenses), before + 1, "one expense, not two");
    // A purchase whose expense can't be logged (payer not an active roommate) must roll the items back to open.
    await run("cart_add", { items: [{ name: "bagels" }] });
    const cartService = await import("@/services/cart");
    await assert.rejects(cartService.markPurchased({ ...ctx, actorId: "00000000-0000-0000-0000-000000000000" }, { totalCents: 400 }), /who paid/i);
    const open = await db.select().from(schema.cartItems).where(eq(schema.cartItems.householdId, householdId));
    assert.deepEqual(open.filter((r) => r.status === "open").map((r) => r.name), ["bagels"], "items stay open after a failed purchase");
    assert.equal(await count(schema.expenses), before + 1);
    await run("cart_purchased", { total: 4 });
  });

  // ---------- coverage ----------

  test("every tool makeTools exposes was exercised", () => {
    const all = Object.keys(tools).sort();
    const missing = all.filter((id) => !covered.has(id));
    assert.deepEqual(missing, [], `tools without a test: ${missing.join(", ")}`);
    for (const id of all) assert.equal((tools as unknown as Record<string, AnyTool>)[id].id, id, `key ${id} must equal its tool id`);
  });
});
