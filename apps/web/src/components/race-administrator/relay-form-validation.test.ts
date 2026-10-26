import { describe, expect, it } from "vitest";
import { relayLegSettings } from "./relay-actions";
import { changeoverCodeOf, relayClock, validateRelayClass, validateRelayTeam } from "./relay-form-validation";
import { defaultLegs, relayTemplate } from "./relay-templates";

/** Steg 56: fel vid fälten i stafettformulären, banan per sträcka, mallar och klockslag som 18.30, 18:30 och 1830. */
const COURSE_A = "00000000-0000-4000-8000-00000000000a";
const COURSE_B = "00000000-0000-4000-8000-00000000000b";

describe("stafettklassens fält", () => {
  it("ger fel vid namn, bana och masstarttid när de saknas", () => {
    const errors = validateRelayClass({ name: " ", legs: defaultLegs(3), changeoverCode: "", readoutMode: "" });
    expect(errors).toEqual({ name: "Skriv klassens namn.", "course-1": "Välj bana för sträcka 1.", "course-2": "Välj bana för sträcka 2.",
      "course-3": "Välj bana för sträcka 3.", "time-1": "Skriv masstarttiden för sträcka 1 som klockslag, till exempel 18:30." });
  });

  it("kräver tid för omstart och minuter för flygande omstart, och en giltig växlingskontroll", () => {
    const legs = defaultLegs(3, [], COURSE_A).map((leg, index) => index === 0 ? { ...leg, time: "18:30" }
      : index === 1 ? { ...leg, method: "RESTART" as const, time: "25:00" } : { ...leg, method: "FLYING_RESTART" as const, minutes: "0" });
    expect(validateRelayClass({ name: "Stafett", legs, changeoverCode: "1000", readoutMode: "" })).toEqual({
      "time-2": "Skriv omstartstiden för sträcka 2 som klockslag, till exempel 18:30.",
      "minutes-3": "Skriv minuter efter ledaren för sträcka 3 som ett heltal 1–720.",
      changeoverCode: "Växlingskontrollen är en kontrollkod 1–999, eller tom." });
    expect(validateRelayClass({ name: "Stafett", legs: legs.slice(0, 1).concat(defaultLegs(2, [], COURSE_A).slice(1)), changeoverCode: "",
      readoutMode: "LAST_LEG" })).toEqual({ changeoverCode: "Utläsning efter sista sträckan kräver en växlingskontroll." });
  });

  it("förstår 18.30, 18:30 och 1830 (och 930) som klockslag", () => {
    for (const value of ["18.30", "18:30", "1830", " 1830 "]) expect(relayClock(value)).toMatch(/^18[:.]30$/);
    expect(relayClock("930")).toBe("09:30");
    expect(relayClock("kl 18")).toBe("kl 18");
    for (const time of ["18.30", "18:30", "1830"]) {
      const legs = defaultLegs(2, [], COURSE_A).map((leg, index) => index === 0 ? { ...leg, time } : leg);
      expect(validateRelayClass({ name: "Stafett", legs, changeoverCode: "", readoutMode: "" })).toEqual({});
      expect(relayLegSettings(legs, "2026-10-26", "Europe/Stockholm")?.[0]?.startTime).toBe("2026-10-26T17:30:00.000Z");
    }
    expect(changeoverCodeOf("1e2")).toBeUndefined();
  });

  it("sparar varje sträckas bana uttryckligen och nekar en sträcka utan bana", () => {
    const legs = defaultLegs(2, [], COURSE_A).map((leg, index) => index === 0 ? { ...leg, time: "18:30" } : { ...leg, course: COURSE_B });
    expect(relayLegSettings(legs, "2026-10-26", "Europe/Stockholm")?.map(leg => leg.courseId)).toEqual([COURSE_A, COURSE_B]);
    expect(relayLegSettings([legs[0]!, { ...legs[1]!, course: "" }], "2026-10-26", "Europe/Stockholm")).toBeUndefined();
  });
});

describe("mallar", () => {
  const filled = defaultLegs(3, [], COURSE_A).map((leg, index) => index === 0 ? { ...leg, time: "18:30" } : index === 2 ? { ...leg, course: COURSE_B } : leg);

  it("teamsprint ger fyra sträckor med växling och utläsning efter varje sträcka; banorna står kvar", () => {
    const sprint = relayTemplate("TEAM_SPRINT", filled, COURSE_A);
    expect(sprint.legs.map(leg => leg.method)).toEqual(["MASS_START", "CHANGEOVER", "CHANGEOVER", "CHANGEOVER"]);
    expect(sprint.legs.map(leg => leg.course)).toEqual([COURSE_A, COURSE_A, COURSE_B, COURSE_A]);
    expect(sprint.legs[0]!.time).toBe("18:30");
    expect(sprint).toMatchObject({ readoutMode: "EACH_LEG", changeoverCode: "", more: true });
  });

  it("vanlig stafett återställer sträckorna och inställningarna men inte banorna", () => {
    const sprint = relayTemplate("TEAM_SPRINT", filled, "").legs.map(leg => ({ ...leg, runners: "2" }));
    const standard = relayTemplate("STANDARD", sprint, "");
    expect(standard.legs).toHaveLength(3);
    expect(standard.legs.map(leg => [leg.method, leg.runners, leg.course])).toEqual([["MASS_START", "1", COURSE_A],
      ["CHANGEOVER", "1", COURSE_A], ["CHANGEOVER", "1", COURSE_B]]);
    expect(standard).toMatchObject({ readoutMode: "", restartRanking: "AFTER_NORMAL", forking: "EVEN", more: false });
  });

  it("ungdomsstafett har två löpare på sträcka 2; linjestafett flygande omstart 60 min från sträcka 2", () => {
    expect(relayTemplate("YOUTH", [], "").legs.map(leg => leg.runners)).toEqual(["1", "2", "1"]);
    const line = relayTemplate("LINE", [], COURSE_A);
    expect(line.legs.map(leg => [leg.method, leg.minutes, leg.course])).toEqual([["MASS_START", "", COURSE_A],
      ...Array.from({ length: 4 }, () => ["FLYING_RESTART", "60", COURSE_A])]);
  });
});

describe("nytt lag", () => {
  it("ger fel vid klass, namn, varje löpares namn och upprepade brickor", () => {
    const errors = validateRelayTeam({ classId: "", number: "0", name: "", club: "", runners: [
      { givenName: "Ada", familyName: "", card: "123" }, { givenName: "", familyName: "Bo", card: "123" }, { givenName: "C", familyName: "D", card: "01" }] });
    expect(errors).toEqual({ class: "Välj stafettklass.", number: "Lagnumret är ett heltal 1–99 999, eller tomt för nästa lediga.",
      name: "Skriv lagets namn.", "family-0": "Skriv efternamnet.", "given-1": "Skriv förnamnet.", "card-1": "Brickan används redan i laget.",
      "card-2": "Bricknumret ska bara vara siffror, utan inledande nolla." });
  });
});
