// Chores: the chart, whose turn, and the Hall of Shame. Reads via services, writes via server actions + revalidatePath.
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { chores } from "@/services";
import { Empty, NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

async function add(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  await chores.addChore(ctx, { name, everyDays: Number(form.get("everyDays")) || 7 });
  revalidatePath("/", "layout");
}

async function didIt(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx || !ctx.actorId) return;
  const name = String(form.get("chore") ?? "").trim();
  if (!name) return;
  await chores.logChore(ctx, { chore: name });
  revalidatePath("/", "layout");
}

async function remove(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await chores.removeChore(ctx, { choreId: String(form.get("id")) });
  revalidatePath("/", "layout");
}

function ago(d: Date | null) {
  if (!d) return "never";
  const days = chores.daysSince(d);
  return days === 0 ? "today" : `${days}d ago`;
}

export default async function ChoresPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const [board, shame] = await Promise.all([chores.choreStatus(ctx), chores.hallOfShame(ctx)]);
  const overdue = board.filter((c) => c.overdue).length;

  return (
    <main data-accent="red">
      <PageHead title="Chores" quip="You guys give up? Or are you thirsty for more?" emoji="🧹">
        {board.length > 0 && (
          <span className={`pill ${overdue ? "red overdue" : "green"}`}>{overdue ? `${overdue} overdue 😤` : "All on track ✨"}</span>
        )}
      </PageHead>

      <div className="stack">
        <section className="card">
          <h2>🧹 Chore board · the chart</h2>
          {board.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Chore</th>
                    <th>Every</th>
                    <th>Last done</th>
                    <th>Whose turn</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {board.map((c) => (
                    <tr key={c.choreId}>
                      <td className="wrap"><b>{c.name}</b></td>
                      <td className="muted nowrap">{c.everyDays}d</td>
                      <td className="wrap">
                        {c.lastDoneAt ? (
                          <>
                            {c.lastDoneBy} <small>· {ago(c.lastDoneAt)}</small>
                          </>
                        ) : (
                          <span className="muted">never</span>
                        )}
                      </td>
                      <td className="wrap">{c.whoseTurn ?? <span className="muted">—</span>}</td>
                      <td>
                        <span className={`pill ${c.overdue ? "red overdue" : "green"}`}>{c.overdue ? "Overdue" : "On track"}</span>
                      </td>
                      <td className="num">
                        <form action={didIt} className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                          <input type="hidden" name="chore" value={c.name} />
                          <input type="hidden" name="id" value={c.choreId} />
                          <button>I did it</button>
                          <button formAction={remove} className="btn-danger" aria-label={`Remove ${c.name}`}>×</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No chore chart yet.">Somebody has to take out the trash. The Wet Bandits aren&apos;t going to do it.</Empty>
          )}
        </section>

        <div className="grid">
          <section className="card">
            <h2>🕷️ Hall of Shame · Buzz&apos;s tarantula award</h2>
            {shame.length ? (
              <ul className="list">
                {shame.map((s, i) => (
                  <li key={s.memberId} className={i === 0 ? "wanted" : undefined}>
                    <span style={{ width: 24, textAlign: "center" }}>{i === 0 ? "🕷️" : `${i + 1}.`}</span>
                    <b>{s.name}</b>
                    <span className="spacer" />
                    <small>
                      {s.choresThisWeek} this week · {s.daysSinceLastChore == null ? "never" : `${s.daysSinceLastChore}d ago`}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nobody to shame.">Yet. The tarantula is patient.</Empty>
            )}
          </section>

          <section className="card">
            <h2>🪣 Set a new trap · add a chore</h2>
            <form action={add} className="stack">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="chore-name">Chore</label>
                  <input id="chore-name" name="name" placeholder="Vacuum the living room, de-ice the front steps" required />
                </div>
                <div className="field">
                  <label htmlFor="chore-every">Every N days</label>
                  <input id="chore-every" name="everyDays" type="number" min="1" max="365" defaultValue={7} required />
                </div>
              </div>
              <div><button>Add to chart</button></div>
              <small className="muted">Same name again just changes how often. Skip it and the tarantula finds you. Nobody cheats Kevin.</small>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
