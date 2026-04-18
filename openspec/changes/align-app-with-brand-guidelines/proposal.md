## Why

PharmIQ now has a finalized brand guide and token set, but this app is not yet consistently aligned with those standards across UI, messaging, and component behavior. Aligning now creates a uniform cross-app experience and reduces design drift as more modules and devices are introduced.

This change also needs to define where brand rules require practical adaptation for Zebra scanner workflows (for example, scan-focused feedback states and handheld ergonomics) so scanner support can stay on-brand without reducing usability.

## What Changes

- Adopt the canonical brand identity package in `brand-identity-pharma-apps/brand-identity` as the source of truth for colors, typography, spacing, semantic states, and motion tokens.
- Standardize app styling to PharmIQ brand direction (teal-led primary identity, restrained amber usage, navy/neutral foundations, and semantic color mapping).
- Align typography and tone rules for owner-facing versus worker-facing surfaces so voice and hierarchy are consistent with the brand guide.
- Define explicit UI adaptation rules for Zebra scanner-oriented experiences where device ergonomics or scan velocity require approved presentation exceptions.
- Identify and document brand-level gaps or proposed adjustments discovered during implementation (including scanner-specific requirements) for review.

## Capabilities

### New Capabilities
- `brand-identity-token-compliance`: Ensure product UI consumes and applies official PharmIQ design tokens (color, typography, spacing, radius, elevation, motion) instead of ad hoc styles.
- `cross-surface-brand-consistency`: Define and enforce consistent visual and messaging behavior across key app surfaces, including dashboards, forms, alerts, tables, and charts.
- `zebra-scanner-brand-adaptations`: Define approved brand-preserving adaptations for Zebra scanner workflows (scan states, readability, interaction sizing, and feedback cues).

### Modified Capabilities
- None.

## Impact

- Affected code: frontend theme/style layers, reusable UI components, data-visualization presentation, and selected in-app copy.
- Affected systems: scanner-enabled workflows (especially Zebra handheld scenarios), UI regression testing baselines, and accessibility/contrast validation.
- Affected dependencies/assets: official brand guideline artifacts and design-token sources in `brand-identity-pharma-apps/brand-identity`.
- Delivery impact: establishes the contract for follow-on spec, design, and task artifacts needed to execute consistent brand adoption safely.