import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0a0e27',
          800: '#141829',
          700: '#1a1f3a',
          600: '#252d4a',
          500: '#3a4558',
        },
        trading: {
          bull: '#10b981',
          bear: '#ef4444',
          neutral: '#f59e0b',
          bullLight: '#d1fae5',
          bearLight: '#fee2e2',
        },
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
