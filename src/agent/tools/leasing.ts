// Leasing tools: work orders and other email to the leasing office, plus a read-only status check.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { leasing } from "@/services";
import type { Ctx } from "@/services/types";
import type { ToolOutbox } from "./index";
import { inboxUrl, pushButton } from "./util";

export const leasingTools = (ctx: Ctx, outbox: ToolOutbox) => {
  const inboxButton = (threadId?: string | null) => pushButton(outbox, "📬 Open inbox", inboxUrl(threadId));
  return {
    create_work_order: createTool({
      id: "create_work_order",
      description:
        "Email the leasing office a maintenance request ('the sink is leaking, tell the leasing office', broken AC). Use this, not email_leasing, for anything broken.",
      inputSchema: z.object({
        issue: z.string().min(1).describe("Short description, e.g. 'kitchen sink is leaking'"),
        location: z.string().optional().describe("Room, e.g. 'kitchen'"),
        urgency: z.enum(["low", "normal", "urgent"]).optional(),
      }),
      execute: async (input) => {
        const r = await leasing.createWorkOrder(ctx, input);
        inboxButton(r.threadId);
        return r;
      },
    }),
    email_leasing: createTool({
      id: "email_leasing",
      description: "Send any other email to the leasing office (questions, notices, lease stuff). Not for repairs.",
      inputSchema: z.object({ subject: z.string().min(1), body: z.string().min(1) }),
      execute: async (input) => {
        const r = await leasing.sendToLeasing(ctx, input);
        inboxButton(r.threadId);
        return r;
      },
    }),
    leasing_status: createTool({
      id: "leasing_status",
      description:
        "Check on work orders / what the leasing office said. Use for 'check the work order', 'did the office reply', 'any news from leasing'.",
      inputSchema: z.object({}),
      execute: async () => {
        const r = await leasing.leasingStatus(ctx);
        inboxButton(r.threads[0]?.threadId);
        return r;
      },
    }),
  };
};
