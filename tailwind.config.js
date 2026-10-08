/**
 * @type {import('tailwindcss').Config}
 *
 * Themeable tokens are `rgb(var(--x) / <alpha-value>)` so a single utility
 * (e.g. `bg-bg-card`) resolves per theme — dark values live in `:root`,
 * light values in `@media (prefers-color-scheme: light)` / `[data-theme]`
 * (see src/index.css). Camelot wheel colors are decorative and stay literal.
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: {
          DEFAULT: v('bg'),
          card: v('bg-card'),
          hover: v('bg-hover'),
          subtle: v('bg-subtle'),
        },
        line: {
          DEFAULT: v('line'),
          hover: v('line-hover'),
        },
        text: {
          DEFAULT: v('text'),
          muted: v('text-muted'),
          dim: v('text-dim'),
        },
        accent: {
          DEFAULT: v('accent'),
          hover: v('accent-hover'),
          soft: v('accent-soft'),
        },
        // Semantic colors
        ok: v('ok'),
        warn: v('warn'),
        bad: v('bad'),
        // Camelot key family colors (12 pairs, A=minor, B=major)
        cam: {
          1: '#ef4444',
          2: '#f97316',
          3: '#f59e0b',
          4: '#eab308',
          5: '#84cc16',
          6: '#22c55e',
          7: '#10b981',
          8: '#14b8a6',
          9: '#06b6d4',
          10: '#3b82f6',
          11: '#5b6cff',
          12: '#8a7bff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': '0.625rem',
      },
      borderRadius: {
        card: '12px', // --r
      },
    },
  },
  plugins: [],
}
