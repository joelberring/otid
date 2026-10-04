import { describe, expect, it } from "vitest";
import { classTableStatus } from "./class-table-status";

describe("klasstabellens status", () => {
  it("visar det som behöver göras först", () => {
    expect(classTableStatus({ entryCount: 0, readOutCount: 0, missingStartTimeCount: 0 })).toEqual({ kind: "NO_ENTRIES" });
    expect(classTableStatus({ entryCount: 3, readOutCount: 1, missingStartTimeCount: 2 })).toEqual({ kind: "MISSING_START_TIMES", count: 2 });
    expect(classTableStatus({ entryCount: 3, readOutCount: 0, missingStartTimeCount: 0 })).toEqual({ kind: "READY" });
    expect(classTableStatus({ entryCount: 3, readOutCount: 1, missingStartTimeCount: 0 })).toEqual({ kind: "WAITING", count: 2 });
    expect(classTableStatus({ entryCount: 3, readOutCount: 3, missingStartTimeCount: 0 })).toEqual({ kind: "ALL_READ_OUT" });
  });
});
