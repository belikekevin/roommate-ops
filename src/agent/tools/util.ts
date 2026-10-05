import { listMembers } from "@/services/members";
import type { Ctx } from "@/services/types";
import type { ToolOutbox } from "./index";

export { dashboardUrl, inboxUrl, isAbsoluteUrl } from "@/lib/urls";

export const toCents = (dollars: number) => Math.round(dollars * 100);

/** Case-insensitive first-name match. Unknown names throw so the model can ask. */
export async function memberIdByName(ctx: Ctx, name: string): Promise<string> {
  const people = await listMembers(ctx);
  const hit = people.find((p) => p.name.toLowerCase().startsWith(name.trim().toLowerCase()));
  if (!hit) throw new Error(`No roommate named "${name}". Roommates: ${people.map((p) => p.name).join(", ")}`);
  return hit.id;
}

/**
 * Attach a link button to Kevin's reply, once per URL. No-op when `url` is null, which is what dashboardUrl() returns
 * without an absolute APP_URL (Telegram rejects relative button links and then drops the whole message).
 */
export function pushButton(outbox: ToolOutbox, text: string, url: string | null): void {
  if (url && !outbox.buttons.some((b) => b.url === url)) outbox.buttons.push({ text, url });
}
