# Mockup 05 — Logo Construction & Identity Assets
> Master reference for logo geometry, construction, and applied usage

---

## LOGO MARK — CONSTRUCTION GRID

The PharmIQ mark is a **hexagon with an integrated ascending chart** — combining the pharmacy hexagon symbol with business intelligence.

```
Construction on 48×48 unit grid:

        ╱──────────────╲
       ╱                ╲
      ╱                  ╲
      │    ↑ chart bars   │
      │    ██ ████ ████   │
      │    ██ ████ ████   │    ← ascending bar chart
      │    ██ ████ ████   │      (3 bars, heights: 40%, 70%, 100%)
      │    ██ ████ ████   │      bar colour: white (on teal icon)
      │                   │      or teal (on white icon)
      │  open top-right   │    ← hexagon is open at top-right corner
      ╲  (data flowing)  ╱       suggesting continuous data flow
       ╲                ╱
        ╲──────────────╱

Grid units: 48×48
Hexagon: flat-top orientation (⬡ not ⬢)
Stroke: 2.5 units on 48 grid
Bar fill: solid, no stroke
Corner radius on bars: 1 unit (2px at 48px)
Open gap top-right: 8 units wide
```

---

## WORDMARK — CONSTRUCTION

```
Space Grotesk 700

  P  h  a  r  m  I  Q
  ↑                ↑↑
  │                ││
  All navy         IQ = teal
  #0F172A          #0F766E
                   (IQ differentiator)

Letter spacing: -0.01em (tighter than default for logomark use)
Baseline alignment: visual centre with icon mark

Lockup proportions (horizontal):
  [Icon 1×] [Space 0.4×] [Wordmark 3.8×]
  Total lockup width: 5.2× icon height
```

---

## FULL LOGO — HORIZONTAL LOCKUP

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                            │
│    [clear space = height of Q]                                            │
│                                                                            │
│           ╱──────╲                                                         │
│          ╱  ▐ ▐▐▐ ╲         Pharm IQ                                     │
│          │  ▐ ▐▐▐  │  ────────────────                                   │
│          │  ▐ ▐▐▐  │  (icon 36px)  (wordmark Space Grotesk 700 28px)     │
│          ╲  (open) ╱                                                       │
│           ╲──────╱                                                         │
│                                                                            │
│    [clear space = height of Q]                                            │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘

Colour versions:
  • Full colour (default): Teal icon + Navy wordmark, "IQ" in teal
  • Reversed (on dark): White icon + White wordmark, "IQ" in teal-light
  • Monochrome dark: All #0F172A
  • Monochrome light (on dark): All #FFFFFF
```

---

## LOGO STACKED (VERTICAL) LOCKUP

```
┌──────────────────────────────────────┐
│                                       │
│           ╱──────╲                    │
│          ╱  ▐ ▐▐▐ ╲                  │
│          │  ▐ ▐▐▐  │  ← icon 48px    │
│          ╲  (open) ╱                  │
│           ╲──────╱                    │
│                                       │
│           Pharm IQ                   │
│           Space Grotesk 700 24px      │
│           centred below icon          │
│                                       │
│  Vertical gap: 8px                    │
│  Total stacked: 48 + 8 + 24 = ~80px  │
└──────────────────────────────────────┘
```

---

## LOGO — ICON ONLY (SMALL SPACES)

```
Usage: favicons, app icons, notification icons, stickers

24px: Full hexagon with bars (SVG only — pixel rendering)
32px: Full hexagon with bars
48px: Preferred minimum for quality
64px+: Full detail visible

App icon (iOS/Android):
  1024×1024px master
  bg: linear-gradient(145deg, #14B8A6 0%, #0F766E 50%, #0F172A 100%)
  icon: white bars in teal hexagon (2px white stroke outline)
  Radius applied by OS — export as square

Favicon:
  32×32px: Simplified hex + bars (2px stroke min)
  16×16px: Hex outline only with single bar as identifier
```

---

## PRODUCT MARK — EXPIRY MATE

Expiry Mate is a sub-brand under PharmIQ. It has its own product mark while staying visually connected.

```
┌──────────────────────────────────────────────────────────────┐
│  EXPIRY MATE PRODUCT MARK                                     │
│                                                               │
│    [Calendar hexagon icon]           Expiry                  │
│     hex outline with calendar grid    ────────               │
│     amber dot in top-right corner     Mate                   │
│     (the "expiry alert" indicator)                           │
│                                                               │
│  Hex: teal (#0F766E)                                         │
│  Calendar grid lines: white                                  │
│  Amber dot: #D97706 (brand warning colour)                   │
│                                                               │
│  Wordmark: Space Grotesk 600                                 │
│  "Expiry" = navy  "Mate" = teal                              │
│                                                               │
│  Sub-brand lockup below parent:                              │
│  "by ◇ PharmIQ" in 10px muted text                          │
└──────────────────────────────────────────────────────────────┘
```

---

## COLOUR SWATCHES — PRINT READY

```
┌──────────────────────────────────────────────────────────────┐
│ BRAND COLOURS                                                 │
│                                                               │
│  ████████  PharmIQ Teal         ████████  Teal Light        │
│  #0F766E   PMS 327 C (approx)   #14B8A6   PMS 326 C (approx)│
│  C:88 M:0 Y:33 K:26             C:73 M:0 Y:25 K:15          │
│  R:15 G:118 B:110               R:20 G:184 B:166            │
│                                                               │
│  ████████  PharmIQ Amber        ████████  PharmIQ Navy       │
│  #D97706   PMS 7549 C (approx)  #0F172A   PMS 5395 C (approx)│
│  C:0 M:45 Y:97 K:15             C:95 M:83 Y:47 K:68         │
│  R:217 G:119 B:6                R:15 G:23 B:42              │
│                                                               │
│  ████████  Success Green        ████████  Critical Red       │
│  #10B981   PMS 7479 C (approx)  #EF4444   PMS 485 C (approx)│
└──────────────────────────────────────────────────────────────┘
```

---

## MERCHANDISE APPLIED EXAMPLES

### Conference Lanyard
```
Lanyard: navy fabric (#0F172A)
ID card: white card
  - Front: ◇ PharmIQ logo (colour, 120px wide)
           Name + Title
           "pharmiq.com.au" in teal 10px
  - Back: QR code linking to /register
          "Smart Ops. Better Margins." in 9px
```

### Tote Bag
```
Bag: navy canvas
Print: Full-colour logo (white reversed version)
      Centred on front face, 120mm wide
Sub-text: "Smart Ops. Better Margins."
          Inter 400 white, 12mm high
          below logo, 15mm gap
```

### Printed A5 Flyer (leave-behind)
```
Front:
  Header: teal (#0F766E) full bleed
  Logo: white reversed, 80mm wide
  Hero stat: "$28,000 in dead stock — find yours free"
  Space Grotesk 700 24pt white
  CTA: pharmiq.com.au/free  QR code

Back:
  White bg, two-column layout
  Product 1: Heat Map  |  Product 2: Dead Stock
  Short description + benefit bullet
  "Start free at pharmiq.com.au"
  Footer: ABN, address
```

---

## STATIONERY

### Business Card (90×55mm)
```
Front:
  Left half: teal bg (#0F766E)
    White reversed logo (centred, 55mm wide)
  Right half: white
    Name: Space Grotesk 600 11pt navy
    Title: Inter 400 9pt secondary
    Email, Phone: Inter 400 9pt teal
    URL: pharmiq.com.au

Back:
  Full teal (#0F766E)
  White reversed PharmIQ icon mark only (centred, 25mm)
  "Smart Ops. Better Margins." below, Inter 400 8pt white/70%
```

### Email Signature
```
[Space Grotesk 600 15px navy] Sarah Chen
[Inter 400 13px secondary] Head of Partnerships · PharmIQ
[Inter 400 13px teal] sarah@pharmiq.com.au
[Inter 400 13px secondary] +61 4XX XXX XXX

[◇ PharmIQ logo, 120px wide, horizontal]

[13px border-top: 1px #E2E8F0]
[Inter 400 11px muted]
PharmIQ Pty Ltd · Melbourne, Australia
Smart Ops. Better Margins. · pharmiq.com.au
```
