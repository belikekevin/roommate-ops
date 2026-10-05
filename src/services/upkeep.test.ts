// Pure upkeep helpers: schedule math + fuzzy name picker. No DB. Run: npx tsx --test src/services/upkeep.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareByNextDue, nextDueDate, pickByName, statusFor, withSchedule } from "./upkeep";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-04T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

test("never done -> nextDue null, overdue", () => {
  const m = withSchedule({ lastDone: null, everyDays: 90 }, now);
  assert.equal(m.nextDue, null);
  assert.equal(m.status, "overdue");
});

test("due in 3 days -> due-soon", () => {
  const m = withSchedule({ lastDone: daysAgo(87), everyDays: 90 }, now);
  assert.equal(m.nextDue?.getTime(), now.getTime() + 3 * DAY);
  assert.equal(m.status, "due-soon");
});

test("due in 30 days -> ok", () => {
  const m = withSchedule({ lastDone: daysAgo(60), everyDays: 90 }, now);
  assert.equal(m.status, "ok");
});

test("past due -> overdue", () => {
  const m = withSchedule({ lastDone: daysAgo(100), everyDays: 90 }, now);
  assert.equal(m.status, "overdue");
  assert.ok(m.nextDue!.getTime() < now.getTime());
});

test("nextDueDate adds everyDays; statusFor edge at exactly 7 days is due-soon", () => {
  assert.equal(nextDueDate(daysAgo(0), 10)?.getTime(), now.getTime() + 10 * DAY);
  assert.equal(statusFor(new Date(now.getTime() + 7 * DAY), now), "due-soon");
  assert.equal(statusFor(new Date(now.getTime() + 7 * DAY + 1), now), "ok");
  assert.equal(statusFor(now, now), "overdue");
});

test("sort: never-done first, then soonest", () => {
  const list = [
    { item: "B", nextDue: new Date(now.getTime() + 5 * DAY) },
    { item: "A", nextDue: null },
    { item: "C", nextDue: new Date(now.getTime() + 1 * DAY) },
  ].sort(compareByNextDue);
  assert.deepEqual(list.map((m) => m.item), ["A", "C", "B"]);
});

test("pickByName: exact > startsWith > includes (either direction)", () => {
  const items = [
    { item: "Replace HVAC filter" },
    { item: "Test smoke alarms" },
    { item: "Clean dryer vent" },
    { item: "Descale coffee maker" },
  ];
  assert.equal(pickByName(items, "  test SMOKE alarms ")?.item, "Test smoke alarms");
  assert.equal(pickByName(items, "clean")?.item, "Clean dryer vent");
  assert.equal(pickByName(items, "hvac")?.item, "Replace HVAC filter");
  assert.equal(pickByName(items, "coffee")?.item, "Descale coffee maker");
  // query longer than the item name: "I did the clean dryer vent thing" includes "clean dryer vent"
  assert.equal(pickByName(items, "the clean dryer vent thing")?.item, "Clean dryer vent");
  assert.equal(pickByName(items, "gutters"), undefined);
  assert.equal(pickByName(items, "   "), undefined);
});

test("pickByName prefers exact over a startsWith on an earlier item", () => {
  const items = [{ item: "Filter check" }, { item: "Filter" }];
  assert.equal(pickByName(items, "filter")?.item, "Filter");
});
