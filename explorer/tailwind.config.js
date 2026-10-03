/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {},
  },
  plugins: [require("daisyui")],
  // The explorer's palette (color-block etc.) assumes the light theme; without
  // this daisyui follows prefers-color-scheme and grays out on dark-mode hosts.
  daisyui: {
    themes: ["light"],
    darkTheme: "light",
  },
}

