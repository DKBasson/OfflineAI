/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          lo: 'var(--accent-lo)',
          b: 'var(--accent-b)',
        },
        surface: {
          DEFAULT: 'var(--glass)',
          md: 'var(--glass-md)',
          hi: 'var(--glass-hi)',
          blue: 'var(--glass-blue)',
        },
        border: {
          DEFAULT: 'var(--border)',
          hi: 'var(--border-hi)',
          blue: 'var(--border-blue)',
        },
        text: {
          primary: 'var(--text)',
          muted: 'var(--text-2)',
          dim: 'var(--text-3)',
        },
        err: {
          DEFAULT: 'var(--err)',
          text: 'var(--err-text)',
        },
        ok: 'var(--ok)',
      },
      borderRadius: {
        DEFAULT: 'var(--r)',
        sm: 'var(--r-sm)',
        xs: 'var(--r-xs)',
        full: '9999px',
      },
      boxShadow: {
        DEFAULT: 'var(--shadow)',
        sm: 'var(--shadow-sm)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
