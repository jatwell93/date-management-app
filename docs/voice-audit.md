# Voice & Messaging Audit — Phase 5

**Date:** 2026-05-17
**Scope:** All user-facing strings in `frontend/src/pages/` and `frontend/src/components/`
**Brand spec reference:** Fraunces (display 48px+), Outfit (headings/UI/eyebrow), Inter (body)

---

## Audience Classification

| Audience | Context | Language Style |
|----------|---------|----------------|
| **Owner / Manager** | Dashboard, Reports, Subscription, User Management | Margins, outcomes, business impact (e.g. "Financial Loss by SKU", "Total Expired Items") |
| **Worker / Team Member** | Scan, Expired Items processing, CSV Upload | Direct utility, action-oriented (e.g. "Scan item", "Process Expired Item", "Upload CSV") |

---

## Pages Reviewed

### Owner-Context Pages

| Page | Key Strings | Classification | Matches Spec? |
|------|------------|----------------|---------------|
| `DashboardPage.tsx` | "Total Items", "Expiring Soon", "Expired Items", "Low Stock" | Owner — outcome metrics | ✅ Yes |
| `ReportsPage.tsx` | "Reports", stat cards with totals/averages | Owner — business insight | ✅ Yes |
| `ExpiredLossReport.tsx` | "Expired Item Loss Report", "Financial Loss by SKU", "Financial Loss by Store Area" | Owner — margin/loss language | ✅ Yes |
| `SubscriptionSettingsPage.tsx` | "Subscription & Billing", plan tier names, pricing | Owner — account management | ✅ Yes |
| `UserManagementPage.tsx` | "User Management", role labels | Owner — team oversight | ✅ Yes |
| `SettingsPage.tsx` | "Organisation Settings", "Manage your organisation profile, members, and roles." | Owner — org management | ✅ Yes |
| `DetailedExpiryReportPage.tsx` | Column headers (Product, SKU, Expiry Date, Days Until Expiry, Status, Quantity, Unit Price, Total Value) | Owner — financial detail | ✅ Yes |
| `UsageReportPage.tsx` | Usage metrics, date range filters | Owner — operational insight | ✅ Yes |

### Worker-Context Pages

| Page | Key Strings | Classification | Matches Spec? |
|------|------------|----------------|---------------|
| `ScanPage.tsx` | "Inventory Scan", "Ready to scan", "Item scanned", "Scan failed. Try again." | Worker — direct utility | ✅ Yes |
| `ExpiredItemsPage.tsx` | "Process Expired Item", "Discard", "Markdown", table headers (Product, SKU, Expiry, etc.) | Worker — action-oriented | ✅ Yes |
| `CSVUploadPage.tsx` | "CSV Upload", "Drag and drop", "Upload", step indicators | Worker — task flow | ✅ Yes |
| `StoreAreaManagementPage.tsx` | "Add New Store Area", "Existing Store Areas" | Worker — direct utility | ✅ Yes |

### Shared-Context Pages

| Page | Key Strings | Classification | Matches Spec? |
|------|------------|----------------|---------------|
| `OnboardingPage.tsx` | Welcome slides, step titles, "Get Started" | Both — onboarding flow | ✅ Yes |
| `ClerkAuthPage.tsx` | "Date Management App" (brand name) | Both — brand identity | ✅ Yes |

---

## Typography Application Summary

| Element Type | Font Applied | Tailwind Class | Examples |
|-------------|-------------|----------------|----------|
| Brand name (auth pages) | Fraunces 700 | `font-display` | "Date Management App" on sign-in/sign-up |
| Page headings | Outfit | `font-heading` | "Inventory Scan", "Organisation Settings", "Reports" |
| Card titles | Outfit | `font-heading` (via CardTitle primitive) | Dashboard stat cards, report cards |
| Dialog/alert titles | Outfit | `font-heading` (via DialogTitle, AlertDialogTitle) | "Process Expired Item" modal |
| Pricing display | Outfit | `font-heading` | "$29/mo", "Contact Sales" in UpgradeModal |
| Table headers | Outfit 600 uppercase | `font-eyebrow` | ExpiredItemsPage columns, ExpiredLossReport columns |
| Section labels | Outfit 600 uppercase | `font-eyebrow` | "Financial Loss by SKU" table section headers |
| Body text | Inter | `font-body` (global default) | Descriptions, paragraphs, form labels |
| Stat numbers | Outfit | `font-heading` | Dashboard metrics, report totals |

---

## Mismatches Found & Fixed

| Location | Issue | Fix Applied |
|----------|-------|-------------|
| `ClerkAuthPage.tsx` | Brand name used default font instead of Fraunces | Applied `font-display text-3xl` |
| `CardTitle` primitive | Rendered `<div>` — not covered by `@layer base` heading rule | Added `font-heading` to component |
| `DialogTitle` / `AlertDialogTitle` | Same issue as CardTitle — non-semantic elements | Added `font-heading` to components |
| All page headings | Used default sans-serif instead of explicit Outfit | Added `font-heading` class to each |
| Table headers | Used plain `uppercase tracking-wider` without brand font | Added `font-eyebrow` class |
| UpgradeModal pricing | Display-size text without heading font | Added `font-heading` class |
| TrialUpgradeFlow pricing | Same as UpgradeModal | Added `font-heading` class |

---

## No Mismatches (Correctly Aligned)

- All owner-context pages use outcome/margin language (not task language)
- All worker-context pages use direct/action language (not business jargon)
- Toast messages use concise action confirmations ("Item processed", "Upload complete")
- Error messages use clear, non-technical language ("Scan failed. Try again.")
- Scanner state indicator text matches spec exactly (Ready/Scanning/Scanned/Warning/Error)

---

## Recommendations for Future Work

1. **String extraction**: Consider extracting all user-facing strings to a constants file or i18n framework for consistent voice management
2. **Eyebrow text**: Any new table or data grid should use `font-eyebrow` for column headers
3. **Display font**: Fraunces should only be used for brand identity text at 48px+ — do not apply to regular headings
4. **Audit cadence**: Re-run this audit when adding new pages or significantly changing UI copy
