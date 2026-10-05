// Pure chore logic, no DB. Run: npx tsx --test src/services/chores.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickChore, whoseTurn, rankShame, countStreak, sortStatus, isOverdue, daysSince } from "./chores";

const chart = [{ name: "Clean bathroom" }, { name: "Take out trash" }, { name: "Dishes" }, { name: "Dish rack" }];

test("pickChore: exact match wins, case/whitespace-insensitive", () => {
  assert.equal(pickChore("  dishes ", chart)?.name, "Dishes");
  assert.equal(pickChore("TAKE OUT TRASH", chart)?.name, "Take out trash");
});

test("pickChore: startsWith beats includes; shortest name wins within a tier", () => {
  assert.equal(pickChore("dish", chart)?.name, "Dishes"); // "Dishes" (6) < "Dish rack" (9)
  assert.equal(pickChore("clean", chart)?.name, "Clean bathroom");
});

test("pickChore: includes works in either direction", () => {
  assert.equal(pickChore("trash", chart)?.name, "Take out trash"); // query inside name
  assert.equal(pickChore("I did the dishes tonight", chart)?.name, "Dishes"); // name inside query
  assert.equal(pickChore("bathroom", chart)?.name, "Clean bathroom");
});

test("pickChore: no match and empty query return undefined", () => {
  assert.equal(pickChore("vacuum", chart), undefined);
  assert.equal(pickChore("   ", chart), undefined);
});

test("whoseTurn: never-done members first, then oldest last log, ties by name", () => {
  const people = [
    { id: "a", name: "Sam" },
    { id: "b", name: "Riley" },
    { id: "c", name: "Alex" },
  ];
  const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);
  // Riley never did it -> Riley's turn even though Alex is older than Sam
  assert.equal(whoseTurn(people, new Map([["a", d(1)], ["c", d(5)]])), "Riley");
  // Everyone has done it -> oldest log
  assert.equal(whoseTurn(people, new Map([["a", d(1)], ["b", d(3)], ["c", d(5)]])), "Alex");
  // Nobody has done it -> alphabetical
  assert.equal(whoseTurn(people, new Map()), "Alex");
  // Two never-done -> alphabetical among them
  assert.equal(whoseTurn(people, new Map([["c", d(1)]])), "Riley");
  assert.equal(whoseTurn([], new Map()), null);
});

test("rankShame: fewest this week first, then longest since (never = worst), then name", () => {
  const rows = [
    { memberId: "1", name: "Alex", daysSinceLastChore: 2, choresThisWeek: 3 },
    { memberId: "2", name: "Riley", daysSinceLastChore: null, choresThisWeek: 0 },
    { memberId: "3", name: "Sam", daysSinceLastChore: 10, choresThisWeek: 0 },
    { memberId: "4", name: "Buzz", daysSinceLastChore: 10, choresThisWeek: 0 },
    { memberId: "5", name: "Kate", daysSinceLastChore: 1, choresThisWeek: 1 },
  ];
  assert.deepEqual(
    rankShame(rows).map((r) => r.name),
    ["Riley", "Buzz", "Sam", "Kate", "Alex"],
  );
});

test("countStreak: consecutive newest-first logs by the same member", () => {
  assert.equal(countStreak(["a", "a", "b", "a"], "a"), 2);
  assert.equal(countStreak(["b", "a", "a"], "a"), 0);
  assert.equal(countStreak(["a"], "a"), 1);
  assert.equal(countStreak([], "a"), 0);
});

test("sortStatus: overdue first, then by name", () => {
  const out = sortStatus([
    { name: "Dishes", overdue: false },
    { name: "Trash", overdue: true },
    { name: "Bathroom", overdue: true },
    { name: "Aquarium", overdue: false },
  ]);
  assert.deepEqual(out.map((r) => r.name), ["Bathroom", "Trash", "Aquarium", "Dishes"]);
});

test("isOverdue / daysSince", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(isOverdue(null, 7, now), true);
  assert.equal(isOverdue(new Date("2026-10-01T12:00:00Z"), 7, now), false);
  assert.equal(isOverdue(new Date("2026-09-20T12:00:00Z"), 7, now), true);
  assert.equal(daysSince(new Date("2026-10-01T06:00:00Z"), now), 3);
  assert.equal(daysSince(new Date("2026-10-04T11:00:00Z"), now), 0);
});
