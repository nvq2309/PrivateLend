/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gray: {
          100: "#fdfdfd",
          200: "#202020",
          300: "rgba(36, 36, 36, 0.89)",
        },
        dimgray: {
          100: "#554e4e",
          200: "rgba(116, 105, 105, 0.15)",
        },
        darkslategray: {
          100: "#484040",
          200: "#2e2e2e",
        },
        steelblue: {
          100: "#86a0d2",
          200: "#7b96bf",
        },
        lightskyblue: {
          100: "#8fbcff",
          200: "#87aeeb",
        },
        lightsteelblue: {
          100: "#b8d4ff",
          200: "#c0ceff",
          300: "#bbd1fa",
          400: "#b0c7f3",
          500: "#abc3f2",
          600: "#98b1e0",
        },
        cornflowerblue: {
          100: "#7394d6",
          200: "rgba(115, 148, 214, 0.8)",
        },
        darkslategray: {
          100: "#33363f",
          200: "rgba(53, 52, 52, 0.69)",
        },
        mediumslateblue: "#1f5af0",
        white: "#fff",
        snow: "#fff9f9",
        "label-color-dark-secondary": "rgba(235, 235, 245, 0.6)",
        tomato: "#ff3b30",
        black: "#000",
        "text-color-dark-tertiary": "rgba(255, 255, 255, 0.25)",
        lavender: {
          100: "#ecf0ff",
          200: "#d9e8ff",
        },
      },
      spacing: {},
      fontFamily: {
        jost: "Jost",
        "sf-pro-display": "'SF Pro Display'",
        "sf-compact-display": "'SF Compact Display'",
        cabin: "Cabin",
        lato: "Lato",
        gugi: "Gugi",
        artifika: "Artifika",
        inter: "Inter",
      },
      borderRadius: {
        "7xl-5": "26.5px",
        xl: "20px",
        "3xs": "10px",
        "8xs": "5px",
        "11xl": "30px",
        mini: "15px",
        "6xl": "25px",
      },
    },
    fontSize: {
      "2xs": "11px",
      "4xs": "9px",
      "sm-7": "13.7px",
      base: "16px",
      xs: "12px",
      sm: "14px",
      "5xs": "8px",
      inherit: "inherit",
    },
  },
};
