import { describe, expect, it } from 'vitest';
import { withOccurrenceKeys } from './listKeys';

describe('withOccurrenceKeys', () => {
  it('numbers repeated values so keys stay unique', () => {
    const keys = withOccurrenceKeys(['a', 'b', 'a', ''], (v) => v).map((r) => r.key);
    expect(keys).toEqual(['a#1', 'b#1', 'a#2', '#1']);
  });

  it('keeps a value key stable when an unrelated item is removed', () => {
    const before = withOccurrenceKeys(['x', 'y'], (v) => v).find((r) => r.item === 'y')?.key;
    const after = withOccurrenceKeys(['y'], (v) => v).find((r) => r.item === 'y')?.key;
    expect(after).toBe(before);
  });
});
