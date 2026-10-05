// Shared inbox: Kevin's AgentMail mailbox with the leasing office. Everyone sees the same threads and unread state.
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { dashboardCtx } from "@/lib/dashboard";
import { leasing, members } from "@/services";
import { Empty, NoHousehold, PageHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function send(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const { threadId } = await leasing.sendToLeasing(ctx, { subject: String(form.get("subject")), body: String(form.get("body")) });
  revalidatePath("/", "layout");
  redirect(threadId ? `/inbox?thread=${threadId}` : "/inbox");
}

async function workOrder(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const location = String(form.get("location") ?? "").trim();
  const { threadId } = await leasing.createWorkOrder(ctx, {
    issue: String(form.get("issue")),
    location: location || undefined,
    urgency: String(form.get("urgency")) as "low" | "normal" | "urgent",
  });
  revalidatePath("/", "layout");
  redirect(threadId ? `/inbox?thread=${threadId}` : "/inbox");
}

async function reply(form: FormData) {
  "use server";
  const ctx = await dashboardCtx();
  if (!ctx) return;
  const threadId = String(form.get("threadId"));
  await leasing.sendToLeasing(ctx, { subject: String(form.get("subject")), body: String(form.get("body")), threadId });
  revalidatePath("/", "layout");
  redirect(`/inbox?thread=${threadId}`);
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const ctx = await dashboardCtx();
  if (!ctx) return <NoHousehold />;
  const { thread } = await searchParams;
  const [house, threads, messages] = await Promise.all([
    members.getHousehold(ctx.householdId),
    leasing.inboxThreads(ctx),
    // A stale or mistyped ?thread= id must not take the whole inbox down: fall back to the list.
    thread ? leasing.openThread(ctx, thread).catch(() => []) : Promise.resolve([]),
  ]);
  const open = threads.find((t) => t.threadId === thread);

  if (!house?.inboxAddress || !house.leasingEmail) {
    return (
      <main data-accent="candy">
        <PageHead title="Inbox" quip="Merry Christmas, ya filthy animal." emoji="📬" />
        <div className="card">
          <Empty title="Kevin needs a mailbox.">
            No mailbox, no mail. Set Kevin&apos;s inbox and the leasing office email in <Link href="/members">Roommates → Fort McCallister settings</Link>.
          </Empty>
        </div>
      </main>
    );
  }

  return (
    <main data-accent="candy">
      <PageHead title="Inbox" quip="Merry Christmas, ya filthy animal." emoji="📬">
        <small className="clip" style={{ maxWidth: "100%" }}>{house.inboxAddress} ⇄ {house.leasingEmail}</small>
      </PageHead>

      <div className="inbox">
        <section className="card threads">
          <h2>👀 Threads · the mail</h2>
          {threads.length ? (
            <ul className="list">
              {threads.map((t) => (
                <li key={t.threadId}>
                  <Link href={`/inbox?thread=${t.threadId}`} className={`thread ${t.threadId === thread ? "active" : ""}`}>
                    <span className="row">
                      {t.unread && t.threadId !== thread && <span className="dot" aria-label="Unread" />}
                      <b className="clip">{t.subject}</b>
                      <span className="spacer" />
                      <small>{when(t.at)}</small>
                    </span>
                    <small className="clip">{t.preview}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="No mail yet.">Write to Old Man Marley (the leasing office) and it shows up here. He&apos;s nicer than he looks.</Empty>}
        </section>

        <section className="stack">
          {thread && open ? (
            <div className="card">
              <h2>{open.subject}</h2>
              <div className="stack">
                {messages.map((m) => (
                  <article key={m.messageId} className={`msg ${m.sent ? "sent" : ""}`}>
                    <div className="row"><b>{m.sent ? "Kevin" : m.from}</b><span className="spacer" /><small>{when(m.at)}</small></div>
                    <p>{m.text}</p>
                  </article>
                ))}
              </div>
              <form action={reply} className="stack" style={{ marginTop: 16 }}>
                <input type="hidden" name="threadId" value={open.threadId} />
                <input type="hidden" name="subject" value={open.subject.startsWith("Re:") ? open.subject : `Re: ${open.subject}`} />
                <textarea name="body" rows={3} placeholder="Reply to Old Man Marley (the leasing office)…" aria-label="Reply" required />
                <div><button>Send reply</button></div>
              </form>
            </div>
          ) : (
            <>
              <div className="card">
                <h2>🔧 Tell Old Man Marley · work order</h2>
                <form action={workOrder} className="stack">
                  <div className="field">
                    <label htmlFor="issue">What&apos;s broken?</label>
                    <input id="issue" name="issue" placeholder="Kitchen sink is leaking, furnace is making the scary noise" required />
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="location">Where</label>
                      <input id="location" name="location" placeholder="kitchen, basement (the scary one)" />
                    </div>
                    <div className="field">
                      <label htmlFor="urgency">Urgency</label>
                      <select id="urgency" name="urgency" defaultValue="normal">
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <div><button>Send work order</button></div>
                </form>
              </div>
              <div className="card">
                <h2>✉️ Write to the leasing office · be nice, it&apos;s Old Man Marley</h2>
                <form action={send} className="stack">
                  <div className="field">
                    <label htmlFor="subject">Subject</label>
                    <input id="subject" name="subject" placeholder="Rent question, the hallway light, a very polite complaint" required />
                  </div>
                  <div className="field">
                    <label htmlFor="body">Message</label>
                    <textarea id="body" name="body" rows={5} placeholder="Kevin sends it from the house inbox and signs for the whole apartment." required />
                  </div>
                  <div><button>Send it</button></div>
                </form>
              </div>
            </>
          )}
          {thread && <Link href="/inbox" className="btn btn-ghost" style={{ alignSelf: "start" }}>← New email or work order</Link>}
        </section>
      </div>
    </main>
  );
}
