import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        serif: ['STKaiti', 'KaiTi', 'serif'],
      },
    },
  },
  plugins: [],
}
export default config
