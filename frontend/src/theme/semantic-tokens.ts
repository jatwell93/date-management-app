/**
 * PharmIQ Semantic Tokens — Intent-Based Mappings
 *
 * 8 semantic categories that map UI intent to raw brand tokens.
 * Components MUST consume these semantic mappings, never raw brand tokens directly.
 *
 * Usage: import { semanticColors, semanticTokens } from '../theme/semantic-tokens';
 */
import { brandColors, surfaceColors } from './tokens';

/* ── Semantic Color Categories ─────────────────────────────── */

/**
 * PRIMARY — CTAs, selection states, active navigation, focus rings
 * Source: brand teal #0F766E
 */
export const semanticPrimary = {
  DEFAULT: brandColors.teal,
  foreground: '#FFFFFF',
  hover: '#115E59',
  active: '#134E4A',
  muted: '#CCFBF1',
  'muted-foreground': '#0F766E',
} as const;

/**
 * SECONDARY — Data visualization, informational highlights
 * Source: brand sky-blue #0EA5E9
 *
 * NOT a link or text colour: #0EA5E9 is 2.8:1 on white. Links use primary teal
 * (#0F766E, 5.5:1). For informational text use `strong` on white or
 * `muted-foreground` on `muted`; `strong` is also the fill behind white text.
 */
export const semanticSecondary = {
  DEFAULT: brandColors['sky-blue'],
  foreground: '#FFFFFF',
  hover: '#0284C7',
  active: '#0369A1',
  muted: brandColors['sky-light'],
  'muted-foreground': '#0369A1',
  strong: '#0369A1',
  'strong-hover': '#075985',
} as const;

/**
 * WARNING — Alert states, pending badges, form validation warnings, amber restraint
 * Source: brand amber #D97706
 * NOTE: Amber is restricted to alert/emphasis contexts ONLY (see AMBER_USAGE_GUIDE.md)
 * DEFAULT is 3.2:1 on white: icons/borders only. Text uses `strong` (5.0:1) on
 * white or `muted-foreground` on `muted`; `strong` is the fill behind white text.
 */
export const semanticWarning = {
  DEFAULT: brandColors.amber,
  foreground: '#FFFFFF',
  hover: '#B45309',
  active: '#92400E',
  muted: '#FEF3C7',
  'muted-foreground': '#92400E',
  strong: '#B45309',
  'strong-hover': '#92400E',
} as const;

/**
 * SUCCESS — Confirmation states, active badges, positive indicators
 * Source: brand green #10B981
 * DEFAULT is 2.5:1 on white: icons/borders only. Text uses `strong` (5.5:1) on
 * white or `muted-foreground` on `muted`; `strong` is the fill behind white text.
 */
export const semanticSuccess = {
  DEFAULT: brandColors.green,
  foreground: '#FFFFFF',
  hover: '#059669',
  active: '#047857',
  muted: '#D1FAE5',
  'muted-foreground': '#047857',
  strong: '#047857',
  'strong-hover': '#065F46',
} as const;

/**
 * CRITICAL — Errors, destructive actions, error badges, scan failures
 * Source: brand red #DC2626
 */
export const semanticCritical = {
  DEFAULT: brandColors.red,
  foreground: '#FFFFFF',
  hover: '#B91C1C',
  active: '#991B1B',
  muted: '#FEE2E2',
  'muted-foreground': '#991B1B',
} as const;

/**
 * SURFACE — Background layers, card surfaces, text hierarchy
 * Source: surface ladder + brand navy
 */
export const semanticSurface = {
  light: {
    background: surfaceColors.light['surface-1'],
    'surface-1': surfaceColors.light['surface-1'],
    'surface-2': surfaceColors.light['surface-2'],
    'surface-3': surfaceColors.light['surface-3'],
    'surface-4': surfaceColors.light['surface-4'],
  },
  dark: {
    background: surfaceColors.dark['surface-1'],
    'surface-1': surfaceColors.dark['surface-1'],
    'surface-2': surfaceColors.dark['surface-2'],
    'surface-3': surfaceColors.dark['surface-3'],
    'surface-4': surfaceColors.dark['surface-4'],
  },
} as const;

/**
 * TEXT — Text color hierarchy for light and dark modes
 * Source: brand navy + surface palette
 */
export const semanticText = {
  light: {
    primary: brandColors.navy,
    secondary: '#475569',
    tertiary: '#64748B',
    muted: '#94A3B8',
    inverse: '#FFFFFF',
  },
  dark: {
    primary: '#F1F5F9',
    secondary: '#CBD5E1',
    tertiary: '#94A3B8',
    muted: '#64748B',
    inverse: brandColors.navy,
  },
} as const;

/**
 * DATA-VIZ — Chart series colors, data visualization palette
 * Colorblind-accessible ordering: teal → sky → amber → green → red → navy
 */
export const semanticDataViz = {
  series1: brandColors.teal,
  series2: brandColors['sky-blue'],
  series3: brandColors.amber,
  series4: brandColors.green,
  series5: brandColors.red,
  series6: brandColors.navy,
} as const;

/**
 * DATA-VIZ (strong) — for a series drawn alone or as a thin line, where it must
 * reach 3:1 against white (WCAG 1.4.11). Sky #0EA5E9 is 2.8:1 and green #10B981
 * is 2.5:1; amber #D97706 passes at 3.2:1 but is marginal for 1-2px lines.
 * Multi-series charts may keep the brand palette when each series also has a
 * label, pattern or legend entry (colour is never the only signal).
 */
export const semanticDataVizStrong = {
  series2: '#0369A1',
  series3: '#B45309',
  series4: '#047857',
} as const;

/* ── Aggregated Export ─────────────────────────────────────── */

export const semanticColors = {
  primary: semanticPrimary,
  secondary: semanticSecondary,
  warning: semanticWarning,
  success: semanticSuccess,
  critical: semanticCritical,
  surface: semanticSurface,
  text: semanticText,
  dataViz: semanticDataViz,
  dataVizStrong: semanticDataVizStrong,
} as const;

export default semanticColors;
