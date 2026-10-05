// Reminders. Same pattern as app/members/page.tsx: server component reads services, server actions write.
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { members, reminders } from "@/services";
import { Empty, NoHousehold, PageHead } from "@/components/ui";
import { TzOffset, localDateTimeToDate } from "@/components/tz-offset";

export const dynamic = "force-dynamic";

// datetime-local has no zone: the form also posts the browser's UTC offset (see TzOffset) so we store the instant meant.
async function add(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const text = String(form.get("text") ?? "").trim();
  const dueAt = localDateTimeToDate(String(form.get("dueAt") ?? ""), form.get("tzOffset"));
  if (!text || Number.isNaN(dueAt.getTime())) return;
  const who = String(form.get("memberId") ?? "");
  await reminders.setReminder(ctx, {
    text,
    dueAt,
    memberId: who || undefined,
    recurring: form.get("monthly") ? "monthly" : undefined,
  });
  revalidatePath("/", "layout");
}

async function cancel(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await reminders.cancelReminder(ctx, { reminderId: String(form.get("id")) });
  revalidatePath("/", "layout");
}

const when = (d: Date) =>
  d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function RemindersPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const [upcoming, people] = await Promise.all([reminders.listReminders(ctx), members.listMembers(ctx)]);
  return (
    <main data-accent="ice">
      <PageHead title="Reminders" quip="KEVIN!!!" emoji="⏰" />
      <div className="grid">
        <section className="card">
          <h2>⏰ Coming up · things Kevin will yell about</h2>
          {upcoming.length ? (
            <ul className="list">
              {upcoming.map((r) => (
                <li key={r.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{r.text}</div>
                    <small>
                      {r.memberName ?? "everyone"} · {when(r.dueAt)}
                    </small>
                  </div>
                  {r.recurring === "monthly" && <span className="pill gold">Monthly</span>}
                  <form action={cancel}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn-danger">Cancel</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing to forget yet.">Rent and other reminders will live here. Kevin has a Talkboy and he&apos;s not afraid to use it.</Empty>
          )}
        </section>

        <section className="card">
          <h2>😤 Yell KEVIN at a time of your choosing · set a reminder</h2>
          <form action={add} className="stack">
            <div className="field">
              <label htmlFor="text">What</label>
              <input id="text" name="text" placeholder="Take the bins out, pay rent, feed the tarantula" required />
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="dueAt">When</label>
                <input id="dueAt" name="dueAt" type="datetime-local" required />
                <TzOffset />
              </div>
              <div className="field">
                <label htmlFor="memberId">For</label>
                <select id="memberId" name="memberId" defaultValue="">
                  <option value="">Everyone</option>
                  {people.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="row" htmlFor="monthly" style={{ cursor: "pointer" }}>
              <input id="monthly" name="monthly" type="checkbox" value="1" />
              Repeat monthly (rent-style)
            </label>
            <div>
              <button>Set it</button>
            </div>
            <small className="muted">Kevin pings the group chat when it&apos;s time. Loudly.</small>
          </form>
        </section>
      </div>
    </main>
  );
}
