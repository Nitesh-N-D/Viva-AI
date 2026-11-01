/** @type {import('tailwindcss').Config} */
// VIVA AI design tokens. Use these names, not raw hex values, in components.
//  - leaf:  primary brand / positive actions (farm)
//  - soil:  warm neutrals for surfaces and body text
//  - steel: fabrication module accent
//  - ember: warnings and attention
//  - danger / info: error and informational states
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        soil: {
          50: "#FBF8F2",
          100: "#F3EBDC",
          200: "#E6D6B9",
          400: "#B98447",
          500: "#8F6B45",
          600: "#6F5232",
          700: "#5A4229",
          900: "#2E2114",
        },
        leaf: {
          50: "#EEF5EA",
          100: "#D9E9D1",
          400: "#6E9A5E",
          600: "#3F6B3A",
          700: "#33582F",
          800: "#264322",
          900: "#18301A",
        },
        steel: {
          50: "#EEF3F6",
          400: "#6E8CA0",
          600: "#3E5A6E",
          800: "#22323D",
        },
        ember: {
          50: "#FDF3E8",
          400: "#E0823D",
          600: "#A84E14",
        },
        danger: { 50: "#FDECEC", 600: "#B42318" },
        info: { 50: "#EAF2FB", 600: "#1F5FA8" },
      },
      fontFamily: {
        display: ["Noto Sans Tamil", "Noto Sans", "system-ui", "sans-serif"],
        body: ["Noto Sans Tamil", "Noto Sans", "system-ui", "sans-serif"],
      },
      borderRadius: {
        tile: "1rem",
        card: "0.875rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(46,33,20,0.06), 0 2px 8px rgba(46,33,20,0.06)",
        raised: "0 4px 16px rgba(46,33,20,0.12)",
      },
      screens: {
        xs: "380px",
      },
    },
  },
  plugins: [],
};
