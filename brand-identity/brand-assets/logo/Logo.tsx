/**
 * PharmIQ Logo Component
 *
 * Usage:
 *   <Logo />                           // full horizontal, primary colours, 40px height
 *   <Logo variant="icon" size={32} />  // icon only
 *   <Logo variant="wordmark" />        // wordmark only
 *   <Logo color="white" />             // reversed for dark backgrounds
 *   <Logo color="mono" monoColor="#FF0000" /> // custom single colour
 *
 * Font dependency: Space Grotesk 700 must be loaded
 *   <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
 */

interface LogoProps {
  /** Which part of the logo to render */
  variant?: 'full' | 'icon' | 'wordmark' | 'stacked'
  /** Colour treatment */
  color?: 'primary' | 'white' | 'mono'
  /** Custom colour for monochrome variant (default: #0F172A navy) */
  monoColor?: string
  /** Height in px — width scales proportionally */
  size?: number
  /** aria-label override (default provided) */
  label?: string
  /** Extra class names */
  className?: string
}

const BRAND = {
  teal:       '#0F766E',
  tealLight:  '#14B8A6',
  navy:       '#0F172A',
  white:      '#FFFFFF',
  whiteMuted: 'rgba(255,255,255,0.15)',
} as const

// Hexagon points (flat-top, 48×48 viewBox, r=20, center=24,24)
const HEX_POINTS = '44,24 34,6.68 14,6.68 4,24 14,41.32 34,41.32'

function HexIcon({
  fillColor,
  barColor,
  strokeOnly = false,
}: {
  fillColor: string
  barColor: string
  strokeOnly?: boolean
}) {
  return (
    <>
      <defs>
        <clipPath id="pharmiq-hex-clip">
          <polygon points={HEX_POINTS} />
        </clipPath>
      </defs>

      {/* Hexagon */}
      <polygon
        points={HEX_POINTS}
        fill={strokeOnly ? BRAND.whiteMuted : fillColor}
        stroke={strokeOnly ? barColor : 'none'}
        strokeWidth={strokeOnly ? 2 : 0}
      />

      {/* Ascending bars (clipped to hexagon) */}
      <g clipPath="url(#pharmiq-hex-clip)">
        {/* Short bar */}
        <rect x="11" y="29" width="7" height="10" rx="1.5" fill={barColor} fillOpacity={0.9} />
        {/* Medium bar */}
        <rect x="20.5" y="21" width="7" height="18" rx="1.5" fill={barColor} />
        {/* Tall bar */}
        <rect x="30" y="11" width="7" height="28" rx="1.5" fill={barColor} />
      </g>
    </>
  )
}

function Wordmark({
  pharmColor,
  iqColor,
}: {
  pharmColor: string
  iqColor: string
}) {
  const font = "'Space Grotesk', 'Sora', system-ui, sans-serif"
  return (
    <>
      <text
        x="0"
        y="28"
        fontFamily={font}
        fontSize={26}
        fontWeight={700}
        letterSpacing="-0.3"
        fill={pharmColor}
      >
        Pharm
      </text>
      <text
        x="80"
        y="28"
        fontFamily={font}
        fontSize={26}
        fontWeight={700}
        letterSpacing="-0.3"
        fill={iqColor}
      >
        IQ
      </text>
    </>
  )
}

export function Logo({
  variant = 'full',
  color = 'primary',
  monoColor = BRAND.navy,
  size = 40,
  label,
  className,
}: LogoProps) {
  // ── Colour resolution ──────────────────────────────────────────
  const isPrimary  = color === 'primary'
  const isWhite    = color === 'white'
  const isMono     = color === 'mono'

  const iconFill   = isMono ? monoColor : isPrimary ? BRAND.teal   : 'transparent'
  const barFill    = isMono ? BRAND.white : BRAND.white
  const pharmColor = isMono ? monoColor : isWhite    ? BRAND.white  : BRAND.navy
  const iqColor    = isMono ? monoColor : isWhite    ? BRAND.tealLight : BRAND.teal
  const strokeOnly = isWhite

  // ── Icon only ─────────────────────────────────────────────────
  if (variant === 'icon') {
    const px = size
    return (
      <svg
        width={px}
        height={px}
        viewBox="0 0 48 48"
        fill="none"
        aria-label={label ?? 'PharmIQ'}
        className={className}
        role="img"
      >
        <title>PharmIQ</title>
        <HexIcon fillColor={iconFill} barColor={barFill} strokeOnly={strokeOnly} />
      </svg>
    )
  }

  // ── Wordmark only ──────────────────────────────────────────────
  if (variant === 'wordmark') {
    const h = size
    const w = Math.round(h * (152 / 36))
    return (
      <svg
        width={w}
        height={h}
        viewBox="0 0 152 36"
        fill="none"
        aria-label={label ?? 'PharmIQ'}
        className={className}
        role="img"
      >
        <title>PharmIQ</title>
        <Wordmark pharmColor={pharmColor} iqColor={iqColor} />
      </svg>
    )
  }

  // ── Stacked (vertical: icon above wordmark) ────────────────────
  if (variant === 'stacked') {
    const iconSize = size
    const h = Math.round(iconSize + 12 + 36 * (iconSize / 48))
    return (
      <svg
        width={iconSize}
        height={h}
        viewBox={`0 0 48 ${Math.round(48 + 12 + 36)}`}
        fill="none"
        aria-label={label ?? 'PharmIQ'}
        className={className}
        role="img"
      >
        <title>PharmIQ</title>
        <HexIcon fillColor={iconFill} barColor={barFill} strokeOnly={strokeOnly} />
        {/* Wordmark centred below icon */}
        <g transform="translate(-52, 60)">
          <Wordmark pharmColor={pharmColor} iqColor={iqColor} />
        </g>
      </svg>
    )
  }

  // ── Full horizontal (default) ─────────────────────────────────
  // viewBox: 200×48
  const h   = size
  const w   = Math.round(h * (200 / 48))
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 200 48"
      fill="none"
      aria-label={label ?? 'PharmIQ'}
      className={className}
      role="img"
    >
      <title>PharmIQ</title>
      <defs>
        <clipPath id="pharmiq-hex-clip-full">
          <polygon points={HEX_POINTS} />
        </clipPath>
      </defs>

      {/* Icon */}
      <polygon
        points={HEX_POINTS}
        fill={strokeOnly ? BRAND.whiteMuted : iconFill}
        stroke={strokeOnly ? BRAND.white : 'none'}
        strokeWidth={strokeOnly ? 2 : 0}
      />
      <g clipPath="url(#pharmiq-hex-clip-full)">
        <rect x="11" y="29" width="7" height="10" rx="1.5" fill={barFill} fillOpacity={0.9} />
        <rect x="20.5" y="21" width="7" height="18" rx="1.5" fill={barFill} />
        <rect x="30" y="11" width="7" height="28" rx="1.5" fill={barFill} />
      </g>

      {/* Wordmark offset right of icon */}
      <g transform="translate(58, 6)">
        <Wordmark pharmColor={pharmColor} iqColor={iqColor} />
      </g>
    </svg>
  )
}

export default Logo
