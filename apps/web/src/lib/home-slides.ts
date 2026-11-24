import type { Language } from "./language";

/**
 * Startsidans bildspel för den som inte är inloggad (ägaren 2026-11-24, ersätter veckans målning där): nio skärmbilder ur
 * programmet i arbetsordning. Bilderna ligger i `apps/web/public/bildspel/` (svenskt gränssnitt) och `bildspel/en/` (engelskt)
 * och tas om med `pnpm bildspel` (`tests/e2e/bildspel.spec.ts`, demodata med påhittade namn). Alla är 1440 × 900 px (WebP).
 */
export const HOME_SLIDES = ["grundkarta", "rita", "vagval", "gps", "layout", "forbered", "avlasning", "resultat", "arkiv"] as const;
export type HomeSlide = (typeof HOME_SLIDES)[number];

export const HOME_SLIDE_SIZE = { width: 1440, height: 900 } as const;
/** Bilden på besökarens språk (samma språkval som texterna); den svenska är reserv om en engelsk saknas (`onError` i bildspelet). */
export const homeSlideSrc = (slide: HomeSlide, language: Language = "sv") => `/bildspel/${language === "en" ? "en/" : ""}${slide}.webp`;

/** Automatisk växling (ägaren 2026-11-24: var 5:e sekund); pausar vid hovring och fokus, stannar efter eget val. */
export const HOME_SLIDE_INTERVAL_MS = 5_000;

/** Nästa eller föregående bild, runt. */
export const stepSlide = (index: number, step: number, count = HOME_SLIDES.length) => ((index + step) % count + count) % count;

/** Ett svep: minst 40 px i sidled och mer i sidled än på höjden; åt vänster är nästa bild. */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
