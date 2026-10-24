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

/**
 * Steg 41: utseendet "Centrum OK 20 år" (förinställningens röda som huvudfärg) får jubileets grafiska profil på fest-sidan och
 * i bardisken: rubriker i Poppins Bold, centrumröd som bärande färg, grönt bara som accent och mörkgrön för grön text, ljusgrå
 * bakgrund med vita kort. Övriga fester och tävlingssidorna ändras inte.
 */
export const CENTRUM_LOOK = { red: "#ae1917", green: "#62c83a", darkGreen: "#2e7d18", canvas: "#f2f2f2" } as const;

export function partyLook(theme: Pick<PartyTheme, "primary"> | undefined): "centrum" | undefined {
  return theme?.primary === CENTRUM_PRESET.primary ? "centrum" : undefined;
}

export function partyThemeStyle(theme: Pick<PartyTheme, "primary" | "accent"> | undefined): CSSProperties {
  const primary = theme?.primary ?? NEUTRAL_PARTY_COLORS.primary;
  const accent = theme?.accent ?? NEUTRAL_PARTY_COLORS.accent;
  if (partyLook(theme) === "centrum") {
    // Kontrast (WCAG AA): vit på #ae1917 7,1:1, #ae1917 på vitt 7,1:1, #2e7d18 på vitt 5,2:1 och på #f2f2f2 4,6:1.
    return { "--party-primary": CENTRUM_LOOK.red, "--party-on-primary": "#ffffff", "--party-accent": CENTRUM_LOOK.green,
      "--party-on-accent": "#1d1d1b", "--party-accent-text": CENTRUM_LOOK.darkGreen, "--party-primary-text": CENTRUM_LOOK.red,
      "--party-heading-font": "\"Poppins\", var(--font-ui)", "--party-heading-weight": "700", "--canvas": CENTRUM_LOOK.canvas,
      "--party-confirm": CENTRUM_LOOK.red } as CSSProperties;
  }
  return {
    "--party-primary": primary, "--party-on-primary": readableTextOn(primary),
    "--party-accent": accent, "--party-on-accent": readableTextOn(accent),
    "--party-accent-text": textColorOn(accent, "#ffffff"), "--party-primary-text": textColorOn(primary, "#ffffff")
  } as CSSProperties;
}
