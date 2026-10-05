import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { members } from "@/services";
import type { Ctx } from "@/services/types";

export const memberTools = (ctx: Ctx) => ({
  list_members: createTool({
    id: "list_members",
    description: "List the roommates in this house.",
    inputSchema: z.object({}),
    execute: async () => (await members.listMembers(ctx)).map((m) => m.name),
  }),
});
