import { describe, expect, it } from "vitest";
import { formErrorsSv as text } from "../i18n/form-errors-sv";
import { hasErrors, isClock, isIsoDate, validateCourseClass, validateCreateRace, validateFirstStart, validateManualClass,
  validateRegistration } from "./form-validation";

describe("fältfel (PLAN.md steg 24)", () => {
  it("klockslag som parseRaceClock godtar", () => {
    for (const value of ["18:30", "8.05", "23:59:59", " 10:00 "]) expect(isClock(value)).toBe(true);
    for (const value of ["", "24:00", "18:60", "1830", "18:3", "kl 18"]) expect(isClock(value)).toBe(false);
  });

  it("datum skrivs ÅÅÅÅ-MM-DD och måste finnas", () => {
    expect(isIsoDate("2026-10-25")).toBe(true);
    for (const value of ["2026-02-30", "10/25/2026", "2026-1-5", ""]) expect(isIsoDate(value)).toBe(false);
  });

  it("Skapa tävling: namnet krävs, etappen är valfri men inte för kort", () => {
    const empty = validateCreateRace({ eventName: "", stageName: "", raceDate: "", timeZone: "Europe/Stockholm" });
    expect(empty).toEqual({ eventName: text.eventName, stageName: undefined, raceDate: text.raceDate, timeZone: undefined });
    expect(hasErrors(validateCreateRace({ eventName: "KM", stageName: "", raceDate: "2026-10-25", timeZone: "Europe/Stockholm" }))).toBe(false);
    expect(validateCreateRace({ eventName: "KM", stageName: "E", raceDate: "2026-10-25", timeZone: "x" }).stageName).toBe(text.stageName);
  });

  it("ny bana: namn och kontroller per fält, klassen är valfri; rogaining kräver tidsgräns och straff när klassen finns", () => {
    expect(validateCourseClass({ courseName: " ", className: "", controls: "" }))
      .toEqual({ courseName: text.courseName, className: undefined, controls: text.controls, timeLimit: undefined, penalty: undefined });
    expect(hasErrors(validateCourseClass({ courseName: "Lång", className: " ", controls: "31 32",
      rogaining: { timeLimit: "0", penalty: "abc" } }))).toBe(false);
    expect(validateCourseClass({ courseName: "Lång", className: "H21", controls: "31 x" }).controls).toBe(text.controlsInvalid);
    expect(hasErrors(validateCourseClass({ courseName: "Lång", className: "H21", controls: "31, 32 33" }))).toBe(false);
    const rogaining = validateCourseClass({ courseName: "R", className: "R60", controls: "31", rogaining: { timeLimit: "0", penalty: "abc" } });
    expect([rogaining.timeLimit, rogaining.penalty]).toEqual([text.timeLimit, text.penalty]);
  });

  it("ny klass: namn och bana", () => {
    expect(validateManualClass({ className: "", courseVersionId: "" })).toEqual({ className: text.className, courseVersionId: text.chooseCourse });
  });

  it("ny deltagare: starttiden är frivillig när klassen lottas senare", () => {
    const base = { classId: "c", classFull: false, givenName: "Ada", familyName: "Löpare", card: "", startClock: "", fixedStart: true };
    expect(validateRegistration({ ...base, timeOptional: true }).startClock).toBeUndefined();
    expect(validateRegistration({ ...base, timeOptional: false }).startClock).toBe(text.startTime);
    expect(validateRegistration({ ...base, timeOptional: true, startClock: "25:00" }).startClock).toBe(text.startTime);
    expect(validateRegistration({ ...base, fixedStart: false, timeOptional: false }).startClock).toBeUndefined();
    expect(validateRegistration({ ...base, classId: "", givenName: "", familyName: "", card: "0123", timeOptional: true }))
      .toEqual({ classId: text.chooseClass, givenName: text.givenName, familyName: text.familyName, card: text.card, startClock: undefined });
    expect(validateRegistration({ ...base, classFull: true, timeOptional: true }).classId).toBe(text.classFull);
  });

  it("lottningens första start", () => {
    expect(validateFirstStart("")).toBe(text.firstStart);
    expect(validateFirstStart("10:00")).toBeUndefined();
  });
});
