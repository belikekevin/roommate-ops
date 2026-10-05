# Walkthrough

A script for trying every feature once. It takes about ten minutes.

## Before you start

1. Finish the [Quick start](../README.md#quick-start) and run `npm run seed:demo`. That gives you the demo house
   "Apt 4B" with three roommates (Sam, Riley, Alex) and three weeks of expenses, chores, reminders and upkeep.
2. Have the dashboard open at `http://localhost:3000` (or your own deployment).
3. Decide where you will talk to Kevin:
   - **Telegram.** Run `npm run poll` locally, or use a deployment with the webhook set. Start each message with
     "Kevin". Reload a dashboard page to see the change.
   - **The Ask Kevin drawer** in the bottom corner of the dashboard. Every message goes to Kevin, so the name is
     optional, and the page behind the drawer refreshes after each answer. Voice notes (step 8) are Telegram
     only.

Kevin acts for whoever is speaking: the Telegram sender, or the roommate selected under "Acting as" in the
dashboard header. The numbers below assume you start from a fresh `seed:demo`.

Steps 6 and 7 need AgentMail: `AGENTMAIL_API_KEY`, plus Kevin's inbox and a leasing office address in
Roommates -> house settings. When the seed creates the house it fills those two from `AGENTMAIL_INBOX` and
`LEASING_EMAIL`, with rent of $2,500 due on the 1st. Step 8 needs `OPENROUTER_API_KEY`. Skip them if you have not
set those up.

## The nine things to say

### 1. "Kevin, add 3 bags of chips for me"

Kevin adds chips to the cart under your name and tells you the estimate. In Telegram the reply has "View cart"
and "Checkout" buttons when `APP_URL` is set.

**See it:** `/cart`. The seeded cart has four items worth $32.74. Chips, 3 bags, is new in your group at $13.47.

**Then check out.** Open `/cart/checkout` (or tap Checkout). This is Kevin's Market, the simulated store. The
page shows the order and a preview of who owes what. Click "Place order (simulated)". Nothing is bought. The cart
is cleared, one grocery expense is logged, and you land on `/money` with the new expense at the top, split by who
added what.

### 2. "Kevin, I paid $60 for internet"

Kevin logs a $60.00 expense with you as the payer, split evenly three ways, $20.00 each.

**See it:** `/money`. The expense is in the recent list with its split, and the balances have moved.

### 3. "Kevin, who owes what?"

Kevin reads the balances and the settle-up plan and answers in dollars. He does not calculate anything himself;
the numbers come from the money service.

**See it:** `/money`, the "Who pays whom" card. It should match his answer exactly. Right after seeding, before
steps 1 and 2, the plan is: Riley pays Sam $747.23 and Alex pays Sam $421.93. "Mark paid" next to a line records
that payment.

### 4. "Kevin, I did the dishes"

Kevin matches "dishes" to the chore chart, logs it for you and mentions your streak.

**See it:** `/chores`. Dishes shows you and "today". Whose turn moves to someone else. The Hall of Shame counts
your chore. In the seeded data Alex is at the top of it and "Clean bathroom" is overdue.

### 5. "Kevin, remind everyone trash goes out Tuesday 8pm"

Kevin works out the date in the house time zone (America/Chicago) and stores a reminder for the whole group.

**See it:** `/reminders`. The new row is there with its due time, next to the seeded ones and the monthly rent
reminder.

To watch one fire, say "Kevin, remind me to check the oven in 2 minutes". The scheduler delivers it to the
Telegram group within a minute of the due time. That needs the scheduler running (`npm run dev` or a deployment)
and the group bound to the house.

### 6. "Kevin, the kitchen sink is leaking, tell the leasing office"

Kevin emails a work order from his own inbox to the leasing office address. In Telegram the reply has an "Open
inbox" button.

**See it:** `/inbox`. The outgoing thread "Work order: ..." is in the list. Open it to read what was sent.

If you control the leasing address, reply to the email now. Within about a minute Kevin posts the reply into the
Telegram group, and the Inbox tab shows an unread badge.

### 7. "Kevin, check the work order"

Kevin looks at the leasing threads and reports the latest: whether the office has answered and what they said.

**See it:** `/inbox`. Open the thread. Opening it marks it read for everyone and the badge clears.

### 8. Voice note: "Kevin, I took out the trash"

Telegram only. Hold the microphone button and say it. The note is transcribed and handled like typed text. A
voice note always gets a reply, with or without the name.

**See it:** `/chores`. "Take out trash" is logged for you.

### 9. "Kevin, what's the report?"

Kevin posts the Kevin Report: who pays whom, overdue chores, the Hall of Shame, upcoming reminders and overdue
upkeep.

**See it:** `/` (Home) shows the same report as cards.

## How Kevin decides to answer

In Telegram he answers when a message contains "kevin", mentions the bot, replies to one of his messages, or is a
voice note. After he answers, he listens for 3 minutes, for up to 3 follow-ups. Try it:

1. "Kevin, add oat milk"
2. "and 2 bags of chips too" (no name; he should still add them)
3. "lol Riley you're late again" (he should stay quiet)

Everything else in the group is logged as context and gets no reply.

## Things that happen on their own

With the scheduler running and the Telegram group bound to the house:

- **Reminders** are delivered when due, in Kevin's voice.
- **Rent reminder.** Monthly on the due day from house settings, at 14:00 UTC. Saving house settings creates or
  refreshes it.
- **Weekly report.** Sunday between 18:00 and 18:59, America/Chicago.
- **Upkeep nudge.** Daily between 09:00 and 09:59, America/Chicago, only if something is overdue. The seed leaves
  two items overdue.
- **Leasing replies.** New mail in Kevin's inbox is posted to the group, checked once a minute.

## The same thing without the model

Every step has a click equivalent, because the dashboard calls the same services:

| Step | In the dashboard |
| --- | --- |
| Cart | `/cart`: add "chips", qty "3 bags". Then Checkout -> Place order (simulated) |
| Expense | `/money`: add an expense of 60, "internet", paid by you, split among everyone |
| Who owes what | `/money`: Balances and "Who pays whom" |
| Chore | `/chores`: "I did it" next to Dishes |
| Reminder | `/reminders`: text, date and time, for Everyone |
| Work order | `/inbox`: the work order form (issue, location, urgency) |
| Report | `/` |

## Start over

`npm run seed:demo` rebuilds the demo history. It keeps the house, the roommates, their Telegram links and stored
emails, and replaces everything else for that house.
