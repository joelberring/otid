import { describe, expect, it } from "vitest";
import { courseSecrecy, publicMapVisible, publicVariantVisible, startHasPassed } from "../src";

const done = { hasResult: true }, out = { hasResult: false };

describe("steg 52: banhemlighet", () => {
  it("håller banorna hemliga så länge någon deltagare saknar resultat eller beslut", () => {
    expect(courseSecrecy({ entries: [done, out, done], finalized: false, revealed: false })).toEqual({ public: false, reason: null, remaining: 1 });
  });

  it("visar banorna när alla har ett resultat eller beslut (även ej start)", () => {
    expect(courseSecrecy({ entries: [done, done], finalized: false, revealed: false })).toEqual({ public: true, reason: "ALL_FINISHED", remaining: 0 });
  });

  it("håller banorna hemliga utan deltagare", () => {
    expect(courseSecrecy({ entries: [], finalized: false, revealed: false })).toMatchObject({ public: false, reason: null });
  });

  it("visar banorna när resultaten är fastställda eller arrangören valt det, även med löpare kvar", () => {
    expect(courseSecrecy({ entries: [out], finalized: true, revealed: false })).toEqual({ public: true, reason: "FINALIZED", remaining: 1 });
    expect(courseSecrecy({ entries: [out], finalized: true, revealed: true })).toEqual({ public: true, reason: "REVEALED", remaining: 1 });
    expect(courseSecrecy({ entries: [], finalized: false, revealed: true })).toMatchObject({ public: true, reason: "REVEALED" });
  });
});

describe("ADR-0186: varianten och kartan publikt före start", () => {
  const now = new Date("2026-12-09T18:30:00Z");
  const hidden = { timing: "AFTER_START" as const, coursesPublic: false, now };

  it("döljer varianten före löparens start och visar den när starttiden har passerat", () => {
    expect(publicVariantVisible({ ...hidden, startTime: "2026-12-09T18:31:00Z" })).toBe(false);
    expect(publicVariantVisible({ ...hidden, startTime: "2026-12-09T18:30:00Z" })).toBe(true);
    expect(publicVariantVisible({ ...hidden, startTime: "2026-12-09T18:00:00+01:00" })).toBe(true);
  });

  it("döljer varianten utan känd starttid tills löparen har startat eller banorna är publika", () => {
    expect(publicVariantVisible({ ...hidden, startTime: null })).toBe(false);
    expect(publicVariantVisible({ ...hidden, startTime: "inte en tid" })).toBe(false);
    expect(publicVariantVisible({ ...hidden, started: true })).toBe(true);
    expect(publicVariantVisible({ ...hidden, coursesPublic: true })).toBe(true);
  });

  it("visar varianten alltid när arrangören valt det", () => {
    expect(publicVariantVisible({ ...hidden, timing: "ALWAYS", startTime: "2026-12-10T00:00:00Z" })).toBe(true);
  });

  it("visar kartan efter start, direkt med valet eller när banorna är publika", () => {
    expect(publicMapVisible({ timing: "AFTER_START", coursesPublic: false, started: false })).toBe(false);
    expect(publicMapVisible({ timing: "AFTER_START", coursesPublic: false, started: true })).toBe(true);
    expect(publicMapVisible({ timing: "AFTER_START", coursesPublic: true, started: false })).toBe(true);
    expect(publicMapVisible({ timing: "ON_PUBLISH", coursesPublic: false, started: false })).toBe(true);
  });

  it("räknar en saknad eller oläslig tid som inte passerad", () => {
    expect(startHasPassed(undefined, now)).toBe(false);
    expect(startHasPassed("", now)).toBe(false);
  });
});
