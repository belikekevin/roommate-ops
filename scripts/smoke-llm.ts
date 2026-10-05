// Smoke test: Neon AI Gateway + model id + tool calling, no DB or Telegram.
// npx tsx --env-file=.env scripts/smoke-llm.ts
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { model } from "../src/lib/llm";

let toolCalled = false;
const roll = createTool({
  id: "roll_die",
  description: "Roll a die. Always use this when asked for a random number.",
  inputSchema: z.object({ sides: z.number().int().positive() }),
  execute: async ({ sides }) => {
    toolCalled = true;
    return { result: 1 + Math.floor(Math.random() * sides) };
  },
});

const agent = new Agent({ id: "smoke", name: "Smoke", instructions: "Be brief.", model, tools: { roll } });

console.log(`model: ${model}`);
const hi = await agent.generate("Say hi in five words.");
console.log("text:", hi.text);
const tool = await agent.generate("Roll a 20-sided die and tell me the result.");
console.log("tool:", tool.text, toolCalled ? "(tool called ✓)" : "(tool NOT called ✗)");
process.exit(toolCalled ? 0 : 1);
