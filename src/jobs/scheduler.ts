// In-process scheduler, started once from instrumentation.ts. It only runs while the server process is up and keeps
// its "already posted" state in memory, so run exactly one always-on instance (a second one would post everything twice).
// Every 60 s: due reminders (Kevin-voiced), the weekly Kevin Report (Sun 18:00 Chicago), a 9 AM upkeep nudge, and a poll of the
// leasing inbox (new office mail -> group).
// The tick never rejects: every send is wrapped, and with no TELEGRAM_BOT_TOKEN it skips sending entirely.
import { isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { telegram } from "@/channels/telegram";
import { dueReminders, markSent, type Reminder } from "@/services/reminders";
import { dueMaintenance } from "@/services/upkeep";
import { formatKevinReport, kevinReport, localParts, shouldPostUpkeepNudge, shouldPostWeeklyReport } from "@/services/report";
import { pollInbox } from "@/services/leasing";
import { inboxUrl } from "@/lib/urls";

const TICK_MS = 60_000;
const MAX_SEND_ATTEMPTS = 3;

/* ---------- in-memory state (one instance, so globalThis is enough; survives Next HMR) ---------- */

type State = {
  weeklyPostedAt: Map<string, Date>; // householdId -> last weekly report
  upkeepPostedDay: Map<string, string>; // householdId -> "YYYY-MM-DD" (Chicago) of last nudge
  reminderFailures: Map<string, number>; // reminderId -> failed send attempts
  warnedNotConfigured: boolean;
};
function state(): State {
  const g = globalThis as { __kevinSchedulerState?: State };
  return (g.__kevinSchedulerState ??= {
    weeklyPostedAt: new Map(),
    upkeepPostedDay: new Map(),
    reminderFailures: new Map(),
    warnedNotConfigured: false,
  });
}

/* ---------- Kevin's voice for reminders (pure, deterministic by reminder id) ---------- */

const REMINDER_LINES = [
  "⏰ {text}. Don't make me come over there, {who} 😤",
  "⏰ Hey {who}: {text}. Kevin's watching, no cap 👀",
  "⏰ {text}. This is my house, I have to defend it. {who}, you're up 🫡",
  "⏰ Reminder for {who}: {text}. Nobody cheats Kevin 😜",
  "⏰ {text}. Keep the change, ya filthy animal. (Kidding. Do it fr, {who}) ✨",
  "⏰ {who}, {text}. Say less, I already set the paint cans 🙈",
]

/** Small stable string hash so the same reminder always gets the same line. */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function reminderLine(r: Pick<Reminder, "id" | "text" | "memberName">): string {
  const who = r.memberName ?? "everyone";
  return REMINDER_LINES[hashId(r.id) % REMINDER_LINES.length].replaceAll("{text}", r.text).replaceAll("{who}", who);
}

/* ---------- helpers ---------- */

function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/** Households that have a Telegram group linked (the only ones Kevin can post to unprompted). */
async function householdsWithChat(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.households.id, name: schema.households.name })
    .from(schema.households)
    .where(isNotNull(schema.households.telegramChatId));
}

function warnNotConfigured(): void {
  const s = state();
  if (s.warnedNotConfigured) return;
  console.log("scheduler: telegram not configured (TELEGRAM_BOT_TOKEN empty); skipping sends");
  s.warnedNotConfigured = true;
}

async function safeSend(householdId: string, text: string, what: string): Promise<boolean> {
  if (!telegramConfigured()) {
    warnNotConfigured();
    return false;
  }
  try {
    await telegram.send(householdId, { text });
    return true;
  } catch (e) {
    console.error(`scheduler: ${what} send failed for household ${householdId}`, e);
    return false;
  }
}

/* ---------- the jobs ---------- */

async function sendDueReminders(now: Date) {
  const s = state();
  let due: Reminder[];
  try {
    due = await dueReminders(now);
  } catch (e) {
    console.error("scheduler: dueReminders failed", e);
    return;
  }
  for (const r of due) {
    const failures = s.reminderFailures.get(r.id) ?? 0;
    if (failures >= MAX_SEND_ATTEMPTS) continue; // gave up; stays unsent so a restart may retry
    const ok = await safeSend(r.householdId, reminderLine(r), "reminder");
    if (!ok) {
      s.reminderFailures.set(r.id, failures + 1);
      if (failures + 1 >= MAX_SEND_ATTEMPTS) console.error(`scheduler: giving up on reminder ${r.id} after ${MAX_SEND_ATTEMPTS} attempts`);
      continue;
    }
    s.reminderFailures.delete(r.id);
    try {
      await markSent(r.id);
    } catch (e) {
      console.error(`scheduler: markSent failed for reminder ${r.id}`, e);
    }
  }
}

/** Post the Kevin Report to a household's chat now. Returns the text. */
async function postWeeklyReport(householdId: string, houseName?: string): Promise<string> {
  const text = formatKevinReport(await kevinReport({ householdId }), { houseName });
  if (await safeSend(householdId, text, "weekly report")) state().weeklyPostedAt.set(householdId, new Date());
  return text;
}

/** Post one line about overdue upkeep, if any. Returns the line or null when nothing is overdue. */
async function postUpkeepNudge(householdId: string, now = new Date()): Promise<string | null> {
  const overdue = (await dueMaintenance({ householdId })).filter((m) => m.status === "overdue");
  if (overdue.length === 0) return null;
  const text = `🔧 Overdue: ${overdue.map((m) => m.item).join(", ")}. Somebody adult today, bestie. Even Kevin did the laundry 🧦`;
  if (await safeSend(householdId, text, "upkeep nudge")) state().upkeepPostedDay.set(householdId, localParts(now).day);
  return text;
}

/** Poll the house's AgentMail inbox once and post every new office message to the group. Returns what was posted. */
async function pollMailOnce(householdId: string): Promise<{ summary: string; threadId: string }[]> {
  if (!process.env.AGENTMAIL_API_KEY) return [];
  const fresh = await pollInbox(householdId);
  for (const m of fresh) {
    if (!telegramConfigured()) {
      warnNotConfigured();
      break;
    }
    try {
      // Button only with an absolute APP_URL: Telegram rejects relative button URLs and drops the whole message.
      const url = inboxUrl(m.threadId);
      await telegram.send(householdId, { text: m.summary, ...(url ? { buttons: [{ text: "📬 Open inbox", url }] } : {}) });
    } catch (e) {
      console.error(`scheduler: mail notification send failed for household ${householdId}`, e);
    }
  }
  return fresh;
}

async function runHouseholdJobs(now: Date) {
  const s = state();
  let houses: { id: string; name: string }[];
  try {
    houses = await householdsWithChat();
  } catch (e) {
    console.error("scheduler: householdsWithChat failed", e);
    return;
  }
  for (const h of houses) {
    try {
      if (shouldPostWeeklyReport(now, s.weeklyPostedAt.get(h.id) ?? null)) await postWeeklyReport(h.id, h.name);
    } catch (e) {
      console.error(`scheduler: weekly report failed for ${h.name}`, e);
    }
    try {
      if (shouldPostUpkeepNudge(now, s.upkeepPostedDay.get(h.id) ?? null)) {
        // Mark the day even when nothing is overdue so we don't re-query every minute of the 9 o'clock hour.
        s.upkeepPostedDay.set(h.id, localParts(now).day);
        await postUpkeepNudge(h.id, now);
      }
    } catch (e) {
      console.error(`scheduler: upkeep nudge failed for ${h.name}`, e);
    }
    try {
      await pollMailOnce(h.id);
    } catch (e) {
      console.error(`scheduler: mail poll failed for ${h.name}`, e);
    }
  }
}

/** One scheduler pass. Never rejects. */
async function tick(now = new Date()): Promise<void> {
  try {
    if (!telegramConfigured()) {
      warnNotConfigured();
      return;
    }
    await sendDueReminders(now);
    await runHouseholdJobs(now);
  } catch (e) {
    console.error("scheduler: tick failed", e);
  }
}

export function startScheduler() {
  const g = globalThis as { __kevinScheduler?: NodeJS.Timeout };
  if (g.__kevinScheduler) return;
  g.__kevinScheduler = setInterval(() => tick().catch((e) => console.error("scheduler", e)), TICK_MS);
  console.log("scheduler started");
}
