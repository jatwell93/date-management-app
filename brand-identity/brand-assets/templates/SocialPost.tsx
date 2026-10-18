/**
 * PharmIQ Social Media Post Templates
 *
 * SVG-based post generators for LinkedIn/Facebook and Instagram.
 * These are React components that render SVG — use satori or @vercel/og
 * to convert to PNG for actual social media posting.
 *
 * Sizes:
 *   LinkedIn/Facebook: 1200×627px
 *   Instagram Square:  1080×1080px
 *   Instagram Story:   1080×1920px
 *
 * Usage with @vercel/og:
 *   import { ImageResponse } from 'next/og'
 *   import { LinkedInPost } from '@/brand/templates/SocialPost'
 *
 *   export function GET() {
 *     return new ImageResponse(<LinkedInPost title="$28,000 in dead stock" />, {
 *       width: 1200, height: 627
 *     })
 *   }
 */

// ── LinkedIn / Facebook Post (1200×627) ──────────────────────────────────────

interface LinkedInPostProps {
  /** Primary large stat or callout (e.g. "$28,000") */
  stat:        string
  /** Supporting headline text */
  headline:    string
  /** Secondary description line */
  description: string
  /** Badge label e.g. "Pharmacy Insight" | "Product Update" */
  badge?:      string
  /** Call-to-action text */
  cta?:        string
}

export function LinkedInPost({ stat, headline, description, badge = 'Pharmacy Insight', cta }: LinkedInPostProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 627" width="1200" height="627">
      {/* White background */}
      <rect width="1200" height="627" fill="#FFFFFF"/>

      {/* Teal top accent bar */}
      <rect width="1200" height="6" fill="#0F766E"/>

      {/* Left margin teal stripe */}
      <rect x="0" y="6" width="6" height="621" fill="#0F766E" opacity="0.3"/>

      {/* Logo — top left */}
      {/* Icon mark (simplified for SVG text rendering) */}
      <polygon points="88,60 78,43.32 58,43.32 48,60 58,76.68 78,76.68" fill="#0F766E"/>
      <rect x="55" y="65" width="7" height="8" rx="1" fill="white" fillOpacity="0.9"/>
      <rect x="64" y="59" width="7" height="14" rx="1" fill="white"/>
      <rect x="73" y="52" width="7" height="21" rx="1" fill="white"/>
      <text x="98" y="67" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="22" fontWeight="700" fill="#0F172A">Pharm</text>
      <text x="164" y="67" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="22" fontWeight="700" fill="#0F766E">IQ</text>

      {/* Badge — top right */}
      {badge && (
        <>
          <rect x="1040" y="32" width={String(badge).length * 11 + 24} height="32" rx="16" fill="#D97706"/>
          <text x="1052" y="53" fontFamily="'Inter', system-ui, sans-serif" fontSize="14" fontWeight="600" fill="white">{badge}</text>
        </>
      )}

      {/* Main stat */}
      <text x="80" y="280" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="140" fontWeight="800" fill="#0F766E">{stat}</text>

      {/* Headline */}
      <text x="80" y="360" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="40" fontWeight="700" fill="#0F172A">{headline}</text>

      {/* Description */}
      <text x="80" y="415" fontFamily="'Inter', system-ui, sans-serif" fontSize="26" fontWeight="400" fill="#475569">{description}</text>

      {/* CTA */}
      {cta && (
        <>
          <rect x="80" y="510" width={String(cta).length * 14 + 40} height="56" rx="8" fill="#D97706"/>
          <text x="100" y="545" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="22" fontWeight="600" fill="white">{cta} →</text>
        </>
      )}

      {/* URL — bottom right */}
      <text x="1100" y="600" fontFamily="'Inter', system-ui, sans-serif" fontSize="18" fontWeight="500" fill="#94A3B8" textAnchor="end">pharmiq.com.au</text>

      {/* Amber bottom accent bar */}
      <rect y="621" width="1200" height="6" fill="#D97706"/>
    </svg>
  )
}

// ── Instagram Square Post (1080×1080) ────────────────────────────────────────

interface InstagramPostProps {
  /** Main headline (keep to 4–6 words for visual impact) */
  headline:    string
  /** Supporting line */
  subline?:    string
  /** Whether to show mini chart element */
  showChart?:  boolean
}

export function InstagramPost({ headline, subline, showChart = true }: InstagramPostProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080">
      {/* Dark gradient background */}
      <defs>
        <linearGradient id="ig-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0F766E"/>
          <stop offset="100%" stopColor="#0F172A"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#ig-bg)"/>

      {/* Subtle hex pattern overlay (decorative) */}
      <polygon points="980,80 940,11.6 860,11.6 820,80 860,148.4 940,148.4" fill="none" stroke="white" strokeWidth="1" opacity="0.1"/>
      <polygon points="1060,200 1020,131.6 940,131.6 900,200 940,268.4 1020,268.4" fill="none" stroke="white" strokeWidth="1" opacity="0.06"/>

      {/* Logo */}
      <polygon points="100,100 88,79.2 64,79.2 52,100 64,120.8 88,120.8" fill="white" fillOpacity="0.9"/>
      <rect x="59" y="107" width="8" height="11" rx="1.5" fill="#0F766E"/>
      <rect x="70" y="100" width="8" height="18" rx="1.5" fill="#0F766E"/>
      <rect x="81" y="92" width="8" height="26" rx="1.5" fill="#0F766E"/>
      <text x="114" y="110" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="30" fontWeight="700" fill="white">PharmIQ</text>

      {/* Headline */}
      <text x="80" y="520" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="88" fontWeight="700" fill="white" dominantBaseline="middle">
        {headline}
      </text>

      {/* Subline */}
      {subline && (
        <text x="80" y="630" fontFamily="'Inter', system-ui, sans-serif" fontSize="36" fontWeight="400" fill="rgba(255,255,255,0.7)">
          {subline}
        </text>
      )}

      {/* Mini chart bars (decorative data motif) */}
      {showChart && (
        <g opacity="0.25">
          <rect x="80" y="780" width="40" height="60" rx="4" fill="white"/>
          <rect x="134" y="750" width="40" height="90" rx="4" fill="white"/>
          <rect x="188" y="710" width="40" height="130" rx="4" fill="white"/>
          <rect x="242" y="680" width="40" height="160" rx="4" fill="#D97706"/>
          <rect x="296" y="740" width="40" height="100" rx="4" fill="white"/>
          <rect x="350" y="760" width="40" height="80" rx="4" fill="white"/>
        </g>
      )}

      {/* Tagline + URL */}
      <text x="80" y="1010" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="24" fontWeight="700" fill="rgba(255,255,255,0.6)">Smart Ops. Better Margins.</text>
      <text x="1000" y="1010" fontFamily="'Inter', system-ui, sans-serif" fontSize="22" fontWeight="500" fill="#14B8A6" textAnchor="end">pharmiq.com.au</text>
    </svg>
  )
}

// ── Instagram Story (1080×1920) ───────────────────────────────────────────────

interface StoryProps {
  category:    string  // e.g. "DID YOU KNOW?"
  stat:        string  // e.g. "4.2%"
  statLabel:   string  // e.g. "of AU pharmacy stock expires before it sells"
  body?:       string
  ctaText:     string
}

export function InstagramStory({ category, stat, statLabel, body, ctaText }: StoryProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
      <rect width="1080" height="1920" fill="#0F172A"/>

      {/* Teal gradient top accent */}
      <defs>
        <linearGradient id="story-top" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0F766E" stopOpacity="0.4"/>
          <stop offset="100%" stopColor="#0F172A" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="600" fill="url(#story-top)"/>

      {/* Logo */}
      <polygon points="100,120 88,99.2 64,99.2 52,120 64,140.8 88,140.8" fill="#0F766E"/>
      <rect x="59" y="127" width="8" height="11" rx="1.5" fill="white" fillOpacity="0.9"/>
      <rect x="70" y="120" width="8" height="18" rx="1.5" fill="white"/>
      <rect x="81" y="112" width="8" height="26" rx="1.5" fill="white"/>
      <text x="114" y="132" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="32" fontWeight="700" fill="white">PharmIQ</text>

      {/* Category badge */}
      <rect x="80" y="360" width={String(category).length * 16 + 32} height="52" rx="26" fill="#D97706"/>
      <text x="96" y="394" fontFamily="'Inter', system-ui, sans-serif" fontSize="22" fontWeight="600" fill="white">{category}</text>

      {/* Big stat */}
      <text x="80" y="600" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="180" fontWeight="800" fill="#0F766E">{stat}</text>

      {/* Stat label */}
      <text x="80" y="680" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="52" fontWeight="700" fill="white">{statLabel}</text>

      {/* Body */}
      {body && (
        <text x="80" y="800" fontFamily="'Inter', system-ui, sans-serif" fontSize="38" fontWeight="400" fill="rgba(255,255,255,0.65)">{body}</text>
      )}

      {/* CTA Button */}
      <rect x="80" y="1680" width="920" height="96" rx="12" fill="#D97706"/>
      <text x="540" y="1740" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="38" fontWeight="600" fill="#0F172A" textAnchor="middle">{ctaText} →</text>

      {/* Swipe hint */}
      <text x="540" y="1840" fontFamily="'Inter', system-ui, sans-serif" fontSize="26" fontWeight="400" fill="rgba(255,255,255,0.3)" textAnchor="middle">swipe up</text>
    </svg>
  )
}
