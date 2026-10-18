# Mockup 02 — PharmIQ Web Dashboard
> Desktop (1440px) authenticated view | Pharmacy: "Eastside Pharmacy — Bondi NSW"

---

## FULL LAYOUT OVERVIEW
```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│  SIDEBAR (240px)              │  TOP BAR (height: 60px)                                       │
│                               │  MAIN CONTENT (flex, responsive grid)                         │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SIDEBAR
```
┌─────────────────────────┐
│ bg: var(--color-brand-navy)              │
│ width: 240px  height: 100vh              │
│ position: fixed  left: 0                 │
│                                          │
│  ◇ PharmIQ                     [≡]      │
│  (white reversed logo)    collapse icon  │
│  padding: 20px 16px                      │
│  border-bottom: 1px solid rgba(255,255,255,0.08)   │
│                                          │
│  ─ Nav Section ─────────────────         │
│                                          │
│  [icon-grid] Dashboard          ◄ ACTIVE │
│  ● highlight: rgba(15,118,110,0.25)      │
│  ● left border: 3px solid teal           │
│  ● text: white  Inter 500 14px           │
│                                          │
│  [icon-flame] Sales Heat-Map             │
│  [icon-package-x] Dead Stock     [3]    │
│    badge: amber bg navy text             │
│  [icon-calendar-x2] Expiry Mate          │
│                                          │
│  ─────────────────────────────           │
│                                          │
│  [icon-bar-chart] Reports                │
│  [icon-buildings] Locations              │
│    sub-label: 1 site                     │
│  [icon-plug] Integrations                │
│                                          │
│  ─ Bottom ──────────────────             │
│                                          │
│  [icon-help] Help & Support              │
│  [icon-settings] Settings                │
│                                          │
│  ┌──────────────────────────┐            │
│  │ 🟢  Sarah Chen           │            │
│  │     Eastside Pharmacy    │            │
│  │     [↑ Upgrade to Pro]   │            │
│  └──────────────────────────┘            │
│  Free plan indicator: amber text 12px    │
└──────────────────────────────────────────┘
```

---

## TOP BAR
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: white  border-bottom: 1px solid border-light  padding: 0 32px  height: 60px       │
│                                                                                         │
│  Dashboard            [Eastside Pharmacy ▼]           [🔔 3]  [? Help]  [SC ▼]        │
│  Space Grotesk 600                                                                      │
│  18px navy           Location switcher                 Bell badge: amber               │
│                      (multi-site: shows dropdown)      Avatar: teal circle initials    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## MAIN CONTENT — DASHBOARD HOME
```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│  bg: var(--color-surface)  padding: 32px  overflow-y: auto                                  │
│                                                                                              │
│  ── KPI CARDS ROW ──────────────────────────────────────────────────────────────────────    │
│                                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │  Today's Revenue │  │  Scripts Today   │  │  Dead Stock Value│  │  Expiry Alerts   │   │
│  │──────────────────│  │──────────────────│  │──────────────────│  │──────────────────│   │
│  │  $6,820           │  │  87               │  │  $2,340          │  │  3 items         │   │
│  │  ↑ 14% vs Mon    │  │  ↑ 8% vs Mon     │  │  7 products      │  │  expiring <30d   │   │
│  │  Space Grotesk   │  │  Space Grotesk   │  │  Space Grotesk   │  │  Space Grotesk   │   │
│  │  700 32px teal   │  │  700 32px sky    │  │  700 32px amber  │  │  700 32px warning│   │
│  │                  │  │                  │  │                  │  │                  │   │
│  │  [sparkline ↑]   │  │  [sparkline ↑]   │  │  [sparkline flat]│  │  [calendar icon] │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│  Card: white bg  border-top: 3px solid [respective semantic colour]  shadow: sm            │
│  padding: 24px  radius: 12px                                                               │
│                                                                                              │
│  ── MAIN GRID ROW ──────────────────────────────────────────────────────────────────────   │
│                                                                                              │
│  ┌──────────────────────────────────────────────────┐  ┌──────────────────────────────┐   │
│  │  SALES HEAT MAP                      [Full View →]│  │  DEAD STOCK ALERTS       [3] │   │
│  │  bg: white  radius: 12px  shadow: sm  padding: 24│  │  bg: white  radius: 12px     │   │
│  │                                                  │  │  padding: 20px  shadow: sm   │   │
│  │  [Date range picker: Last 7 days ▼]              │  │                              │   │
│  │                                                  │  │  ┌──────────────────────┐   │   │
│  │       9am  10  11  12  1pm   2   3   4   5       │  │  │ ■ Vitamin D3 2000IU  │   │   │
│  │  Mon  ░░░  ██  ███  ██  ░░  ░░  ░░  ░░  ░░      │  │  │   90 tabs · $16.80   │   │   │
│  │  Tue  ░░░  ██  ███  ██  █░  ░░  ░░  ░░  ░░      │  │  │   Idle: 127 days     │   │   │
│  │  Wed  ░░░  ██  ██   █░  ░░  ░░  ░░  ░░  ░░      │  │  │   [List on Network]  │   │   │
│  │  Thu  ░░░  ██  ███  ███ █░  ░░  ░░  ░░  ░░      │  │  └──────────────────────┘   │   │
│  │  Fri  ░░░  ██  ███  ███ ██  █   ░░  ░░  ░░      │  │  ┌──────────────────────┐   │   │
│  │  Sat  ██   ███ ███  ██  █░  ░░  ░░  ░░  n/a     │  │  │ ■ Zinc 50mg tabs     │   │   │
│  │  Sun  █░   ██  ██   █░  ░░  ░░  n/a n/a n/a     │  │  │   60 tabs · $11.40   │   │   │
│  │                                                  │  │  │   Idle: 95 days      │   │   │
│  │  ← Low ░░░ ░░░ ███ ▓▓▓ ███ Hot →               │  │  │   [List on Network]  │   │   │
│  │  color: heatmap-0  to  heatmap-4  scale          │  │  └──────────────────────┘   │   │
│  │  cells: 28×28px  gap: 3px  radius: 4px           │  │                              │   │
│  │                                                  │  │  + 5 more items              │   │
│  │  Peak hours: Tue–Thu 10am–12pm (Sat 9–11am)     │  │  [View All Dead Stock →]     │   │
│  │  Insight text: 13px Inter secondary italic       │  │  link: teal Inter 500 13px   │   │
│  └──────────────────────────────────────────────────┘  └──────────────────────────────┘   │
│  Left card: col-span ~7/12   Right card: col-span ~5/12                                     │
│                                                                                              │
│  ── BOTTOM ROW ─────────────────────────────────────────────────────────────────────────   │
│                                                                                              │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────────────────┐   │
│  │  EXPIRY TIMELINE            [View] │  │  REVENUE TREND (30 days)                   │   │
│  │                                    │  │                                            │   │
│  │  ● Metformin 500mg   3 days !!!!!  │  │  [Line chart]                              │   │
│  │    (critical: red badge)           │  │  series-1: Revenue (teal)                  │   │
│  │  ● Ibuprofen 400mg   12 days       │  │  series-2: Scripts (sky)                   │   │
│  │    (warning: amber badge)          │  │  x-axis: Mar 1 → Mar 25                   │   │
│  │  ● Paracetamol 500mg 28 days       │  │  y-axis: $0 → $10,000                     │   │
│  │    (warning: amber badge)          │  │                                            │   │
│  │                                    │  │  tooltip on hover: date, revenue, scripts  │   │
│  │  [View All in Expiry Mate →]       │  │  [Export CSV] [Change range ▼]            │   │
│  └────────────────────────────────────┘  └────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SALES HEAT MAP — FULL VIEW PAGE
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Header: "Sales Heat-Map"  Space Grotesk 700 28px  + [Date range ▼] [Location ▼] │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                              │ │
│  │        9am    10am   11am   12pm   1pm    2pm    3pm    4pm    5pm   6pm    │ │
│  │  Mon   ░      ███    ████   ███    ██     █      ░      ░      ░      ░     │ │
│  │  Tue   ░      ███    ████   ████   ██     █      ░      ░      ░      ░     │ │
│  │  Wed   ░      ██     ███    ██     █      ░      ░      ░      ░      ░     │ │
│  │  Thu   ░      ███    ████   ████   ███    ██     ░      ░      ░      ░     │ │
│  │  Fri   ░      ██     ████   ████   ████   ███    █      ░      ░      ░     │ │
│  │  Sat   ██     ████   ████   ███    ██     ░      n/a    n/a    n/a    n/a   │ │
│  │  Sun   █      ██     ███    ██     ░      ░      n/a    n/a    n/a    n/a   │ │
│  │                                                                              │ │
│  │  Scale: ░ No sales → ▓ Low → █ Avg → ██ High → ███ Peak                   │ │
│  │  Cells: 48×48px  gap: 4px  radius: 6px  hover: expand + tooltip            │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  KEY INSIGHTS PANEL (below chart)                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ 🔥 Peak Window: Tue–Fri 10am–12pm  →  "Staff at full capacity"              │ │
│  │ 😴 Quiet Window: All days 3pm–5pm  →  "Consider promotions or callbacks"    │ │
│  │ 📅 Saturday spike: 9am–11am         →  "Popular weekend pickup time"        │ │
│  │ bg: navy  text: white  radius: 8px  padding: 16px  Inter 14px              │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## DEAD-STOCK OPTIMIZER PAGE
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│  Header: "Dead Stock Optimizer"  [Filter: >60 days ▼]  [Sort by Value ▼]  [+ Add] │
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────┐│
│  │  ALL ITEMS (7)   |   LISTED ON NETWORK (2)   |   TRADED (1)                  ││
│  │  Tab underline: active = teal 3px                                             ││
│  └──────────────────────────────────────────────────────────────────────────────┘│
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────┐│
│  │  PRODUCT              QTY   DAYS IDLE  COST VALUE   STATUS      ACTION        ││
│  │  ─────────────────────────────────────────────────────────────────────────── ││
│  │  Vitamin D3 2000IU    90    127 days   $16.80       [Dead Stock] [List →]     ││
│  │  [amber dot]                [bold red] [amber]      [violet pill]             ││
│  │                                                                               ││
│  │  Zinc 50mg            60    95 days    $11.40       [Dead Stock] [List →]     ││
│  │  Ibuprofen Extra      24    82 days    $28.80       [Dead Stock] [List →]     ││
│  │  Multivitamin Adult   48    74 days    $57.60       [Listed ✓]  [Edit]        ││
│  │  [sky dot — listed]                                 [sky pill]                ││
│  │  Panadol Osteo        36    68 days    $43.20       [Listed ✓]  [Edit]        ││
│  │                                                                               ││
│  │  ─────────────────────────────────────────────────────────────────────────── ││
│  │  Total dead stock value:  $157.80    Avg idle time:  89 days                  ││
│  │  Space Grotesk 600 amber  tabular-nums                                        ││
│  └──────────────────────────────────────────────────────────────────────────────┘│
│                                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────┐│
│  │  NETWORK ACTIVITY                                                             ││
│  │  "2 pharmacies near you are looking for Zinc 50mg"   [View Offers]           ││
│  │  bg: teal-50  border-left: 4px teal  Inter 14px navy                         ││
│  └──────────────────────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## DESIGN ANNOTATIONS

| Element | Token | Value |
|---------|-------|-------|
| Sidebar background | `--color-brand-navy` | #0F172A |
| Active nav item | `rgba(15,118,110,0.25)` + 3px teal border | custom |
| Card border-top (revenue) | `--color-brand-teal` | #0F766E |
| Card border-top (dead stock) | `--color-brand-amber` | #D97706 |
| Card border-top (alerts) | `--color-warning` | #D97706 |
| KPI number (revenue) | `--color-brand-teal` | #0F766E |
| KPI number (dead stock) | `--color-brand-amber` | #D97706 |
| Table row hover | `--color-brand-teal-50` | #F0FDFA |
| Critical badge | `--color-critical` on `--color-critical-bg` | #EF4444 on #FEF2F2 |
| Dead stock badge | `--color-dead-stock` on `--color-dead-stock-bg` | #8B5CF6 on #F5F3FF |
| Listed badge | `--color-info` on `--color-info-bg` | #0EA5E9 on #F0F9FF |
