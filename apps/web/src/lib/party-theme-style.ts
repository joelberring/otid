import type { CSSProperties } from "react";
import type { PartyTheme } from "@o-tid/contracts";
import { readableTextOn, textColorOn } from "@o-tid/domain";

/**
 * Festens färger som CSS-variabler (PLAN.md steg 40), för den publika fest-sidan och bardisken. Neutralt förval.
 * Text på färgad yta blir mörk eller ljus efter kontrasten; färgerna som text på vitt mörkas tills de klarar WCAG AA.
 */
export const NEUTRAL_PARTY_COLORS = { primary: "#2f3a4a", accent: "#3d7a5c" } as const;
/**
 * Förinställningen "Centrum OK 20 år": loggans röda och gröna, rubriken "Jubileumsbaren" och kvällens prislista. Varorna
 * läggs bara till om koden saknas; befintliga varor skrivs aldrig över.
 */
export const CENTRUM_PRESET = { title: "Jubileumsbaren", primary: "#ae1917", accent: "#62c83a",
  items: [
    { code: 31, name: "Margarita", priceOre: 3_500, group: "Drink" },
    { code: 32, name: "Gin tonic", priceOre: 3_500, group: "Drink" },
    { code: 33, name: "Cuba libre", priceOre: 3_500, group: "Drink" },
    { code: 34, name: "Vargtass", priceOre: 3_500, group: "Drink" },
    { code: 35, name: "Öl", priceOre: 2_500, group: null },
    { code: 36, name: "Vin", priceOre: 2_500, group: null },
    { code: 37, name: "Alkoholfri öl", priceOre: 2_500, group: null },
    { code: 38, name: "Alkoholfri cider", priceOre: 2_000, group: null }
  ] } as const;

export function partyThemeStyle(theme: Pick<PartyTheme, "primary" | "accent"> | undefined): CSSProperties {
  const primary = theme?.primary ?? NEUTRAL_PARTY_COLORS.primary;
  const accent = theme?.accent ?? NEUTRAL_PARTY_COLORS.accent;
  return {
    "--party-primary": primary, "--party-on-primary": readableTextOn(primary),
    "--party-accent": accent, "--party-on-accent": readableTextOn(accent),
    "--party-accent-text": textColorOn(accent, "#ffffff"), "--party-primary-text": textColorOn(primary, "#ffffff")
  } as CSSProperties;
}
