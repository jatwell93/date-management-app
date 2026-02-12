# PLAN: Handheld Styling (Task 6)

**Date:** 2026-02-12  
**Status:** Proposal Phase  
**Scope:** CSS styling for 5" PDT screens (Zebra TC21-HC, CipherLab RS36, etc.)

---

## Executive Summary

Task 6 requires creating responsive CSS for handheld pharmacy devices with 5" screens (≤600×900px). The goal is to optimize typography, touch targets, spacing, and visibility for portrait-oriented PDT workflows. This is a straightforward styling task with clear design requirements from prior tasks.

---

## Current State Analysis

### Existing Styling Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| **CSS Framework** | Tailwind CSS 3.x | globals.css + tailwind utilities; no custom `/styles` directory yet |
| **Base Styles** | ✅ Complete | globals.css has theme colors, typography scale vars (--font-size-*) |
| **Components** | ✅ Already using handheld classes | HandheldLayout, HandheldScanner use inline Tailwind (h-screen, flex-1, etc.) |
| **Detection** | ✅ useHandheldDetection hook | Returns `isHandheld` boolean; conditions rendering |
| **App Structure** | ✅ Clean | App.tsx wrapped with HandheldProvider; all routes inherit context |
| **Handheld Classes** | ⚠️ Scattered | Inline Tailwind classes in components; no centralized handheld.css |

### Key Components Needing Styling

From grep search + component review:

1. **CameraScanner.tsx** — Already has handheld classes:
   - `isHandheld ? 'h-full flex flex-col'`
   - `isHandheld ? 'flex-1 min-h-[300px]'`
   - `isHandheld ? 'text-lg'` on errors
   - `isHandheld ? 'py-3 text-lg min-h-[48px]'` on buttons

2. **HandheldScanner.tsx** — Uses:
   - `handheld-scanner` class (custom, not yet defined)
   - `full-screen-scan` class (custom, not yet defined)

3. **HandheldScanToolbar.tsx** — Floating toolbar needs styling for:
   - Adequate spacing, touch targets
   - Bottom-right positioning
   - Status indicator visibility

4. **HandheldLayout.tsx** — Uses Tailwind for layout:
   - `h-screen` (full viewport height)
   - `flex flex-col` (flexbox layout)
   - `flex-1 overflow-auto` (children scrollable)
   - `max-w-7xl mx-auto` (desktop fallback)

5. **Navigation + Hidden Elements** — App.tsx has main nav bar that should be hidden on handheld

---

## Technical Approach: CSS vs. Tailwind Config

### Option A: `handheld.css` with CSS Media Queries ✅ RECOMMENDED

**File:** `frontend/src/styles/handheld.css` (new directory)

**Pros:**
- Centralized styling for all handheld breakpoints
- Clear separation of concerns (handheld vs desktop)
- Easy to audit all small-screen overrides in one file
- Standard web dev pattern (familiar to most developers)
- Can use @layer for Tailwind integration

**Cons:**
- Requires a new directory (minor)
- Need to import in App.tsx or globals.css

**Implementation Pattern:**
```css
/* Using @layer to extend Tailwind without conflict */
@layer components {
  @media (max-width: 600px) and (max-height: 900px) {
    body.handheld-mode { /* or just media query */ }
    .button { min-height: 48px; }
  }
}
```

### Option B: Extend Tailwind Config

**Pros:**
- Native Tailwind utilities (no new CSS file)
- Consistent with existing component styling

**Cons:**
- Tailwind config gets complex with custom breakpoints
- Media query logic harder to centralize
- Overkill for one-time responsive breakpoint

---

## Recommended Approach: **Option A** (handheld.css)

**Rationale:**
1. Project already uses Tailwind + globals.css + custom CSS mix
2. Centralizing handheld media queries in one file makes auditing easier
3. @layer components allows seamless Tailwind integration
4. Clear to future maintainers that all ≤600×900px logic is in one place
5. Task 6.1-6.4 explicitly asks for `handheld.css`

---

## Design Requirements Checklist

From task spec:

### 6.1 Media Query & Typography
- [ ] Media query: `@media (max-width: 600px) and (max-height: 900px)`
- [ ] Base font size: **16px** (from default 14px)
- [ ] Button minimum: **48×48px** with padding
- [ ] Input height: **44px minimum** (good with smaller padding)
- [ ] Card padding: **12px** (vs 16px on desktop)
- [ ] Form labels: **14px** with line-height 1.4

### 6.2 Hide Non-Essential UI
Target elements (need to identify in App.tsx + related pages):
- [ ] Markdown calculator link
- [ ] Reports dropdown (hide unless in nav)
- [ ] User management / store area links (hide unless Manager, then dropdown)
- [ ] Secondary nav items that clutter 5" screen

### 6.3 Full-Screen Scan Area
- [ ] Camera backdrop: `height: 100vh - header_height`
- [ ] Full-width scan frame

### 6.4 Import & Integration
- [ ] Create `frontend/src/styles/handheld.css`
- [ ] Import in `App.tsx` or `globals.css`

---

## Element Audit: What Needs Styling

### Typography Bumps
| Element | Current | Handheld | Notes |
|---------|---------|----------|-------|
| Body text | 14px (sm) | 16px (base) | Use Tailwind text-base |
| Form labels | 12px-14px | 14px minimum | Add padding around labels |
| Help text | varies | 14px minimum | Use text-sm but with line-height 1.4 |
| Heading 1 | 24px | 18px-20px | Keep readable but compact |
| Heading 2 | 18px | 16px | Proportional reduction |

### Touch Targets Standardization
| Element | Current | Handheld | Example |
|---------|---------|----------|---------|
| Buttons | 40px | 48px × 48px | Scan button, Sync Now, Settings |
| Form inputs | 40px | 44px height | Barcode text input, form fields |
| Checkboxes/radios | varies | 44×44px | Sync strategy selector |
| Link targets | varies | 48×48px min | Dropdown menu items, Navigation |
| Toolbar icons | varies | 48×48px | Sync status, Settings gear |

### Spacing Rationalization
| Element | Desktop | Handheld | Notes |
|---------|---------|----------|-------|
| Card padding | 16px | 12px | HandheldScanToolbar, content cards |
| Vertical margins | 16px | 8px-12px | Between form sections |
| Horizontal padding | 16px | 8px-12px | Page/section edges |
| Gap between items | 16px | 8px | List items, toolbar buttons |

### Navigation & Hidden Elements

**App.tsx Main Navigation** (search for `<nav className="bg-primary..."`):
- Top navbar with Inventory Manager title + dropdown menu
- Desktop: Full menu visible
- Handheld: Should be hidden/collapsed (replaced by HandheldScanToolbar)

**Elements to Hide on Handheld:**
1. Markdown calculator link (not a pharmacy workflow)
2. Reports dropdown (accessible via settings menu, not top nav)
3. User management / Store area (hidden unless Manager, then in hamburger menu)
4. Desktop nav bar entirely (0 height / display none)

---

## File Structure Plan

```
frontend/src/
├── styles/                       (NEW)
│   └── handheld.css
├── App.tsx                       (MODIFY: add import)
├── globals.css                   (no change needed, but could import from here)
└── [components, pages, etc.]
```

---

## Refs Consulted

✅ **Responsive Design (Tailwind docs):**
- Media query patterns via Tailwind breakpoints
- `@layer` directive for custom utilities

✅ **Touch Target Accessibility (WCAG 2.1):**
- 44×44px minimum (WCAG AA)
- 48×48px recommended industry standard for handheld
- Target size checks via axe-core

✅ **Small Screen Patterns:**
- Ant Design Mobile: touch optimization, 300ms delay avoidance
- Typography scaling for 5" displays (14px minimum for secondary text)

---

## Implementation Steps (Task Breakdown)

### Task 6.1: Create handheld.css with media queries
1. Create `frontend/src/styles/` directory
2. Create `handheld.css` file with:
   - `@media (max-width: 600px) and (max-height: 900px)` wrapper
   - Font size overrides (body 16px, labels 14px, help text 14px)
   - Button/input size standardization (48px, 44px)
   - Card/section padding (12px)
   - Line-height adjustments (labels 1.4)

### Task 6.2: Hide non-essential UI
1. Identify exact selectors in App.tsx for:
   - Markdown calculator link
   - Reports dropdown toggle
   - User management link
   - Store area link
2. Add `display: none` or `visibility: hidden` rules in handheld.css
3. Exception: Show user management/store in dropdown if Manager role

### Task 6.3: Full-screen scan area
1. Add CSS for camera backdrop (height: calc(100vh - header_height))
2. Ensure scan frame fills width
3. Test on CameraScanner component

### Task 6.4: Import handheld.css
1. Add import in App.tsx: `import './styles/handheld.css'`
   OR in globals.css: `@import './styles/handheld.css'`
2. Verify Tailwind processes @layer correctly

---

## Testing Strategy (Not in Task 6, but relevant for QA)

Once CSS is written:
- [ ] Snapshot test HandheldLayout on small screen
- [ ] Visual regression: button sizes, padding on handheld
- [ ] Keyboard navigation: all hidden elements remain keyboard-accessible
- [ ] Portal/dropdown elements: proper z-index on toolbar
- [ ] Test on real PDT or emulator (portrait orientation)

---

## Open Questions / Decisions

**Q1:** Should we add a `.handheld-mode` class to `body` or rely purely on media queries?
- **Recommended:** Pure media queries (simpler, no JS needed)
- **Rationale:** isHandheld context already drives component rendering; CSS media query is declarative

**Q2:** Where should handheld.css be imported?
- **Option A:** App.tsx: `import './styles/handheld.css'` (component level)
- **Option B:** globals.css: `@import './styles/handheld.css'` (global level)
- **Recommended:** App.tsx for clarity (imported alongside other app styles)

**Q3:** Should hidden elements be fully removed (display: none) or just hidden (visibility: hidden)?
- **Recommended:** `display: none` for calculator link, reports dropdown
- **Reason:** Saves space on 5" screen; not needed in handheld workflow

---

## Success Criteria

✅ Task 6.1 complete:
- handheld.css exists with media query
- Font sizing matches spec (16px body, 14px labels)
- Touch targets 48×48px / 44px input height
- Padding/margins per spec (12px cards, etc.)

✅ Task 6.2 complete:
- Non-essential UI hidden on ≤600×900px screens
- Markdown calculator not visible
- Reports/User mgmt hidden (unless Manager in dropdown)

✅ Task 6.3 complete:
- Camera scan area fills height: calc(100vh - header_height)

✅ Task 6.4 complete:
- handheld.css imported in App.tsx
- No Tailwind conflicts
- Styles apply correctly

✅ Verification:
- `npm run build` succeeds
- No CSS warnings
- Visual inspection on emulator/real device

---

## Effort Estimate

- **6.1 Media Queries + Typography:** 20-30 min
- **6.2 Hidden Elements:** 15-20 min (need to find exact selectors)
- **6.3 Scan Area CSS:** 10-15 min
- **6.4 Import + Verification:** 5-10 min

**Total: 50-75 minutes**

---

## Next Steps (APPROVAL GATE)

1. ✅ Review this PLAN document
2. ⏳ User approval: "looks good" / "change X" / "proceed"
3. → Move to BUILD phase: implement handheld.css
4. → QA phase: test on multiple screen sizes
5. → APPROVAL phase: final review + merge

---

**Status:** Ready for User Approval
