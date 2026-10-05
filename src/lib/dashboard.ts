// The dashboard has no user accounts: it shows the first household and acts as the member named by the "actor" cookie
// (the "Acting as" picker in the header), the same way a chat message acts as its sender. Anyone who can open the
// site can therefore act as any roommate, so set DASHBOARD_PASSWORD on a public deployment (see src/proxy.ts).
import { cookies } from "next/headers";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { listMembers } from "@/services/members";
import type { Ctx } from "@/services/types";

export async function dashboardCtx(): Promise<Ctx | null> {
  const [house] = await db.select().from(schema.households).orderBy(asc(schema.households.createdAt)).limit(1);
  if (!house) return null;
  const people = await listMembers({ householdId: house.id });
  const actor = (await cookies()).get("actor")?.value;
  const actorId = people.find((m) => m.id === actor)?.id ?? people[0]?.id ?? "";
  return { householdId: house.id, actorId, source: "ui" };
}
