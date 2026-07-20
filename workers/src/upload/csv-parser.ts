export interface CsvParserState {
  records: string[][];
  record: string[];
  field: string;
  inQuotes: boolean;
}

export function parseCsvRecords(text: string): string[][] {
  const state: CsvParserState = {
    records: [],
    record: [],
    field: '',
    inQuotes: false,
  };
  const content = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < content.length; index += 1) {
    index += advanceCsvParser(state, content[index], content[index + 1]);
  }

  finishCsvRecord(state);
  return state.records;
}

function advanceCsvParser(state: CsvParserState, char: string, nextChar?: string): number {
  if (char === '"' && state.inQuotes && nextChar === '"') {
    state.field += '"';
    return 1;
  }
  if (char === '"') {
    state.inQuotes = !state.inQuotes;
    return 0;
  }
  if (char === ',' && !state.inQuotes) {
    state.record.push(state.field);
    state.field = '';
    return 0;
  }
  if ((char === '\n' || char === '\r') && !state.inQuotes) {
    finishCsvRecord(state);
    return char === '\r' && nextChar === '\n' ? 1 : 0;
  }

  state.field += char;
  return 0;
}

function finishCsvRecord(state: CsvParserState): void {
  state.record.push(state.field);
  if (state.record.some((cell) => cell.trim())) {
    state.records.push(state.record);
  }
  state.record = [];
  state.field = '';
}
