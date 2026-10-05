// Pure-function tests for the cart. No DB: price estimates, the weighted split, and cartTotal.
// Run: npx tsx --test src/services/cart.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, CATALOG_SIZE, DEFAULT_UNIT_CENTS, estimate, lookupPrice, parseQty } from "../lib/prices";
import { checkoutUrl } from "../lib/store";
import { cartTotal, computeCartSplits, type SplitItem } from "./cart";

const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
const by = (rows: { memberId: string; cents: number }[]) => Object.fromEntries(rows.map((r) => [r.memberId, r.cents]));

/* ---------- prices ---------- */

test("catalog has ~60+ items with positive integer prices", () => {
  assert.ok(CATALOG_SIZE >= 60, `only ${CATALOG_SIZE} items`);
  for (const [k, v] of Object.entries(CATALOG)) {
    assert.ok(Number.isInteger(v) && v > 0, `${k} has a bad price ${v}`);
    assert.equal(k, k.trim().toLowerCase(), `${k} should be normalized`);
  }
});

test("lookupPrice: exact, then catalog-in-query, then query-in-catalog; case and spacing don't matter", () => {
  assert.equal(lookupPrice("milk")?.name, "milk");
  assert.equal(lookupPrice("  MILK ")?.name, "milk");
  assert.equal(lookupPrice("oat milk")?.name, "oat milk");
  assert.equal(lookupPrice("sparkling")?.name, "sparkling water", "query token inside a catalog name");
  assert.equal(lookupPrice("oat")?.name, "oat milk", "whole words: 'oat' does not match 'oatmeal'");
  assert.equal(lookupPrice("toilet")?.name, "toilet paper");
  assert.equal(lookupPrice("whole milk")?.name, "milk", "catalog name inside the query");
  assert.equal(lookupPrice("bag of chips")?.name, "chips");
  assert.equal(lookupPrice("egg")?.name, "eggs", "plural-insensitive");
  assert.equal(lookupPrice("Bagel")?.name, "bagels");
  assert.equal(lookupPrice("caviar"), null);
  assert.equal(lookupPrice(""), null);
});

test("lookupPrice: whole-word matching, most matching tokens first, then the longest catalog name", () => {
  // A catalog word inside a longer word is not a match: pepper, butter, salt, tea, rice.
  assert.equal(lookupPrice("pepperoni pizza")?.name, "pizza");
  assert.equal(lookupPrice("butternut squash"), null, "'butter' is not a word of 'butternut'");
  assert.equal(lookupPrice("salted peanuts")?.name, "peanuts");
  assert.equal(lookupPrice("tea towels"), null, "'towels' is the thing; tea is only the modifier and paper towels isn't a subset");
  assert.equal(lookupPrice("rice cakes")?.name, "rice cakes");
  assert.equal(lookupPrice("rice cake")?.name, "rice cakes");
  // The last word decides when it is a catalog word.
  assert.equal(lookupPrice("chocolate milk")?.name, "milk");
  assert.equal(lookupPrice("milk chocolate")?.name, "chocolate");
  assert.equal(lookupPrice("peanut butter cookies")?.name, "cookies");
  assert.equal(lookupPrice("oat milk and cookies")?.name, "cookies");
  // Otherwise most matching tokens wins over a shorter name.
  assert.equal(lookupPrice("chicken thighs")?.name, "chicken");
  assert.equal(lookupPrice("frozen pizza rolls")?.name, "frozen pizza");
  assert.equal(lookupPrice("greek yogurt cups")?.name, "greek yogurt");
  assert.equal(lookupPrice("sparkling water bottles")?.name, "sparkling water");
  // Same count -> the longest catalog name ("cream" is in both "ice cream" and "cream cheese").
  assert.equal(lookupPrice("cream")?.name, "cream cheese");
  assert.equal(lookupPrice("All Purpose Cleaner")?.name, "all-purpose cleaner", "punctuation in the catalog name is ignored");
});

test("parseQty: a bare number or a count-like unit is a count; size units mean one item", () => {
  assert.equal(parseQty("3 bags"), 3);
  assert.equal(parseQty("3 bags of chips"), 3);
  assert.equal(parseQty("2"), 2);
  assert.equal(parseQty("2 bottles"), 2);
  assert.equal(parseQty("6 cans"), 6);
  assert.equal(parseQty("2 loaves"), 2);
  assert.equal(parseQty("4 x"), 4);
  assert.equal(parseQty("4x"), 4);
  assert.equal(parseQty("2 pcs"), 2);
  assert.equal(parseQty("3 rolls"), 3);
  // Sizes, not counts.
  assert.equal(parseQty("16 oz"), 1);
  assert.equal(parseQty("1.5 lb"), 1);
  assert.equal(parseQty("2 lbs"), 1);
  assert.equal(parseQty("500 g"), 1);
  assert.equal(parseQty("500g"), 1);
  assert.equal(parseQty("12 pack"), 1);
  assert.equal(parseQty("12 ct"), 1);
  assert.equal(parseQty("1 dozen"), 1);
  assert.equal(parseQty("2 dozen"), 1);
  assert.equal(parseQty("2 gallons"), 1);
  assert.equal(parseQty("1 gallon"), 1);
  assert.equal(parseQty("2 liters"), 1);
  assert.equal(parseQty("a dozen"), 1);
  assert.equal(parseQty(undefined), 1);
  assert.equal(parseQty("0"), 1, "never below 1");
});

test("estimate: unit price x count; unknown items default to 499; sizes don't multiply", () => {
  assert.equal(estimate("chips", "3 bags"), 3 * CATALOG.chips);
  assert.equal(estimate("milk"), CATALOG.milk);
  assert.equal(estimate("Dish Soap", "2"), 2 * CATALOG["dish soap"]);
  assert.equal(estimate("caviar"), DEFAULT_UNIT_CENTS);
  assert.equal(estimate("caviar", "4 jars"), 4 * DEFAULT_UNIT_CENTS);
  assert.equal(estimate("chicken", "16 oz"), CATALOG.chicken, "16 oz is one chicken, not sixteen");
  assert.equal(estimate("soda", "12 pack"), CATALOG.soda);
  assert.equal(estimate("rice", "500 g"), CATALOG.rice);
  assert.equal(estimate("eggs", "1 dozen"), CATALOG.eggs);
  assert.ok(Number.isInteger(estimate("milk", "1.5")));
});

test("checkoutUrl points at our simulated checkout page", () => {
  const saved = process.env.APP_URL;
  try {
    process.env.APP_URL = "https://kevin.example/";
    assert.equal(checkoutUrl(), "https://kevin.example/cart/checkout");
    delete process.env.APP_URL;
    assert.equal(checkoutUrl(), "/cart/checkout");
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
});

/* ---------- cartTotal ---------- */

test("cartTotal sums estimates, treating unknown as 0", () => {
  assert.equal(cartTotal([]), 0);
  assert.equal(cartTotal([{ estCents: 100 }, { estCents: null }, { estCents: 250 }]), 350);
});

/* ---------- computeCartSplits ---------- */

const item = (addedBy: string, estCents: number | null, shared = false): SplitItem => ({ addedBy, estCents, shared });
const ACTIVE = ["a", "b", "c"];

test("splits: each person pays for their own items, scaled to the real total", () => {
  // a: 1000, b: 3000 estimated; the receipt says 8000 -> a 2000, b 6000, c omitted.
  const rows = computeCartSplits([item("a", 1000), item("b", 3000)], ACTIVE, 8000, "a");
  assert.deepEqual(by(rows), { a: 2000, b: 6000 });
  assert.equal(sum(rows), 8000);
});

test("splits: shared items split evenly across active members", () => {
  const rows = computeCartSplits([item("a", 900, true)], ACTIVE, 900, "a");
  assert.deepEqual(by(rows), { a: 300, b: 300, c: 300 });
  const mixed = computeCartSplits([item("a", 600), item("b", 300, true)], ACTIVE, 900, "b");
  assert.deepEqual(by(mixed), { a: 700, b: 100, c: 100 });
});

test("splits: sums exactly to total; remainder cents go to the payer first", () => {
  // 1000 split three even ways via a shared item: 334/333/333 with the extra cent on the payer.
  const rows = computeCartSplits([item("a", 500, true)], ACTIVE, 1000, "c");
  assert.equal(sum(rows), 1000);
  assert.equal(by(rows).c, 334);
  assert.equal(by(rows).a, 333);
  assert.equal(by(rows).b, 333);
  // payer isn't a participant -> the cent still lands somewhere, still exact.
  const rows2 = computeCartSplits([item("a", 1), item("b", 1)], ACTIVE, 1001, "c");
  assert.equal(sum(rows2), 1001);
  assert.deepEqual(Object.keys(by(rows2)).sort(), ["a", "b"]);
});

test("splits: always exact for awkward totals and weights", () => {
  const items = [item("a", 333), item("b", 777), item("c", 1), item("a", 199, true), item("b", 5, true)];
  for (const total of [1, 2, 3, 7, 99, 101, 1337, 12345, 99999]) {
    for (const payer of ACTIVE) {
      const rows = computeCartSplits(items, ACTIVE, total, payer);
      assert.equal(sum(rows), total, `total ${total} payer ${payer}`);
      assert.ok(rows.every((r) => Number.isInteger(r.cents) && r.cents >= 0));
      assert.equal(new Set(rows.map((r) => r.memberId)).size, rows.length, "no duplicate members");
    }
  }
});

test("splits: zero-weight members are omitted; items from inactive adders count as shared", () => {
  const rows = computeCartSplits([item("a", 500), item("gone", 300)], ACTIVE, 800, "a");
  // 'gone' isn't active: their 300 is shared across a, b, c (100 each). a: 600, b: 100, c: 100.
  assert.deepEqual(by(rows), { a: 600, b: 100, c: 100 });
  assert.ok(!("gone" in by(rows)));
});

test("splits: no estimates at all -> split by item count", () => {
  const rows = computeCartSplits([item("a", null), item("a", null), item("b", 0)], ACTIVE, 300, "b");
  assert.deepEqual(by(rows), { a: 200, b: 100 });
});

test("splits: empty cart or no active members -> no rows", () => {
  assert.deepEqual(computeCartSplits([], ACTIVE, 100, "a"), []);
  assert.deepEqual(computeCartSplits([item("a", 100)], [], 100, "a"), []);
});
