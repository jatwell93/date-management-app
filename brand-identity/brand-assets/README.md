# PharmIQ Brand Assets

Implementation-ready brand code files. Consume these directly in your web app, mobile app, and design tools.

## Directory Structure

```
brand-assets/
├── logo/
│   ├── pharmiq-icon.svg           ← Icon mark only (use for favicon, app icon, avatars)
│   ├── pharmiq-icon-reversed.svg  ← Icon on dark backgrounds
│   ├── pharmiq-logo-full.svg      ← Full horizontal logo (website header, docs)
│   ├── pharmiq-logo-reversed.svg  ← Full logo for dark backgrounds
│   ├── pharmiq-wordmark.svg       ← Wordmark only
│   ├── pharmiq-logo-mono.svg      ← Single-colour (emboss, embroidery, B&W print)
│   └── Logo.tsx                   ← React component (all variants + colour modes)
│
├── colors/
│   └── brand-colors.ts            ← TypeScript colour system (all brand colours + semantic)
│
├── typography/
│   ├── Typography.tsx             ← React typography components (H1–Caption, DataMetric)
│   └── fonts.css                  ← Font loading + global typography styles
│
├── templates/
│   ├── SocialPost.tsx             ← LinkedIn (1200×627), Instagram (1080×1080), Story (1080×1920)
│   └── BusinessCard.tsx           ← SVG business cards + HTML email signature
│
├── scripts/
│   └── generate-favicons.ts       ← Generate all favicon/icon sizes from master SVG
│
├── pharmiq.webmanifest            ← PWA web manifest
└── README.md                      ← This file
```

## Quick Start

### 1. Install fonts (add to `<head>`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
```

Or with Fontsource (recommended for production):
```bash
npm install @fontsource/space-grotesk @fontsource/inter
```

### 2. Load design tokens

```tsx
// In your app root (e.g. _app.tsx / layout.tsx)
import '@/brand-assets/typography/fonts.css'
import '@/brand/design-tokens.css'   // from ../design-tokens.css
```

### 3. Use the Logo component

```tsx
import { Logo } from '@/brand-assets/logo/Logo'

// Full horizontal logo (default)
<Logo />

// Icon only, 32px
<Logo variant="icon" size={32} />

// Reversed on dark backgrounds
<Logo color="white" />

// Wordmark only
<Logo variant="wordmark" />
```

### 4. Use brand colours

```typescript
import { brand, semantic, chart } from '@/brand-assets/colors/brand-colors'

const primary = brand.teal[700]   // '#0F766E'
const warning = semantic.warning.DEFAULT   // '#D97706'
const series1 = chart.series1     // '#0F766E'
```

### 5. Use typography components

```tsx
import { H1, H2, Body, DataMetric } from '@/brand-assets/typography/Typography'

<H1>Smart Ops. Better Margins.</H1>
<Body color="secondary">Turn your pharmacy data into your pharmacy's advantage.</Body>
<DataMetric value="$48,230" label="Today's Revenue" trend="+12%" trendDir="up" />
```

### 6. Generate favicons

```bash
npm install sharp --save-dev
npx tsx brand-assets/scripts/generate-favicons.ts
```

Add to `<head>`:
```html
<link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
<link rel="manifest" href="/pharmiq.webmanifest" />
<meta name="theme-color" content="#0F766E" />
```

### 7. Social media templates (with @vercel/og)

```tsx
import { ImageResponse } from 'next/og'
import { LinkedInPost } from '@/brand-assets/templates/SocialPost'

export function GET() {
  return new ImageResponse(
    <LinkedInPost
      stat="$28,000"
      headline="in dead stock sitting on AU pharmacy shelves"
      description="How much is yours? Find out free with PharmIQ."
      badge="Pharmacy Insight"
      cta="Start Free"
    />,
    { width: 1200, height: 627 }
  )
}
```

## Colour Reference (Quick)

| Token | Hex | Use |
|-------|-----|-----|
| `brand.teal[700]` | `#0F766E` | Primary CTAs, active states, brand chrome |
| `brand.amber[600]` | `#D97706` | Alerts, expiry warnings, AU accent |
| `brand.navy[900]` | `#0F172A` | Headings, dark backgrounds |
| `brand.sky[500]` | `#0EA5E9` | Secondary charts, info states |
| `semantic.critical.DEFAULT` | `#EF4444` | Expired items, errors |
| `semantic.success.DEFAULT` | `#10B981` | In-stock, positive trends |
| `semantic.deadStock.DEFAULT` | `#8B5CF6` | Dead-stock badges |

## Typography Reference

| Use | Font | Weight | Size |
|-----|------|--------|------|
| Hero headings | Space Grotesk | 800 | 56px |
| Page titles H1 | Space Grotesk | 700 | 40px |
| Section headings H2 | Space Grotesk | 700 | 32px |
| Card headings H3 | Space Grotesk | 600 | 24px |
| Body copy | Inter | 400 | 16px |
| Dashboard KPIs | Space Grotesk | 600 | 32px |
| Table cells / data | Inter (tabular-nums) | 400 | 15px |
| Labels (uppercase) | Inter | 500 | 13px |
| Captions | Inter | 400 | 12px |

## Logo Usage Rules

- **Minimum digital width**: 140px (full), 24px (icon)
- **Clear space**: Equal to the height of the "Q" on all sides
- **Never**: rotate, recolour outside approved variants, add effects, distort
- **Dark backgrounds**: Use `pharmiq-logo-reversed.svg` or `<Logo color="white" />`
- **Single colour print**: Use `pharmiq-logo-mono.svg`

## File Formats for Export

| Asset | Format |
|-------|--------|
| Logo master | SVG (lossless, scalable) |
| Logo raster | PNG @2× and @3× |
| App icon | PNG 1024×1024 (let platform scale) |
| Favicon | PNG suite (see generate-favicons.ts) |
| Social posts | PNG via @vercel/og or satori |
| Print materials | SVG → PDF via Illustrator/Affinity |
