import { describe, expect, it } from "vitest";
import {
  ClassStartDrawError,
  planClassStartDraw,
  type ClassStartDrawInput
} from "../src";

const ids = [
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000001"
] as const;

function input(overrides: Partial<ClassStartDrawInput> = {}): ClassStartDrawInput {
  return {
    algorithmVersion: "xorshift32-fisher-yates-v1",
    seed: 1,
    entryIds: ids,
    firstStartTimeMs: 1_704_067_200_123,
    intervalSeconds: 90,
    ...overrides
  };
}

describe("planClassStartDraw", () => {
  it("gives a stable golden draw for a fixed seed", () => {
    expect(planClassStartDraw(input())).toEqual([
      { entryId: "00000000-0000-4000-8000-000000000002", startTimeMs: 1_704_067_200_123 },
      { entryId: "00000000-0000-4000-8000-000000000003", startTimeMs: 1_704_067_290_123 },
      { entryId: "00000000-0000-4000-8000-000000000004", startTimeMs: 1_704_067_380_123 },
      { entryId: "00000000-0000-4000-8000-000000000001", startTimeMs: 1_704_067_470_123 }
    ]);
  });

  it("does not depend on input order and does not mutate the input", () => {
    const originalIds = [...ids];
    const ordered = planClassStartDraw(input({ entryIds: originalIds }));
    const reversed = planClassStartDraw(input({ entryIds: [...originalIds].reverse() }));

    expect(reversed).toEqual(ordered);
    expect(originalIds).toEqual(ids);
  });

  it("includes every entry exactly once at consecutive interval slots", () => {
    const draw = planClassStartDraw(input());
    expect(draw.map((slot) => slot.entryId).sort()).toEqual([...ids].sort());
    expect(new Set(draw.map((slot) => slot.entryId)).size).toBe(ids.length);
    expect(draw.map((slot) => slot.startTimeMs)).toEqual([
      1_704_067_200_123,
      1_704_067_290_123,
      1_704_067_380_123,
      1_704_067_470_123
    ]);
  });

  it("keeps a singleton and its millisecond instant unchanged", () => {
    expect(planClassStartDraw(input({ entryIds: [ids[0]], firstStartTimeMs: -1 }))).toEqual([
      { entryId: ids[0], startTimeMs: -1 }
    ]);
  });

  it.each([
    ["unsupported version", { algorithmVersion: "other" }],
    ["zero seed", { seed: 0 }],
    ["non-integer seed", { seed: 1.5 }],
    ["malformed id", { entryIds: ["not-a-uuid"] }],
    ["uppercase id", { entryIds: ["00000000-0000-4000-8000-00000000000A"] }],
    ["invalid UUID version", { entryIds: ["00000000-0000-0000-8000-000000000001"] }],
    ["invalid UUID variant", { entryIds: ["00000000-0000-4000-0000-000000000001"] }],
    ["duplicate id", { entryIds: [ids[0], ids[0]] }],
    ["empty roster", { entryIds: [] }],
    ["too many entries", { entryIds: Array.from({ length: 10_001 }, () => ids[0]) }],
    ["zero interval", { intervalSeconds: 0 }],
    ["fractional interval", { intervalSeconds: 1.5 }],
    ["overflowing last slot", { firstStartTimeMs: 253_402_300_799_999, entryIds: [ids[0], ids[1]] }]
  ])("rejects %s", (_label, overrides) => {
    expect(() => planClassStartDraw(input(overrides as Partial<ClassStartDrawInput>)))
      .toThrowError(ClassStartDrawError);
  });

  it("rejects malformed runtime input", () => {
    expect(() => planClassStartDraw(null as unknown as ClassStartDrawInput)).toThrowError(ClassStartDrawError);
    expect(() => planClassStartDraw({ ...input(), entryIds: "not-an-array" } as unknown as ClassStartDrawInput))
      .toThrowError(ClassStartDrawError);
  });
});
