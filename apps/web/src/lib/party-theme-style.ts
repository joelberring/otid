import type { CSSProperties } from "react";
import type { PartyTheme } from "@o-tid/contracts";
import { readableTextOn, textColorOn } from "@o-tid/domain";

/**
 * Festens färger som CSS-variabler (PLAN.md steg 40), för den publika fest-sidan och bardisken. Neutralt förval.
 * Text på färgad yta blir mörk eller ljus efter kontrasten; färgerna som text på vitt mörkas tills de klarar WCAG AA.
 */
export const NEUTRAL_PARTY_COLORS = { primary: "#2f3a4a", accent: "#3d7a5c" } as const;
/** Förinställningen "Centrum OK 20 år": loggans röda och gröna. */
export const CENTRUM_PRESET = { title: "Centrum OK 20 år", primary: "#ae1917", accent: "#62c83a" } as const;

export function partyThemeStyle(theme: Pick<PartyTheme, "primary" | "accent"> | undefined): CSSProperties {
  const primary = theme?.primary ?? NEUTRAL_PARTY_COLORS.primary;
  const accent = theme?.accent ?? NEUTRAL_PARTY_COLORS.accent;
  return {
    "--party-primary": primary, "--party-on-primary": readableTextOn(primary),
    "--party-accent": accent, "--party-on-accent": readableTextOn(accent),
    "--party-accent-text": textColorOn(accent, "#ffffff"), "--party-primary-text": textColorOn(primary, "#ffffff")
  } as CSSProperties;
}
