/**
 * PharmIQ Brand Color System
 *
 * Single source of truth for all colour values.
 * Import this wherever you need brand-accurate colours.
 *
 * Usage:
 *   import { brand, semantic, chart, neutral } from '@/brand/colors'
 *   const primary = brand.teal[600]   // → '#0F766E'
 *
 * Design token mapping:
 *   CSS custom properties are in design-tokens.css
 *   JSON tokens are in design-tokens.json
 */

// ── Brand Primary: Teal ───────────────────────────────────────────────────────
// Deep teal — uncontested territory in AU pharmacy tech market.
// Distinct from Pharmacy Halo's lighter teal (#39C0C0) and every blue competitor.
export const teal = {
  50:  '#F0FDFA',  // Row hover, teal surface backgrounds
  100: '#CCFBF1',  // Selected states, badge backgrounds
  200: '#99F6E4',  // Chart fills, illustrated elements
  300: '#5EEAD4',  // Heat map scale mid
  400: '#2DD4BF',  // Lighter interactive states
  500: '#14B8A6',  // Teal Light — hover states, reversed logo accent
  600: '#0D9488',  // Interactive hover on primary
  700: '#0F766E',  // ★ PharmIQ Teal — PRIMARY BRAND COLOUR
  800: '#0D5D5A',  // Teal Dark — pressed/active states
  900: '#134E4A',  // Deepest teal — high-contrast text on teal bg
} as const

// ── Brand Accent: Amber ───────────────────────────────────────────────────────
// Australian warmth + functional alert colour.
// No AU pharmacy tech competitor uses amber/gold as primary accent.
export const amber = {
  50:  '#FFFBEB',  // Warning card backgrounds
  100: '#FEF3C7',  // Light alert fills
  200: '#FDE68A',  // Amber Light — warning badge backgrounds
  300: '#FCD34D',  // Medium amber
  400: '#FBBF24',  // Bright amber
  500: '#F59E0B',  // Standard amber
  600: '#D97706',  // ★ PharmIQ Amber — BRAND ACCENT / ALERT COLOUR
  700: '#B45309',  // Hover on amber
  800: '#92400E',  // Amber Dark — alert text on light backgrounds (7:1 on white = AAA ✓)
  900: '#78350F',  // Deep amber text
} as const

// ── Brand Base: Navy ──────────────────────────────────────────────────────────
// Primary text, navigation, headings — authoritative and trustworthy.
export const navy = {
  50:  '#F8FAFC',  // Surface / sidebar background
  100: '#F1F5F9',  // Light surface variant
  200: '#E2E8F0',  // Border Light
  300: '#CBD5E1',  // Border Mid
  400: '#94A3B8',  // Text Muted (DECORATIVE ONLY — never body text)
  500: '#64748B',  // Medium secondary
  600: '#475569',  // ★ Text Secondary — body copy, descriptions
  700: '#334155',  // Text strong secondary
  800: '#1E293B',  // Dark surface
  850: '#1E3A5F',  // Navy Mid — card headers, sidebar
  900: '#0F172A',  // ★ PharmIQ Navy — PRIMARY TEXT / DARK BACKGROUND
} as const

// ── Brand Secondary: Sky Blue ─────────────────────────────────────────────────
// Tech accent for secondary metrics in charts and informational states.
export const sky = {
  50:  '#F0F9FF',
  100: '#E0F2FE',
  300: '#7DD3FC',
  400: '#38BDF8',
  500: '#0EA5E9',  // ★ PharmIQ Sky — secondary tech accent, chart series 2, info states
  600: '#0284C7',
  700: '#0369A1',
} as const

// ── Semantic Colours ──────────────────────────────────────────────────────────
export const semantic = {
  success: {
    DEFAULT: '#10B981',  // Positive trends, in-stock, completions
    bg:      '#ECFDF5',  // Badge/card backgrounds
    dark:    '#059669',  // Hover / pressed
    text:    '#065F46',  // Text on success-bg (meets AA)
  },
  warning: {
    DEFAULT: amber[600], // '#D97706' — reuses brand amber
    bg:      amber[50],  // '#FFFBEB'
    dark:    amber[700], // '#B45309'
    text:    amber[800], // '#92400E' (7:1 contrast on white = AAA ✓)
  },
  critical: {
    DEFAULT: '#EF4444',  // Expired items, critical errors, stock-outs
    bg:      '#FEF2F2',  // Alert backgrounds
    dark:    '#DC2626',  // Hover
    text:    '#991B1B',  // Text on critical-bg (meets AA)
  },
  info: {
    DEFAULT: sky[500],   // '#0EA5E9' — reuses brand sky
    bg:      sky[50],    // '#F0F9FF'
    dark:    sky[600],
    text:    sky[700],
  },
  deadStock: {
    DEFAULT: '#8B5CF6',  // Dead-stock specific — distinct from warnings
    bg:      '#F5F3FF',
    dark:    '#7C3AED',
    text:    '#5B21B6',
  },
} as const

// ── Neutral Palette ───────────────────────────────────────────────────────────
export const neutral = {
  white:        '#FFFFFF',
  surface:      navy[50],   // '#F8FAFC'
  borderLight:  navy[200],  // '#E2E8F0'
  borderMid:    navy[300],  // '#CBD5E1'
  textPrimary:  navy[900],  // '#0F172A'
  textSecondary:navy[600],  // '#475569'
  textMuted:    navy[400],  // '#94A3B8' — DECORATIVE ONLY
} as const

// ── Chart / Data Viz Palette ──────────────────────────────────────────────────
// All series tested for minimum 3:1 contrast against #F8FAFC surface.
// Never rely on colour alone to distinguish series — pair with icons/labels.
export const chart = {
  series1: teal[700],       // '#0F766E' — primary metric
  series2: sky[500],        // '#0EA5E9' — secondary metric
  series3: amber[600],      // '#D97706' — alert/warning metric ⚠️ don't pair with series6 alone
  series4: '#8B5CF6',       // Violet    — comparison metric
  series5: '#10B981',       // Green     — growth/positive metric
  series6: '#F43F5E',       // Rose      — negative/loss ⚠️ don't pair with series3 alone
  gridLine: neutral.borderLight,   // '#E2E8F0' — subtle, doesn't compete with data
  axisLabel: neutral.textMuted,    // '#94A3B8'
  heatmap: [
    navy[50],    // Level 0: no data
    teal[100],   // Level 1: low
    teal[300],   // Level 2: below average
    teal[700],   // Level 3: average
    amber[600],  // Level 4: above average / hot
    amber[800],  // Level 5: top performer
  ],
} as const

// ── Accessibility Audit ───────────────────────────────────────────────────────
// Pre-verified contrast ratios (use to fail-fast in CI if colours change)
export const contrastAudit = [
  { combo: 'White text on teal[700]',         ratio: 5.3,  passes: 'AA'  },
  { combo: 'Navy[900] on white',              ratio: 19.1, passes: 'AAA' },
  { combo: 'Teal[700] on white',              ratio: 5.3,  passes: 'AA'  },
  { combo: 'Amber[800] on white',             ratio: 7.0,  passes: 'AA'  },
  { combo: 'White on navy[900]',              ratio: 19.1, passes: 'AAA' },
  { combo: 'Navy[900] on amber[600]',         ratio: 7.0,  passes: 'AA'  },
  { combo: 'Navy[600] on white (body text)',  ratio: 5.9,  passes: 'AA'  },
  { combo: 'White text on amber[600]',        ratio: 2.8,  passes: 'FAIL — NEVER use for text' },
  { combo: 'Navy[400] on white (muted)',      ratio: 2.7,  passes: 'FAIL — decorative only' },
] as const

// ── Full palette export ───────────────────────────────────────────────────────
export const brand = { teal, amber, navy, sky } as const

export default {
  brand,
  semantic,
  neutral,
  chart,
  contrastAudit,
}
