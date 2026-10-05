// Upkeep tools: recurring home maintenance (add, mark done, status).
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { upkeep } from "@/services";
import type { Ctx } from "@/services/types";

export const upkeepTools = (ctx: Ctx) => ({
  add_maintenance: createTool({
    id: "add_maintenance",
    description: "Track a recurring upkeep item, e.g. 'change the AC filter every 90 days'. Same name again just updates the cadence.",
    inputSchema: z.object({
      item: z.string().min(1).describe("e.g. 'Replace HVAC filter'"),
      everyDays: z.number().int().positive().describe("How often, in days"),
    }),
    execute: async (input) => {
      await upkeep.addMaintenance(ctx, input);
      return { ok: true };
    },
  }),
  maintenance_done: createTool({
    id: "maintenance_done",
    description: "Mark an upkeep item done today. Fuzzy name match ('hvac filter' finds 'Replace HVAC filter').",
    inputSchema: z.object({ item: z.string().min(1) }),
    execute: async (input) => {
      await upkeep.markDone(ctx, input);
      return { ok: true };
    },
  }),
  maintenance_status: createTool({
    id: "maintenance_status",
    description: "Upkeep items with next-due date and status (overdue / due-soon / ok), soonest first.",
    inputSchema: z.object({ dueOnly: z.boolean().optional().describe("true = only overdue or due within 7 days") }),
    execute: async ({ dueOnly }) => (dueOnly ? upkeep.dueMaintenance(ctx) : upkeep.listMaintenance(ctx)),
  }),
});
