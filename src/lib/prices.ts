// Built-in grocery price catalog for cart estimates. No API: a small table of common items with typical US unit
// prices in integer cents. The LLM never prices anything; cart.addItems calls estimate() and stores estCents.

/** name (lower case, singular where it matters) -> unit price in cents */
export const CATALOG: Record<string, number> = {
  // dairy + eggs
  milk: 449,
  "oat milk": 499,
  "almond milk": 399,
  eggs: 429,
  butter: 549,
  cheese: 599,
  "cheddar cheese": 599,
  "shredded cheese": 449,
  yogurt: 129,
  "greek yogurt": 599,
  "cream cheese": 349,
  "ice cream": 599,
  // bakery + grains
  bread: 379,
  bagels: 449,
  tortillas: 349,
  rice: 699,
  pasta: 199,
  "pasta sauce": 349,
  cereal: 499,
  oatmeal: 449,
  flour: 399,
  sugar: 349,
  // produce
  bananas: 149,
  apples: 399,
  oranges: 449,
  strawberries: 499,
  blueberries: 449,
  avocados: 199,
  avocado: 199,
  tomatoes: 349,
  lettuce: 249,
  spinach: 349,
  onions: 199,
  garlic: 99,
  potatoes: 449,
  carrots: 199,
  broccoli: 249,
  lemons: 99,
  limes: 79,
  // protein
  "chicken breast": 899,
  chicken: 899,
  "ground beef": 799,
  bacon: 749,
  salmon: 1199,
  tofu: 299,
  "peanut butter": 449,
  peanuts: 399,
  beans: 149,
  "black beans": 149,
  // snacks
  chips: 449,
  "tortilla chips": 449,
  salsa: 399,
  hummus: 449,
  cookies: 399,
  crackers: 349,
  popcorn: 349,
  pretzels: 349,
  "rice cakes": 349,
  chocolate: 299,
  "granola bars": 549,
  // drinks
  coffee: 999,
  tea: 499,
  "orange juice": 449,
  juice: 449,
  soda: 699,
  "sparkling water": 599,
  water: 499,
  beer: 1299,
  wine: 1299,
  // frozen + pantry
  pizza: 699,
  "frozen pizza": 699,
  "frozen vegetables": 299,
  ketchup: 349,
  mustard: 249,
  mayo: 449,
  "olive oil": 999,
  "soy sauce": 349,
  "hot sauce": 399,
  salt: 199,
  pepper: 399,
  ramen: 99,
  // household
  "toilet paper": 1299,
  "paper towels": 999,
  "dish soap": 349,
  "hand soap": 299,
  "laundry detergent": 1299,
  "trash bags": 999,
  sponges: 349,
  "all-purpose cleaner": 449,
  shampoo: 699,
  toothpaste: 399,
};

export const CATALOG_SIZE = Object.keys(CATALOG).length;

/** Price for anything the catalog doesn't know. */
export const DEFAULT_UNIT_CENTS = 499;

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Trivial singular form so "bagel" matches "bagels" and "eggs" matches "egg" either way. */
const singular = (s: string) => (s.length > 3 && s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s);

/** Whole-word tokens, singularized, as a set ("Bag of Chips" -> {bag, of, chip}). */
const tokens = (s: string) => new Set(normalizeName(s).split(" ").filter(Boolean).map(singular));

const CATALOG_TOKENS: Array<{ key: string; toks: Set<string> }> = Object.keys(CATALOG).map((key) => ({ key, toks: tokens(key) }));

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((t) => b.has(t)).length;

/**
 * Catalog lookup on whole-word boundaries (tokens, plural-insensitive), so "pepperoni pizza" is pizza (not pepper),
 * "butternut squash" is unknown (not butter) and "salted peanuts" is peanuts (not salt). Tiers, first hit wins:
 *  1. same tokens ("oat milk", "Oat Milk", "egg" ~ "eggs");
 *  2. every token of the catalog name is in the query ("whole milk" -> milk, "bag of chips" -> chips). The last
 *     word of the query is usually the thing itself, so when it is a catalog word only names containing it count:
 *     "chocolate milk" -> milk, "milk chocolate" -> chocolate, "tea towels" -> unknown (tea is just the modifier);
 *  3. every token of the query is in the catalog name ("sparkling" -> sparkling water, "oat" -> oat milk).
 * Within a tier the catalog name with the most matching tokens wins, then the longest name. Partial overlaps that
 * are neither a subset ("tea towels" vs paper towels) are unknown. Null when nothing matches.
 */
export function lookupPrice(name: string): { name: string; unitCents: number } | null {
  const q = tokens(name);
  if (q.size === 0) return null;
  const head = [...q][q.size - 1];
  const headIsCatalogWord = CATALOG_TOKENS.some((c) => c.toks.has(head));
  const tiers: Array<(k: Set<string>) => boolean> = [
    (k) => k.size === q.size && isSubset(k, q),
    (k) => isSubset(k, q) && (!headIsCatalogWord || k.has(head)),
    (k) => isSubset(q, k),
  ];
  for (const test of tiers) {
    const hits = CATALOG_TOKENS.filter((c) => test(c.toks)).sort(
      (a, b) => overlap(b.toks, q) - overlap(a.toks, q) || b.key.length - a.key.length || a.key.localeCompare(b.key),
    );
    if (hits[0]) return { name: hits[0].key, unitCents: CATALOG[hits[0].key] };
  }
  return null;
}

/** Units that mean "this many items". Anything else after the number (oz, lb, pack, dozen, ct, ...) is a size. */
const COUNT_UNITS = new Set([
  "bag", "bags", "box", "boxes", "bottle", "bottles", "can", "cans", "jar", "jars", "loaf", "loaves", "bunch", "bunches",
  "head", "heads", "pc", "pcs", "piece", "pieces", "x", "unit", "units", "roll", "rolls",
]);

/**
 * How many of the item a free-text quantity means. The leading number counts only when it is bare ("3") or
 * followed by a count-like unit ("3 bags", "2 bottles of", "4x"). A number that sizes the item ("16 oz", "1.5 lb",
 * "12 pack", "500 g", "1 dozen", "2 gallons") is one item. Never < 1.
 */
export function parseQty(qty: string | undefined | null): number {
  const m = String(qty ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?/);
  if (!m) return 1;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return 1;
  const unit = m[2];
  if (unit && !COUNT_UNITS.has(unit)) return 1;
  return n;
}

/** Estimated cents for `qty` of `name`: unit price (catalog or 499 default) x item count from parseQty. */
export function estimate(name: string, qty?: string | null): number {
  const unit = lookupPrice(name)?.unitCents ?? DEFAULT_UNIT_CENTS;
  return Math.round(unit * parseQty(qty));
}
