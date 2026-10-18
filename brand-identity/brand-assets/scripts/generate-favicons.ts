/**
 * PharmIQ Favicon Generator
 *
 * Generates all required favicon and app icon sizes from the master SVG.
 *
 * Prerequisites:
 *   npm install sharp --save-dev
 *   (or: bun add -d sharp)
 *
 * Run:
 *   npx tsx brand-assets/scripts/generate-favicons.ts
 *   (or: bun run brand-assets/scripts/generate-favicons.ts)
 *
 * Input:  brand-assets/logo/pharmiq-icon.svg
 * Output: public/favicons/
 */

import sharp from 'sharp'
import fs    from 'node:fs'
import path  from 'node:path'

const INPUT_SVG = path.resolve(__dirname, '../logo/pharmiq-icon.svg')
const OUTPUT_DIR = path.resolve(process.cwd(), 'public/favicons')

// ── Size definitions ──────────────────────────────────────────────────────────

const FAVICON_SIZES = [
  // Browser favicons
  { size: 16,   name: 'favicon-16x16.png',          purpose: 'Browser tab (small)' },
  { size: 32,   name: 'favicon-32x32.png',          purpose: 'Browser tab (standard)' },
  { size: 48,   name: 'favicon-48x48.png',          purpose: 'Windows site icon' },
  { size: 64,   name: 'favicon-64x64.png',          purpose: 'Windows taskbar' },
  // Apple touch icons
  { size: 120,  name: 'apple-touch-icon-120.png',   purpose: 'iPhone (non-retina)' },
  { size: 152,  name: 'apple-touch-icon-152.png',   purpose: 'iPad (non-retina)' },
  { size: 167,  name: 'apple-touch-icon-167.png',   purpose: 'iPad Pro' },
  { size: 180,  name: 'apple-touch-icon.png',       purpose: 'iPhone 6+ (retina) — canonical' },
  // Android / PWA
  { size: 192,  name: 'android-chrome-192x192.png', purpose: 'Android home screen' },
  { size: 512,  name: 'android-chrome-512x512.png', purpose: 'PWA splash + maskable' },
  // Microsoft
  { size: 70,   name: 'mstile-70x70.png',           purpose: 'Windows tile (small)' },
  { size: 150,  name: 'mstile-150x150.png',         purpose: 'Windows tile (medium)' },
  { size: 310,  name: 'mstile-310x310.png',         purpose: 'Windows tile (large)' },
  // App Store / Google Play master
  { size: 1024, name: 'app-icon-1024x1024.png',     purpose: 'App Store / Google Play master' },
]

// ── Background colour for raster renders ─────────────────────────────────────
// The SVG icon uses a teal fill — this bg is used for platforms that
// don't support transparency in favicons (e.g., Windows tiles).
const TILE_BG = '#0F766E' // PharmIQ Teal

async function generate(): Promise<void> {
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  console.log(`\nPharmIQ Favicon Generator`)
  console.log(`Input:  ${INPUT_SVG}`)
  console.log(`Output: ${OUTPUT_DIR}\n`)

  // Read SVG input
  if (!fs.existsSync(INPUT_SVG)) {
    throw new Error(`SVG not found: ${INPUT_SVG}\nRun this script from the project root.`)
  }

  const results: Array<{ file: string; size: number; status: 'ok' | 'error'; error?: string }> = []

  for (const { size, name, purpose } of FAVICON_SIZES) {
    const outputPath = path.join(OUTPUT_DIR, name)
    try {
      await sharp(INPUT_SVG)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9, palette: size <= 64 })
        .toFile(outputPath)

      results.push({ file: name, size, status: 'ok' })
      console.log(`  ✓  ${size.toString().padStart(4)}×${size}  ${name.padEnd(36)}  ${purpose}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ file: name, size, status: 'error', error: msg })
      console.error(`  ✗  ${size}×${size}  ${name} — ERROR: ${msg}`)
    }
  }

  // Generate favicon.ico (multi-size: 16, 32, 48)
  try {
    // sharp doesn't natively write .ico — generate 32px PNG named favicon.ico as fallback
    // For true .ico, use the `ico` package or `png-to-ico` cli
    await sharp(INPUT_SVG)
      .resize(32, 32)
      .png()
      .toFile(path.join(OUTPUT_DIR, 'favicon.ico.png'))
    console.log(`  ✓    32×32  favicon.ico.png (rename to favicon.ico if needed)`)
    console.log(`  ℹ   For true multi-size .ico: npx png-to-ico public/favicons/favicon-16x16.png public/favicons/favicon-32x32.png public/favicons/favicon-48x48.png > public/favicon.ico`)
  } catch (e) {
    console.warn('  ⚠  Could not generate favicon.ico.png')
  }

  // Generate webmanifest
  const manifestPath = path.join(OUTPUT_DIR, '../site.webmanifest')
  const manifest = {
    name:             'PharmIQ',
    short_name:       'PharmIQ',
    description:      'Smart Ops. Better Margins. Pharmacy intelligence for Australian operators.',
    start_url:        '/',
    display:          'standalone',
    background_color: '#0F766E',
    theme_color:      '#0F766E',
    icons: [
      { src: '/favicons/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/favicons/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`\n  ✓  site.webmanifest written`)

  // Summary
  const ok    = results.filter(r => r.status === 'ok').length
  const error = results.filter(r => r.status === 'error').length
  console.log(`\nDone. ${ok} files generated${error > 0 ? `, ${error} errors` : ''}.`)
  console.log(`\nAdd to your <head>:\n`)
  console.log(htmlSnippet())
}

function htmlSnippet(): string {
  return `<link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0F766E" />
<meta name="msapplication-TileColor" content="#0F766E" />
<meta name="msapplication-TileImage" content="/favicons/mstile-150x150.png" />`
}

generate().catch(err => {
  console.error('\nFailed:', err)
  process.exit(1)
})
