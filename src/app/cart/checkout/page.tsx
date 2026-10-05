// "Kevin's Market": the app's own simulated store checkout. Nothing is purchased anywhere. Placing the
// order logs one grocery expense (split by who added what) through the money service and clears the cart.
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dashboardCtx } from "@/lib/dashboard";
import { cart, members } from "@/services";
import { dollars } from "@/services/types";
import { DEFAULT_UNIT_CENTS } from "@/lib/prices";
import { Empty, NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const STORES = ["Kevin's Market", "Mart of Shame", "Buzz's Bodega", "Little Nero's Pantry"];

/** What the order charges: the catalog estimate, or the default unit price per item when nothing is priced. */
const orderTotal = (items: { estCents: number | null }[]) => {
  const total = cart.cartTotal(items);
  return total > 0 ? total : items.length * DEFAULT_UNIT_CENTS;
};

async function placeOrder(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const items = await cart.listOpenItems(ctx);
  if (items.length === 0) redirect("/cart");
  await cart.markPurchased(ctx, { totalCents: orderTotal(items), payerId: String(form.get("payerId") || ctx.actorId) });
  revalidatePath("/", "layout");
  redirect("/money");
}

export default async function CheckoutPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const [items, people] = await Promise.all([cart.listOpenItems(ctx), members.listMembers(ctx)]);
  const total = orderTotal(items);
  const actor = people.find((m) => m.id === ctx.actorId);
  // Same split the order will log (payer = the person acting; only remainder cents depend on who pays).
  const nameOf = new Map(people.map((m) => [m.id, m.name]));
  const ownCount = new Map<string, number>();
  for (const i of items) if (!i.shared && i.addedBy) ownCount.set(i.addedBy, (ownCount.get(i.addedBy) ?? 0) + 1);
  const hasShared = items.some((i) => i.shared || !nameOf.has(i.addedBy ?? ""));
  const preview = cart.computeCartSplits(
    items.map((i) => ({ addedBy: i.addedBy ?? "", shared: i.shared, estCents: i.estCents })),
    people.map((m) => m.id),
    total,
    ctx.actorId,
  );

  return (
    <main data-accent="gold">
      <PageHead title="Kevin's Market" quip="Bless this highly nutritious microwavable macaroni and cheese dinner." emoji="🍕">
        <span className="pill gold">Kevin&apos;s Market — simulated · nothing is really bought</span>
      </PageHead>

      {items.length === 0 ? (
        <div className="card">
          <Empty title="The cart is empty. Not even macaroni.">
            Nothing to check out. <Link href="/cart">Back to the cart</Link> and add something first.
          </Empty>
        </div>
      ) : (
        <div className="grid">
          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <h2>
              🛒 Your order
              <span className="pill">{items.length} item{items.length === 1 ? "" : "s"}</span>
            </h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>For</th>
                    <th className="num">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="wrap"><b>{i.name}</b></td>
                      <td className="muted wrap">{i.qty}</td>
                      <td className="wrap">{i.shared ? <span className="pill green">Shared</span> : i.addedByName}</td>
                      <td className="num">{i.estCents != null ? dollars(i.estCents) : "—"}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3}><b>Total</b></td>
                    <td className="num"><span className="stat" style={{ fontSize: 20 }}>{dollars(total)}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ margin: "10px 0 0" }}>
              Estimated prices from Kevin&apos;s catalog. Delivery: never. Tip: whoever does the dishes. Credit card? You got it.
            </p>
          </section>

          <section className="card">
            <h2>💸 Place order · credit card? You got it.</h2>
            <form action={placeOrder} className="stack">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="store">Store</label>
                  <select id="store" name="store" defaultValue={STORES[0]}>
                    {STORES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="payerId">Paid by</label>
                  <select id="payerId" name="payerId" defaultValue={ctx.actorId}>
                    {people.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <button style={{ fontSize: 17, padding: "12px 22px" }}>Place order (simulated) · {dollars(total)}</button>
              </div>
              <small className="muted">
                <b>Pretend-swipe. Nobody gets charged, nobody gets a pizza, everybody gets a line on the money page.</b>{" "}
                No card is charged and no store is contacted. Placing the order logs one {dollars(total)} grocery expense paid by{" "}
                {actor?.name ?? "you"}: everyone pays for their own items, shared items split evenly across the house. Then it clears the cart.
              </small>
            </form>
          </section>

          <section className="card">
            <h2>👀 Who owes what · the split</h2>
            <ul className="list">
              {preview.map((row) => {
                const n = ownCount.get(row.memberId) ?? 0;
                return (
                  <li key={row.memberId}>
                    <b>{nameOf.get(row.memberId) ?? "Someone"}</b>
                    <span className="muted">
                      {n} item{n === 1 ? "" : "s"}
                      {hasShared && <> + shared</>}
                    </span>
                    <span className="spacer" />
                    <span className="num">{dollars(row.cents)}</span>
                  </li>
                );
              })}
            </ul>
            <p style={{ margin: "12px 0 0" }}>
              <Link href="/cart">← Back to the cart</Link>
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
