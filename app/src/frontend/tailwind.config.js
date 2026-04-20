/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        'surface-dim': 'var(--surface-dim)',
        'surface-bright': 'var(--surface-bright)',
        'surface-container-lowest': 'var(--surface-container-lowest)',
        'surface-container-low': 'var(--surface-container-low)',
        'surface-container': 'var(--surface-container)',
        'surface-container-high': 'var(--surface-container-high)',
        'surface-container-highest': 'var(--surface-container-highest)',

        primary: 'var(--primary)',
        'primary-dim': 'var(--primary-dim)',
        'primary-container': 'var(--primary-container)',
        'on-primary': 'var(--on-primary)',
        'on-primary-container': 'var(--on-primary-container)',

        secondary: 'var(--secondary)',
        'secondary-container': 'var(--secondary-container)',
        'on-secondary': 'var(--on-secondary)',
        'on-secondary-container': 'var(--on-secondary-container)',

        tertiary: 'var(--tertiary)',
        'tertiary-container': 'var(--tertiary-container)',
        'on-tertiary': 'var(--on-tertiary)',
        'on-tertiary-container': 'var(--on-tertiary-container)',

        'on-surface': 'var(--on-surface)',
        'on-surface-variant': 'var(--on-surface-variant)',
        outline: 'var(--outline)',
        'outline-variant': 'var(--outline-variant)',
        'inverse-surface': 'var(--inverse-surface)',

        error: 'var(--error)',
        'on-error': 'var(--on-error)',
        'error-container': 'var(--error-container)',
        'on-error-container': 'var(--on-error-container)',

        'orb-lavender': 'var(--orb-lavender)',
        'orb-peach': 'var(--orb-peach)',
        'orb-sky': 'var(--orb-sky)',
      },
      fontFamily: {
        display: ["'Plus Jakarta Sans'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ["'Be Vietnam Pro'", 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display-lg': ['57px', { lineHeight: '1.12', letterSpacing: '-0.01em' }],
        'display-md': ['45px', { lineHeight: '1.16', letterSpacing: '-0.005em' }],
        'display-sm': ['36px', { lineHeight: '1.22', letterSpacing: '0' }],
        'headline-lg': ['32px', { lineHeight: '1.25', letterSpacing: '0' }],
        'headline-md': ['28px', { lineHeight: '1.29', letterSpacing: '0' }],
        'headline-sm': ['24px', { lineHeight: '1.33', letterSpacing: '0' }],
        'title-lg': ['22px', { lineHeight: '1.27', letterSpacing: '0' }],
        'title-md': ['16px', { lineHeight: '1.5', letterSpacing: '0.005em' }],
        'title-sm': ['14px', { lineHeight: '1.43', letterSpacing: '0.005em' }],
        'body-lg': ['16px', { lineHeight: '1.5', letterSpacing: '0.003em' }],
        'body-md': ['14px', { lineHeight: '1.43', letterSpacing: '0.003em' }],
        'body-sm': ['12px', { lineHeight: '1.33', letterSpacing: '0.004em' }],
        'label-lg': ['14px', { lineHeight: '1.43', letterSpacing: '0.007em' }],
        'label-md': ['12px', { lineHeight: '1.33', letterSpacing: '0.007em' }],
        'label-sm': ['11px', { lineHeight: '1.45', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        sm: '0.5rem',
        md: '0.75rem',
        lg: '2rem',
        xl: '3rem',
        full: '9999px',
      },
      boxShadow: {
        'ambient-sm': '0 4px 12px 0 rgba(57, 38, 76, 0.04)',
        ambient: '0 8px 24px 0 rgba(57, 38, 76, 0.06)',
        'ambient-lg': '0 16px 48px 0 rgba(57, 38, 76, 0.08)',
        'ambient-xl': '0 24px 60px 0 rgba(57, 38, 76, 0.08)',
        'glow-primary': '0 0 32px 0 rgba(106, 55, 212, 0.25)',
      },
      animation: {
        'float-slow': 'float 12s ease-in-out infinite',
        'float-med': 'float 9s ease-in-out infinite',
        'float-fast': 'float 6s ease-in-out infinite',
        'fade-up': 'fadeUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '50%': { transform: 'translate(20px, -15px) scale(1.05)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
