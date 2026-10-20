// One-time Chart.js defaults so every report chart matches the app's type and ink,
// and stops animating for people who ask the OS for reduced motion.
// Imported only by lazyCharts.ts, so chart.js stays out of the initial bundle.
import type { Chart } from 'chart.js';
import { semanticText } from '../../theme/semantic-tokens';

export const CHART_FONT_FAMILY =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const CHART_FONT_SIZE = 14;
/** Tick, legend and title ink: text-secondary #475569 (7.6:1 on white). */
export const CHART_TEXT_COLOR = semanticText.light.secondary;
/** Grid and axis lines: the brand hairline. */
export const CHART_GRID_COLOR = 'rgba(15, 23, 42, 0.08)';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

export function applyChartDefaults(
  chart: Pick<typeof Chart, 'defaults'>,
  reducedMotion: boolean = prefersReducedMotion(),
): void {
  const { defaults } = chart;
  defaults.font.family = CHART_FONT_FAMILY;
  defaults.font.size = CHART_FONT_SIZE;
  defaults.color = CHART_TEXT_COLOR;
  defaults.borderColor = CHART_GRID_COLOR;
  if (reducedMotion) {
    defaults.animation = false;
  }
}
