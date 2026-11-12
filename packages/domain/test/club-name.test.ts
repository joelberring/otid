import { describe, expect, it } from "vitest";
import { existingClubSpelling } from "../src/club-name";

describe("klubbnamn för hand (användartest 2026-11-12)", () => {
  it("tar den befintliga stavningen när bara skiftläge eller blanksteg skiljer", () => {
    expect(existingClubSpelling("ok test", ["OK Test", null, "Annan OK"])).toBe("OK Test");
    expect(existingClubSpelling("  OK   Test ", ["OK Test"])).toBe("OK Test");
    expect(existingClubSpelling("ok ÄÖ", ["OK ÄÖ"])).toBe("OK ÄÖ");
  });

  it("vid flera stavningar den vanligaste", () => {
    expect(existingClubSpelling("ok test", ["ok Test", "OK Test", "OK Test"])).toBe("OK Test");
  });

  it("en ny klubb behåller sin stavning", () => {
    expect(existingClubSpelling(" OK Ny ", ["OK Test"])).toBe("OK Ny");
    expect(existingClubSpelling("", ["OK Test"])).toBe("");
  });
});
