import { describe, expect, it } from "vitest";
import { courseSecrecy } from "../src";

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
