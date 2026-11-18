/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
      },
      colors: {
        brand: {
          50:  '#eef7f4',
          100: '#d4ebe3',
          200: '#a9d7c8',
          300: '#7cc1a8',
          400: '#4fa989',
          500: '#2d8a6b',
          600: '#226f56',
          700: '#1b5542',
          800: '#133c30',
          900: '#0c241d',
        },
        surface: {
          light: '#ffffff',
          muted: '#f7f7f5',
          dark: '#1a1a1a',
          dim: '#111111',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-right': {
          '0%': { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-left': {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(45, 138, 107, 0.4)' },
          '70%': { boxShadow: '0 0 0 12px rgba(45, 138, 107, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(45, 138, 107, 0)' },
        },
        'progress': {
          '0%': { width: '0%' },
          '100%': { width: 'var(--progress)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
        'fade-up': 'fade-up 0.3s ease-out',
        'slide-right': 'slide-right 0.3s ease-out',
        'slide-left': 'slide-left 0.3s ease-out',
        'scale-in': 'scale-in 0.25s ease-out',
        'pulse-ring': 'pulse-ring 2s infinite',
      },
    },
  },
  plugins: [],
}
