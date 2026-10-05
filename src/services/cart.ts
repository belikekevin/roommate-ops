// Shared grocery cart. Items are attributed to whoever added them; purchase logs ONE expense split by who
// added what (weighted by estCents, shared items split evenly across active roommates).
// computeCartSplits and cartTotal are pure and unit-tested in cart.test.ts without a DB.
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { estimate } from "@/lib/prices";
import { checkoutUrl } from "@/lib/store";
import { listMembers } from "./members";
import { logExpense, type Expense, type SplitRow } from "./money";
import type { Ctx } from "./types";

const { cartItems, members } = schema;

export type CartItem = {
  id: string;
  name: string;
  qty: string;
  addedByName: string;
  shared: boolean;
  estCents: number | null;
  addedBy?: string;
  createdAt?: Date;
};

/** The bits of an item the split needs. */
export type SplitItem = { addedBy: string; shared: boolean; estCents: number | null };

/* ---------- pure helpers ---------- */

/** Sum of estimates (unknown = 0). */
export function cartTotal(items: { estCents: number | null }[]): number {
  return items.reduce((s, i) => s + (i.estCents ?? 0), 0);
}

/**
 * Split `totalCents` across people by what they put in the cart:
 *  - each person's own items weigh their estCents;
 *  - shared items (and items added by someone no longer active) are weighed evenly across `activeMemberIds`;
 *  - weights scale to totalCents; rounding remainder cents go one each, payer first, then by largest leftover fraction.
 * Members with zero weight are omitted. Rows always sum to exactly totalCents. If no item has an estimate, each
 * item counts 1 so the split is by item count.
 */
export function computeCartSplits(items: SplitItem[], activeMemberIds: string[], totalCents: number, payerId?: string): SplitRow[] {
  const active = [...new Set(activeMemberIds)];
  if (active.length === 0 || items.length === 0) return [];
  const activeSet = new Set(active);
  const noEstimates = items.every((i) => !((i.estCents ?? 0) > 0));
  const weightOf = (i: SplitItem) => (noEstimates ? 1 : Math.max(0, i.estCents ?? 0));

  const weight = new Map<string, number>();
  const bump = (id: string, w: number) => weight.set(id, (weight.get(id) ?? 0) + w);
  for (const i of items) {
    const w = weightOf(i);
    if (w <= 0) continue;
    if (i.shared || !activeSet.has(i.addedBy)) for (const id of active) bump(id, w / active.length);
    else bump(i.addedBy, w);
  }
  const totalWeight = [...weight.values()].reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) return [];

  const order = active.filter((id) => (weight.get(id) ?? 0) > 0);
  if (payerId && order.includes(payerId)) order.splice(0, 0, ...order.splice(order.indexOf(payerId), 1));
  const rows = order.map((memberId, idx) => {
    const exact = (totalCents * (weight.get(memberId) ?? 0)) / totalWeight;
    const cents = Math.floor(exact + 1e-9);
    return { memberId, cents, frac: exact - cents, idx };
  });
  let remainder = totalCents - rows.reduce((s, r) => s + r.cents, 0);
  const byClaim = [...rows].sort((a, b) => {
    if (payerId && a.memberId !== b.memberId) {
      if (a.memberId === payerId) return -1;
      if (b.memberId === payerId) return 1;
    }
    return b.frac - a.frac || a.idx - b.idx;
  });
  for (let k = 0; remainder > 0; k = (k + 1) % byClaim.length) {
    byClaim[k].cents += 1;
    remainder -= 1;
  }
  return rows.map(({ memberId, cents }) => ({ memberId, cents }));
}

/* ---------- services ---------- */

type Row = typeof cartItems.$inferSelect;

async function namesFor(householdId: string): Promise<Map<string, string>> {
  // Every member of the house, including anyone who moved out, so old items still show a name.
  const rows = await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.householdId, householdId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const toItem = (r: Row, names: Map<string, string>): CartItem => ({
  id: r.id,
  name: r.name,
  qty: r.qty,
  addedByName: names.get(r.addedBy) ?? "Someone",
  shared: r.shared,
  estCents: r.estCents,
  addedBy: r.addedBy,
  createdAt: r.createdAt,
});

async function openRows(householdId: string): Promise<Row[]> {
  return db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.householdId, householdId), eq(cartItems.status, "open")))
    .orderBy(asc(cartItems.createdAt), asc(cartItems.id));
}

/** Open items with adder names, oldest first. */
export async function listOpenItems(ctx: Pick<Ctx, "householdId">): Promise<CartItem[]> {
  const [rows, names] = await Promise.all([openRows(ctx.householdId), namesFor(ctx.householdId)]);
  return rows.map((r) => toItem(r, names));
}

/** Items are attributed to ctx.actorId. estCents comes from lib/prices (catalog), not the LLM. */
export async function addItems(ctx: Ctx, input: { items: { name: string; qty?: string }[]; shared?: boolean }): Promise<CartItem[]> {
  const items = input.items
    .map((i) => ({ name: i.name.trim().replace(/\s+/g, " "), qty: (i.qty ?? "").trim() || "1" }))
    .filter((i) => i.name);
  if (items.length === 0) throw new Error("Add what? Give me at least one item name.");
  const rows = await db
    .insert(cartItems)
    .values(
      items.map((i) => ({
        householdId: ctx.householdId,
        name: i.name,
        qty: i.qty,
        addedBy: ctx.actorId,
        shared: !!input.shared,
        estCents: estimate(i.name, i.qty),
      })),
    )
    .returning();
  const names = await namesFor(ctx.householdId);
  return rows.map((r) => toItem(r, names));
}

/** Remove the newest open item whose name matches: exact (case-insensitive) first, then contains. */
export async function removeItem(ctx: Ctx, input: { name: string }): Promise<boolean> {
  const q = input.name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return false;
  const rows = await db
    .select({ id: cartItems.id, name: cartItems.name })
    .from(cartItems)
    .where(and(eq(cartItems.householdId, ctx.householdId), eq(cartItems.status, "open")))
    .orderBy(desc(cartItems.createdAt), desc(cartItems.id));
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const hit = rows.find((r) => norm(r.name) === q) ?? rows.find((r) => norm(r.name).includes(q) || q.includes(norm(r.name)));
  if (!hit) return false;
  await db.delete(cartItems).where(eq(cartItems.id, hit.id));
  return true;
}

/** Remove one open item by id. Household-scoped, so a stale or foreign id can't touch another house's cart. */
export async function removeItemById(ctx: Pick<Ctx, "householdId">, input: { id: string }): Promise<boolean> {
  const id = input.id.trim();
  if (!id) return false;
  const gone = await db
    .delete(cartItems)
    .where(and(eq(cartItems.id, id), eq(cartItems.householdId, ctx.householdId), eq(cartItems.status, "open")))
    .returning({ id: cartItems.id });
  return gone.length > 0;
}

/** Open items grouped by who added them ("Shared" for shared items). Shared group last. */
export async function viewCart(ctx: Pick<Ctx, "householdId">): Promise<Record<string, CartItem[]>> {
  const items = await listOpenItems(ctx);
  const groups: Record<string, CartItem[]> = {};
  for (const i of items.filter((x) => !x.shared)) (groups[i.addedByName] ??= []).push(i);
  const shared = items.filter((x) => x.shared);
  if (shared.length) groups.Shared = shared;
  return groups;
}

/** Link to the simulated store (/cart/checkout) for all open items; null when the cart is empty. */
export async function checkout(ctx: Pick<Ctx, "householdId">): Promise<{ url: string | null; items: CartItem[] }> {
  const items = await listOpenItems(ctx);
  return { url: items.length ? checkoutUrl() : null, items };
}

/**
 * Payer bought the cart: one expense, split by who added what (weighted by estCents), shared split evenly.
 *
 * Atomic against retries and double-clicks. Inside one transaction the open items are flipped to "purchased"
 * FIRST (`UPDATE ... WHERE status = 'open' RETURNING *`); the rows that came back are the only items this purchase
 * may charge for, and zero rows means someone else already bought it (or the cart is empty), so we throw and the
 * second click fails cleanly. Only then is the expense written through money.logExpense, which stays the single
 * writer of expenses. If logExpense throws (bad payer, bad splits, DB error) the surrounding transaction rolls the
 * UPDATE back and the items stay open. A concurrent call blocks on the row locks until the first one commits, then
 * its UPDATE sees status = "purchased" and matches nothing.
 *
 * Trade-off: logExpense runs its own transaction on a second connection, so the one remaining window is the outer
 * commit failing after the expense committed; items would stay open with an expense logged, which is visible and
 * fixable, unlike the old double charge.
 */
export async function markPurchased(ctx: Ctx, input: { totalCents: number; payerId?: string }): Promise<Expense> {
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) {
    throw new Error("The grocery total has to be more than $0.00 (whole cents).");
  }
  const payerId = input.payerId ?? ctx.actorId;
  return db.transaction(async (tx) => {
    const items = await tx
      .update(cartItems)
      .set({ status: "purchased" })
      .where(and(eq(cartItems.householdId, ctx.householdId), eq(cartItems.status, "open")))
      .returning();
    if (items.length === 0) {
      throw new Error("The cart is empty, so there's nothing to mark purchased. Add items first ('Kevin, add milk').");
    }
    const people = await listMembers(ctx);
    const splits = computeCartSplits(
      items.map((i) => ({ addedBy: i.addedBy, shared: i.shared, estCents: i.estCents })),
      people.map((m) => m.id),
      input.totalCents,
      payerId,
    );
    return logExpense(ctx, {
      payerId,
      cents: input.totalCents,
      description: `Groceries (${items.length} item${items.length === 1 ? "" : "s"})`,
      splits,
      source: "cart",
    });
  });
}
