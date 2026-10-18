# Mockup 01 — PharmIQ Website Homepage
> Desktop (1440px) | Annotated wireframe with design token references

---

## SECTION 1: NAVIGATION BAR
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: var(--color-white)  border-bottom: 1px solid var(--color-border-light)             │
│  height: 64px  position: sticky  top: 0  z-index: var(--z-sticky)                      │
│                                                                                          │
│  ◇ PharmIQ          Features  Pricing  Case Studies  Blog           [Sign In]  [Start Free →]  │
│                                                                                          │
│  ←── Logo: icon (24px teal hex-chart) + wordmark Space Grotesk 600 navy ──→            │
│  Nav links: Inter 500 14px text-secondary  |  hover: text-primary                      │
│  Sign In: ghost button  |  Start Free: Primary teal button 40px height                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 2: HERO
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: linear-gradient(135deg, var(--color-brand-navy) 0%, #1E3A5F 60%, #0F766E 100%)    │
│  padding: 96px 80px  min-height: 640px                                                  │
│                                                                                          │
│  ┌───────────────────────────────┐    ┌────────────────────────────────────────────┐    │
│  │  LEFT COLUMN (max-width 520px)│    │  RIGHT COLUMN: Product Screenshot          │    │
│  │                               │    │                                            │    │
│  │  [Chip: "Free for every AU pharmacy"]      │  ┌────────────────────────────────┐ │  │
│  │  bg: rgba(15,118,110,0.3)     │    │  │   PharmIQ Dashboard          ╳   │ │  │
│  │  border: 1px solid teal-light │    │  │──────────────────────────────────│ │  │
│  │  text: 13px amber 500         │    │  │  Today's Overview              ▼ │ │  │
│  │                               │    │  │                                   │ │  │
│  │  Smart Ops.                   │    │  │  ┌────────┐ ┌────────┐ ┌──────┐  │ │  │
│  │  Better Margins.              │    │  │  │Revenue │ │Scripts │ │ Dead │  │ │  │
│  │                               │    │  │  │$48,230 │ │  312   │ │Stock │  │ │  │
│  │  Space Grotesk 700 56px white │    │  │  │↑ 12%   │ │↑  8%   │ │  7   │  │ │  │
│  │  line-height: 1.1             │    │  │  │  teal  │ │  sky   │ │amber │  │ │  │
│  │                               │    │  │  └────────┘ └────────┘ └──────┘  │ │  │
│  │  Turn your pharmacy's data    │    │  │                                   │ │  │
│  │  into your pharmacy's         │    │  │  [Sales Heat Map - Mini]          │ │  │
│  │  advantage. Free tools to     │    │  │  Mon-Fri grid, teal scale         │ │  │
│  │  start — premium when you're  │    │  │  9am-5pm heat cells               │ │  │
│  │  ready to go further.         │    │  │                                   │ │  │
│  │                               │    │  │  [Dead Stock bar: 7 items]        │ │  │
│  │  Inter 400 18px white/80%     │    │  │  ██████░░ $2,340 tied up →       │ │  │
│  │  max-width: 420px             │    │  └────────────────────────────────┘ │  │
│  │  leading: 1.65                │    │  Shadow: var(--shadow-xl)            │    │
│  │                               │    │  Border-radius: 12px                 │    │
│  │  ┌──────────────────────────┐ │    │  Device frame: subtle navy border    │    │
│  │  │  [Start for Free →]      │ │    └────────────────────────────────────────┘    │
│  │  │  bg: amber  text: navy   │ │                                                  │
│  │  │  height: 52px  r: 8px    │ │                                                  │
│  │  └──────────────────────────┘ │                                                  │
│  │  [Watch 2-min demo] →         │                                                  │
│  │  text: white/70%  Inter 500   │                                                  │
│  │                               │                                                  │
│  │  ─────────────────────────    │                                                  │
│  │  "3,200+ pharmacies.          │                                                  │
│  │   Across every state."        │                                                  │
│  │  12px Inter white/50%         │                                                  │
│  └───────────────────────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 3: SOCIAL PROOF BAR
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: var(--color-surface)  border-top/bottom: 1px solid var(--color-border-light)      │
│  padding: 32px 80px                                                                     │
│                                                                                         │
│  "Trusted by pharmacies across Australia"    [Guild Group]  [Priceline]  [Terry White]  │
│  [Capital Chemist]  [Sigma Healthcare]  [API]                                           │
│                                                                                         │
│  12px Inter muted  |  logos: grayscale, 40px height, 60% opacity                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 4: PROBLEM SECTION ("The Pain Points")
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: white  padding: 80px                                                               │
│                                                                                         │
│  [Centre-aligned]                                                                       │
│  You're leaving money on the shelf.                                                     │
│  Space Grotesk 700 40px navy  max-width: 640px                                          │
│                                                                                         │
│  Every day, Australian pharmacies face the same three margin killers:                   │
│  Inter 400 18px text-secondary  max-width: 560px                                       │
│                                                                                         │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │ [icon: clock/dead]   │  │ [icon: calendar/x]   │  │ [icon: chart-drop]   │         │
│  │                      │  │                      │  │                      │         │
│  │  Dead Stock          │  │  Expiry Write-offs   │  │  Invisible Sales     │         │
│  │                      │  │                      │  │  Patterns            │         │
│  │  $28,000 average     │  │  4.2% of AU pharmacy │  │  You can't see       │         │
│  │  tied up in stock    │  │  stock reaches        │  │  where your margins  │         │
│  │  that won't move.    │  │  expiry annually.     │  │  are won or lost.    │         │
│  │                      │  │                      │  │                      │         │
│  │  15px Inter secondary│  │  15px Inter secondary│  │  15px Inter secondary│         │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘         │
│  Card: white bg  border: border-light  radius: 12px  shadow: sm  padding: 28px         │
│  Number stat: Space Grotesk 700 32px teal                                              │
│  Label: Inter 600 18px navy                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 5: PRODUCT SUITE
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: surface  padding: 80px                                                             │
│                                                                                         │
│  Three tools. One platform. Free to start.                                              │
│  Space Grotesk 700 40px navy                                                            │
│                                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │  PRODUCT CARD 1: SALES HEAT-MAP DASHBOARD                                       │   │
│  │  border-top: 3px solid var(--color-brand-teal)                                  │   │
│  │  bg: white  padding: 32px  radius: 12px  shadow: sm                             │   │
│  │                                                                                  │   │
│  │  [Mini heat-map visualisation — 7-day grid, amber hot cells, teal avg cells]    │   │
│  │  ████░░░ Mon  ░░████░ Tue  ░░░░░░ Wed  ░████░ Thu  ███░░░ Fri                  │   │
│  │  color scale legend: —teal scale→ amber                                         │   │
│  │                                                                                  │   │
│  │  Sales Heat-Map Dashboard                                                       │   │
│  │  Space Grotesk 600 22px navy                                                    │   │
│  │                                                                                  │   │
│  │  See exactly when your pharmacy is busy — and when it's not. Optimise staffing, │   │
│  │  promotions, and ordering around real sales patterns.                           │   │
│  │  Inter 400 15px secondary  leading: 1.6                                         │   │
│  │                                                                                  │   │
│  │  [Free ✓]  [Learn More →]                                                      │   │
│  │  Chip: success green  |  Text link: teal 500                                    │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                         │
│  [PRODUCT CARD 2: DEAD-STOCK TRADING OPTIMIZER — same structure, amber border-top]     │
│  [PRODUCT CARD 3: EXPIRY MATE — amber border-top, "Coming Soon" chip]                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 6: HOW IT WORKS
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: linear-gradient(180deg, white 0%, #F0FDFA 100%)  padding: 80px                    │
│                                                                                         │
│  Up and running in minutes.                                                             │
│  Space Grotesk 700 40px navy  text-align: center                                       │
│                                                                                         │
│  ─── Step 1 ──────────────── Step 2 ──────────────── Step 3 ───                       │
│                                                                                         │
│  ○ Connect               →  ○ Analyse               →  ○ Act                         │
│  [icon: plug/sync]           [icon: chart-bar]           [icon: target/arrow]          │
│                                                                                         │
│  Connect your POS           PharmIQ analyses your         Get clear alerts:            │
│  system in 3 clicks.        sales patterns, stock         "List this item. It's        │
│  Compatible with            velocity, and expiry          been stationary 90 days."    │
│  Fred, Minfos,              risk — automatically.                                      │
│  Corum, Z Software.                                                                     │
│                                                                                         │
│  Step number: Space Grotesk 700 32px teal                                              │
│  Heading: Space Grotesk 600 18px navy                                                  │
│  Body: Inter 400 15px secondary                                                         │
│  Connector line: 1px dashed border-mid                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 7: PRICING
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: white  padding: 80px                                                               │
│                                                                                         │
│  Start free. Scale when you're ready.                                                   │
│  Space Grotesk 700 40px navy  text-align: center                                       │
│                                                                                         │
│  ┌──────────────────────────────┐  ┌─────────────────────────────────────────────┐     │
│  │  FREE                        │  │  PREMIUM                              ★       │     │
│  │  bg: surface  border: border │  │  bg: navy  text: white  shadow: lg           │     │
│  │                              │  │  border: 2px solid teal                      │     │
│  │  $0 / month                  │  │                                              │     │
│  │  Space Grotesk 800 40px navy │  │  $79 / month                                 │     │
│  │                              │  │  Space Grotesk 800 40px amber                │     │
│  │  Forever free                │  │  per pharmacy location                       │     │
│  │                              │  │                                              │     │
│  │  ✓ Sales heat-map (30 days)  │  │  ✓ Full sales heat-map (unlimited)          │     │
│  │  ✓ Dead-stock alerts (5/mo)  │  │  ✓ Dead-stock optimizer (unlimited)         │     │
│  │  ✓ Expiry Mate (50 items)    │  │  ✓ Expiry Mate (unlimited SKUs)             │     │
│  │  ✓ 1 location                │  │  ✓ Multi-site dashboard                     │     │
│  │  ✗ Multi-site                │  │  ✓ Network trading (dead stock exchange)    │     │
│  │  ✗ API access                │  │  ✓ API access + webhooks                    │     │
│  │  ✗ Priority support          │  │  ✓ Priority AU-based support                │     │
│  │                              │  │  ✓ 30-day free trial, cancel anytime        │     │
│  │  [Get Started Free]          │  │                                              │     │
│  │  Secondary button teal       │  │  [Start 30-Day Trial →]                     │     │
│  │                              │  │  Primary amber button                        │     │
│  └──────────────────────────────┘  └─────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 8: TESTIMONIALS
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: surface  padding: 80px                                                             │
│                                                                                         │
│  "Within two weeks, we liquidated $18,000 in dead stock through the network."          │
│  Space Grotesk 600 24px navy  max-width: 680px  text-align: center                     │
│                                                                                         │
│  — Sarah Chen, Owner · Eastside Pharmacy, Bondi NSW                                    │
│  Inter 500 14px teal                                                                    │
│                                                                                         │
│  [◄] ●●○○ [►]  ← carousel indicators, teal dots                                        │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 9: FOOTER
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: var(--color-brand-navy)  padding: 64px 80px                                       │
│                                                                                         │
│  ◇ PharmIQ              Product    Company    Resources  Legal                         │
│  (white reversed logo)  Dashboard  About      Blog       Privacy                       │
│                         Dead Stock Careers    Docs       Terms                          │
│                         Expiry Mate Partners  API        Security                       │
│                                                                                         │
│  ───────────────────────────────────────────────────────────────────────────            │
│                                                                                         │
│  © 2026 PharmIQ Pty Ltd · Melbourne, Australia · ABN XX XXX XXX XXX                   │
│  🌐 Proudly serving Australian pharmacy since [year]                                   │
│  Inter 400 13px white/50%                                                               │
│                                                                                         │
│  ─ 4px solid teal stripe at very bottom ─                                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## MOBILE ADAPTATION NOTES (375px)

- Nav: hamburger menu (40×40px) → full-screen drawer with same links
- Hero: single column, product screenshot below copy, screenshot 100% width
- Problem cards: 1-column stacked, full width
- Product suite: 1-column stacked
- Pricing: 1-column, Free card first, Premium card second with "Most Popular" chip
- All horizontal padding: 24px
- Section padding: 48px vertical (down from 80px)
