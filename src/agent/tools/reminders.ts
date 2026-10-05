// Reminder tools: set, list, cancel.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { reminders } from "@/services";
import type { Ctx } from "@/services/types";
import { memberIdByName } from "./util";

export const reminderTools = (ctx: Ctx) => ({
  set_reminder: createTool({
    id: "set_reminder",
    description:
      "Set a reminder for the whole group (omit who) or one roommate ('remind everyone trash goes out Tuesday 8pm'). Resolve relative times yourself from the 'Now:' in your instructions; dueAt is ISO 8601 with timezone.",
    inputSchema: z.object({
      text: z.string().min(1).describe("What to say when it fires, e.g. 'Trash goes out'"),
      dueAt: z.string().describe("ISO 8601 with timezone, e.g. 2026-10-07T20:00:00-04:00"),
      who: z.string().optional().describe("Roommate name; omit for everyone"),
      monthly: z.boolean().optional().describe("true to repeat every month"),
    }),
    execute: async ({ text, dueAt, who, monthly }) =>
      reminders.setReminder(ctx, {
        text,
        dueAt: new Date(dueAt),
        memberId: who ? await memberIdByName(ctx, who) : undefined,
        recurring: monthly ? "monthly" : undefined,
      }),
  }),
  list_reminders: createTool({
    id: "list_reminders",
    description: "Upcoming reminders, soonest first, with ids.",
    inputSchema: z.object({}),
    execute: async () => reminders.listReminders(ctx),
  }),
  cancel_reminder: createTool({
    id: "cancel_reminder",
    description: "Cancel an upcoming reminder by id (from list_reminders) or by a few words of its text.",
    inputSchema: z.object({
      reminderId: z.string().optional(),
      text: z.string().optional().describe("Words from the reminder text, case-insensitive"),
    }),
    execute: async ({ reminderId, text }) => {
      const upcoming = await reminders.listReminders(ctx);
      const q = text?.trim().toLowerCase();
      const hit = upcoming.find((r) => (reminderId && r.id === reminderId) || (q && r.text.toLowerCase().includes(q)));
      if (!hit) {
        throw new Error(
          upcoming.length
            ? `No upcoming reminder matches that. Upcoming: ${upcoming.map((r) => `"${r.text}"`).join(", ")}`
            : "There are no upcoming reminders to cancel.",
        );
      }
      await reminders.cancelReminder(ctx, { reminderId: hit.id });
      return { cancelled: hit.text, id: hit.id };
    },
  }),
});
