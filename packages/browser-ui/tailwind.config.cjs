/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: 'var(--card)',
        border: 'var(--border)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        primary: 'var(--primary)',
        'primary-foreground': 'var(--primary-foreground)',
        success: 'var(--success)',
        error: 'var(--error)',
        warning: 'var(--warning)',
        accent: 'var(--accent)',
        ds: {
          gray: {
            100: 'var(--accents-1)',
            200: 'var(--accents-2)',
            300: 'var(--accents-3)',
            400: 'var(--accents-4)',
            500: 'var(--accents-5)',
            600: 'var(--accents-6)',
            700: 'var(--accents-7)',
            800: 'var(--accents-8)',
          },
          red: {
            100: 'var(--ds-red-100)',
            200: 'var(--ds-red-200)',
            300: 'var(--ds-red-300)',
            700: 'var(--ds-red-700)',
            800: 'var(--ds-red-800)',
            900: 'var(--ds-red-900)',
          },
          green: {
            100: 'var(--ds-green-100)',
            200: 'var(--ds-green-200)',
            300: 'var(--ds-green-300)',
            700: 'var(--ds-green-700)',
            800: 'var(--ds-green-800)',
            900: 'var(--ds-green-900)',
          },
          amber: {
            100: 'var(--ds-amber-100)',
            200: 'var(--ds-amber-200)',
            300: 'var(--ds-amber-300)',
            700: 'var(--ds-amber-700)',
            800: 'var(--ds-amber-800)',
            900: 'var(--ds-amber-900)',
          },
          blue: {
            700: 'var(--ds-blue-700)',
          },
        },
      },
    },
  },
  plugins: [],
};
