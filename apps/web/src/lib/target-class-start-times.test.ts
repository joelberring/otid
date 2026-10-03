import { describe, expect, it } from "vitest";
import { projectTargetClassStartTimes } from "./target-class-start-times";

const entry = (id: string, fixedStartTime: string | null, classId = "target") =>
  ({ id, fixedStartTime, classId, displayName: `Person ${id}` });

describe("målklassens tilldelade tider", () => {
  it("väljer endast målklassen, räknar null och ändrar inte underlaget", () => {
    const rows = Object.freeze([Object.freeze(entry("1", null)), Object.freeze(entry("2", "2026-09-12T10:00:00Z")),
      Object.freeze(entry("3", "2026-09-12T10:00:00Z", "other")), Object.freeze(entry("4", null, "other"))]);
    expect(projectTargetClassStartTimes(rows, "target", null)).toEqual({
      rows: [{ id: "2", displayName: "Person 2", fixedStartTime: "2026-09-12T10:00:00Z" }],
      missingRows: [{ id: "1", displayName: "Person 1" }], missingTimeCount: 1, matchingTimeCount: 0
    });
    expect(rows.map(row => row.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("sorterar tidsögonblick över offset/dygn och har stabil ordning vid lika tid", () => {
    const result = projectTargetClassStartTimes([
      entry("b", "2026-09-12T00:30:00+02:00"), entry("a", "2026-09-11T22:30:00Z"),
      entry("later", "2026-09-11T23:00:00Z"), entry("early", "2026-09-12T00:00:00+03:00")
    ], "target", "2026-09-11T23:30:00+01:00");
    expect(result.rows.map(row => row.id)).toEqual(["early", "a", "b", "later"]);
    expect(result.matchingTimeCount).toBe(2);
  });

  it("jämför millisekunder exakt, inte närmaste minut eller lokal klocktext", () => {
    const rows = [entry("summer", "2026-10-25T02:30:00.125+02:00"), entry("winter", "2026-10-25T02:30:00.125+01:00")];
    expect(projectTargetClassStartTimes(rows, "target", "2026-10-25T00:30:00.125Z").matchingTimeCount).toBe(1);
    expect(projectTargetClassStartTimes(rows, "target", "2026-10-25T00:30:00.126Z").matchingTimeCount).toBe(0);
  });

  it("bevarar alla rader för UI-sidor och redovisar ärligt tom/null-only klass", () => {
    const rows = Array.from({ length: 45 }, (_, index) => entry(String(index), "2026-09-12T10:00:00Z"));
    expect(projectTargetClassStartTimes(rows, "target", null).rows).toHaveLength(45);
    expect(projectTargetClassStartTimes(rows, "other", null)).toEqual({ rows: [], missingRows: [], missingTimeCount: 0, matchingTimeCount: 0 });
    expect(projectTargetClassStartTimes([entry("missing", null)], "target", null))
      .toEqual({ rows: [], missingRows: [{ id: "missing", displayName: "Person missing" }], missingTimeCount: 1, matchingTimeCount: 0 });
  });

  it("TASK066 sorterar deltagare utan tid på svenskt namn och stabilt id", () => {
    const rows = [
      { ...entry("z", null), displayName: "Östen" },
      { ...entry("b", null), displayName: "Åsa" },
      { ...entry("a", null), displayName: "Åsa" },
      { ...entry("fixed", "2026-09-12T10:00:00Z"), displayName: "Aina" },
      { ...entry("other", null, "other"), displayName: "Anna" }
    ];
    expect(projectTargetClassStartTimes(rows, "target", null).missingRows).toEqual([
      { id: "a", displayName: "Åsa" }, { id: "b", displayName: "Åsa" }, { id: "z", displayName: "Östen" }
    ]);
  });
});
