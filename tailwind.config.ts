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
        // Black, not navy, since 2026-08-26. The token NAMES are kept so the
        // handful of places that actually used them did not have to change.
        //
        // The real palette in this app was never this config: bg-midnight was
        // used zero times while the literal #0B1426 appeared 110 times across
        // 50 files. The sweep fixed the literals; these exist so new code has
        // somewhere correct to point.
        //
        // Promoted from src/app/scan/scan.css, which had shipped this exact
        // near-black set for /scan and /v2 all along.
        midnight: "#0a0a0a",
        "surface-1": "#111111",
        "surface-2": "#171717",
        "surface-3": "#262626",
        ink: "#1f1f1f",
        reef: "#00C9A7",
        // Was #1B65A7. Ocean was the SECONDARY accent, so it becomes the deep
        // end of a teal ramp rather than flattening into reef and losing the
        // hierarchy it was carrying.
        ocean: "#0E8C77",
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
