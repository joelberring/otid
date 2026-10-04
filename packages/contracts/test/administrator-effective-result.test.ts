import { describe, expect, it } from "vitest";
import { administratorEffectiveResultResponseSchema as schema } from "../src/administrator-effective-result";
const id = "10000000-0000-4000-8000-000000000001";
const common = { formatVersion: 1, raceId: id, entryId: id, history: [], entryVersion: 1, currentClassId: id,
  snapshotVersion: 3, generatedAt: "2026-09-12T12:00:00.000Z", timeZone: "Europe/Stockholm" };
const active = { ...common, state: "ACTIVE_RESULT", selectedRevision: { id, revision: 4 },
  result: { revision: 2, status: "DSQ", reason: "MANUAL_DISQUALIFICATION" },
  resultClass: { id, name: "Testklass" }, resultSnapshotVersion: 1, resultCurrent: true, governingDecision: "DSQ" };
describe("TASK033 effective result projection", () => {
  it("separates absent, withdrawn and governing older published result", () => {
    expect(schema.safeParse({ ...common, state: "NO_PUBLISHED_RESULT", selectedRevision: null }).success).toBe(true);
    expect(schema.safeParse({ ...common, state: "NO_ACTIVE_RESULT", selectedRevision: { id, revision: 2 } }).success).toBe(true);
    expect(schema.safeParse(active).success).toBe(true);
    for (const patch of [{ governingDecision: "NONE" }, { resultSnapshotVersion: 4 }, { selectedRevision: { id, revision: 1 } },
      { raw: "private" }, { state: "NO_ACTIVE_RESULT" }]) expect(schema.safeParse({ ...active, ...patch }).success).toBe(false);
  });
  it("carries a short result history in words-ready form", () => {
    const history = [{ revision: 2, cause: "MANUAL_DISQUALIFICATION", status: "DSQ", at: "2026-09-12T12:00:00.000Z" },
      { revision: 1, cause: "CARD_READOUT", status: "OK", at: "2026-09-12T11:00:00.000Z" }];
    expect(schema.safeParse({ ...active, history }).success).toBe(true);
    expect(schema.safeParse({ ...active, history: [{ ...history[0], status: "UNKNOWN" }] }).success).toBe(false);
    expect(schema.safeParse({ ...active, history: Array.from({ length: 11 }, () => history[1]) }).success).toBe(false);
  });
  it("does not expose a time for NT or confuse checkin DNS with a technical result", () => {
    const nt = { ...active, result: { revision: 2, status: "NT", reason: "WITHOUT_TIMING" }, governingDecision: "NT" };
    expect(schema.safeParse(nt).success).toBe(true);
    expect(schema.safeParse({ ...nt, result: { ...nt.result, elapsedMs: 0 } }).success).toBe(false);
    const dns = { ...active, result: { revision: 2, status: "DNS", reason: "DID_NOT_START" }, governingDecision: "CHECKIN_DNS" };
    expect(schema.safeParse(dns).success).toBe(true);
    expect(schema.safeParse({ ...dns, governingDecision: "NONE" }).success).toBe(false);
  });
  it("accepts ordered repeated controls with absent splits, but rejects technical details for status-only results", () => {
    const detail = { courseName: "Bana A", courseVersionId: id, startTime: "2026-09-12T10:00:00.000Z",
      finishTime: null, controls: [
        { sequence: 1, controlCode: 31, occurrence: 1, elapsedMs: 1000, legMs: 1000 },
        { sequence: 2, controlCode: 31, occurrence: 2, elapsedMs: null, legMs: null }
      ], missingControls: [], extraPunches: [] };
    expect(schema.safeParse({ ...active, controlDetails: detail }).success).toBe(true);
    expect(schema.safeParse({ ...active, controlDetails: { ...detail, controls: [detail.controls[0],
      { ...detail.controls[1], occurrence: 1 }] } }).success).toBe(false);
    expect(schema.safeParse({ ...active, controlDetails: { ...detail, controls: [detail.controls[0],
      { ...detail.controls[1], legMs: 0 }] } }).success).toBe(false);
    expect(schema.safeParse({ ...active, controlDetails: { ...detail, raw: "private" } }).success).toBe(false);
    expect(schema.safeParse({ ...active, result: { revision: 2, status: "DNF", reason: "DID_NOT_FINISH" },
      governingDecision: "DNF", controlDetails: detail }).success).toBe(false);
  });
});
