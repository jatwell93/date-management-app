/**
 * PharmIQ Business Card Template (SVG)
 * Standard 90×55mm / 3.5×2.1 inch at 96dpi → 340×208px SVG
 *
 * Front: Split design — teal left half (logo), white right half (contact)
 * Back:  Full teal, icon mark centred, tagline below
 *
 * Usage:
 *   <BusinessCardFront name="Sarah Chen" title="Head of Partnerships" email="sarah@pharmiq.com.au" phone="+61 4XX XXX XXX" />
 *   <BusinessCardBack />
 *
 * For print: export as SVG → convert to PDF at 300dpi
 * Bleed: add 3mm bleed area outside the 90×55mm live area
 */

interface BusinessCardProps {
  name:      string
  title:     string
  email:     string
  phone?:    string
  website?:  string
}

export function BusinessCardFront({ name, title, email, phone, website = 'pharmiq.com.au' }: BusinessCardProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 208" width="340" height="208">
      {/* White background */}
      <rect width="340" height="208" fill="#FFFFFF" rx="6"/>

      {/* ── LEFT HALF: Teal branding panel ── */}
      <rect width="130" height="208" fill="#0F766E" rx="6"/>
      <rect x="124" y="0" width="6" height="208" fill="#0F766E"/> {/* remove right radius on left panel */}

      {/* Icon mark — centred in left panel */}
      <polygon points="82,104 72,86.68 52,86.68 42,104 52,121.32 72,121.32" fill="white" fillOpacity="0.9"/>
      <rect x="49" y="110" width="7" height="9" rx="1" fill="#0F766E"/>
      <rect x="58" y="104" width="7" height="15" rx="1" fill="#0F766E"/>
      <rect x="67" y="97" width="7" height="22" rx="1" fill="#0F766E"/>

      {/* Tagline below icon */}
      <text x="65" y="144" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="8" fontWeight="600" fill="white" fillOpacity="0.7" textAnchor="middle">Smart Ops.</text>
      <text x="65" y="155" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="8" fontWeight="600" fill="white" fillOpacity="0.7" textAnchor="middle">Better Margins.</text>

      {/* ── RIGHT HALF: Contact details ── */}

      {/* Name */}
      <text x="150" y="75" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="14" fontWeight="600" fill="#0F172A">{name}</text>

      {/* Title */}
      <text x="150" y="93" fontFamily="'Inter', system-ui, sans-serif" fontSize="10" fontWeight="400" fill="#475569">{title}</text>

      {/* Divider */}
      <rect x="150" y="102" width="170" height="1" fill="#E2E8F0"/>

      {/* Email */}
      <text x="150" y="122" fontFamily="'Inter', system-ui, sans-serif" fontSize="10" fontWeight="400" fill="#0F766E">{email}</text>

      {/* Phone */}
      {phone && (
        <text x="150" y="138" fontFamily="'Inter', system-ui, sans-serif" fontSize="10" fontWeight="400" fill="#475569">{phone}</text>
      )}

      {/* Website */}
      <text x="150" y="160" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="10" fontWeight="500" fill="#0F172A">{website}</text>

      {/* Amber bottom line (right panel only) */}
      <rect x="130" y="202" width="210" height="4" fill="#D97706"/>
    </svg>
  )
}

export function BusinessCardBack() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 208" width="340" height="208">
      {/* Full teal background */}
      <defs>
        <linearGradient id="card-back-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#14B8A6"/>
          <stop offset="100%" stopColor="#0D5D5A"/>
        </linearGradient>
      </defs>
      <rect width="340" height="208" fill="url(#card-back-bg)" rx="6"/>

      {/* Large hex mark — centred */}
      <polygon points="200,110 183,80.8 149,80.8 132,110 149,139.2 183,139.2" fill="white" fillOpacity="0.15"/>
      <polygon points="200,110 183,80.8 149,80.8 132,110 149,139.2 183,139.2" fill="none" stroke="white" strokeWidth="1.5" strokeOpacity="0.6"/>
      <rect x="147" y="118" width="10" height="13" rx="1.5" fill="white" fillOpacity="0.85"/>
      <rect x="161" y="108" width="10" height="23" rx="1.5" fill="white"/>
      <rect x="175" y="97" width="10" height="34" rx="1.5" fill="white"/>

      {/* PharmIQ wordmark below */}
      <text x="170" y="165" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="20" fontWeight="700" fill="white" textAnchor="middle">Pharm</text>
      <text x="218" y="165" fontFamily="'Space Grotesk', system-ui, sans-serif" fontSize="20" fontWeight="700" fill="#14B8A6">IQ</text>

      {/* Tagline */}
      <text x="170" y="185" fontFamily="'Inter', system-ui, sans-serif" fontSize="9" fontWeight="400" fill="rgba(255,255,255,0.55)" textAnchor="middle">Smart Ops. Better Margins.</text>
    </svg>
  )
}

// ── Email Signature HTML ──────────────────────────────────────────────────────
// Returns an HTML string safe for email clients (inline styles only)

interface EmailSigProps {
  name:    string
  title:   string
  email:   string
  phone?:  string
}

export function emailSignatureHTML({ name, title, email, phone }: EmailSigProps): string {
  return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; max-width: 480px;">
  <tr>
    <td style="padding-bottom: 12px; border-bottom: 1px solid #E2E8F0;">
      <img src="https://pharmiq.com.au/brand/logo-horizontal.png" alt="PharmIQ" width="130" height="28" style="display: block;" />
    </td>
  </tr>
  <tr>
    <td style="padding-top: 12px;">
      <p style="margin: 0 0 2px 0; font-size: 15px; font-weight: 700; color: #0F172A;">${name}</p>
      <p style="margin: 0 0 8px 0; font-size: 12px; color: #475569;">${title}</p>
      <p style="margin: 0 0 2px 0; font-size: 12px;">
        <a href="mailto:${email}" style="color: #0F766E; text-decoration: none;">${email}</a>
      </p>
      ${phone ? `<p style="margin: 0 0 8px 0; font-size: 12px; color: #475569;">${phone}</p>` : ''}
      <p style="margin: 8px 0 0 0; font-size: 11px; color: #94A3B8;">
        PharmIQ Pty Ltd · Melbourne, Australia<br/>
        <a href="https://pharmiq.com.au" style="color: #0F766E; text-decoration: none;">pharmiq.com.au</a>
        &nbsp;·&nbsp;Smart Ops. Better Margins.
      </p>
    </td>
  </tr>
</table>
`.trim()
}
