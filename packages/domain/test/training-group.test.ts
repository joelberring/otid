import { describe, expect, it } from "vitest";
import {
  GROUP_CODE_PATTERN, groupParticipantKey, isoWeekday, mapAgreementIssues, mapPublicUseBlocked, maskPublicNames, placementPoints,
  repetitionDates, seasonTable, shownDisplayName, shownPersonName, suggestGroupCode, type MapAgreementFacts
} from "../src/training-group";

describe("steg 68: gruppens kod", () => {
  it("föreslår en giltig kod ur namnet", () => {
    expect(suggestGroupCode("Ungdom OK ÄÖ")).toBe("ungdom-ok-ao");
    expect(suggestGroupCode("Å")).toBe("a-grupp");
    expect(suggestGroupCode("!!")).toBe("grupp");
    expect(suggestGroupCode("x".repeat(80))).toHaveLength(40);
    for (const name of ["Ungdom OK ÄÖ", "Å", "!!", "Tisdagsgänget – vår 2027", "a".repeat(50) + " b"]) {
      expect(GROUP_CODE_PATTERN.test(suggestGroupCode(name)), name).toBe(true);
    }
    expect(GROUP_CODE_PATTERN.test("-ab")).toBe(false);
    expect(GROUP_CODE_PATTERN.test("ab")).toBe(false);
    expect(GROUP_CODE_PATTERN.test("Ab-c")).toBe(false);
  });
});

describe("steg 68: namnen publikt", () => {
  it("förnamn, fullt namn eller inga namn", () => {
    expect(shownPersonName("FULL", "Anna", "Svensson")).toEqual({ givenName: "Anna", familyName: "Svensson" });
    expect(shownPersonName("FIRST", "Anna", "Svensson")).toEqual({ givenName: "Anna", familyName: "" });
    expect(shownPersonName("NONE", "Anna", "Svensson")).toEqual({ givenName: "Deltagare", familyName: "" });
    expect(shownDisplayName("FIRST", "Anna Maria Svensson")).toBe("Anna");
    expect(shownDisplayName("NONE", "Anna Svensson")).toBe("Deltagare");
    expect(shownDisplayName("FULL", "Anna Svensson")).toBe("Anna Svensson");
  });

  it("går igenom hela svaret, bygger om displayName och tar bort Eventors person-id", () => {
    const value = { formatVersion: 1, results: [{ className: "H12", givenName: "Ali", familyName: "Berg", organisationName: "OK ÄÖ" }],
      classes: [{ name: "D12", entries: [{ displayName: "Bo Ek", personEventorId: "123", organisationName: null }] }],
      teams: [{ name: "Lag 1", legs: [{ givenName: "Cy", familyName: "Dahl", displayName: "Cy Dahl" }] }] };
    const first = maskPublicNames(value, "FIRST");
    expect(first.results[0]).toEqual({ className: "H12", givenName: "Ali", familyName: "", organisationName: "OK ÄÖ" });
    expect(first.classes[0]).toEqual({ name: "D12", entries: [{ displayName: "Bo", organisationName: null }] });
    expect(first.teams[0]!.legs[0]).toEqual({ givenName: "Cy", familyName: "", displayName: "Cy" });
    expect(JSON.stringify(maskPublicNames(value, "NONE"))).not.toMatch(/Ali|Berg|Bo|Ek|Cy|Dahl|123/);
    expect(maskPublicNames(value, "FULL")).toBe(value);
    // Originalet ändras inte.
    expect(value.results[0]!.familyName).toBe("Berg");
  });
});

describe("steg 68: upprepning", () => {
  it("varje tisdag en termin", () => {
    expect(isoWeekday("2027-01-12")).toBe(2);
    const dates = repetitionDates({ weekday: 2, firstDate: "2027-01-10", lastDate: "2027-02-09" });
    expect(dates).toEqual(["2027-01-12", "2027-01-19", "2027-01-26", "2027-02-02", "2027-02-09"]);
    expect(repetitionDates({ weekday: 7, firstDate: "2027-01-10", lastDate: "2027-01-10" })).toEqual(["2027-01-10"]);
    expect(repetitionDates({ weekday: 1, firstDate: "2027-01-12", lastDate: "2027-01-13" })).toEqual([]);
  });

  it("avvisar för långt och ogiltigt", () => {
    expect(repetitionDates({ weekday: 2, firstDate: "2027-01-10", lastDate: "2028-06-01" })).toBeUndefined();
    expect(repetitionDates({ weekday: 8, firstDate: "2027-01-10", lastDate: "2027-02-01" })).toBeUndefined();
    expect(repetitionDates({ weekday: 2, firstDate: "2027-02-10", lastDate: "2027-01-01" })).toBeUndefined();
    // Varje dag i ett år blir fler än 60 tillfällen – men en veckodag ett år är 52–53.
    expect(repetitionDates({ weekday: 3, firstDate: "2027-01-01", lastDate: "2027-12-31" })).toHaveLength(52);
  });
});

describe("steg 68: kartans avtal", () => {
  const external: MapAgreementFacts = { ownership: "EXTERNAL", validUntil: "2027-06-30", trainingOnly: true, feePerPrint: true,
    noPublicDisplay: true };
  it("varnar för utgånget avtal, publik visning, tävling och avgift", () => {
    expect(mapAgreementIssues(external, { date: "2027-05-01" })).toEqual(["FEE_PER_PRINT"]);
    expect(mapAgreementIssues(external, { date: "2027-07-01", publicUse: true, raceType: "STANDARD" }))
      .toEqual(["EXPIRED", "NO_PUBLIC_DISPLAY", "TRAINING_ONLY", "FEE_PER_PRINT"]);
    expect(mapAgreementIssues({ ...external, trainingOnly: false, feePerPrint: false, noPublicDisplay: false, validUntil: null },
      { date: "2030-01-01", publicUse: true })).toEqual([]);
  });

  it("spärrar publik visning tills admin valt att visa ändå", () => {
    expect(mapPublicUseBlocked(external, "2027-05-01", false)).toBe(true);
    expect(mapPublicUseBlocked(external, "2027-05-01", true)).toBe(false);
    expect(mapPublicUseBlocked({ ...external, noPublicDisplay: false }, "2027-05-01", false)).toBe(false);
    expect(mapPublicUseBlocked({ ...external, noPublicDisplay: false }, "2027-07-01", false)).toBe(true);
    expect(mapPublicUseBlocked(undefined, "2027-07-01", false)).toBe(false);
  });
});

describe("steg 68: deltagare och säsong", () => {
  it("känner igen samma löpare", () => {
    expect(groupParticipantKey({ givenName: " Anna ", familyName: "SVENSSON" })).toBe(groupParticipantKey({ givenName: "anna", familyName: "Svensson" }));
    expect(groupParticipantKey({ givenName: "Anna", familyName: "Svensson", eventorPersonId: "77" })).toBe("eventor:77");
  });

  it("närvaro och poäng per träning eller placering", () => {
    const a = { key: "a", givenName: "Ali", familyName: "Berg", className: "H12" };
    const b = { key: "b", givenName: "Bo", familyName: "Ek", className: "H12" };
    const sessions = [
      { raceId: "r1", raceDate: "2027-01-12", results: [{ ...a, status: "OK", position: 1 }, { ...b, status: "OK", position: 2 }] },
      { raceId: "r2", raceDate: "2027-01-19", results: [{ ...a, status: "MP" }, { ...b, status: "DNS" }] },
      { raceId: "r3", raceDate: "2027-01-26", results: [{ ...b, status: "OK", position: 1 }, { ...b, className: "D14", status: "OK", position: 3 }] }
    ];
    const attendance = seasonTable(sessions, "ATTENDANCE");
    expect(attendance.map(row => [row.key, row.attended, row.points])).toEqual([["a", 2, 2], ["b", 2, 2]]);
    expect(attendance.find(row => row.key === "b")!.raceIds).toEqual(["r1", "r3"]);
    const placement = seasonTable(sessions, "PLACEMENT");
    expect(placement.map(row => [row.key, row.points])).toEqual([["b", 19], ["a", 10]]);
    expect(placementPoints({ status: "OK", position: 14 })).toBe(1);
    expect(placementPoints({ status: "OK" })).toBe(1);
    expect(placementPoints({ status: "DNF" })).toBe(0);
  });
});
