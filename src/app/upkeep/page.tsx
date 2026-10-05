// Upkeep: the recurring battle plan. Reads via services/upkeep, writes via server actions + revalidatePath.
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { upkeep } from "@/services";
import type { MaintenanceItem } from "@/services/upkeep";
import { Empty, NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

async function add(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const item = String(form.get("item") ?? "").trim();
  const everyDays = Number(form.get("everyDays") ?? 90);
  if (!item) return;
  await upkeep.addMaintenance(ctx, { item, everyDays: Number.isFinite(everyDays) && everyDays > 0 ? everyDays : 90 });
  revalidatePath("/", "layout");
}

async function done(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await upkeep.markDone(ctx, { item: String(form.get("item") ?? "") });
  revalidatePath("/", "layout");
}

async function seedDefaults() {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await upkeep.addDefaults(ctx);
  revalidatePath("/", "layout");
}

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

const STATUS: Record<MaintenanceItem["status"], { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "pill red overdue" },
  "due-soon": { label: "Due soon", cls: "pill gold" },
  ok: { label: "OK", cls: "pill green" },
};

export default async function UpkeepPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const items = await upkeep.listMaintenance(ctx);

  return (
    <main data-accent="green">
      <PageHead title="Upkeep" quip="Kevin's battle plan for the house." emoji="🪣" />
      <div className="grid">
        <section className="card card-wide">
          <h2>🪣 Battle plan · paint cans, icicles, the attic</h2>
          {items.length ? (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Every</th>
                      <th>Last done</th>
                      <th>Next due</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((m) => (
                      <tr key={m.id}>
                        <td className="wrap">{m.item}</td>
                        <td className="num">{m.everyDays} days</td>
                        <td className="nowrap">{m.lastDone ? day(m.lastDone) : <span className="muted">never</span>}</td>
                        <td className="nowrap">{m.nextDue ? day(m.nextDue) : "now"}</td>
                        <td><span className={STATUS[m.status].cls}>{STATUS[m.status].label}</span></td>
                        <td className="num">
                          <form action={done}>
                            <input type="hidden" name="item" value={m.item} />
                            <button className="btn-ghost">Done</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {items.length < 3 && (
                <form action={seedDefaults} className="row" style={{ marginTop: 16 }}>
                  <span className="muted">Thin plan. The Wet Bandits would walk right in.</span>
                  <span className="spacer" />
                  <button className="btn-ghost">Load the paint cans 🪣 (add the usual suspects)</button>
                </form>
              )}
            </>
          ) : (
            <Empty title="No battle plan yet. The house is wide open.">
              Filters, smoke alarms and other recurring upkeep go here.
              <form action={seedDefaults} style={{ marginTop: 16 }}>
                <button>Load the paint cans 🪣 (add the usual suspects)</button>
              </form>
            </Empty>
          )}
        </section>

        <section className="card">
          <h2>🧼 Set a trap · add an upkeep item</h2>
          <form action={add} className="stack">
            <div className="field">
              <label htmlFor="item">What needs doing</label>
              <input id="item" name="item" placeholder="Replace HVAC filter, test the smoke alarms, check the attic" required />
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="everyDays">Every (days)</label>
                <input id="everyDays" name="everyDays" type="number" min="1" step="1" defaultValue={90} required />
              </div>
              <div><button>Add to the plan</button></div>
            </div>
            <small className="muted">Kevin nudges the group chat when a trap needs resetting. Mark it Done and the clock restarts.</small>
          </form>
        </section>
      </div>
    </main>
  );
}
