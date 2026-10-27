import { describe, expect, it } from "vitest";
import { individualPlacementText, placeOrdinal, placementLines, relayLegPlacementText, relayTeamPlacementText } from "./placement-text";

describe("placeringen vid avläsningen i klartext (steg 57)", () => {
  it("skriver svenska ordningstal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(placeOrdinal))
      .toEqual(["1:a", "2:a", "3:e", "4:e", "11:e", "12:e", "13:e", "21:a", "22:a", "23:e", "101:a", "111:e", "112:e"]);
  });

  it("individuell: placering, antal i mål och avstånd till ledaren", () => {
    expect(individualPlacementText({ position: 3, tied: false, finished: 12, leader: { name: "Ada Ek", behindMs: 134_000 } }))
      .toBe("3:e av 12 i mål · +2:14 efter Ada Ek");
    expect(individualPlacementText({ position: 2, tied: false, finished: 2, leader: { name: "Ada Ek", behindMs: 30_500 } }))
      .toBe("2:a av 2 i mål · +0:30 efter Ada Ek");
    expect(individualPlacementText({ position: 1, tied: false, finished: 5, ahead: { ms: 65_000 } })).toBe("Leder · 1:05 före tvåan");
    expect(individualPlacementText({ position: 1, tied: false, finished: 1 })).toBe("Leder · ensam i mål");
  });

  it("lika tid: delad placering", () => {
    expect(individualPlacementText({ position: 1, tied: true, finished: 4, leader: { name: "Ada Ek", behindMs: 0 } }))
      .toBe("Delad 1:a av 4 i mål · samma tid som Ada Ek");
    expect(individualPlacementText({ position: 3, tied: true, finished: 4, leader: { name: "Ada Ek", behindMs: 100_000 } }))
      .toBe("Delad 3:e av 4 i mål · +1:40 efter Ada Ek");
  });

  it("rogaining: poäng före tid", () => {
    expect(individualPlacementText({ position: 3, tied: false, finished: 3, leader: { name: "Ada Ek", pointsBehind: 40 } }))
      .toBe("3:e av 3 i mål · 40 p efter Ada Ek");
    expect(individualPlacementText({ position: 1, tied: false, finished: 3, ahead: { points: 40 } })).toBe("Leder · 40 p före tvåan");
  });

  it("stafett: laget efter sträckan och sträcktiden mot bästa", () => {
    expect(relayTeamPlacementText({ position: 3, tied: false, finished: 12, leader: { name: "OK Ek 1", behindMs: 134_000 } }, 2))
      .toBe("Laget 3:e av 12 efter sträcka 2 · +2:14 efter OK Ek 1");
    expect(relayTeamPlacementText({ position: 1, tied: false, finished: 4, ahead: { ms: 65_000 } }, 2))
      .toBe("Laget leder efter sträcka 2 · 1:05 före tvåan");
    expect(relayTeamPlacementText({ position: 2, tied: true, finished: 4, leader: { name: "OK Ek 1", behindMs: 5_000 } }, 1))
      .toBe("Laget delad 2:a av 4 efter sträcka 1 · +0:05 efter OK Ek 1");
    expect(relayLegPlacementText({ position: 4, tied: false, finished: 10, leader: { name: "OK Ek 1", behindMs: 62_000 }, elapsedMs: 1_390_000 }))
      .toBe("Sträcktid 23:10 · 4:e av 10 på sträckan · +1:02 efter bästa");
    expect(relayLegPlacementText({ position: 1, tied: false, finished: 3, ahead: { ms: 4_000 }, elapsedMs: 1_390_000 }))
      .toBe("Sträcktid 23:10 · bäst på sträckan (0:04 före tvåan)");
    expect(placementLines({ kind: "relay", leg: 2, legTime: { position: 1, tied: false, finished: 1, elapsedMs: 600_000 } }))
      .toEqual(["Sträcktid 10:00 · bäst på sträckan"]);
  });
});
