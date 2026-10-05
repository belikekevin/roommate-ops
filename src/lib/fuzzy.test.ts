// Shared fuzzy name picker (chores and upkeep both wrap it). Run: npx tsx --test src/lib/fuzzy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normName, pickByName } from "./fuzzy";

const pick = (names: string[], query: string) => pickByName(names, query, (n) => n);

test("normName trims, lower-cases and collapses whitespace", () => {
  assert.equal(normName("  Take   OUT\ttrash "), "take out trash");
});

test("pickByName: exact beats startsWith beats includes", () => {
  assert.equal(pick(["Filter check", "Filter"], "filter"), "Filter");
  assert.equal(pick(["Clean filter", "Filter check"], "filter"), "Filter check");
  assert.equal(pick(["Replace HVAC filter", "Test smoke alarms"], "hvac"), "Replace HVAC filter");
});

test("pickByName: includes works in either direction", () => {
  assert.equal(pick(["Dishes", "Take out trash"], "I did the dishes tonight"), "Dishes");
  assert.equal(pick(["Dishes", "Take out trash"], "trash"), "Take out trash");
});

test("pickByName: ties go to the shortest name, then alphabetical, whatever the input order", () => {
  assert.equal(pick(["Dish rack", "Dishes"], "dish"), "Dishes");
  assert.equal(pick(["Dishes", "Dish rack"], "dish"), "Dishes");
  assert.equal(pick(["Mop B", "Mop A"], "mop"), "Mop A");
  assert.equal(pick(["Mop A", "Mop B"], "mop"), "Mop A");
});

test("pickByName: reads the name through getName; empty query or no match -> undefined", () => {
  const items = [{ item: "Clean dryer vent" }, { item: "Descale coffee maker" }];
  assert.equal(pickByName(items, "coffee", (m) => m.item), items[1]);
  assert.equal(pickByName(items, "gutters", (m) => m.item), undefined);
  assert.equal(pickByName(items, "   ", (m) => m.item), undefined);
});
