// Database schema (Drizzle). Every service reads and writes these tables; apply changes with `npm run db:push`.
// Money is always integer cents.
import { pgTable, uuid, text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  telegramChatId: text("telegram_chat_id").unique(),
  rentCents: integer("rent_cents"),
  rentDueDay: integer("rent_due_day"), // 1-28
  leasingEmail: text("leasing_email"),
  inboxAddress: text("inbox_address"), // AgentMail inbox for this house
  createdAt: createdAt(),
});

export const members = pgTable("members", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  telegramUserId: text("telegram_user_id"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const expenses = pgTable("expenses", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  payerId: uuid("payer_id").notNull().references(() => members.id),
  cents: integer("cents").notNull(),
  description: text("description").notNull(),
  source: text("source", { enum: ["chat", "ui", "cart"] }).notNull().default("chat"),
  createdAt: createdAt(),
});

export const expenseSplits = pgTable(
  "expense_splits",
  {
    expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull().references(() => members.id),
    cents: integer("cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const settlements = pgTable("settlements", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  fromId: uuid("from_id").notNull().references(() => members.id),
  toId: uuid("to_id").notNull().references(() => members.id),
  cents: integer("cents").notNull(),
  createdAt: createdAt(),
});

export const cartItems = pgTable("cart_items", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  qty: text("qty").notNull().default("1"), // free text: "2", "3 gallons"
  addedBy: uuid("added_by").notNull().references(() => members.id),
  shared: boolean("shared").notNull().default(false),
  estCents: integer("est_cents"),
  status: text("status", { enum: ["open", "purchased"] }).notNull().default("open"),
  createdAt: createdAt(),
});

export const chores = pgTable("chores", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  everyDays: integer("every_days").notNull().default(7),
});

export const choreLogs = pgTable("chore_logs", {
  id: id(),
  choreId: uuid("chore_id").notNull().references(() => chores.id),
  memberId: uuid("member_id").notNull().references(() => members.id),
  doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  text: text("text").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  memberId: uuid("member_id").references(() => members.id),
  recurring: text("recurring", { enum: ["monthly"] }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const emails = pgTable("emails", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  direction: text("direction", { enum: ["in", "out"] }).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  threadId: text("thread_id"),
  createdAt: createdAt(),
});

export const maintenance = pgTable("maintenance", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  item: text("item").notNull(),
  everyDays: integer("every_days").notNull(),
  lastDone: timestamp("last_done", { withTimezone: true }),
});

// Every group message, addressed to Kevin or not, so he has the house context when he does reply.
export const chatLog = pgTable("chat_log", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  memberId: uuid("member_id").references(() => members.id), // null = Kevin
  text: text("text").notNull(),
  createdAt: createdAt(),
});
