/*
 * PharmIQ Tailwind Configuration
 * Semantic colors are derived from design-tokens.json (single source of truth).
 * Do NOT hardcode hex values here — update design-tokens.json instead.
 */
const tokens = require('./src/theme/design-tokens.json');
const brand = tokens.colors.brand;
const dark = tokens.colors.dark;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        display: ["'Fraunces'", 'Georgia', 'serif'],
        heading: ["'Outfit'", "'Inter'", 'sans-serif'],
        body: ["'Inter'", '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'sans-serif'],
        eyebrow: ["'Outfit'", "'Inter'", 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        red: {
          600: '#dc2626',
          700: '#b91c1c',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        /* ── Semantic Tokens (derived from design-tokens.json) ── */
        'semantic-primary': {
          DEFAULT: brand.teal,
          foreground: '#FFFFFF',
          hover: '#115E59',
          active: '#134E4A',
          muted: '#CCFBF1',
          'muted-foreground': brand.teal,
        },
        'semantic-secondary': {
          DEFAULT: brand['sky-blue'],
          foreground: '#FFFFFF',
          hover: '#0284C7',
          active: '#0369A1',
          muted: brand['sky-light'],
          'muted-foreground': '#0369A1',
        },
        'semantic-warning': {
          DEFAULT: brand.amber,
          foreground: '#FFFFFF',
          hover: '#B45309',
          active: '#92400E',
          muted: '#FEF3C7',
          'muted-foreground': '#92400E',
        },
        'semantic-success': {
          DEFAULT: brand.green,
          foreground: '#FFFFFF',
          hover: '#059669',
          active: '#047857',
          muted: '#D1FAE5',
          'muted-foreground': '#047857',
        },
        'semantic-critical': {
          DEFAULT: brand.red,
          foreground: '#FFFFFF',
          hover: '#B91C1C',
          active: '#991B1B',
          muted: '#FEE2E2',
          'muted-foreground': '#991B1B',
        },
        'semantic-surface': {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          4: 'var(--surface-4)',
        },
        'semantic-canvas': dark['canvas-dark'],
        'semantic-text': {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
        },
        'semantic-data-viz': {
          1: brand.teal,
          2: brand['sky-blue'],
          3: brand.amber,
          4: brand.green,
          5: brand.red,
          6: brand.navy,
        },

        /* ── DEPRECATED: inventory-* colors ────────────────── */
        /* These will be removed after wave migration. Use semantic-* instead. */
        inventory: {
          primary: {
            50: '#f0f9ff',
            100: '#e0f2fe',
            200: '#bae6fd',
            300: '#7dd3fc',
            400: '#38bdf8',
            500: '#0ea5e9',
            600: '#0284c7',
            700: '#0369a1',
            800: '#075985',
            900: '#0c4a6e',
          },
          secondary: {
            50: '#f0fdfa',
            100: '#ccfbf1',
            200: '#99f6e4',
            300: '#5eead4',
            400: '#2dd4bf',
            500: '#14b8a6',
            600: '#0d9488',
            700: '#0f766e',
            800: '#115e59',
            900: '#134e4a',
          },
          success: {
            50: '#f0fdf4',
            100: '#dcfce7',
            200: '#bbf7d0',
            300: '#86efac',
            400: '#4ade80',
            500: '#22c55e',
            600: '#16a34a',
            700: '#15803d',
            800: '#166534',
            900: '#14532d',
          },
          warning: {
            50: '#fff7ed',
            100: '#ffedd5',
            200: '#fed7aa',
            300: '#fdba74',
            400: '#fb923c',
            500: '#f97316',
            600: '#ea580c',
            700: '#c2410c',
            800: '#9a3412',
            900: '#7c2d12',
          },
          error: {
            50: '#fef2f2',
            100: '#fee2e2',
            200: '#fecaca',
            300: '#fca5a5',
            400: '#f87171',
            500: '#ef4444',
            600: '#dc2626',
            700: '#b91c1c',
            800: '#991b1b',
            900: '#7f1d1d',
          },
          neutral: {
            50: '#fafafa',
            100: '#f5f5f5',
            200: '#e5e5e5',
            300: '#d4d4d4',
            400: '#a3a3a3',
            500: '#737373',
            600: '#525252',
            700: '#404040',
            800: '#262626',
            900: '#171717',
          },
        },
      },
      borderColor: {
        hairline: 'var(--border-hairline)',
      },
      backgroundColor: {
        'teal-glow': 'var(--glow-teal)',
        'amber-glow': 'var(--glow-amber)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
