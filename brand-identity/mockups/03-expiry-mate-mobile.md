# Mockup 03 — Expiry Mate Mobile App
> iOS (375×812px — iPhone 14 standard) | Product: Expiry Mate by PharmIQ

---

## APP ICON
```
┌──────────────────────────────────────┐
│  App Icon: 1024×1024px master        │
│                                      │
│  Background: teal-to-navy gradient   │
│  linear-gradient(145deg,             │
│    #14B8A6 0%, #0F766E 50%,          │
│    #0F172A 100%)                     │
│                                      │
│  Icon element:                       │
│  ┌────────────────────────────┐      │
│  │                            │      │
│  │      ◇                     │      │
│  │     ╱│╲    Calendar        │      │
│  │    ╱ │ ╲   hexagon with    │      │
│  │   ╱  │  ╲  amber clock     │      │
│  │   ╲  ●  ╱  dot (expiry     │      │
│  │    ╲ │ ╱   warning)        │      │
│  │     ╲│╱                    │      │
│  │      ─                     │      │
│  └────────────────────────────┘      │
│                                      │
│  Radius: 225px (Apple standard)      │
│  Shadow: Apple default               │
└──────────────────────────────────────┘
```

---

## SCREEN 1: HOME / SUMMARY
```
┌─────────────────────────────────────────────┐
│ ░░░░░░░░░ STATUS BAR ░░░░░░░░░░░░░░░░░░░░░ │ ← 44px, system default
│                                              │
│ Expiry Mate    [bell 🔔 3]  [SC ●]          │ ← Top bar, white bg
│ Space Grotesk 600 18px navy  |  44px height  │
│ border-bottom: 1px border-light              │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  bg: linear-gradient teal→navy         │ │
│  │  padding: 20px  radius: 12px  mx: 16px │ │
│  │                                        │ │
│  │  Today's Expiry Summary                │ │
│  │  Space Grotesk 600 16px white          │ │
│  │                                        │ │
│  │  3  Expired          12  Expiring      │ │
│  │  Space Grotesk 700   Space Grotesk 700 │ │
│  │  40px critical red   40px amber        │ │
│  │                                        │ │
│  │  [Review Now →]                        │ │
│  │  amber button  height: 44px  radius: 8 │ │
│  └────────────────────────────────────────┘ │
│  mt: 16px                                    │
│                                              │
│  MOST URGENT             [See All →]         │
│  Space Grotesk 600 16px navy  |  teal link   │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  border-left: 4px solid critical       │ │
│  │  bg: critical-bg  radius: 8px  p: 16px │ │
│  │                                        │ │
│  │  Metformin 500mg                       │ │
│  │  Space Grotesk 600 15px navy           │ │
│  │                                        │ │
│  │  [EXPIRED] · Batch: MT2024-03          │ │
│  │  critical badge  |  Inter 12px muted   │ │
│  │                                        │ │
│  │  Qty: 24 tabs         [Mark Removed]   │ │
│  │  Inter 13px secondary  amber button    │ │
│  └────────────────────────────────────────┘ │
│  mt: 8px                                     │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  border-left: 4px solid warning        │ │
│  │  bg: warning-bg  radius: 8px  p: 16px  │ │
│  │                                        │ │
│  │  Ibuprofen 400mg          12 days left │ │
│  │  Space Grotesk 600 15px  amber 500 13px│ │
│  │                                        │ │
│  │  Qty: 48 tabs  · Shelf B3  [Review]    │ │
│  └────────────────────────────────────────┘ │
│  mt: 8px                                     │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  bg: warning-bg  border-left: warning  │ │
│  │                                        │ │
│  │  Paracetamol 500mg        28 days left │ │
│  │  Qty: 100 tabs             [Review]    │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  OK STOCK (47 products tracked)              │
│  Space Grotesk 500 14px teal                 │
│  [chevron-right →]                           │
│                                              │
├──────────────────────────────────────────────┤
│  BOTTOM TAB BAR                              │ ← iOS native tab bar, 83px
│  bg: white  border-top: 1px border-light    │
│  Safe area: inset-bottom respected           │
│                                              │
│  🏠 Home    📷 Scan    🔔 Alerts  ⚙ Settings│
│  Teal icon + label (active: Home)            │
│  24px icons  |  10px labels  |  48×48 areas │
└─────────────────────────────────────────────┘
```

---

## SCREEN 2: SCAN VIEW
```
┌─────────────────────────────────────────────┐
│ ░░░░░░░░ STATUS BAR (dark content) ░░░░░░░ │
│                                              │
│ [← Back]  Scan Barcode          [Torch 🔦]  │
│ white text on dark bg  |  44px top bar       │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  CAMERA VIEWFINDER (full width)        │ │
│  │  bg: camera feed                       │ │
│  │  height: ~340px                        │ │
│  │                                        │ │
│  │     ┌─────────────────────┐            │ │
│  │     │                     │            │ │
│  │     │   [SCAN GUIDE BOX]  │            │ │
│  │     │   Teal corner marks │            │ │
│  │     │   2px stroke, 20px  │            │ │
│  │     │   corner length     │            │ │
│  │     │                     │            │ │
│  │     └─────────────────────┘            │ │
│  │                                        │ │
│  │  "Point camera at barcode or QR"       │ │
│  │  Inter 14px white  text-align: center  │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ─── OR SEARCH MANUALLY ───────────────      │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  🔍 Search product name or barcode...  │ │
│  │  height: 48px  radius: 8px             │ │
│  │  border: border-mid  bg: white         │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  RECENT SCANS                               │
│  Space Grotesk 500 14px secondary           │
│                                              │
│  Metformin 500mg                  Today 9:42│
│  Ibuprofen 400mg                  Today 9:38│
│  Inter 14px navy  |  caption muted          │
│                                              │
├──────────────────────────────────────────────┤
│  🏠 Home    📷 Scan ●  🔔 Alerts  ⚙ Settings│
└─────────────────────────────────────────────┘
```

---

## SCREEN 3: AFTER SCAN — PRODUCT FOUND
```
┌─────────────────────────────────────────────┐
│ ░░░░░░░░░ STATUS BAR ░░░░░░░░░░░░░░░░░░░░░ │
│                                              │
│ [← Scan Again]    Product Detail            │
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  bg: white  shadow: sm  radius: 12px   │ │
│  │  padding: 20px  mx: 16px               │ │
│  │                                        │ │
│  │  [barcode icon]  BARCODE MATCHED       │ │
│  │  12px Inter muted                      │ │
│  │                                        │ │
│  │  Ibuprofen 400mg                       │ │
│  │  Space Grotesk 700 22px navy           │ │
│  │                                        │ │
│  │  Nurofen Extra Strength · 24 tablets   │ │
│  │  Inter 400 14px secondary              │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  EXPIRY INFORMATION                    │ │
│  │                                        │ │
│  │  Expiry Date                           │ │
│  │  Inter 500 12px muted uppercase        │ │
│  │                                        │ │
│  │  06 / 2026                             │ │
│  │  Space Grotesk 700 40px warning amber  │ │
│  │                                        │ │
│  │  12 days remaining                     │ │
│  │  [!] EXPIRY WARNING                    │ │
│  │  amber badge  |  Inter 600 13px        │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  STOCK DETAILS                         │ │
│  │                                        │ │
│  │  Batch Number      Location            │ │
│  │  IB2025-11         Shelf B3            │ │
│  │                                        │ │
│  │  Quantity on Hand  Unit Cost           │ │
│  │  48 tablets        $0.72/tab           │ │
│  │                                        │ │
│  │  All values: Inter 600 15px navy       │ │
│  │  Labels: Inter 400 12px muted          │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  [Mark as Actioned]  ← amber primary   │ │
│  │  height: 52px  width: 100%  radius: 8  │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  [Set Reminder]      ← teal secondary  │ │
│  │  border: 1.5px teal  height: 48px      │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  [List for Dead-Stock Trade] ← ghost   │ │
│  │  text: secondary  height: 44px         │ │
│  └────────────────────────────────────────┘ │
│                                              │
├──────────────────────────────────────────────┤
│  🏠 Home    📷 Scan    🔔 Alerts  ⚙ Settings│
└─────────────────────────────────────────────┘
```

---

## SCREEN 4: ALERTS LIST
```
┌─────────────────────────────────────────────┐
│  Expiry Alerts                    [Filter ▼] │
│  Space Grotesk 700 20px navy                 │
├──────────────────────────────────────────────┤
│                                              │
│  [EXPIRED (3)] [<30 DAYS (12)] [>30 DAYS]   │
│  Active: [EXPIRED] teal underline 2px        │
│                                              │
│  ─── EXPIRED ────────────────────           │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  [●] Metformin 500mg         EXPIRED   │ │
│  │  red dot  critical pill badge           │ │
│  │  Batch: MT2024-03  ·  Qty: 24          │ │
│  │  Expired: 3 days ago                   │ │
│  │  [Remove] ← red text button            │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  [●] Atorvastatin 40mg       EXPIRED   │ │
│  │  Batch: AV2024-01  ·  Qty: 30          │ │
│  │  Expired: 1 day ago                    │ │
│  │  [Remove]                              │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  ─── BULK ACTION ───────────────────         │
│  [Mark All Expired as Removed]              │
│  amber button, full width, 48px             │
│                                              │
├──────────────────────────────────────────────┤
│  🏠 Home    📷 Scan    🔔 Alerts ●  ⚙       │
│  (badge: 3 on Alerts tab)                   │
└─────────────────────────────────────────────┘
```

---

## DESIGN ANNOTATIONS

| Element | Specification |
|---------|---------------|
| Min tap target | 48×48dp (all interactive elements) |
| Bottom tab height | 83px (includes safe area) |
| Safe area top | 44–59px (Dynamic Island/notch aware) |
| Card corner radius | 12px (consistent with web) |
| Expiry date display | Space Grotesk 700 40px — prominence is intentional |
| Critical border | 4px left border, critical red |
| Warning border | 4px left border, warning amber |
| Empty state | Illustration + "No expiry alerts today. Nice work!" in teal |
| Haptic feedback | Success pattern on scan; warning pattern on scan with expiry issue |
| Offline mode | Last-synced badge in top bar; local scan works offline |

## NOTIFICATION TEMPLATES

**Push notification — Expiry alert:**
```
PharmIQ · Expiry Mate
3 items expire in the next 7 days.
Metformin, Ibuprofen, Paracetamol →
```

**Push notification — Dead stock update:**
```
PharmIQ · Dead Stock
A pharmacy near you wants your Zinc 50mg.
View offer →
```
Both notifications use the app icon with amber badge count.
