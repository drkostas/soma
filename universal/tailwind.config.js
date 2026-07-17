/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "./node_modules/soma-style/src/ui/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset"), require("soma-style/preset")],
  theme: { extend: {} },
  plugins: [],
};
