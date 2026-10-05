# roommate-ops

Instructions for AI coding agents working in this repository. People: start with [README.md](README.md).

- **What it is:** a shared household agent ("Kevin") for roommates and families. A Telegram bot and a Next.js dashboard over one Postgres database: bills, a shared grocery cart, chores, reminders, leasing-office email and upkeep.
- **Stack:** Next 16 (App Router, server components and server actions), a Mastra agent with tools, Drizzle on Postgres, grammY for Telegram, AgentMail for email, OpenRouter for voice transcription. TypeScript, ESM, Node 22.
- **The one rule:** all business logic lives in `src/services/`. Kevin's tools (`src/agent/tools/`) and the dashboard (`src/app/`) are thin front doors that call the same service functions. Anything you can do in chat must be doable in the UI, and vice versa.
- **Services** take `ctx: Ctx` first (`householdId`, `actorId`, `source`). `ctx.actorId` is the default payer, doer or adder.
- **Money** is integer cents in services and the database. Tools take dollars from the model and convert with `toCents()`. The model never does math.
- **Tools** resolve names with `memberIdByName()` and attach chat buttons through the `outbox`, never by pasting URLs.
- **Pages** are `force-dynamic` server components that read services; server actions write through services, then call `revalidatePath`. `src/app/members/page.tsx` is the reference.
- **Kevin's copy** is playful, never mean: 1 to 3 short lines, roast the chore and not the person, no house emoji.
- **Before you finish:** `npm run typecheck` and `npm test` must pass. `npm run test:tools` needs a database. `npm run kevin:smoke` needs the LLM and writes rows.
- **Never** commit `.env`, and never put real addresses, chat ids or tokens in code, docs or seed data.

Conventions, tests and PR etiquette: [CONTRIBUTING.md](CONTRIBUTING.md). Data model, agent, router, scheduler and how to add a module: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
