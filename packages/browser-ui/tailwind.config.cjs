/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0b1021',
        foreground: '#e5e7eb',
        card: '#10172d',
        border: 'rgba(255, 255, 255, 0.08)',
        muted: '#0f162c',
        'muted-foreground': '#9ca3af',
        primary: '#5b8def',
        'primary-foreground': '#f8fafc',
        success: '#34d399',
        destructive: '#f87171',
        accent: 'rgba(255, 255, 255, 0.06)',
      },
    },
  },
  plugins: [],
};
