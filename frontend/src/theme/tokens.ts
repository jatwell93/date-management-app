/**
 * PharmIQ Design Tokens — Typed TypeScript Constants
 * Source: design-tokens.json (PharmIQ Brand Guidelines v2.0)
 *
 * Usage: import { colors, typography, spacing, ... } from '../theme/tokens';
 */
import designTokens from './design-tokens.json';

/* ── Colors ────────────────────────────────────────────────── */

export const colors = {
  brand: designTokens.colors.brand,
  dark: designTokens.colors.dark,
  atmospheric: designTokens.colors.atmospheric,
  border: designTokens.colors.border,
  surface: designTokens.colors.surface,
} as const;

export const brandColors = designTokens.colors.brand;
export const surfaceColors = designTokens.colors.surface;

/* ── Typography ────────────────────────────────────────────── */

export const typography = {
  fontFamily: designTokens.typography['font-family'],
  fontWeight: designTokens.typography['font-weight'],
  fontSize: designTokens.typography['font-size'],
  lineHeight: designTokens.typography['line-height'],
  letterSpacing: designTokens.typography['letter-spacing'],
  eyebrow: designTokens.typography.eyebrow,
} as const;

export const fontFamily = designTokens.typography['font-family'];
export const fontSize = designTokens.typography['font-size'];
export const fontWeight = designTokens.typography['font-weight'];
export const lineHeight = designTokens.typography['line-height'];
export const letterSpacing = designTokens.typography['letter-spacing'];

/* ── Spacing ───────────────────────────────────────────────── */

export const spacing = designTokens.spacing;
export const spacingScale = designTokens.spacing.scale;

/* ── Radius ────────────────────────────────────────────────── */

export const radius = designTokens.radius;

/* ── Elevation ─────────────────────────────────────────────── */

export const elevation = designTokens.elevation;

/* ── Motion ────────────────────────────────────────────────── */

export const motion = {
  duration: designTokens.motion.duration,
  easing: designTokens.motion.easing,
};

export const duration = designTokens.motion.duration;
export const easing = designTokens.motion.easing;

/* ── Full token export ─────────────────────────────────────── */

export default designTokens;
