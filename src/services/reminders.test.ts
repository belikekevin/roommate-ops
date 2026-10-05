// Pure date math only; no DB. Run: npx tsx --test src/services/reminders.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addOneMonth, nextRentDue, RENT_HOUR_UTC } from "./reminders";

const utc = (y: number, m1: number, d: number, h = 0, min = 0) => new Date(Date.UTC(y, m1 - 1, d, h, min, 0, 0));

test("addOneMonth: Jan 31 clamps to Feb 28", () => {
  assert.equal(addOneMonth(utc(2026, 1, 31, 9, 30)).toISOString(), utc(2026, 2, 28, 9, 30).toISOString());
});

test("addOneMonth: December rolls into January of next year", () => {
  assert.equal(addOneMonth(utc(2026, 12, 5, 14)).toISOString(), utc(2027, 1, 5, 14).toISOString());
});

test("addOneMonth: keeps time-of-day and a normal day", () => {
  const next = addOneMonth(utc(2026, 3, 15, 18, 45));
  assert.equal(next.toISOString(), utc(2026, 4, 15, 18, 45).toISOString());
  assert.equal(next.getUTCHours(), 18);
  assert.equal(next.getUTCMinutes(), 45);
});

test("addOneMonth: day 29/30 also clamps to 28 so the chain never skips a month", () => {
  assert.equal(addOneMonth(utc(2026, 1, 30)).getUTCDate(), 28);
  assert.equal(addOneMonth(utc(2026, 1, 29)).getUTCMonth(), 1); // February
});

test("nextRentDue: today before the due day -> this month at 14:00 UTC", () => {
  const due = nextRentDue(utc(2026, 10, 4, 12), 15);
  assert.equal(due.toISOString(), utc(2026, 10, 15, RENT_HOUR_UTC).toISOString());
});

test("nextRentDue: today is the due day, before 14:00 -> today at 14:00 UTC", () => {
  const due = nextRentDue(utc(2026, 10, 15, 9), 15);
  assert.equal(due.toISOString(), utc(2026, 10, 15, RENT_HOUR_UTC).toISOString());
});

test("nextRentDue: today is the due day, after 14:00 -> next month", () => {
  const due = nextRentDue(utc(2026, 10, 15, 16), 15);
  assert.equal(due.toISOString(), utc(2026, 11, 15, RENT_HOUR_UTC).toISOString());
});

test("nextRentDue: exactly 14:00 on the due day counts as passed", () => {
  const due = nextRentDue(utc(2026, 10, 15, RENT_HOUR_UTC), 15);
  assert.equal(due.getUTCMonth(), 10); // November (0-based)
});

test("nextRentDue: due day 28 in February and from Dec 31", () => {
  assert.equal(nextRentDue(utc(2026, 2, 1), 28).toISOString(), utc(2026, 2, 28, RENT_HOUR_UTC).toISOString());
  // Past the 28th -> rolls to next month, and December -> January next year.
  assert.equal(nextRentDue(utc(2026, 12, 31, 20), 28).toISOString(), utc(2027, 1, 28, RENT_HOUR_UTC).toISOString());
});
