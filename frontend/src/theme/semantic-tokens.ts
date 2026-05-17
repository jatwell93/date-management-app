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
 * SECONDARY — Data visualization, informational highlights, links
 * Source: brand sky-blue #0EA5E9
 */
export const semanticSecondary = {
  DEFAULT: brandColors['sky-blue'],
  foreground: '#FFFFFF',
  hover: '#0284C7',
  active: '#0369A1',
  muted: brandColors['sky-light'],
  'muted-foreground': '#0369A1',
} as const;

/**
 * WARNING — Alert states, pending badges, form validation warnings, amber restraint
 * Source: brand amber #D97706
 * NOTE: Amber is restricted to alert/emphasis contexts ONLY (see AMBER_USAGE_GUIDE.md)
 */
export const semanticWarning = {
  DEFAULT: brandColors.amber,
  foreground: '#FFFFFF',
  hover: '#B45309',
  active: '#92400E',
  muted: '#FEF3C7',
  'muted-foreground': '#92400E',
} as const;

/**
 * SUCCESS — Confirmation states, active badges, positive indicators
 * Source: brand green #10B981
 */
export const semanticSuccess = {
  DEFAULT: brandColors.green,
  foreground: '#FFFFFF',
  hover: '#059669',
  active: '#047857',
  muted: '#D1FAE5',
  'muted-foreground': '#047857',
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
} as const;

export default semanticColors;
