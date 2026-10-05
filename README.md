# roommate-ops

A shared household agent for families and roommates. "Kevin" lives in your Telegram group chat and on a web
dashboard. He splits bills, keeps a shared grocery cart, tracks chores, sends reminders and emails the leasing
office. The chat and the dashboard are two front doors to the same data, so anything you can say to Kevin you can
also click.

Kevin talks like the kid from Home Alone, left in charge of the house: brief, cheeky, never mean. The persona is a
prompt. The bookkeeping is plain code: balances, splits and totals come from tested service functions, never from
the model.

## What Kevin does

- **Bills and settle-up.** "I paid $60 for internet" is logged and split. Balances and a short list of who pays
  whom are always up to date.
- **Shared cart with a simulated checkout.** Items are filed under whoever asked for them, with price estimates
  from a built-in catalog. Checkout is a pretend store page inside the app ("Kevin's Market"). Nothing is bought;
  placing the order logs one expense split by who added what.
- **Chores and the Hall of Shame.** A chore chart with cadence, whose turn it is, streaks, and a ranking of who
  has done the least lately.
- **Reminders.** One-off or monthly, for one person or everyone. Set rent and a due day and the monthly rent
  reminder is created for you.
- **Leasing office email.** Kevin has his own mailbox. He sends work orders, posts replies into the group, and the
  dashboard has a shared inbox.
- **Upkeep.** Recurring house maintenance (filters, smoke alarms) with a morning nudge when something is overdue.
- **Weekly report.** Money, chores, reminders and upkeep in one message every Sunday evening, or on request.
- **Voice notes.** Send a Telegram voice note; it is transcribed and handled like a typed message.

## How it works

```
 Telegram group              Dashboard (Next.js)
       |                       |                        |
 POST /api/telegram      "Ask Kevin" drawer       pages + server
 (long polling locally)   POST /api/chat             actions
       |                       |                        |
 channels/telegram.ts          |                        |
   voice -> lib/voice.ts       |                        |
   (OpenRouter)                |                        |
       |                       |                        |
 router.ts                     |                        |
   logs every message,         |                        |
   decides if Kevin replies    |                        |
       |                       |                        |
       v                       v                        |
 agent/kevin.ts  askKevin(ctx, text)                    |
   Mastra agent <-> LLM gateway                         |
   memory: one thread per household                     |
       |                                                |
 agent/tools/*  (thin wrappers)                         |
       |                                                |
       v                                                v
 services/*   money  cart  chores  reminders  leasing  upkeep  report
       |
       v
 Postgres (Drizzle)

 jobs/scheduler.ts   in-process, every 60 s: due reminders, Sunday report,
                     09:00 upkeep nudge, leasing inbox poll -> Telegram group
 lib/agentmail.ts    Kevin's mailbox on AgentMail: send, read threads;
                     POST /api/agentmail receives inbound mail webhooks
```

**The one design rule:** all business logic lives in `src/services/`. Kevin's tools and the dashboard pages are
thin front doors that call the same service functions. The longer tour is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

You need:

- Node 22
- A Postgres connection string ([Neon](https://neon.com) works)
- An LLM gateway credential. As shipped, that is a Neon AI Gateway base URL and token.
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-agent) explains how to point at another provider.
- A Telegram bot from [@BotFather](https://t.me/BotFather)

Optional: an OpenRouter key for voice notes and an AgentMail key and inbox for email.

```sh
git clone https://github.com/belikekevin/roommate-ops.git
cd roommate-ops
npm install
cp .env.example .env     # fill in the values; see Configuration below
npm run db:push          # create the tables
npm run seed:demo        # demo house "Apt 4B": Sam, Riley, Alex and three weeks of history
npm run dev              # dashboard at http://localhost:3000
```

The dashboard works with only `DATABASE_URL` set. The Ask Kevin drawer also needs the LLM gateway values. Telegram
needs the bot token.

`npm run dev` also starts the scheduler, which posts reminders to Telegram. If a deployed instance already runs
against the same database, add `DISABLE_SCHEDULER=1` to your local `.env` so nothing is sent twice.

### Kevin in your Telegram group, locally

1. In @BotFather: `/newbot` gives you the token and username. Then `/setprivacy` -> Disable, so Kevin sees every
   group message and not only commands.
2. Add the bot to a group. If it was already in the group when you changed the privacy setting, remove it and add
   it again.
3. Bind the group to the seeded house. Put the group's chat id (a negative number, `-100...` for supergroups) in
   `.env` as `TELEGRAM_CHAT_ID` and run `npm run seed:demo` again. One way to find the id: send a message in the
   group, then open `https://api.telegram.org/bot<token>/getUpdates` and read `message.chat.id`. This only
   returns updates while no webhook is set and `npm run poll` is not running.
4. `npm run poll` starts long polling. Say "kevin hi" in the group.

Two things to know:

- A group that is not bound to any house gets a new, empty house on its first message. The dashboard shows the
  oldest house only, so bind the group before you start chatting.
- Roommates are matched to Telegram accounts by first name. A sender whose first name matches a roommate with no
  Telegram link claims that roommate. Anyone else is added as a new roommate. To play Sam, rename Sam to your
  Telegram first name on the Roommates page before your first message.

`npm run seed:demo` wipes and rebuilds the demo house's history every time. Do not run it against a house with
real data.

A scripted tour of the features is in [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).

## Configuration

Every variable the code reads. `.env.example` has the same list with placeholders.

| Variable | Required | What it is for | Where to get it |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres for app data and Kevin's conversation memory | Neon Console -> branch -> Connect (pooled string, `sslmode=require`), or any Postgres |
| `NEON_AI_GATEWAY_BASE_URL` | For the agent | Base URL of the LLM gateway. Bare host, no `/v1` | Neon Console -> branch -> Connect -> "AI Gateway" tab |
| `NEON_AI_GATEWAY_TOKEN` | For the agent | Gateway credential (scope `ai_gateway:invoke`). Not a `napi_` API key | Same tab, "Reveal credential" |
| `LLM_MODEL` | No | Model id on the gateway. Default `claude-sonnet-5` | `curl "$NEON_AI_GATEWAY_BASE_URL/v1/models" -H "Authorization: Bearer $NEON_AI_GATEWAY_TOKEN"` |
| `TELEGRAM_BOT_TOKEN` | For Telegram | The bot. Without it the scheduler sends nothing. `npm run build` needs it to be non-empty | @BotFather -> `/newbot` |
| `TELEGRAM_BOT_USERNAME` | No | Lets `@your_bot` mentions trigger a reply | @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | For webhooks | Telegram sends it with every webhook call and the route rejects calls without it | Make one up: 1-256 chars of `A-Z a-z 0-9 _ -` |
| `TELEGRAM_CHAT_ID` | No (seed only) | Binds the seeded house to your group so Kevin can post unprompted | See the Telegram steps above |
| `OPENROUTER_API_KEY` | No | Voice note transcription. Without it voice notes get no reply | openrouter.ai -> Keys |
| `STT_MODEL` | No | Audio-capable chat model used to transcribe. Default `google/gemini-2.5-flash` | OpenRouter model list |
| `AGENTMAIL_API_KEY` | No | Kevin's mailbox. Without it the email features report that they are not configured | agentmail.to |
| `AGENTMAIL_INBOX` | No | Kevin's inbox address. The seed writes it into a newly created demo house, and it is the fallback "from" address for a house with no inbox of its own | Create an inbox in AgentMail and use its address |
| `AGENTMAIL_WEBHOOK_SECRET` | No | Signing secret (`whsec_...`) for the optional AgentMail webhook at `/api/agentmail`. When set, unsigned deliveries are rejected. When unset, the signature is not checked | Shown by AgentMail when you create the webhook |
| `LEASING_EMAIL` | No (seed only) | Leasing office address written into a newly created demo house. Default `leasing@example.com` | An address you control, so you can reply |
| `APP_URL` | For webhooks and buttons | Public URL of the app. Webhook target and base for the buttons in Kevin's replies | Your deployment, e.g. `https://your-app.fly.dev` |
| `DASHBOARD_PASSWORD` | No | When set, the dashboard and `/api/chat` require HTTP Basic auth: any username, this password | Make one up |
| `DISABLE_SCHEDULER` | No | Set to `1` to skip the in-process scheduler | - |
| `KEVIN_HOUSEHOLD_ID` | No (scripts only) | Which house `npm run seed` and `npm run kevin:smoke` act on. Default: the first one | `households.id` in the database |

The platform sets three more that the code reads: `NEXT_RUNTIME` and `NODE_ENV` (set by Next.js) and `PORT` (used
by `npm start`, default 3000).

The leasing office address and Kevin's inbox address are stored per house. The seed fills them from
`LEASING_EMAIL` and `AGENTMAIL_INBOX` only when it creates the house. After that, change them in the dashboard
under Roommates -> house settings. The Inbox page needs both.

## Talking to Kevin

Every text message in the group is logged so Kevin has context. He replies when one of these is true:

- the message contains the word "kevin" (any case)
- it mentions the bot's `@username`
- it is a reply to one of his messages
- it is a voice note

After he replies, he keeps listening for 3 minutes, for up to 3 follow-up messages. "Kevin, add oat milk" and then
"and 2 bags of chips too" works without saying his name again. During that window he may decide a message is just
roommates talking and stay silent. His own scheduled posts (reminders, the report, mail notices) do not open the
window. In the dashboard's Ask Kevin drawer every message goes to him and he always answers.

You do not need exact phrases. These are examples of what he handles:

| Say | What happens |
| --- | --- |
| Kevin, I paid $60 for internet | Logs a $60.00 expense paid by you, split evenly across everyone |
| Kevin, I paid $45 for pizza, split it with Riley | Same, split only between the people named |
| Kevin, who owes what? | Balances and the shortest list of payments that settles them |
| Kevin, I paid Riley back $30 | Records the payment |
| Kevin, add 3 bags of chips for me | Adds the item to the cart under your name with a price estimate. In Telegram the reply carries View cart and Checkout buttons |
| Kevin, add paper towels for the house | Adds a shared item, split evenly at purchase |
| Kevin, what's in the cart? | The open cart grouped by person, with an estimated total |
| Kevin, I bought the groceries, $84 | Logs one $84.00 expense split by who added what and clears the cart |
| Kevin, I did the dishes | Matches "dishes" to the chore chart, logs it for you, reports your streak |
| Kevin, add vacuuming every 7 days | Puts a chore on the chart |
| Kevin, whose turn is the trash? | Last done, overdue or not, whose turn, and the Hall of Shame |
| Kevin, remind everyone trash goes out Tuesday 8pm | A one-off reminder for the group, delivered when due |
| Kevin, remind me to pay the internet bill on the 5th every month | A monthly reminder for you |
| Kevin, cancel the trash reminder | Cancels the matching reminder |
| Kevin, the kitchen sink is leaking, tell the leasing office | Emails a work order from Kevin's inbox |
| Kevin, check the work order | The latest status of the leasing threads and what the office said |
| Kevin, track the HVAC filter every 90 days | Adds a recurring upkeep item |
| Kevin, I replaced the HVAC filter | Marks it done and restarts its clock |
| Kevin, what's the report? | The full Kevin Report |

Times are read in the house time zone, which is `America/Chicago` (see Limitations).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server with the dashboard, the API routes and the scheduler |
| `npm run build` | Production build |
| `npm start` | Serves the production build on `$PORT` (default 3000) |
| `npm run db:push` | Creates or updates the tables from `src/db/schema.ts` (drizzle-kit; reads `.env`) |
| `npm run seed` | Loads the demo history into the demo house. Does nothing if the house already has expenses |
| `npm run seed:demo` | Same, but wipes and rebuilds that house's history first. Keeps the house, its roommates, their Telegram links and stored emails |
| `npm run poll` | Runs the Telegram bot with long polling, for local development. Deletes the webhook first |
| `npm run telegram:webhook` | Registers the webhook at `$APP_URL/api/telegram` and prints its status. `-- --delete` removes it |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests for the pure functions. No `.env`, no database |
| `npm run test:tools` | Runs every Kevin tool against your database in a throwaway household. No LLM |
| `npm run kevin:smoke` | Sends a set of sample messages through the real agent and prints the replies. Writes rows |

One more check has no npm alias: `npx tsx --env-file=.env scripts/smoke-llm.ts` makes one text call and one tool
call through the gateway, with no database or Telegram involved. Run it first if Kevin does not answer.

The scripts that take `--env-file=.env` need a `.env` file to exist. `npm start` uses the shell form
`${PORT:-3000}`, which Windows `cmd` does not expand; on Windows run `npx next start -p 3000`.

## Testing

```sh
npm run typecheck     # must pass
npm test              # unit tests for the pure logic: splits, settle-up, cart, chores, reminders, report, router, auth
npm run test:tools    # needs DATABASE_URL in .env; creates a throwaway household and deletes it afterwards
npm run kevin:smoke   # needs the LLM gateway; writes expenses, chores, reminders and cart items to the first household
```

`kevin:smoke` includes a leasing message. If AgentMail and a leasing address are configured, it sends a real
email.

CI (`.github/workflows/ci.yml`) runs the typecheck and the unit tests on pushes to `main` and on every pull
request.

## Deploy

The repo ships a `Dockerfile` and a `fly.toml` for [Fly.io](https://fly.io). Any host that keeps one Node process
running will do. A platform that freezes or scales the process to zero will not send reminders, because the
scheduler is a timer inside the server process.

1. Pick an app name and put it in `fly.toml` (`app = "..."`). Create the app:

   ```sh
   fly apps create your-app
   ```

2. Create the tables in the production database. From your machine, with `DATABASE_URL` in `.env` pointing at
   that database:

   ```sh
   npm run db:push
   ```

3. Set the secrets. Use every variable from the Configuration table that you need:

   ```sh
   fly secrets set DATABASE_URL=... NEON_AI_GATEWAY_BASE_URL=... NEON_AI_GATEWAY_TOKEN=... LLM_MODEL=... \
     TELEGRAM_BOT_TOKEN=... TELEGRAM_BOT_USERNAME=... TELEGRAM_WEBHOOK_SECRET=... \
     OPENROUTER_API_KEY=... STT_MODEL=... AGENTMAIL_API_KEY=... AGENTMAIL_INBOX=... \
     APP_URL=https://your-app.fly.dev DASHBOARD_PASSWORD=...
   ```

4. Deploy on exactly one machine:

   ```sh
   fly deploy --ha=false
   ```

   The scheduler runs inside the app process and keeps its "already posted" guards in memory. Two machines would
   send every reminder twice. For the same reason `fly.toml` never stops the machine.

5. Point Telegram at the deployment. With `APP_URL`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in your
   local `.env` matching the deployed values:

   ```sh
   npm run telegram:webhook
   ```

   The output should show `url: https://your-app.fly.dev/api/telegram` and no last error.

6. Optional: register an AgentMail webhook for the `message.received` event at
   `https://your-app.fly.dev/api/agentmail` and set its signing secret as `AGENTMAIL_WEBHOOK_SECRET`. Leasing
   replies then reach the group at once. Without it the scheduler's inbox poll finds them within a minute.

Things that will trip you up:

- `npm run poll` deletes the webhook. After any local polling session, run `npm run telegram:webhook` again or
  the deployed bot stays silent.
- If you ever run a second instance (a staging copy, a local dev server on the production database), set
  `DISABLE_SCHEDULER=1` on it.
- Kevin can only post unprompted to a house whose group is bound (`households.telegram_chat_id`). See the Telegram
  steps in Quick start.
- The webhook handler answers Telegram after 55 seconds even if Kevin is still working. The reply still arrives.

`.github/workflows/deploy.yml` is a manual deploy (Actions -> Deploy -> Run workflow). It runs the checks and then
`flyctl deploy --remote-only --ha=false`. It needs a repository secret `FLY_API_TOKEN`
(`fly tokens create deploy -a your-app`).

## Security notes

- There are no user accounts. The dashboard acts as whichever roommate is selected in the "Acting as" picker, and
  anyone who can open it can read and change everything.
- Set `DASHBOARD_PASSWORD` for any deployment that is reachable from the internet. It puts HTTP Basic auth in
  front of the dashboard and `/api/chat` (any username, that password). It is one shared password, not accounts.
- The webhook routes stay open because their callers cannot log in. Set `TELEGRAM_WEBHOOK_SECRET` so only
  Telegram can call `/api/telegram`. If you register the AgentMail webhook, set `AGENTMAIL_WEBHOOK_SECRET`;
  without it anyone who can reach `/api/agentmail` can post a fake leasing office message into the group.
- Anyone in the Telegram group can use every feature, including sending email from Kevin's inbox.
- Never commit `.env`. Keep real addresses, chat ids and tokens out of code, docs and seed data.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Limitations and ideas

- **One household per deployment in the dashboard.** The data model and the Telegram side handle many households,
  but the dashboard always shows the oldest one.
- **The store is simulated.** `src/lib/store.ts` only builds the link to the in-app checkout page. A real grocery
  provider could be plugged in there.
- **The time zone is a constant.** `America/Chicago` appears in two places in `src`: `DEFAULT_TZ` in
  `src/services/report.ts` (report dates, the Sunday and 09:00 windows) and the agent instructions in
  `src/agent/kevin.ts`. The seed script has its own copy. The rent reminder fires at 14:00 UTC. Dashboard pages
  format times in the server's time zone.
- **Voice depends on the model.** `STT_MODEL` must be an OpenRouter chat model that accepts audio input.
- **Email deliverability.** AgentMail's spam classifier can reject mail that reads like a joke. Work orders are
  written in plain language for that reason.
- **Any mail in Kevin's inbox is treated as leasing office mail** and announced to the group.
- **Scheduler guards are in memory.** A restart during the Sunday 18:00 hour can post the weekly report twice.
- **Price estimates are a small built-in table** (`src/lib/prices.ts`), not live prices.

## Project layout

```
src/
  db/schema.ts        Drizzle tables. Money is integer cents.
  services/           Business logic. Every function is (ctx, input) => result.
  agent/kevin.ts      askKevin(): persona, Mastra agent, memory
  agent/tools/        One file per module. Each tool wraps a service call.
  router.ts           Logs every chat message and decides whether Kevin replies
  router-policy.ts    The pure rules behind that decision
  channels/           Telegram (grammY)
  jobs/scheduler.ts   Reminders, weekly report, upkeep nudge, inbox poll
  proxy.ts            Optional password gate (DASHBOARD_PASSWORD)
  lib/                llm, voice, agentmail (+ webhook verification), store, urls, prices, fuzzy matching,
                      basic auth, dashboard context
  app/                Dashboard pages and api/{telegram,chat,agentmail}
  components/         Shared UI pieces and the Ask Kevin drawer
scripts/              seed, poll, telegram-webhook, kevin-smoke, smoke-llm
docs/                 ARCHITECTURE.md, WALKTHROUGH.md
```

## Credits

Built by Sudhersan and Ryan Sam Varghese. Contributions are welcome; start with
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).

Kevin's persona is an affectionate parody. This project is not affiliated with or endorsed by the owners of Home
Alone.
