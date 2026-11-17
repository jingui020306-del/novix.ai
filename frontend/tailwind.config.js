export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontSize: {
        xs: ['0.875rem', '1.5'],
        sm: ['0.9375rem', '1.6'],
        base: ['1rem', '1.65'],
        lg: ['1.125rem', '1.5'],
        xl: ['1.25rem', '1.4'],
        '2xl': ['1.5rem', '1.4'],
        '3xl': ['1.5rem', '1.4'],
      },
      colors: {
        brand: {
          500: 'rgb(var(--c-accent) / <alpha-value>)',
          600: 'rgb(var(--c-accent-hover) / <alpha-value>)',
        },
        border: 'rgb(var(--c-border) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
        text: 'rgb(var(--c-text) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
      },
      borderRadius: {
        ui: '0.6rem',
      },
      boxShadow: {
        soft: '0 8px 26px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
}
