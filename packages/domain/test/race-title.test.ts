import { describe, expect, it } from "vitest";
import { joinRaceParts, raceDetails, raceTitle, shownRaceName } from "../src";

describe("loppets namn bredvid evenemangets", () => {
  it("visar bara evenemanget när loppet saknar eget namn", () => {
    expect(raceTitle("Natt-KM", "")).toBe("Natt-KM");
    expect(raceTitle("Natt-KM", "   ")).toBe("Natt-KM");
    expect(raceTitle("Natt-KM", "", " – ")).toBe("Natt-KM");
    expect(shownRaceName("Natt-KM", "")).toBeUndefined();
  });

  it("lägger till loppets namn med ställets avgränsare", () => {
    expect(raceTitle("Natt-KM", "Etapp 1")).toBe("Natt-KM · Etapp 1");
    expect(raceTitle("Natt-KM", "Etapp 1", " – ")).toBe("Natt-KM – Etapp 1");
    expect(shownRaceName("Natt-KM", " Torsdag ")).toBe("Torsdag");
  });

  it("visar inte samma namn två gånger", () => {
    expect(raceTitle("Kvällsträning", "Kvällsträning")).toBe("Kvällsträning");
    expect(shownRaceName("Kvällsträning", "Kvällsträning")).toBeUndefined();
  });

  it("raden under rubriken hoppar över tomma delar", () => {
    expect(raceDetails("Natt-KM", "", ["2026-11-01", "Träning"])).toBe("2026-11-01 · Träning");
    expect(raceDetails("Natt-KM", "Etapp 2", ["2026-11-01"])).toBe("Etapp 2 · 2026-11-01");
    expect(raceDetails("Natt-KM", "", ["2026-11-01"], ", ")).toBe("2026-11-01");
    expect(raceDetails("Natt-KM", "", [])).toBe("");
    expect(joinRaceParts(["Natt-KM", undefined, null, "", "2026-11-01"])).toBe("Natt-KM · 2026-11-01");
  });
});
