import { describe, expect, it } from "vitest";
import { raceListName } from "./race-list-name";

const numbered = (n: number) => `Lopp ${n}`;
const race = (raceId: string, raceName: string, raceDate: string) => ({ raceId, raceName, raceDate });

describe("loppets namn i Mina tävlingar", () => {
  it("visar loppets eget namn", () => {
    const torsdag = race("b", "Torsdag", "2026-11-05");
    expect(raceListName(torsdag, [torsdag], numbered)).toBe("Torsdag");
  });

  it("ett ensamt lopp utan namn får inget namn", () => {
    const only = race("a", "", "2026-11-05");
    expect(raceListName(only, [only], numbered)).toBeUndefined();
  });

  it("flera lopp utan namn numreras efter datum, inte efter listans ordning", () => {
    const second = race("a", "", "2026-11-06"), first = race("b", " ", "2026-11-05"), named = race("c", "Final", "2026-11-07");
    const races = [second, named, first];
    expect(raceListName(first, races, numbered)).toBe("Lopp 1");
    expect(raceListName(second, races, numbered)).toBe("Lopp 2");
    expect(raceListName(named, races, numbered)).toBe("Final");
  });
});
