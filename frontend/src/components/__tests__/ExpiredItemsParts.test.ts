import { lossChartOptions } from '../expired-items/ExpiredItemsParts';

type TickOptions = {
  precision?: number;
  callback: (value: number | string, index: number, ticks: unknown[]) => string;
};

describe('lossChartOptions', () => {
  const ticks = lossChartOptions.scales?.y?.ticks as unknown as TickOptions;

  it('keeps y ticks on whole dollars so small totals cannot repeat a label', () => {
    expect(ticks.precision).toBe(0);
    expect(lossChartOptions.scales?.y).toMatchObject({ beginAtZero: true });
  });

  it('formats ticks as whole AUD and passes through non-numeric values', () => {
    expect(ticks.callback(0, 0, [])).toBe('$0');
    expect(ticks.callback(1250, 0, [])).toBe('$1,250');
    expect(ticks.callback('n/a', 0, [])).toBe('n/a');
  });

  it('does not repeat the card heading as a canvas title', () => {
    expect(lossChartOptions.plugins?.title?.display).toBe(false);
  });
});
