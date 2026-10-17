/**
 * Pair each value with a React key that stays unique even when values repeat
 * (`value#1`, `value#2`, ...). The key follows the value, not its list position.
 */
export function withOccurrenceKeys<T>(
  items: readonly T[],
  getValue: (item: T) => string,
): Array<{ item: T; key: string }> {
  const counts = new Map<string, number>();
  return items.map((item) => {
    const value = getValue(item);
    const occurrence = (counts.get(value) ?? 0) + 1;
    counts.set(value, occurrence);
    return { item, key: `${value}#${occurrence}` };
  });
}
