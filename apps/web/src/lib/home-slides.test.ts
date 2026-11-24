import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { homeSlidesEn } from "../i18n/home-slides-en";
import { homeSlidesSv } from "../i18n/home-slides-sv";
import { HOME_SLIDE_INTERVAL_MS, HOME_SLIDES, homeSlideSrc, stepSlide, swipeStep } from "./home-slides";

describe("startsidans bildspel", () => {
  it("går runt åt båda hållen", () => {
    expect(stepSlide(0, -1)).toBe(HOME_SLIDES.length - 1);
    expect(stepSlide(HOME_SLIDES.length - 1, 1)).toBe(0);
    expect(stepSlide(2, 1)).toBe(3);
  });
  it("svep åt vänster är nästa, korta och lodräta svep ingenting", () => {
    expect(swipeStep(-60, 5)).toBe(1);
    expect(swipeStep(60, -5)).toBe(-1);
    expect(swipeStep(-30, 0)).toBe(0);
    expect(swipeStep(-60, 80)).toBe(0);
  });
  it("växlar högst var 5:e sekund", () => expect(HOME_SLIDE_INTERVAL_MS).toBeGreaterThanOrEqual(5_000));
  it("har text på båda språken och en komprimerad bild per bild", () => {
    for (const slide of HOME_SLIDES) {
      expect(homeSlidesSv.slides[slide].title).not.toBe("");
      expect(homeSlidesEn.slides[slide].alt).not.toBe("");
      for (const language of ["sv", "en"] as const) {
        const file = new URL(`../../public${homeSlideSrc(slide, language)}`, import.meta.url);
        expect(existsSync(file), `${language}/${slide}`).toBe(true);
        expect(statSync(file).size, `${language}/${slide}`).toBeLessThan(200_000);
      }
    }
  });
  it("tar bilden på besökarens språk", () => {
    expect(homeSlideSrc("rita")).toBe("/bildspel/rita.webp");
    expect(homeSlideSrc("rita", "en")).toBe("/bildspel/en/rita.webp");
  });
});
