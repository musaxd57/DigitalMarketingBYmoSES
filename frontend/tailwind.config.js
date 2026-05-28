/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: { DEFAULT: '#0a0a0f', card: '#111118', border: '#1e1e2e' },
        accent: { DEFAULT: '#00ff88', dim: '#00cc6a' },
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
