// LLM smoke test: runs the demo utterances through askKevin against the REAL first household.
// Run: npm run kevin:smoke      (set KEVIN_HOUSEHOLD_ID to pick a house; defaults to the first one)
// It writes demo-ish rows (expenses, chore logs, reminders, cart items) to that household. That's the point.
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../src/db";

const UTTERANCES = [
  "Kevin, add 3 bags of chips for me",
  "I paid $60 for internet",
  "I did the dishes",
  "remind everyone trash goes out Tuesday 8pm",
  "the sink is leaking, tell the leasing office",
  "who owes what?",
  "what's the kevin report?",
  "mark the trash as done for Alex",
];

const baseUrl = process.env.NEON_AI_GATEWAY_BASE_URL ?? "";
const apiKey = process.env.NEON_AI_GATEWAY_TOKEN ?? "";
if (!baseUrl || baseUrl.includes("<") || !apiKey || apiKey.startsWith("napi_")) {
  console.log("LLM gateway not configured — set NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN (gateway credential, scope ai_gateway:invoke; not a napi_ key) in .env.");
  console.log("Nothing was sent to the model. Tool-level proof: npm run test:tools");
  process.exit(0);
}

const households = await db.select().from(schema.households).orderBy(schema.households.createdAt);
const house = process.env.KEVIN_HOUSEHOLD_ID ? households.find((h) => h.id === process.env.KEVIN_HOUSEHOLD_ID) : households[0];
if (!house) {
  console.error(process.env.KEVIN_HOUSEHOLD_ID ? `No household ${process.env.KEVIN_HOUSEHOLD_ID}` : "No households. Run npm run seed first.");
  process.exit(1);
}
const people = await db.select().from(schema.members).where(eq(schema.members.householdId, house.id)).orderBy(schema.members.createdAt);
const actor = people.find((m) => m.active) ?? people[0];
if (!actor) {
  console.error(`Household "${house.name}" has no members.`);
  process.exit(1);
}

console.log("=".repeat(72));
console.log(`KEVIN SMOKE  house="${house.name}" (${house.id})  actor=${actor.name}  model=${process.env.LLM_MODEL ?? "claude-sonnet-5"}`);
console.log("This WRITES real rows (expenses, chore logs, reminders, cart items) to that household.");
console.log("Leasing turns will email the leasing office if AGENTMAIL_API_KEY + leasing email are set.");
console.log("=".repeat(72));

async function counts() {
  const n = async (table: typeof schema.expenses | typeof schema.reminders | typeof schema.cartItems) =>
    Number((await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.householdId, house!.id)))[0].n);
  const choreLogs = Number(
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.choreLogs)
        .innerJoin(schema.chores, eq(schema.choreLogs.choreId, schema.chores.id))
        .where(eq(schema.chores.householdId, house!.id))
    )[0].n,
  );
  return { expenses: await n(schema.expenses), chore_logs: choreLogs, reminders: await n(schema.reminders), cart_items: await n(schema.cartItems) };
}

const { askKevin } = await import("../src/agent/kevin");
const ctx = { householdId: house.id, actorId: actor.id, source: "chat" as const };

let failures = 0;
for (const [i, text] of UTTERANCES.entries()) {
  const input = `[${actor.name}] ${text}`;
  console.log(`\n[${i + 1}/${UTTERANCES.length}] > ${input}`);
  const before = await counts();
  const t0 = Date.now();
  try {
    const out = await askKevin(ctx, input);
    console.log(`Kevin: ${out.text}`);
    if (out.buttons?.length) console.log(`  buttons: ${out.buttons.map((b) => `${b.text} -> ${b.url}`).join(" | ")}`);
  } catch (err) {
    failures++;
    console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
  const after = await counts();
  const delta = (Object.keys(before) as (keyof typeof before)[])
    .map((k) => `${k} ${before[k]}->${after[k]}${after[k] !== before[k] ? ` (${after[k] - before[k] > 0 ? "+" : ""}${after[k] - before[k]})` : ""}`)
    .join("  ");
  console.log(`  db: ${delta}  (${Date.now() - t0} ms)`);
}

console.log(`\n${failures ? `${failures} turn(s) errored` : "all turns completed"}.`);
process.exit(failures ? 1 : 0);
