/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        work: '#2563eb',
        school: '#ea580c',
        personal: '#16a34a',
        conflict: '#dc2626',
      },
    },
  },
  plugins: [],
};
