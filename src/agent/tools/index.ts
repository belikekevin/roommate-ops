import type { Ctx } from "@/services/types";
import type { Button } from "@/channels/types";
import { memberTools } from "./members";
import { moneyTools } from "./money";
import { cartTools } from "./cart";
import { choreTools } from "./chores";
import { reminderTools } from "./reminders";
import { leasingTools } from "./leasing";
import { upkeepTools } from "./upkeep";

/** Side channel for tools to attach things to Kevin's reply (e.g. the Checkout button). */
export type ToolOutbox = { buttons: Button[] };

export function makeTools(ctx: Ctx, outbox: ToolOutbox) {
  return {
    ...memberTools(ctx),
    ...moneyTools(ctx),
    ...cartTools(ctx, outbox),
    ...choreTools(ctx),
    ...reminderTools(ctx),
    ...leasingTools(ctx, outbox),
    ...upkeepTools(ctx),
  };
}
