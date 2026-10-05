// Pure-function tests for money. No DB: only computeSettlePlan and splitEvenly are exercised.
// Run: npx tsx --test src/services/money.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSettlePlan, splitEvenly, type Balance, type Transfer } from "./money";

const b = (name: string, cents: number): Balance => ({ memberId: name.toLowerCase(), name, cents });

/** Apply a plan to balances and return the resulting net per member. */
function applyPlan(balances: Balance[], plan: Transfer[]) {
  const net = new Map(balances.map((x) => [x.memberId, x.cents]));
  for (const t of plan) {
    net.set(t.fromId, (net.get(t.fromId) ?? 0) + t.cents); // debtor pays -> balance rises toward 0
    net.set(t.toId, (net.get(t.toId) ?? 0) - t.cents); // creditor receives -> balance falls toward 0
  }
  return net;
}

test("settle plan: empty input -> empty plan", () => {
  assert.deepEqual(computeSettlePlan([]), []);
});

test("settle plan: everyone square -> empty plan", () => {
  assert.deepEqual(computeSettlePlan([b("Kevin", 0), b("Buzz", 0), b("Marv", 0)]), []);
});

test("settle plan: 3-person classic", () => {
  // Kevin paid 90 for everyone (30 each): Kevin +60, Buzz -30, Marv -30.
  const plan = computeSettlePlan([b("Kevin", 6000), b("Buzz", -3000), b("Marv", -3000)]);
  assert.equal(plan.length, 2);
  for (const t of plan) {
    assert.equal(t.toName, "Kevin");
    assert.equal(t.cents, 3000);
  }
  assert.deepEqual(plan.map((t) => t.fromName).sort(), ["Buzz", "Marv"]);
});

test("settle plan: biggest debtor pays biggest creditor first", () => {
  const plan = computeSettlePlan([b("Harry", -7000), b("Kate", 5000), b("Peter", 2000), b("Marv", -1000), b("Kevin", 1000)]);
  assert.deepEqual(plan[0], { fromId: "harry", fromName: "Harry", toId: "kate", toName: "Kate", cents: 5000 });
  const net = applyPlan([b("Harry", -7000), b("Kate", 5000), b("Peter", 2000), b("Marv", -1000), b("Kevin", 1000)], plan);
  for (const v of net.values()) assert.equal(v, 0);
  // Never more transfers than people minus one for a connected set of balances.
  assert.ok(plan.length <= 4);
});

test("settle plan: zeroes every balance, transfers positive, never pays more than owed", () => {
  const balances = [b("A", 12345), b("B", -2345), b("C", -10000), b("D", 1), b("E", -1), b("F", 0)];
  const plan = computeSettlePlan(balances);
  for (const t of plan) {
    assert.ok(t.cents > 0, "transfers must be positive");
    assert.notEqual(t.fromId, t.toId);
  }
  // Total sent equals total owed by debtors (and total owed to creditors).
  const owed = balances.filter((x) => x.cents < 0).reduce((s, x) => s - x.cents, 0);
  assert.equal(plan.reduce((s, t) => s + t.cents, 0), owed);
  // Each debtor pays exactly their debt; each creditor receives exactly their credit.
  const net = applyPlan(balances, plan);
  for (const v of net.values()) assert.equal(v, 0);
  // Zero-balance members never appear.
  assert.ok(plan.every((t) => t.fromId !== "f" && t.toId !== "f"));
});

test("settle plan: ignores sub-cent (zero) balances and handles single debtor/creditor", () => {
  assert.deepEqual(computeSettlePlan([b("A", 0), b("B", 0), b("C", 250), b("D", -250)]), [
    { fromId: "d", fromName: "D", toId: "c", toName: "C", cents: 250 },
  ]);
});

test("splitEvenly: exact division", () => {
  assert.deepEqual(splitEvenly(900, ["a", "b", "c"], "a"), [
    { memberId: "a", cents: 300 },
    { memberId: "b", cents: 300 },
    { memberId: "c", cents: 300 },
  ]);
});

test("splitEvenly: remainder goes to the payer first, then the rest in order", () => {
  // 10.00 / 3 = 3.33 r 1 -> payer b gets the extra cent.
  assert.deepEqual(splitEvenly(1000, ["a", "b", "c"], "b"), [
    { memberId: "a", cents: 333 },
    { memberId: "b", cents: 334 },
    { memberId: "c", cents: 333 },
  ]);
  // 10.02 / 4 = 2.50 r 2 -> payer c, then a.
  assert.deepEqual(splitEvenly(1002, ["a", "b", "c", "d"], "c"), [
    { memberId: "a", cents: 251 },
    { memberId: "b", cents: 250 },
    { memberId: "c", cents: 251 },
    { memberId: "d", cents: 250 },
  ]);
});

test("splitEvenly: payer not a participant -> remainder in list order; sums always match", () => {
  const rows = splitEvenly(1001, ["a", "b", "c"], "zed");
  assert.deepEqual(rows, [
    { memberId: "a", cents: 334 },
    { memberId: "b", cents: 334 },
    { memberId: "c", cents: 333 },
  ]);
  for (const total of [1, 2, 7, 99, 100, 101, 12345]) {
    for (const n of [1, 2, 3, 4, 5, 7]) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      const sum = splitEvenly(total, ids, "m0").reduce((s, r) => s + r.cents, 0);
      assert.equal(sum, total, `${total} across ${n}`);
    }
  }
});

test("splitEvenly: dedupes ids and handles empty", () => {
  assert.deepEqual(splitEvenly(300, ["a", "a", "b"]), [
    { memberId: "a", cents: 150 },
    { memberId: "b", cents: 150 },
  ]);
  assert.deepEqual(splitEvenly(300, []), []);
});
