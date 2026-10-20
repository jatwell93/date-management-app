import {
  applyChartDefaults,
  CHART_FONT_SIZE,
  CHART_GRID_COLOR,
  CHART_TEXT_COLOR,
  prefersReducedMotion,
} from '../chartDefaults';

type Defaults = Parameters<typeof applyChartDefaults>[0]['defaults'];

const makeChart = () => ({
  defaults: { font: {}, animation: { duration: 1000 } } as unknown as Defaults,
});

const stubReducedMotion = (matches: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({ matches, media: query })),
  );
};

describe('chart defaults', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets 14px Inter, token ink and hairline grid', () => {
    const chart = makeChart();
    applyChartDefaults(chart, false);

    expect(chart.defaults.font.size).toBe(CHART_FONT_SIZE);
    expect(chart.defaults.font.family).toMatch(/^'Inter'/);
    expect(chart.defaults.color).toBe(CHART_TEXT_COLOR);
    expect(chart.defaults.borderColor).toBe(CHART_GRID_COLOR);
    expect(chart.defaults.animation).toEqual({ duration: 1000 });
  });

  it('turns animation off when the OS asks for reduced motion', () => {
    stubReducedMotion(true);
    const chart = makeChart();

    applyChartDefaults(chart);

    expect(prefersReducedMotion()).toBe(true);
    expect(chart.defaults.animation).toBe(false);
  });

  it('keeps animation when reduced motion is not requested', () => {
    stubReducedMotion(false);
    const chart = makeChart();

    applyChartDefaults(chart);

    expect(chart.defaults.animation).toEqual({ duration: 1000 });
  });
});
