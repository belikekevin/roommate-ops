// Backend of the dashboard's "Ask Kevin" panel. Same agent as Telegram, acting as the dashboard's selected member.
// The reply is one JSON object ({ text, buttons }), not a stream.
import { askKevin } from "@/agent/kevin";
import { listMembers } from "@/services/members";
import { dashboardCtx } from "@/lib/dashboard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };
  const ctx = await dashboardCtx();
  if (!ctx) return Response.json({ error: "no household yet" }, { status: 400 });
  const me = (await listMembers(ctx)).find((m) => m.id === ctx.actorId);
  try {
    const out = await askKevin(ctx, `[${me?.name ?? "Someone"}] ${text}`);
    return Response.json(out);
  } catch (err) {
    console.error("[api/chat]", err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
