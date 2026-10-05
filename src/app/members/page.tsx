// Members + house settings. This page is the reference pattern: server component reads services, server actions write.
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { members, reminders } from "@/services";
import { NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

async function add(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await members.addMember(ctx, { name: String(form.get("name")) });
  revalidatePath("/", "layout");
}

async function rename(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await members.renameMember(ctx, { memberId: String(form.get("id")), name: String(form.get("name")) });
  revalidatePath("/", "layout");
}

async function remove(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  await members.removeMember(ctx, { memberId: String(form.get("id")) });
  revalidatePath("/", "layout");
}

async function saveSettings(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const text = (k: string) => String(form.get(k) ?? "").trim();
  await members.updateHouseSettings(ctx, {
    name: text("name") || "Our place",
    rentCents: text("rent") ? Math.round(Number(text("rent")) * 100) : null,
    rentDueDay: text("dueDay") ? Math.min(28, Math.max(1, Math.round(Number(text("dueDay"))))) : null,
    leasingEmail: text("leasingEmail").toLowerCase() || null,
    inboxAddress: text("inboxAddress").toLowerCase() || null,
  });
  await reminders.syncRentReminder(ctx);
  revalidatePath("/members");
}

export default async function MembersPage() {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const [people, house] = await Promise.all([members.listMembers(ctx), members.getHousehold(ctx.householdId)]);
  return (
    <main data-accent="gold">
      <PageHead title="Roommates" quip="Hope everyone's accounted for this time." emoji="🧦" />
      <div className="grid">
        <section className="card">
          <h2>🫡 Who lives here · headcount</h2>
          <ul className="list">
            {people.map((m) => (
              <li key={m.id}>
                <form action={rename} className="row" style={{ flex: 1 }}>
                  <input type="hidden" name="id" value={m.id} />
                  <input name="name" defaultValue={m.name} aria-label="Name" style={{ flex: 1 }} />
                  <span className={`pill ${m.telegramUserId ? "green" : ""}`}>{m.telegramUserId ? "On Telegram" : "Not on Telegram"}</span>
                  <button className="btn-ghost">Save</button>
                  <button formAction={remove} className="btn-danger" title="I made my family disappear.">Remove</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={add} className="row" style={{ marginTop: 16 }}>
            <input name="name" placeholder="New roommate (not Harry, not Marv)" aria-label="New roommate" required style={{ flex: 1 }} />
            <button>Add</button>
          </form>
          <small className="muted" style={{ display: "block", marginTop: 10 }}>Remove is the &quot;I made my family disappear 🙈&quot; button. Use it wisely.</small>
        </section>

        <section className="card">
          <h2>✨ Fort McCallister settings · house settings</h2>
          <form action={saveSettings} className="stack">
            <div className="field">
              <label htmlFor="name">House name</label>
              <input id="name" name="name" defaultValue={house?.name ?? ""} required />
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="rent">Rent ($/month)</label>
                <input id="rent" name="rent" type="number" min="0" step="0.01" defaultValue={house?.rentCents != null ? house.rentCents / 100 : ""} />
              </div>
              <div className="field">
                <label htmlFor="dueDay">Due day (1-28)</label>
                <input id="dueDay" name="dueDay" type="number" min="1" max="28" defaultValue={house?.rentDueDay ?? ""} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="leasingEmail">Leasing office email (Old Man Marley)</label>
              <input id="leasingEmail" name="leasingEmail" type="email" defaultValue={house?.leasingEmail ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="inboxAddress">Kevin&apos;s inbox (sends from)</label>
              <input id="inboxAddress" name="inboxAddress" type="email" defaultValue={house?.inboxAddress ?? ""} />
            </div>
            <div><button>Save settings</button></div>
            <small className="muted">Set rent and a due day and Kevin yells about rent every month, automatically. KEVIN!!!</small>
          </form>
        </section>
      </div>
    </main>
  );
}
