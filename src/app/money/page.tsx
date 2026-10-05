// Money: balances, settle plan, add expense, recent expenses. Reads services, writes via server actions.
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { members, money } from "@/services";
import { dollars } from "@/services/types";
import { Empty, NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const toCents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").trim()) * 100);
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

async function addExpense(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const splitAmong = form.getAll("split").map(String);
  await money.logExpense(ctx, {
    cents: toCents(form.get("amount")),
    description: String(form.get("description") ?? ""),
    payerId: String(form.get("payerId") || ctx.actorId),
    splitAmong: splitAmong.length ? splitAmong : undefined,
  });
  revalidatePath("/", "layout");
}

async function markPaid(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await money.settleUp(ctx, {
    fromId: String(form.get("fromId")),
    toId: String(form.get("toId")),
    cents: Number(form.get("cents")),
  });
  revalidatePath("/", "layout");
}

async function settle(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await money.settleUp(ctx, { toId: String(form.get("toId")), cents: toCents(form.get("amount")) });
  revalidatePath("/", "layout");
}

export default async function MoneyPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const [people, balances, recent] = await Promise.all([
    members.listMembers(ctx),
    money.getBalances(ctx),
    money.listExpenses(ctx, 20),
  ]);
  const plan = money.computeSettlePlan(balances);
  const others = people.filter((m) => m.id !== ctx.actorId);

  return (
    <main data-accent="green">
      <PageHead title="Money" quip="Keep the change, ya filthy animal." emoji="💸" />
      <div className="grid">
        <section className="card">
          <h2>💸 Balances · who&apos;s a filthy animal</h2>
          {balances.length ? (
            <ul className="list">
              {balances.map((b) => (
                <li key={b.memberId}>
                  <b>{b.name}</b>
                  <span className="spacer" />
                  {b.cents > 0 ? (
                    <span className="pill green">is owed {dollars(b.cents)}</span>
                  ) : b.cents < 0 ? (
                    <span className="pill red">owes {dollars(-b.cents)}</span>
                  ) : (
                    <span className="pill">square</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nobody's here.">Add roommates first, then start splitting. You can&apos;t split a cheese pizza with nobody.</Empty>
          )}
        </section>

        <section className="card">
          <h2>🫡 Who pays whom · Wet Bandits, settle up</h2>
          {plan.length ? (
            <ul className="list">
              {plan.map((t, i) => (
                <li key={i}>
                  <b>{t.fromName}</b>
                  <span className="muted">pays</span>
                  <b>{t.toName}</b>
                  <span className="spacer" />
                  <span className="stat" style={{ fontSize: 18 }}>{dollars(t.cents)}</span>
                  <form action={markPaid}>
                    <input type="hidden" name="fromId" value={t.fromId} />
                    <input type="hidden" name="toId" value={t.toId} />
                    <input type="hidden" name="cents" value={t.cents} />
                    <button className="btn-ghost" title="Keep the change, ya filthy animal.">Mark paid</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="All square. No filthy animals today." className="socks">Nobody owes anybody. Keep it that way, ya filthy animals.</Empty>
          )}
          {others.length > 0 && (
            <form action={settle} className="row" style={{ marginTop: 16 }}>
              <span className="muted">Settle up (keep the change):</span>
              <span>I paid</span>
              <select name="toId" aria-label="Paid to" required>
                {others.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" aria-label="Amount" required style={{ width: 100 }} />
              <button className="btn-ghost">Record it</button>
            </form>
          )}
        </section>

        <section className="card">
          <h2>🍕 Add expense · who paid for the Plaza Hotel room service?</h2>
          <form action={addExpense} className="stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="amount">Amount ($)</label>
                <input id="amount" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required />
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
            <div className="field">
              <label htmlFor="description">What for</label>
              <input id="description" name="description" placeholder="Room service, cheese pizza, the window Buzz broke" required />
            </div>
            <div className="field">
              <label>Split among</label>
              <div className="row">
                {people.map((m) => (
                  <label key={m.id} className="row" style={{ gap: 4, fontWeight: 500, color: "inherit" }}>
                    <input type="checkbox" name="split" value={m.id} defaultChecked />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
            <div><button>Add expense</button></div>
            <small className="muted">Kevin does the math so nobody has to. Nobody cheats Kevin.</small>
          </form>
        </section>

        <section className="card card-wide">
          <h2>👀 The receipts · recent expenses</h2>
          {recent.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What</th>
                    <th>Paid by</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e.id}>
                      <td className="muted nowrap">{day(e.createdAt)}</td>
                      <td className="wrap" title={e.splits?.map((s) => `${s.name} ${dollars(s.cents)}`).join(" · ")}>{e.description}</td>
                      <td className="wrap">{e.payerName}</td>
                      <td className="num">{dollars(e.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Nothing logged yet.">The first cheese pizza is on somebody. Just for me.</Empty>
          )}
        </section>
      </div>
    </main>
  );
}
