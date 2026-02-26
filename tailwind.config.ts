import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        midnight: "#0B1426",
        reef: "#00C9A7",
        ocean: "#1B65A7",
        surface: "rgba(255, 255, 255, 0.03)",
        "surface-border": "rgba(255, 255, 255, 0.06)",
        "surface-hover": "rgba(255, 255, 255, 0.12)",
        "text-primary": "#FFFFFF",
        "text-secondary": "rgba(255, 255, 255, 0.5)",
        "border-subtle": "rgba(255, 255, 255, 0.08)",
        error: "#E74C3C",
        warning: "#F5A623",
        success: "#00C9A7",
      },
      fontFamily: {
        sans: ["var(--font-general-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
