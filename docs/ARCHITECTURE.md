# Architecture

A tour of the code for people who want to change it. The [README](../README.md) covers setup and deployment.

## The one rule

All business logic lives in `src/services/`. There are two front doors:

- **Chat.** `src/agent/tools/*` wraps service functions as tools the model can call.
- **Dashboard.** `src/app/**` pages read services and write through server actions.

Neither door holds logic of its own. If a tool or a page needs to compute something, the computation belongs in a
service, where the other door and the tests can reach it.

## Data model

`src/db/schema.ts` (Drizzle, Postgres). Every table has a `household_id` except the two child tables noted below.

| Table | What it holds |
| --- | --- |
| `households` | Name, `telegram_chat_id` (unique), rent amount and due day (1-28), leasing office email, Kevin's inbox address |
| `members` | Roommates: name, optional `telegram_user_id`, `active` flag. Removing a roommate sets `active = false` |
| `expenses` | Payer, amount, description, `source` (`chat`, `ui` or `cart`) |
| `expense_splits` | One row per person per expense: their share. Keyed by expense, cascades on delete |
| `settlements` | A payment from one roommate to another |
| `cart_items` | Name, free-text quantity, who added it, `shared` flag, price estimate, `status` (`open` or `purchased`) |
| `chores` | Name and cadence in days |
| `chore_logs` | Who did which chore, and when. Keyed by chore |
| `reminders` | Text, due time, optional member (null means everyone), `recurring` (`monthly` or null), `sent_at` |
| `emails` | A local copy of mail sent to and received from the leasing office, with the AgentMail thread id |
| `maintenance` | Upkeep items: name, cadence in days, last done |
| `chat_log` | Every group message. `member_id` null means Kevin said it |

Conventions:

- **Money is integer cents** in every table and every service. Column names end in `cents`. `dollars()` in
  `src/services/types.ts` formats for display.
- Timestamps are `timestamptz`.
- Mastra's memory creates its own `mastra_*` tables in the same database. `drizzle.config.ts` filters them out so
  `npm run db:push` leaves them alone.
- There are no migration files. `db:push` syncs the schema directly.

## Services

Every service function has the shape `(ctx, input) => result`.

```ts
type Ctx = {
  householdId: string;
  actorId: string;          // members.id of whoever is acting
  source?: "chat" | "ui";
};
```

`ctx.actorId` is the sender in chat and the selected roommate in the dashboard. Services use it as the default
payer, doer or adder. Read-only functions take `Pick<Ctx, "householdId">`. A few functions used only by the
router and the scheduler take plain ids instead of a `Ctx`.

Import services through the namespace file: `import { money } from "@/services"`.

| Module | Main exports |
| --- | --- |
| `members` | `householdForTelegramChat`, `linkTelegram`, `listMembers`, `addMember`, `renameMember`, `removeMember`, `getHousehold`, `updateHouseSettings` |
| `money` | `logExpense`, `getBalances`, `getSettlePlan`, `settleUp`, `listExpenses`; pure: `splitEvenly`, `computeSettlePlan` |
| `cart` | `addItems`, `removeItem`, `removeItemById`, `listOpenItems`, `viewCart`, `checkout`, `markPurchased`; pure: `cartTotal`, `computeCartSplits` |
| `chores` | `addChore`, `logChore`, `choreStatus`, `hallOfShame`, `removeChore`; pure: `pickChore`, `whoseTurn`, `rankShame`, `countStreak` |
| `reminders` | `setReminder`, `listReminders`, `cancelReminder`, `syncRentReminder`, `dueReminders`, `markSent`; pure: `addOneMonth`, `nextRentDue` |
| `leasing` | `sendToLeasing`, `createWorkOrder`, `leasingStatus`, `inboxThreads`, `openThread`, `unreadCount`, `handleInboundEmail`, `pollInbox`; pure: `isStoredEmail` |
| `upkeep` | `addMaintenance`, `markDone`, `listMaintenance`, `dueMaintenance`, `addDefaults`; pure: `statusFor`, `pickByName` |
| `report` | `kevinReport`, `formatKevinReport`, `shouldPostWeeklyReport`, `shouldPostUpkeepNudge` |
| `chatlog` | `logMessage`, `recentChatter`, `lastKevinReplyAt`, `humanMessagesSince` |

The pure helpers have no database access and are what `npm test` covers.

Some behaviour worth knowing before you change it:

- **Even splits** give leftover cents to the payer first, then to the others in order. Splits always sum to the
  expense exactly.
- **Balances** are paid minus owed, plus settlements sent, minus settlements received. Roommates who moved out
  stay in the ledger while their balance is not zero, so the house always nets to zero.
- **The settle-up plan** is greedy: the biggest debtor pays the biggest creditor, repeat.
- **Buying the cart** flips the open items to `purchased` and writes one expense inside one transaction, so a
  double click cannot charge twice. Each person's share is weighted by the estimates of their own items; shared
  items are spread evenly.
- **Price estimates** come from the table in `src/lib/prices.ts`, matched on whole words, with a default for
  unknown items. The model never prices anything.
- **The rent reminder** is the unsent monthly reminder for everyone whose text starts with `Rent $`. There is no
  dedicated column. `syncRentReminder` deletes and recreates it whenever house settings are saved.

## The agent

`src/agent/kevin.ts` exports one function:

```ts
askKevin(ctx: Ctx, input: string, chatter?: string[], opts?: { mayStaySilent?: boolean }): Promise<Outgoing>
```

It builds a Mastra `Agent` for each request. That is cheap, and it lets the tools close over the caller's `Ctx`,
so a tool can never act for another household. The instructions are the persona, the list of roommates, the
current time in UTC and the house time zone. `maxSteps` is 6. The result is `{ text, buttons }`.

The persona block also carries the rules that keep the model honest: log what people say with tools, never do
math, state facts from tools exactly, ask when a name does not match a roommate.

### The model

`src/lib/llm.ts` is one line:

```ts
export const model = `neon/${process.env.LLM_MODEL ?? "claude-sonnet-5"}` as const;
```

Mastra's model router takes strings of the form `provider/model-id` and looks the provider up in the registry
bundled with `@mastra/core`. For `neon` that registry says: base URL `${NEON_AI_GATEWAY_BASE_URL}/v1`, API key
from `NEON_AI_GATEWAY_TOKEN`. That is why those two variables appear nowhere in `src`.

The same registry lists other providers in the same format, for example `openai/...` (reads `OPENAI_API_KEY`),
`anthropic/...` (reads `ANTHROPIC_API_KEY`) and `openrouter/...` (reads `OPENROUTER_API_KEY`). To use one, change
the prefix in `src/lib/llm.ts` and set that provider's key. Notes:

- This project has only been run against the Neon gateway.
- The model must support tool calling.
- `scripts/kevin-smoke.ts` checks for the two Neon variables before it runs. Update that check if you switch.
- `scripts/smoke-llm.ts` is the quickest test of a new model: one text reply and one tool call.

### Tools

`makeTools(ctx, outbox)` in `src/agent/tools/index.ts` merges one file per module. Each tool is a Mastra
`createTool` with a zod input schema and an `execute` that calls a service.

| Tool id | Service call |
| --- | --- |
| `list_members` | `members.listMembers` |
| `log_expense` | `money.logExpense` |
| `get_balances` | `money.getBalances` + `money.getSettlePlan` |
| `settle_up` | `money.settleUp` |
| `list_expenses` | `money.listExpenses` |
| `cart_add` | `cart.addItems` |
| `cart_remove` | `cart.removeItem` |
| `cart_view` | `cart.viewCart` |
| `cart_checkout` | `cart.checkout` |
| `cart_purchased` | `cart.markPurchased` |
| `log_chore` | `chores.logChore` |
| `add_chore` | `chores.addChore` |
| `chore_status` | `chores.choreStatus` + `chores.hallOfShame` |
| `kevin_report` | `report.kevinReport` + `report.formatKevinReport` |
| `set_reminder` | `reminders.setReminder` |
| `list_reminders` | `reminders.listReminders` |
| `cancel_reminder` | `reminders.listReminders` + `reminders.cancelReminder` |
| `create_work_order` | `leasing.createWorkOrder` |
| `email_leasing` | `leasing.sendToLeasing` |
| `leasing_status` | `leasing.leasingStatus` |
| `add_maintenance` | `upkeep.addMaintenance` |
| `maintenance_done` | `upkeep.markDone` |
| `maintenance_status` | `upkeep.listMaintenance` or `upkeep.dueMaintenance` |

What a tool is allowed to do besides calling the service:

- **Convert units.** The model passes dollars; `toCents()` converts. Results go back in cents, and the tool
  description says so.
- **Resolve names.** `memberIdByName()` matches a first name, case-insensitive. An unknown name throws an error
  that lists the roommates, and the model asks the user.
- **Attach buttons.** Tools call `pushButton(outbox, text, url)` with a link from `dashboardUrl()` or
  `inboxUrl()` (`src/lib/urls.ts`). `askKevin` returns the buttons next to the text and the channel renders
  them. Tools never return a URL for the model to paste. Those helpers return null unless `APP_URL` is an
  absolute http(s) URL, and then no button is attached, because Telegram rejects a message with a relative
  button link.

### Memory

One Mastra `Memory` backed by `PostgresStore` on `DATABASE_URL`. Each household has a single thread,
`household-<id>`, with the household id as the resource, and the last 30 messages are replayed. Chat and the
dashboard drawer share that thread.

Telegram turns get extra context: the router passes the last two hours of group chat (up to 30 lines) from
`chat_log`, so Kevin knows what was said while nobody was talking to him.

## When Kevin speaks

`src/router.ts` handles every incoming Telegram message:

1. Find or create the household for the chat, and the member for the sender.
2. Log the message to `chat_log`.
3. Decide: `reply`, `maybe` or `ignore`.
4. On `reply` or `maybe`, call `askKevin`. Log Kevin's answer with `member_id` null.

The decision is in `src/router-policy.ts`, which is pure and unit-tested.

**Hard triggers** always produce `reply`: a voice note, a reply to one of Kevin's messages, an `@username`
mention, or the word "kevin" (`/\bkevin\b/i`).

**The attention window** produces `maybe`. It is open when both are true:

- Kevin's last logged reply is at most 3 minutes old (`ATTENTION_WINDOW_MS = 180_000`).
- Fewer than `ATTENTION_MAX_FOLLOW_UPS = 4` human messages have been logged since that reply. The message being
  handled is already counted, so Kevin weighs the first, second and third follow-up, and the fourth closes the
  window.

A `maybe` message goes to the model with one extra instruction: answer exactly `[silent]` if this is not for
you. `parseSilent()` reads the answer. A silent answer is dropped: nothing is sent, nothing is logged and the
window is not refreshed. A real answer is logged, which refreshes the window, so a real back-and-forth keeps
going.

**Everything else** is `ignore`: logged as context, no model call.

Both facts come from `chat_log`, so the window survives restarts. Scheduled posts are sent straight to Telegram
and never logged, so they never open a window. The dashboard's `/api/chat` calls `askKevin` directly and never
sets `mayStaySilent`.

## Telegram

`src/channels/telegram.ts` is a grammY bot. It handles text and voice messages, turns them into an
`IncomingMessage`, calls the router and sends the reply with an inline keyboard for the buttons. It also exports
`telegram.send(householdId, msg)`, which the scheduler and the mail webhook use. `send` does nothing for a house
with no `telegram_chat_id`.

- In production, `src/app/api/telegram/route.ts` is the webhook. It checks Telegram's secret token header against
  `TELEGRAM_WEBHOOK_SECRET` and answers after 55 seconds at the latest.
- Locally, `scripts/poll.ts` runs the same bot with long polling.

The agent and the services never import Telegram. `src/channels/types.ts` defines the `Channel` interface that a
second channel would implement.

### Identity

- `householdForTelegramChat` finds the house by chat id. An unknown chat gets a new house named after the group.
- `linkTelegram` finds the member by Telegram user id. Failing that, it claims an unlinked member with the same
  first name. Failing that, it creates a member.

## Voice

1. The bot downloads the voice note from Telegram (ogg/opus).
2. `src/lib/voice.ts` posts it to OpenRouter's chat completions API as an `input_audio` part with a "transcribe
   verbatim" prompt, using `STT_MODEL`.
3. The reply text is cleaned up and becomes the message text.
4. The router treats it as a hard trigger, so a voice note always gets an answer. It is logged with a `(voice)`
   prefix.

If `OPENROUTER_API_KEY` is missing, transcription throws, the error is logged, and no reply is sent.

## Scheduler

`src/instrumentation.ts` starts `src/jobs/scheduler.ts` once when the Node server boots, unless
`DISABLE_SCHEDULER=1`. It is a `setInterval` with a 60 second tick. A tick never throws, and it returns
immediately when `TELEGRAM_BOT_TOKEN` is empty.

| Job | When | Guard |
| --- | --- | --- |
| Due reminders | Every tick: all unsent reminders with `due_at <= now`, across households | `sent_at` in the database. A monthly reminder inserts next month's copy when sent. After 3 failed sends the reminder is skipped until restart (in memory) |
| Weekly report | Sunday 18:00-18:59 `America/Chicago` | Not posted in the last 20 hours (in memory, per household) |
| Upkeep nudge | 09:00-09:59 `America/Chicago`, only if something is overdue | Once per local calendar day (in memory, per household) |
| Leasing inbox poll | Every tick, if `AGENTMAIL_API_KEY` is set | See Email below |

The last three run only for households with a bound Telegram chat.

The in-memory guards live on `globalThis` so they survive hot reloads in development. They do not survive a
restart and are not shared between instances. That is why the app runs on exactly one machine, and why a restart
inside the Sunday window can post the report twice.

Reminder messages are one of six lines in Kevin's voice, picked by a hash of the reminder id so the same
reminder always reads the same.

## Email

`src/lib/agentmail.ts` is a thin AgentMail client. An inbox id is the inbox's email address.
`src/services/leasing.ts` is everything else.

**Addresses.** Each house stores `inbox_address` and `leasing_email`. A house without an inbox of its own falls
back to `AGENTMAIL_INBOX` for sending and polling. The dashboard's Inbox page still asks for both addresses in
house settings.

**Sending.** `sendToLeasing` sends from the inbox to the leasing address, or replies in a thread, and stores a
copy in `emails` with direction `out`. `createWorkOrder` formats a subject and body and calls it. Without
`AGENTMAIL_API_KEY`, or without both addresses, these throw a message that says what to set.

**Receiving** has three paths that can all see the same message:

- **The poll** (`pollInbox`, from the scheduler). It lists threads, looks only at unread ones, and re-fetches a
  thread only when its timestamp moved since the last poll, so an idle inbox costs one list call per tick. New
  received messages are stored and posted to the group with an "Open inbox" button. The poll marks nothing read.
- **The webhook** (`src/app/api/agentmail/route.ts` -> `handleInboundEmail`). `src/lib/agentmail-webhook.ts`
  verifies the signature and maps the `message.received` event to an email; other events are acknowledged and
  dropped. The service finds the house by the receiving inbox, stores the message and posts a summary to the
  group. With `AGENTMAIL_WEBHOOK_SECRET` set, a delivery needs a valid signature (HMAC-SHA256 over the id,
  timestamp and raw body, timestamp within five minutes) or it gets a 401. With it unset, nothing is checked.
- **Opening a thread** in the dashboard (`openThread`). It marks the thread read for everyone and stores any
  message that is missing locally.

**Dedupe.** AgentMail's message id is not stored. `isStoredEmail` treats a received message as already stored
when a row in the same thread has the same timestamp, or the same normalized subject and body (first 300
characters), or the same subject and a creation time within 10 minutes after the message's timestamp. That keeps
the three paths from storing or announcing a message twice.

The poll alone is enough. The webhook only makes notifications faster.

**The dashboard inbox** reads threads straight from AgentMail, so every roommate sees the same mailbox and the
same unread state. `leasingStatus` (behind "check the work order") is a read-only glance at the latest threads.

## Dashboard

Next.js App Router, server components throughout. `src/app/members/page.tsx` is the reference page.

- **Reading.** A page calls `dashboardCtx()` and then service functions, and renders the result. Pages are
  `export const dynamic = "force-dynamic"`.
- **Writing.** A server action in the same file builds the `ctx` again, calls a service, then calls
  `revalidatePath`. Most actions revalidate the whole layout because the Home report and the nav badge depend on
  everything.
- **Who is acting.** `src/lib/dashboard.ts` returns the oldest household and the member id from the `actor`
  cookie, or the first roommate when the cookie is missing. The "Acting as" picker in the header sets the cookie.
  There are no accounts.
- **Ask Kevin.** `src/components/ask-kevin.tsx` is a client drawer that posts to `/api/chat`, which calls
  `askKevin` with the same `ctx`. After each answer it calls `router.refresh()` so the cards behind it update.
  The transcript is kept in `sessionStorage`.
- **Access.** `src/proxy.ts` (the Next.js Proxy file, formerly called middleware) is an optional password gate.
  With `DASHBOARD_PASSWORD` unset or empty, every request passes. With it set, every page, the server actions
  behind the forms and `/api/chat` require HTTP Basic auth with that password and any username. Its `matcher`
  leaves `/api/telegram`, `/api/agentmail`, `/_next/*` and `/favicon.ico` open. The header parsing and the
  constant-time comparison are in `src/lib/basic-auth.ts`. It is one shared password, not accounts: once in, the
  "Acting as" picker still lets you act as any roommate.

| Route | Page |
| --- | --- |
| `/` | The Kevin Report as cards: who pays whom, chores, Hall of Shame, coming up, upkeep due |
| `/money` | Balances, settle-up plan with "Mark paid", record a payment, add an expense, recent expenses |
| `/cart` | Open items by person, add and remove, estimated total, "Mark purchased" with a receipt total |
| `/cart/checkout` | Kevin's Market, the simulated store: order summary, split preview, "Place order (simulated)" |
| `/chores` | Chore board with "I did it", Hall of Shame, add a chore |
| `/reminders` | Upcoming reminders, cancel, set a new one (one-off or monthly) |
| `/inbox` | Shared mailbox: threads, replies, work order form, new email |
| `/upkeep` | Upkeep items with status, "Done", add an item, load the default list |
| `/members` | Roommates (add, rename, remove) and house settings |

The reminder form posts the browser's UTC offset in a hidden field (`src/components/tz-offset.tsx`) so a
`datetime-local` value is stored as the instant the user meant.

### Theming

All styles are in `src/app/globals.css`. There is no CSS framework.

- **Tokens.** Colors, shadows and the radius are CSS custom properties on `:root`, with a dark set under
  `prefers-color-scheme: dark`.
- **Accents.** Each page sets `data-accent` on `<main>`: `red`, `green`, `gold`, `ice` or `candy`. That attribute
  remaps `--accent`, `--accent-soft`, `--accent-text` and `--accent-ink`, and components use only those four.
  A new page picks an accent and gets matching headings, pills and buttons for free.
- **Motion.** Animations use opacity, transform and box-shadow only. Everything is switched off under
  `prefers-reduced-motion: reduce`. Keep both properties true when you add one.
- **Shared pieces.** `PageHead`, `Empty` and `NoHousehold` in `src/components/ui.tsx`.

## Adding a module

Say you want a guest log. Work from the inside out:

1. **Schema.** Add the table to `src/db/schema.ts` with a `household_id`. Amounts in integer cents. Run
   `npm run db:push`.
2. **Service and unit test.** Add `src/services/guests.ts` with `(ctx, input) => result` functions and export it
   from `src/services/index.ts`. Keep the decisions in pure helpers and test those in `guests.test.ts`.
3. **Tool.** Add `src/agent/tools/guests.ts` and merge it in `src/agent/tools/index.ts`. Write the description
   for the model: when to use it, defaults, units. Resolve names with `memberIdByName()`.
4. **Tool database test.** Add cases to `src/agent/tools/tools.dbtest.ts` and run `npm run test:tools`.
5. **Page.** Add `src/app/guests/page.tsx` following the members page, pick an accent, and add the route to
   `NAV` in `src/components/nav-links.tsx`.
6. **Report and scheduler, if relevant.** If the module belongs in the Kevin Report, add it to `kevinReport` and
   `formatKevinReport` in `src/services/report.ts` and to the Home page. If Kevin should bring it up on his own,
   add a job to `src/jobs/scheduler.ts` with a guard against double posting.

Then say it to Kevin and click it in the dashboard. Both should do the same thing.
