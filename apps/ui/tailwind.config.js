/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#070b12',
        surface: '#111a2a',
        's2': '#162338',
        fg: '#ecf3ff',
        muted: '#99a8bf',
        faint: '#6e7d95',
        accent: '#ff7a48',
        a2: '#ffb648',
        success: '#52e4a4',
        warn: '#ffd166',
        danger: '#ff8e8e',
        info: '#6cb4ff',
      },
      maxWidth: { page: '1320px' },
    },
  },
  plugins: [],
}
