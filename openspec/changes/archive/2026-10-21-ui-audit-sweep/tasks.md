## 1. Setup

- [x] 1.1 Write `.impeccable.md` design context from the brand guidelines.
- [x] 1.2 Create this OpenSpec change with one task per view.

## 2. View audits (one PR each, P0-P3 fixed)

- [x] 2.1 Dashboard (`/dashboard`) — #652, 14 -> 19/20
- [x] 2.2 Scan (`/scan`, scanner components) — #655, 12 -> 17/20
- [x] 2.3 Reports (`/reports`) — #654, 14 -> 18/20
- [x] 2.4 Detailed expiry report (`/detailed-expiry-report`) — #653, 12 -> 17/20
- [x] 2.5 Expiry entries (`/expiry-entries`) — #656, 13 -> 17/20
- [x] 2.6 Expired items (`/expired-items`) — #658, 12 -> 17/20
- [x] 2.7 Supplier credits (`/supplier-credits`) — #659, 13 -> 16/20
- [x] 2.8 Platform catalogue (`/platform/catalogue`) — #657, 12 -> 19/20
- [x] 2.9 Usage report (`/usage-report`) — #661, 13 -> 17/20
- [x] 2.10 Markdown calculator (`/markdown-calculator`) — #660, 15 -> 20/20
- [x] 2.11 Subscription and upgrade (`/subscription`, `/upgrade`) — #662, 12 -> 17/20
- [x] 2.12 User management (`/user-management`) — #663, 16 -> 20/20
- [x] 2.13 Store area management (`/store-area-management`) — #665, 14 -> 20/20
- [x] 2.14 CSV upload (`/csv-upload`, `/expiry-import`) — #664, 14 -> 17/20
- [x] 2.15 Settings (`/settings`) — #666, 13 -> 16/20
- [x] 2.16 Onboarding (`/onboarding`) — #667, 11 -> 16/20

## 3. Shell

- [x] 3.1 Shell audit: `App.tsx`, `AppNav`, `layouts/`, `components/ui`, `components/charts`,
      `theme/`, `globals.css`, banners and warnings, plus shared findings reported by section 2
      — #668, 12 -> 18/20.

## 4. Follow-ups (tracked outside this change)

- Support contact placeholders — #670.
- Usage report shows numeric user ids — #671.
- Shell deferrals (shadcn `--primary` navy vs teal, dark-mode muted tokens, quota modal focus
  trap) — listed in #668 for the owner to decide.
