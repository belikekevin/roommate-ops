// Forgiving name lookup for things people type in chat ("trash" -> "Take out trash"). Pure, no DB.

/** Trimmed, lower-cased, inner whitespace collapsed. */
export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Pick the item whose name best matches `query`. Tiers, first non-empty wins:
 *  1. exact (after normName)
 *  2. the name starts with the query
 *  3. one contains the other ("trash" ~ "Take out trash", "take out the trash please" ~ "Take out trash")
 * Within a tier the shortest name wins (closest match), then alphabetical, so the result never depends on the order
 * of `items`. Returns undefined for an empty query or when nothing matches.
 */
export function pickByName<T>(items: readonly T[], query: string, getName: (item: T) => string): T | undefined {
  const q = normName(query);
  if (!q) return undefined;
  const tiers: Array<(n: string) => boolean> = [
    (n) => n === q,
    (n) => n.startsWith(q),
    (n) => n.includes(q) || q.includes(n),
  ];
  for (const matches of tiers) {
    const hits = items
      .filter((item) => matches(normName(getName(item))))
      .sort((a, b) => getName(a).length - getName(b).length || getName(a).localeCompare(getName(b)));
    if (hits[0]) return hits[0];
  }
  return undefined;
}
