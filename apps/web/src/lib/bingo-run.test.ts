import { describe, expect, it } from "vitest";
import { bingoProgressRequestSchema } from "@o-tid/contracts";
import { bingoProgressRequest, formatBingoDistance, formatBingoGap, formatBingoTime, newBingoRun, parseStoredBingoRun } from "./bingo-run";
import { parseShips } from "./bingo-setup";

const runner = "10000000-0000-4000-8000-000000000001";
const start = Date.UTC(2026, 10, 17, 17, 0);

describe("bingo i telefonen", () => {
  it("loppet sparas och läses tillbaka; fel form ger inget", () => {
    const run = { ...newBingoRun("Lisa", "1", start, runner, 77), shots: [{ cell: "A1", at: start + 1000, x: 1.234, y: 5.678, accuracyM: 7.25 }] };
    expect(parseStoredBingoRun(JSON.stringify(run))).toEqual(run);
    expect(parseStoredBingoRun("{")).toBeUndefined();
    expect(parseStoredBingoRun(JSON.stringify({ ...run, formatVersion: 2 }))).toBeUndefined();
    const request = bingoProgressRequest(run);
    expect(bingoProgressRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ seed: 77, shots: [{ cell: "A1", x: 1.23, y: 5.68, accuracyM: 7.3 }], status: "RUNNING" });
    expect(bingoProgressRequest(newBingoRun("Lisa", "1", start, runner))).not.toHaveProperty("seed");
  });

  it("appens senast räknade punkt sparas i loppet; äldre lopp utan den läses som förut och en trasig tas bort", () => {
    const run = { ...newBingoRun("Lisa", "1", start, runner), lastSeq: 42 };
    expect(parseStoredBingoRun(JSON.stringify(run))).toEqual(run);
    expect(parseStoredBingoRun(JSON.stringify(newBingoRun("Lisa", "1", start, runner)))).not.toHaveProperty("lastSeq");
    expect(parseStoredBingoRun(JSON.stringify({ ...run, lastSeq: "42" }))?.lastSeq).toBeUndefined();
    expect(bingoProgressRequest(run)).not.toHaveProperty("lastSeq");
  });

  it("tid, sträcka, glapp och skeppens längder som text", () => {
    expect(formatBingoTime(65)).toBe("1:05");
    expect(formatBingoTime(3725)).toBe("1:02:05");
    expect(formatBingoDistance(845)).toBe("845 m");
    expect(formatBingoDistance(2345)).toBe("2,3 km");
    expect(formatBingoGap([start + 723_000, start + 880_000], start)).toBe("12:03–14:40");
    expect(parseShips("4, 3 3;2")).toEqual([4, 3, 3, 2]);
    expect(parseShips(" ")).toBeNull();
    expect(parseShips("7")).toBeUndefined();
  });
});
