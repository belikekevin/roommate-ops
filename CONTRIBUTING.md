# Contributing

Thanks for wanting to help. This is a small project with a few firm conventions. Read this page and skim
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before a larger change.

## Dev setup

Follow the [Quick start](README.md#quick-start). In short: Node 22, `npm install`, copy `.env.example` to `.env`,
`npm run db:push`, `npm run seed:demo`, `npm run dev`.

Use a database you can throw away. `seed:demo` rebuilds the demo house and `kevin:smoke` writes rows.

Most changes can be built and tested with only `DATABASE_URL`. You need the LLM gateway to talk to Kevin, and a
Telegram bot only for chat-specific work.

## The one rule

All business logic lives in `src/services/`. Tools in `src/agent/tools/` and pages in `src/app/` are thin front
doors that call the same service functions. Anything a roommate can do in chat should be doable in the dashboard,
and the other way round.

If you are writing an `if` about money, turns or dates inside a tool or a page, move it to a service.

## Conventions

- **Cents.** Money is integer cents in the database and in every service. Tools accept dollars from the model and
  convert with `toCents()`. The model never does math; totals, splits and balances come from services.
- **`ctx` first.** Every service function is `(ctx, input) => result`. Use `ctx.actorId` as the default payer,
  doer or adder. Scope every query by `ctx.householdId`.
- **Signatures are the contract.** Change a service body freely. Change a signature together with its tool, its
  page and its tests.
- **Tools resolve names.** Use `memberIdByName()`. Let it throw on an unknown name so the model asks the user
  instead of guessing.
- **Buttons go through the outbox.** A tool calls `pushButton(outbox, text, dashboardUrl("/path"))`. It never
  returns a URL for the model to paste.
- **Tool descriptions are for the model.** Say when to use the tool, what the defaults are and which units go in
  and out.
- **Pages.** Server components read services. Server actions write through services, then `revalidatePath`.
  Pages are `force-dynamic`. `src/app/members/page.tsx` is the reference. Style with the existing tokens and a
  `data-accent`; respect `prefers-reduced-motion`.
- **Kevin's copy.** Playful, never mean. Roast the chore, not the person. One to three short lines. Facts stay
  exact; jokes go around them. No profanity. No house emoji: the persona bans it, so the UI and scheduled
  messages skip it too.
- **No real identifiers.** No real names, email addresses, chat ids, URLs of live deployments or tokens in code,
  docs, tests or seed data.

## Tests

Before you open a pull request:

```sh
npm run typecheck
npm test
```

Both must pass; CI runs the same two commands.

- New or changed service logic needs a unit test. Put the decision in a pure helper and test it in
  `src/services/<module>.test.ts`. Unit tests run without `.env` and without a database.
- New or changed tools need a case in `src/agent/tools/tools.dbtest.ts`. Run `npm run test:tools` against your
  dev database. It works in a throwaway household and cleans up after itself.
- If you changed the persona, a tool description or the router, run `npm run kevin:smoke` and read the replies.
  It needs the LLM and it writes rows, so do not point it at data you care about.

## Commits and pull requests

- Keep a pull request to one change. Small ones get reviewed quickly.
- Write commit subjects in the imperative and say what changed: "Split shared cart items evenly", not "fixes".
- In the description, say what the change does, how you tested it, and include a screenshot for anything
  visible.
- If you add an environment variable, add it to `.env.example` and to the Configuration table in the README.
- If you change behaviour that the docs describe, update the docs in the same pull request.
- Open an issue first for a new module or anything that changes the schema.

Security problems do not go in public issues. See [SECURITY.md](SECURITY.md).

By contributing you agree that your work is released under the [MIT license](LICENSE).
