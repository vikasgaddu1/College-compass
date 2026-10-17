import type { Config } from "tailwindcss";

// Colors resolve to CSS variables defined in src/styles/base.css so the
// frontend owner can retheme without touching this file.
const token = (name: string) => `var(--${name})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        text: token("text"),
        "text-muted": token("text-muted"),
        border: token("border"),
        accent: token("accent"),
        "accent-soft": token("accent-soft"),
        "accent-contrast": token("accent-contrast"),
        good: token("good"),
        warn: token("warn"),
        bad: token("bad"),
        "tier-high-reach": token("tier-high-reach"),
        "tier-reach": token("tier-reach"),
        "tier-target": token("tier-target"),
        "tier-likely": token("tier-likely"),
        "tier-safety": token("tier-safety"),
      },
      fontSize: {
        // iOS Dynamic Type-inspired scale (default size class).
        caption2: ["11px", { lineHeight: "13px" }],
        caption: ["12px", { lineHeight: "16px" }],
        footnote: ["13px", { lineHeight: "18px" }],
        subhead: ["15px", { lineHeight: "20px" }],
        callout: ["16px", { lineHeight: "21px" }],
        body: ["17px", { lineHeight: "22px" }],
        headline: ["17px", { lineHeight: "22px", fontWeight: "600" }],
        title3: ["20px", { lineHeight: "25px", fontWeight: "600" }],
        title2: ["22px", { lineHeight: "28px", fontWeight: "700" }],
        title1: ["28px", { lineHeight: "34px", fontWeight: "700" }],
        large: ["34px", { lineHeight: "41px", fontWeight: "700", letterSpacing: "-0.4px" }],
      },
      borderRadius: {
        card: "16px",
        control: "12px",
        chip: "10px",
      },
      boxShadow: {
        card: "var(--shadow)",
      },
      spacing: {
        "safe-top": "var(--sat)",
        "safe-bottom": "var(--sab)",
        "safe-left": "var(--sal)",
        "safe-right": "var(--sar)",
      },
      minHeight: { tap: "44px" },
      minWidth: { tap: "44px" },
      maxWidth: { column: "560px" },
    },
  },
  plugins: [],
} satisfies Config;
