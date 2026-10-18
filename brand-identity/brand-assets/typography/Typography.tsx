/**
 * PharmIQ Typography System — React Components
 *
 * All type components use design tokens via CSS custom properties.
 * Requires design-tokens.css to be loaded in the app.
 *
 * Usage:
 *   import { Display, H1, H2, H3, Body, BodyLg, Label, Caption, DataMetric } from '@/brand/Typography'
 *
 *   <H1>Smart Ops. Better Margins.</H1>
 *   <DataMetric value="$48,230" trend="+12%" trendDir="up" />
 */

import React from 'react'

// ── Shared types ──────────────────────────────────────────────────────────────

type Color = 'primary' | 'secondary' | 'muted' | 'teal' | 'amber' | 'white' | 'critical'

interface BaseProps {
  children: React.ReactNode
  color?:   Color
  className?: string
  id?: string
}

const colorMap: Record<Color, string> = {
  primary:   'var(--color-text-primary)',
  secondary: 'var(--color-text-secondary)',
  muted:     'var(--color-text-muted)',
  teal:      'var(--color-brand-teal)',
  amber:     'var(--color-brand-amber)',
  white:     '#FFFFFF',
  critical:  'var(--color-critical)',
}

// ── Display — Hero headings ───────────────────────────────────────────────────

export function Display({ children, color = 'primary', className, id }: BaseProps) {
  return (
    <h1
      id={id}
      className={className}
      style={{
        fontFamily:    'var(--font-heading)',
        fontSize:      'var(--text-display)',
        fontWeight:    800,
        lineHeight:    'var(--leading-display)',
        letterSpacing: '-0.02em',
        color:         colorMap[color],
        margin:        0,
      }}
    >
      {children}
    </h1>
  )
}

// ── Headings H1–H4 ────────────────────────────────────────────────────────────

export function H1({ children, color = 'primary', className, id }: BaseProps) {
  return (
    <h1
      id={id}
      className={className}
      style={{
        fontFamily:    'var(--font-heading)',
        fontSize:      'var(--text-h1)',
        fontWeight:    700,
        lineHeight:    'var(--leading-heading)',
        letterSpacing: '-0.01em',
        color:         colorMap[color],
        margin:        0,
      }}
    >
      {children}
    </h1>
  )
}

export function H2({ children, color = 'primary', className, id }: BaseProps) {
  return (
    <h2
      id={id}
      className={className}
      style={{
        fontFamily:    'var(--font-heading)',
        fontSize:      'var(--text-h2)',
        fontWeight:    700,
        lineHeight:    'var(--leading-heading)',
        letterSpacing: '-0.01em',
        color:         colorMap[color],
        margin:        0,
      }}
    >
      {children}
    </h2>
  )
}

export function H3({ children, color = 'primary', className, id }: BaseProps) {
  return (
    <h3
      id={id}
      className={className}
      style={{
        fontFamily: 'var(--font-heading)',
        fontSize:   'var(--text-h3)',
        fontWeight: 600,
        lineHeight: 'var(--leading-heading)',
        color:      colorMap[color],
        margin:     0,
      }}
    >
      {children}
    </h3>
  )
}

export function H4({ children, color = 'primary', className, id }: BaseProps) {
  return (
    <h4
      id={id}
      className={className}
      style={{
        fontFamily: 'var(--font-heading)',
        fontSize:   'var(--text-h4)',
        fontWeight: 600,
        lineHeight: 'var(--leading-heading)',
        color:      colorMap[color],
        margin:     0,
      }}
    >
      {children}
    </h4>
  )
}

// ── Body Text ─────────────────────────────────────────────────────────────────

export function BodyLg({ children, color = 'secondary', className }: BaseProps) {
  return (
    <p
      className={className}
      style={{
        fontFamily: 'var(--font-body)',
        fontSize:   'var(--text-body-lg)',
        fontWeight: 400,
        lineHeight: 'var(--leading-body)',
        color:      colorMap[color],
        margin:     0,
      }}
    >
      {children}
    </p>
  )
}

export function Body({ children, color = 'secondary', className }: BaseProps) {
  return (
    <p
      className={className}
      style={{
        fontFamily: 'var(--font-body)',
        fontSize:   'var(--text-body)',
        fontWeight: 400,
        lineHeight: 'var(--leading-body)',
        color:      colorMap[color],
        margin:     0,
      }}
    >
      {children}
    </p>
  )
}

export function BodySm({ children, color = 'secondary', className }: BaseProps) {
  return (
    <p
      className={className}
      style={{
        fontFamily: 'var(--font-body)',
        fontSize:   'var(--text-body-sm)',
        fontWeight: 400,
        lineHeight: 'var(--leading-body)',
        color:      colorMap[color],
        margin:     0,
      }}
    >
      {children}
    </p>
  )
}

// ── Label ─────────────────────────────────────────────────────────────────────

export function Label({ children, color = 'secondary', className }: BaseProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily:    'var(--font-body)',
        fontSize:      'var(--text-label)',
        fontWeight:    500,
        lineHeight:    'var(--leading-label)',
        letterSpacing: '0.01em',
        color:         colorMap[color],
        textTransform: 'uppercase',
      }}
    >
      {children}
    </span>
  )
}

// ── Caption ───────────────────────────────────────────────────────────────────

export function Caption({ children, color = 'muted', className }: BaseProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily:    'var(--font-body)',
        fontSize:      'var(--text-caption)',
        fontWeight:    400,
        lineHeight:    'var(--leading-label)',
        color:         colorMap[color],
      }}
    >
      {children}
    </span>
  )
}

// ── DataMetric — Dashboard KPI display ───────────────────────────────────────
//
// Renders a large metric value with optional trend indicator.
// Uses tabular-nums to prevent layout shift on value changes.
//
// Usage:
//   <DataMetric value="$48,230" label="Today's Revenue" trend="+12%" trendDir="up" />

interface DataMetricProps {
  value:      string | number
  label?:     string
  trend?:     string
  trendDir?:  'up' | 'down' | 'neutral'
  color?:     Color
  className?: string
}

export function DataMetric({ value, label, trend, trendDir = 'neutral', color = 'primary', className }: DataMetricProps) {
  const trendColors = {
    up:      'var(--color-success)',
    down:    'var(--color-critical)',
    neutral: 'var(--color-text-muted)',
  }
  const trendIcons = { up: '↑', down: '↓', neutral: '→' }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <span style={{
          fontFamily:    'var(--font-body)',
          fontSize:      'var(--text-caption)',
          fontWeight:    500,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color:         'var(--color-text-muted)',
        }}>
          {label}
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontFamily:          'var(--font-heading)',
          fontSize:            'var(--text-data-lg)',
          fontWeight:          600,
          lineHeight:          'var(--leading-display)',
          color:               colorMap[color],
          fontVariantNumeric:  'tabular-nums',
        }}>
          {value}
        </span>
        {trend && (
          <span style={{
            fontFamily:         'var(--font-body)',
            fontSize:           'var(--text-body-sm)',
            fontWeight:         500,
            color:              trendColors[trendDir],
            fontVariantNumeric: 'tabular-nums',
          }}>
            {trendIcons[trendDir]} {trend}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Tagline — Brand tagline component ────────────────────────────────────────

export function Tagline({ className }: { className?: string }) {
  return (
    <p
      className={className}
      style={{
        fontFamily:    'var(--font-heading)',
        fontSize:      'var(--text-h3)',
        fontWeight:    700,
        lineHeight:    1.2,
        letterSpacing: '-0.01em',
        color:         'var(--color-text-primary)',
        margin:        0,
      }}
    >
      Infrastructure for Choice.{' '}
      <span style={{ color: 'var(--color-brand-teal)' }}>Clarity for Growth.</span>
    </p>
  )
}
