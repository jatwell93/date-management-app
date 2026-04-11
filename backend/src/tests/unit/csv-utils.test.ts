import { escapeCSVValue, stringifyCSV } from '../../utils/csv';

describe('escapeCSVValue', () => {
  it('returns empty string for null and undefined', () => {
    expect(escapeCSVValue(null)).toBe('');
    expect(escapeCSVValue(undefined)).toBe('');
  });

  it('returns plain values without escaping when no special characters are present', () => {
    expect(escapeCSVValue('ABC123')).toBe('ABC123');
    expect(escapeCSVValue(42)).toBe('42');
  });

  it('wraps values containing commas in quotes', () => {
    expect(escapeCSVValue('hello,world')).toBe('"hello,world"');
  });

  it('escapes embedded double quotes', () => {
    expect(escapeCSVValue('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps newline content in quotes', () => {
    expect(escapeCSVValue('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('stringifyCSV', () => {
  it('returns only the header row when no data rows are provided', () => {
    const csv = stringifyCSV(['sku', 'name'], []);
    expect(csv).toBe('sku,name');
  });

  it('serializes rows using header order and escaping rules', () => {
    const csv = stringifyCSV(
      ['sku', 'name', 'notes'],
      [
        { sku: 'A-1', name: 'Milk', notes: 'plain' },
        { sku: 'B-2', name: 'Cream, Full', notes: 'say "hi"' },
      ],
    );

    expect(csv).toBe('sku,name,notes\nA-1,Milk,plain\nB-2,"Cream, Full","say ""hi"""');
  });

  it('stringifies Date values to their standard string representation', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    const csv = stringifyCSV(['createdAt'], [{ createdAt: date }]);
    expect(csv).toBe(`createdAt\n${String(date)}`);
  });
});
