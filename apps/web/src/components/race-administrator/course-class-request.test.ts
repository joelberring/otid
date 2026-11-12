import { manualCourseClassCreateRequestSchema } from "@o-tid/contracts";
import { describe, expect, it } from "vitest";
import { courseClassRequestFrom, courseGetsClass } from "./course-class-request";

const base = { requestId: "r1", courseName: " Lång ", controlCodes: [31, 32], startRuleChoice: true, startRule: "FIXED" as const };

describe("Ny bana: klass", () => {
  it("Träning: tomt klassnamn ger en klass med banans namn och fri start", () => {
    expect(courseGetsClass("TRAINING", " ")).toBe(true);
    expect(courseClassRequestFrom({ ...base, raceType: "TRAINING", className: "", startRuleChoice: false }))
      .toEqual({ formatVersion: 1, requestId: "r1", courseName: "Lång", className: "Lång", startRule: "PUNCH", controlCodes: [31, 32] });
  });

  it("Träning: ett ifyllt klassnamn används", () => {
    expect(courseClassRequestFrom({ ...base, raceType: "TRAINING", className: " H21 ", startRuleChoice: false }).className).toBe("H21");
  });

  it("övriga typer: tomt klassnamn sparar bara banan", () => {
    expect(courseGetsClass("STANDARD", "")).toBe(false);
    expect(courseClassRequestFrom({ ...base, raceType: "STANDARD", className: "" }))
      .toEqual({ formatVersion: 1, requestId: "r1", courseName: "Lång", controlCodes: [31, 32] });
  });

  it("övriga typer: med klassnamn följer startsättet och rogainingens regler med", () => {
    expect(courseClassRequestFrom({ ...base, raceType: "STANDARD", className: "D21" }))
      .toMatchObject({ className: "D21", startRule: "FIXED" });
    expect(courseClassRequestFrom({ ...base, raceType: "ROGAINING", className: "Alla", startRuleChoice: false,
      rogaining: { timeLimitMinutes: 60, penaltyPoints: 1 } })).toMatchObject({ startRule: "PUNCH", rogaining: { timeLimitMinutes: 60, penaltyPoints: 1 } });
  });
  it("begäran har kontraktets nyckelordning: kvittot jämförs som text mot begäran", () => {
    const requestId = "0023e775-772d-4979-9f5b-8438c7fb2ff9";
    for (const input of [
      { ...base, requestId, raceType: "STANDARD" as const, className: "D21" },
      { ...base, requestId, raceType: "TRAINING" as const, className: "", startRuleChoice: false },
      { ...base, requestId, raceType: "STANDARD" as const, className: "" },
      { ...base, requestId, raceType: "ROGAINING" as const, className: "Alla", startRuleChoice: false, rogaining: { timeLimitMinutes: 60, penaltyPoints: 1 } }
    ]) {
      const request = courseClassRequestFrom(input);
      expect(JSON.stringify(manualCourseClassCreateRequestSchema.parse(request))).toBe(JSON.stringify(request));
    }
  });
});
