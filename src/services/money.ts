// Money: expenses, splits, balances, settling up. Integer cents everywhere.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { listMembers } from "./members";
import { dollars, type Ctx } from "./types";

const { expenses, expenseSplits, settlements, members } = schema;

export type Balance = { memberId: string; name: string; cents: number }; // + = is owed, - = owes
export type Transfer = { fromId: string; fromName: string; toId: string; toName: string; cents: number };
export type ExpenseSplit = { memberId: string; name: string; cents: number };
export type Expense = {
  id: string;
  payerName: string;
  cents: number;
  description: string;
  createdAt: Date;
  payerId?: string;
  splits?: ExpenseSplit[];
};
export type SplitRow = { memberId: string; cents: number };

/* ---------- pure helpers (unit-tested in money.test.ts) ---------- */

/**
 * Split `total` cents evenly across `memberIds`. Leftover cents (total mod n) go one each,
 * starting with the payer if they're a participant, then the rest in the given order.
 * Example: 1000 across [a, b, c] with payer b -> b 334, a 333, c 333.
 */
export function splitEvenly(total: number, memberIds: string[], payerId?: string): SplitRow[] {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return [];
  const base = Math.floor(total / ids.length);
  let remainder = total - base * ids.length;
  const order = payerId && ids.includes(payerId) ? [payerId, ...ids.filter((id) => id !== payerId)] : ids;
  const extra = new Map<string, number>();
  for (const id of order) {
    if (remainder <= 0) break;
    extra.set(id, 1);
    remainder -= 1;
  }
  return ids.map((memberId) => ({ memberId, cents: base + (extra.get(memberId) ?? 0) }));
}

/**
 * Minimal-ish set of transfers that zeroes all balances. Greedy: the biggest debtor pays the
 * biggest creditor min(debt, credit), repeat. Balances are integer cents, so "< 1 cent" means zero
 * and is skipped. Ties break by name so the output is deterministic.
 */
export function computeSettlePlan(balances: Balance[]): Transfer[] {
  const byName = (a: Balance, b: Balance) => a.name.localeCompare(b.name);
  const debtors = balances
    .filter((b) => b.cents <= -1)
    .map((b) => ({ ...b, cents: -b.cents }))
    .sort((a, b) => b.cents - a.cents || byName(a, b));
  const creditors = balances
    .filter((b) => b.cents >= 1)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.cents - a.cents || byName(a, b));

  const plan: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const cents = Math.min(d.cents, c.cents);
    plan.push({ fromId: d.memberId, fromName: d.name, toId: c.memberId, toName: c.name, cents });
    d.cents -= cents;
    c.cents -= cents;
    if (d.cents === 0) i++;
    if (c.cents === 0) j++;
    // Re-sort the remaining tails so we always pair the current biggest with the current biggest.
    // (Each side is already sorted and only its head shrank, so a bubble-down is enough.)
    bubbleDown(debtors, i);
    bubbleDown(creditors, j);
  }
  return plan;
}

function bubbleDown(arr: { cents: number; name: string }[], from: number) {
  for (let k = from; k + 1 < arr.length && arr[k].cents < arr[k + 1].cents; k++) {
    [arr[k], arr[k + 1]] = [arr[k + 1], arr[k]];
  }
}

/* ---------- services ---------- */

function assertWholeCents(cents: number, what = "Amount") {
  if (!Number.isInteger(cents)) throw new Error(`${what} must be whole cents (got ${cents}).`);
  if (cents <= 0) throw new Error(`${what} must be more than $0.00.`);
}

/**
 * Record a shared expense. payerId defaults to ctx.actorId.
 * - `splits` (explicit rows) wins when provided; they must sum to `cents`. cart.ts uses this for weighted splits.
 * - Otherwise `splitAmong` (member ids; default = everyone active) is split evenly, remainder cents to the payer first.
 */
export async function logExpense(
  ctx: Ctx,
  input: { payerId?: string; cents: number; description: string; splitAmong?: string[]; splits?: SplitRow[]; source?: "ui" | "chat" | "cart" },
): Promise<Expense> {
  assertWholeCents(input.cents);
  const description = input.description?.trim();
  if (!description) throw new Error("What was it for? Give the expense a description.");

  const people = await listMembers(ctx);
  const byId = new Map(people.map((m) => [m.id, m]));
  const payerId = input.payerId ?? ctx.actorId;
  const payer = byId.get(payerId);
  if (!payer) throw new Error("I don't know who paid. The payer isn't an active roommate in this house.");

  let rows: SplitRow[];
  if (input.splits) {
    rows = input.splits;
    if (rows.length === 0) throw new Error("Splits can't be empty. Who shares this?");
    const seen = new Set<string>();
    for (const r of rows) {
      if (!byId.has(r.memberId)) throw new Error(`Can't split with ${r.memberId}: not an active roommate here.`);
      if (seen.has(r.memberId)) throw new Error(`${byId.get(r.memberId)!.name} appears twice in the split.`);
      seen.add(r.memberId);
      if (!Number.isInteger(r.cents) || r.cents < 0) throw new Error(`Bad split for ${byId.get(r.memberId)!.name}: ${r.cents} cents.`);
    }
    const sum = rows.reduce((s, r) => s + r.cents, 0);
    if (sum !== input.cents) {
      throw new Error(`Splits add up to ${dollars(sum)} but the expense is ${dollars(input.cents)}. They have to match.`);
    }
  } else {
    const among = input.splitAmong ?? people.map((m) => m.id);
    if (among.length === 0) throw new Error("Nobody to split with. Add some roommates first.");
    const unknown = among.find((id) => !byId.has(id));
    if (unknown) throw new Error(`Can't split with ${unknown}: not an active roommate here.`);
    rows = splitEvenly(input.cents, among, payerId);
  }

  const source = input.source ?? (ctx.source === "ui" ? "ui" : "chat");
  const created = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(expenses)
      .values({ householdId: ctx.householdId, payerId, cents: input.cents, description, source })
      .returning();
    await tx.insert(expenseSplits).values(rows.map((r) => ({ expenseId: e.id, memberId: r.memberId, cents: r.cents })));
    return e;
  });

  return {
    id: created.id,
    payerId,
    payerName: payer.name,
    cents: created.cents,
    description: created.description,
    createdAt: created.createdAt,
    splits: rows.map((r) => ({ memberId: r.memberId, name: byId.get(r.memberId)!.name, cents: r.cents })),
  };
}

/**
 * Per active member: paid − owed + settlements sent − settlements received. Positive = is owed.
 * Zero balances are included. Sorted by balance descending (biggest creditor first), then by name,
 * so the people who are owed money sit at the top of the card.
 */
export async function getBalances(ctx: Pick<Ctx, "householdId">): Promise<Balance[]> {
  const hid = ctx.householdId;
  const total = sql<number>`coalesce(sum(${expenses.cents}), 0)::int`;
  const [people, paid, owed, sent, received, everyone] = await Promise.all([
    listMembers(ctx),
    db.select({ id: expenses.payerId, cents: total }).from(expenses).where(eq(expenses.householdId, hid)).groupBy(expenses.payerId),
    db
      .select({ id: expenseSplits.memberId, cents: sql<number>`coalesce(sum(${expenseSplits.cents}), 0)::int` })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
      .where(eq(expenses.householdId, hid))
      .groupBy(expenseSplits.memberId),
    db
      .select({ id: settlements.fromId, cents: sql<number>`coalesce(sum(${settlements.cents}), 0)::int` })
      .from(settlements)
      .where(eq(settlements.householdId, hid))
      .groupBy(settlements.fromId),
    db
      .select({ id: settlements.toId, cents: sql<number>`coalesce(sum(${settlements.cents}), 0)::int` })
      .from(settlements)
      .where(eq(settlements.householdId, hid))
      .groupBy(settlements.toId),
    db.select({ id: schema.members.id, name: schema.members.name, active: schema.members.active }).from(schema.members).where(eq(schema.members.householdId, hid)),
  ]);

  const tally = new Map<string, number>();
  const add = (rows: { id: string; cents: number }[], sign: 1 | -1) => {
    for (const r of rows) tally.set(r.id, (tally.get(r.id) ?? 0) + sign * Number(r.cents));
  };
  add(paid, 1);
  add(owed, -1);
  add(sent, 1);
  add(received, -1);

  // Removed roommates stay in the ledger while they still owe or are owed, so balances always net to zero.
  const movedOut = everyone
    .filter((m) => !m.active && (tally.get(m.id) ?? 0) !== 0)
    .map((m) => ({ memberId: m.id, name: `${m.name} (moved out)`, cents: tally.get(m.id) ?? 0 }));
  return [...people.map((m) => ({ memberId: m.id, name: m.name, cents: tally.get(m.id) ?? 0 })), ...movedOut]
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

export async function getSettlePlan(ctx: Pick<Ctx, "householdId">): Promise<Transfer[]> {
  return computeSettlePlan(await getBalances(ctx));
}

/** Record that `from` paid `to` back. fromId defaults to ctx.actorId. */
export async function settleUp(ctx: Ctx, input: { fromId?: string; toId: string; cents: number }): Promise<void> {
  assertWholeCents(input.cents, "Payment");
  const fromId = input.fromId ?? ctx.actorId;
  if (fromId === input.toId) throw new Error("Paying yourself back doesn't count.");
  const people = await listMembers(ctx);
  const ids = new Set(people.map((m) => m.id));
  if (!ids.has(fromId)) throw new Error("The payer isn't an active roommate in this house.");
  if (!ids.has(input.toId)) throw new Error("The person being paid isn't an active roommate in this house.");
  await db.insert(settlements).values({ householdId: ctx.householdId, fromId, toId: input.toId, cents: input.cents });
}

/** Newest first, with payer name and per-person splits. */
export async function listExpenses(ctx: Pick<Ctx, "householdId">, limit = 50): Promise<Expense[]> {
  const rows = await db
    .select({
      id: expenses.id,
      payerId: expenses.payerId,
      payerName: members.name,
      cents: expenses.cents,
      description: expenses.description,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(members, eq(expenses.payerId, members.id))
    .where(eq(expenses.householdId, ctx.householdId))
    .orderBy(desc(expenses.createdAt), desc(expenses.id))
    .limit(limit);
  if (rows.length === 0) return [];

  const splitRows = await db
    .select({ expenseId: expenseSplits.expenseId, memberId: expenseSplits.memberId, name: members.name, cents: expenseSplits.cents })
    .from(expenseSplits)
    .innerJoin(members, eq(expenseSplits.memberId, members.id))
    .where(and(inArray(expenseSplits.expenseId, rows.map((r) => r.id))));
  const splitsByExpense = new Map<string, ExpenseSplit[]>();
  for (const s of splitRows) {
    const list = splitsByExpense.get(s.expenseId) ?? [];
    list.push({ memberId: s.memberId, name: s.name, cents: s.cents });
    splitsByExpense.set(s.expenseId, list);
  }
  return rows.map((r) => ({ ...r, splits: splitsByExpense.get(r.id) ?? [] }));
}
