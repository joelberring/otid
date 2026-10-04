import { describe, expect, it } from "vitest";
import { courseEditOutcome, evaluateCardReadout, sameControlCodes, summarizeCourseEdit, withProposedCourseVersion,
  type NormalizedCardReadout, type RaceSnapshot } from "../src";

const ids = {
  race: "00000000-0000-4000-8000-000000000001",
  class: "00000000-0000-4000-8000-000000000002",
  course: "00000000-0000-4000-8000-000000000003",
  version: "00000000-0000-4000-8000-000000000004",
  entry: "00000000-0000-4000-8000-000000000005",
  proposed: "00000000-0000-4000-8000-000000000006",
  otherClass: "00000000-0000-4000-8000-000000000007",
  otherVersion: "00000000-0000-4000-8000-000000000008"
};

function snapshot(): RaceSnapshot {
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-08-30", snapshotVersion: 1 },
    classes: [
      { id: ids.class, raceId: ids.race, name: "H21", courseVersionId: ids.version, startRule: "PUNCH" },
      { id: ids.otherClass, raceId: ids.race, name: "D21", courseVersionId: ids.otherVersion, startRule: "PUNCH" }
    ],
    courses: [{
      id: ids.course, raceId: ids.race, name: "Lång",
      versions: [{ id: ids.version, courseId: ids.course, version: 1, createdAt: "2026-08-30T08:00:00Z",
        controls: [31, 32, 33].map((code, index) => ({ id: `cc-${index}`, courseVersionId: ids.version,
          controlId: `control-${code}`, sequence: index + 1, controlCode: code })) }]
    }, {
      id: "other-course", raceId: ids.race, name: "Kort",
      versions: [{ id: ids.otherVersion, courseId: "other-course", version: 1, createdAt: "2026-08-30T08:00:00Z", controls: [] }]
    }],
    entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Ada", familyName: "Löpare" }],
    cardAssignments: [{ id: "card", raceId: ids.race, entryId: ids.entry, cardNumber: "12345", active: true }],
    classControlNeutralizations: [{ id: "n", classId: ids.class, courseVersionId: ids.version, courseControlId: "cc-1",
      sequence: 2, controlCode: 32 }]
  };
}

const readout: NormalizedCardReadout = {
  id: "readout", raceId: ids.race, cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:00Z",
  finishPunchedAt: "2026-08-30T10:40:00Z", rawMessageId: "raw", readAt: "2026-08-30T10:41:00Z",
  punches: [{ code: 31, punchedAt: "2026-08-30T10:10:00Z" }, { code: 33, punchedAt: "2026-08-30T10:20:00Z" }]
};

describe("Redigera bana", () => {
  it("prövar avläsningen mot den föreslagna kontrollföljden för klasser på banan", () => {
    const current = snapshot();
    expect(evaluateCardReadout(readout, { ...current, classControlNeutralizations: [] }).status).toBe("MP");
    const removed = withProposedCourseVersion(current, ids.course, ids.version,
      { id: ids.proposed, version: 2, createdAt: "2026-08-30T11:00:00Z", controlCodes: [31, 33] });
    const evaluation = evaluateCardReadout(readout, removed);
    expect(evaluation).toMatchObject({ status: "OK", courseVersionId: ids.proposed });
    expect(removed.classes.find(row => row.id === ids.otherClass)?.courseVersionId).toBe(ids.otherVersion);
    expect(removed.courses[0]?.versions[1]?.controls.map(row => row.controlId)).toEqual(["control-31", "control-33"]);
    // Ursprunget ändras inte.
    expect(current.classes[0]?.courseVersionId).toBe(ids.version);
  });

  it("strukna kontroller på den gamla versionen följer inte med", () => {
    const current = snapshot();
    expect(evaluateCardReadout(readout, current).status).toBe("OK");
    const same = withProposedCourseVersion(current, ids.course, ids.version,
      { id: ids.proposed, version: 2, createdAt: "2026-08-30T11:00:00Z", controlCodes: [31, 32, 33, 34] });
    expect(evaluateCardReadout(readout, same)).toMatchObject({ status: "MP", missingControls: [32, 34] });
  });

  it("klassar utfall och räknar dem", () => {
    expect(courseEditOutcome("MP", "OK", false)).toBe("BECOMES_OK");
    expect(courseEditOutcome("OK", "MP", false)).toBe("BECOMES_MISPUNCHED");
    expect(courseEditOutcome("OK", "OK", false)).toBe("UNCHANGED");
    expect(courseEditOutcome("MP", "OK", true)).toBe("UNCHANGED");
    expect(summarizeCourseEdit(["BECOMES_OK", "UNCHANGED", "BECOMES_OK", "BECOMES_MISPUNCHED"]))
      .toEqual({ becomesOkCount: 2, becomesMispunchedCount: 1, unchangedCount: 1 });
    expect(sameControlCodes([31, 32], [31, 32])).toBe(true);
    expect(sameControlCodes([31, 32], [32, 31])).toBe(false);
  });
});
