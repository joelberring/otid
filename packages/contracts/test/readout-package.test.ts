import { describe, expect, it } from "vitest";
import { canonicalJsonBytes, readoutPackageSchema } from "../src";

const ids = {
  event: "10000000-0000-4000-8000-000000000001",
  race: "10000000-0000-4000-8000-000000000002"
};

function payload() {
  return {
    formatVersion: 1 as const,
    raceId: ids.race,
    packageVersion: 3,
    resultEngineVersion: "0.1.0",
    event: {
      id: ids.event,
      name: "Testtävling",
      startsOn: "2026-08-30",
      timeZone: "Europe/Stockholm"
    },
    raceSnapshot: {
      race: {
        id: ids.race,
        eventId: ids.event,
        name: "Individuellt",
        raceDate: "2026-08-30",
        snapshotVersion: 3
      },
      classes: [],
      courses: [],
      entries: [],
      cardAssignments: [],
      classControlNeutralizations: []
    },
    fetchedAt: "2026-08-30T10:00:00.000Z"
  };
}

describe("canonical JSON-bytes", () => {
  it("sorterar objektnycklar rekursivt men bevarar arrayordning", () => {
    const first = canonicalJsonBytes({ z: 1, a: [3, { b: "å", a: null }] });
    const second = canonicalJsonBytes({ a: [3, { a: null, b: "å" }], z: 1 });
    expect(first).toEqual(second);
    expect(new TextDecoder().decode(first)).toBe('{"a":[3,{"a":null,"b":"å"}],"z":1}');
    expect(new TextDecoder().decode(canonicalJsonBytes({ a: [2, 1] })))
      .not.toBe(new TextDecoder().decode(canonicalJsonBytes({ a: [1, 2] })));
  });

  it.each([
    ["flyttal", { value: 1.5 }],
    ["undefined", { value: undefined }],
    ["icke-JSON-objekt", { value: new Date("2026-08-30T00:00:00Z") }],
    ["gles array", { value: Array(1) }]
  ])("avvisar %s", (_description, value) => {
    expect(() => canonicalJsonBytes(value)).toThrow();
  });
});

describe("avläsningspaketets kontrakt", () => {
  it("accepterar en strikt och självkonsistent payload", () => {
    expect(readoutPackageSchema.parse(payload())).toEqual(payload());
  });

  it("avvisar extra fält, motsägande race eller paketversion och för lång motorversion", () => {
    expect(readoutPackageSchema.safeParse({ ...payload(), extra: true }).success).toBe(false);
    expect(readoutPackageSchema.safeParse({ ...payload(), raceId: crypto.randomUUID() }).success).toBe(false);
    expect(readoutPackageSchema.safeParse({ ...payload(), packageVersion: 4 }).success).toBe(false);
    expect(readoutPackageSchema.safeParse({ ...payload(), resultEngineVersion: "x".repeat(65) }).success).toBe(false);
  });
});
