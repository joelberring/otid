import { describe, expect, it } from "vitest";
import { evaluateCardReadout, withProposedClassSetup, type NormalizedCardReadout, type RaceSnapshot } from "../src";

const ids = {
  race: "00000000-0000-4000-8000-000000000001",
  class: "00000000-0000-4000-8000-000000000002",
  long: "00000000-0000-4000-8000-000000000003",
  short: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005",
  other: "00000000-0000-4000-8000-000000000006"
};

const version = (id: string, codes: number[]) => ({ id, courseId: `${id}-course`, version: 1, createdAt: "2026-08-30T08:00:00Z",
  controls: codes.map((code, index) => ({ id: `${id}-${index}`, courseVersionId: id, controlId: `control-${code}`,
    sequence: index + 1, controlCode: code })) });

function snapshot(): RaceSnapshot {
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-08-30", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "H21", courseVersionId: ids.long, startRule: "FIXED" },
      { id: ids.other, raceId: ids.race, name: "D21", courseVersionId: ids.long, startRule: "FIXED" }],
    courses: [{ id: `${ids.long}-course`, raceId: ids.race, name: "Lång", versions: [version(ids.long, [31, 32, 33])] },
      { id: `${ids.short}-course`, raceId: ids.race, name: "Kort", versions: [version(ids.short, [31, 33])] }],
    entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Ada", familyName: "Löpare",
      fixedStartTime: "2026-08-30T10:00:00Z" },
    { id: "other-entry", raceId: ids.race, classId: ids.other, givenName: "Bo", familyName: "Löpare",
      fixedStartTime: "2026-08-30T10:01:00Z" }],
    cardAssignments: [{ id: "card", raceId: ids.race, entryId: ids.entry, cardNumber: "12345", active: true }],
    classControlNeutralizations: []
  };
}

const readout: NormalizedCardReadout = {
  id: "readout", raceId: ids.race, cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:05Z",
  finishPunchedAt: "2026-08-30T10:40:00Z", rawMessageId: "raw", readAt: "2026-08-30T10:41:00Z",
  punches: [{ code: 31, punchedAt: "2026-08-30T10:10:00Z" }, { code: 33, punchedAt: "2026-08-30T10:30:00Z" }]
};

describe("withProposedClassSetup", () => {
  it("flyttar bara den valda klassen till den nya banan", () => {
    const current = snapshot();
    expect(evaluateCardReadout(readout, current).status).toBe("MP");
    const proposed = withProposedClassSetup(current, { classId: ids.class, courseVersionId: ids.short, startRule: "FIXED" });
    expect(evaluateCardReadout(readout, proposed)).toMatchObject({ status: "OK", courseVersionId: ids.short });
    expect(proposed.classes.find(row => row.id === ids.other)?.courseVersionId).toBe(ids.long);
    expect(proposed.entries[0]?.fixedStartTime).toBe("2026-08-30T10:00:00Z");
    expect(current.classes[0]?.courseVersionId).toBe(ids.long);
  });

  it("byte av startsätt tömmer klassens fasta starttider och ger stämplad start", () => {
    const proposed = withProposedClassSetup(snapshot(), { classId: ids.class, courseVersionId: ids.short, startRule: "PUNCH" });
    expect(proposed.entries.find(row => row.id === ids.entry)?.fixedStartTime).toBeUndefined();
    expect(proposed.entries.find(row => row.id === "other-entry")?.fixedStartTime).toBe("2026-08-30T10:01:00Z");
    expect(evaluateCardReadout(readout, proposed)).toMatchObject({ status: "OK", startTime: "2026-08-30T10:00:05Z" });
  });

  it("avvisar okänd klass eller bana", () => {
    expect(() => withProposedClassSetup(snapshot(), { classId: "x", courseVersionId: ids.short, startRule: "PUNCH" })).toThrow();
    expect(() => withProposedClassSetup(snapshot(), { classId: ids.class, courseVersionId: "x", startRule: "PUNCH" })).toThrow();
  });
});
