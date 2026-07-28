/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "./node_modules/soma-style/src/ui/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset"), require("soma-style/preset")],
  theme: {
    extend: {
      /* Mobile type baseline (#241): 16px body floor + slightly larger caption.
         App-local override of the soma-style preset scale; propagating this into
         the shared soma-style package for all three apps is #242. */
      fontSize: {
        body: ["16px", { lineHeight: "24px", fontWeight: "400" }],
        caption: ["13px", { lineHeight: "18px", fontWeight: "500" }],
      },
    },
  },
  plugins: [],
};
