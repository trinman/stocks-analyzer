/** @type {import('tailwindcss').Config} */
export default {
  // The app toggles `.dark` on <html>, so dark: variants must key off that class
  // instead of the operating-system preference.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'fade-in': 'fade-in 240ms ease-out both',
      },
    },
  },
  plugins: [],
};
