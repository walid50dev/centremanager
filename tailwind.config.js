/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',
        foreground: '#0F172A',
        background: '#F8FAFC',
        border: '#E2E8F0',
        success: '#16A34A',
        warning: '#D97706',
        destructive: '#DC2626',
        muted: '#64748B',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        arabic: ['"Noto Sans Arabic"', 'Inter', 'ui-sans-serif', 'sans-serif'],
      },
      fontSize: {
        // Typography scale
        label: ['13px', { lineHeight: '18px', fontWeight: '500' }],
        body: ['14px', { lineHeight: '20px' }],
        btn: ['14px', { lineHeight: '20px', fontWeight: '500' }],
        h2: ['20px', { lineHeight: '28px', fontWeight: '600' }],
        h1: ['24px', { lineHeight: '32px', fontWeight: '600' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
      },
    },
  },
  plugins: [],
};
