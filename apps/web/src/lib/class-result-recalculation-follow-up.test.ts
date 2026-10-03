import { describe, expect, it } from "vitest";
import type { ResultRecalculationCandidates } from "./result-recalculation-admin-client";
import { projectClassResultRecalculationFollowUp } from "./class-result-recalculation-follow-up";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const otherClassId = "30000000-0000-4000-8000-000000000003";

function entry(id: string, name: string, selectedClassId: string, resultSnapshotVersion: number | null) {
  return {
    id, displayName: name, organisationName: null, classId: selectedClassId, className: "Testklass",
    entryVersion: 2, readiness: "READY" as const,
    cardAssignmentId: "40000000-0000-4000-8000-000000000004",
    latestReadout: { id: "50000000-0000-4000-8000-000000000005", readAt: "2026-09-18T08:00:00.000Z" },
    latestResultRevision: resultSnapshotVersion === null ? null : {
      id: `60000000-0000-4000-8000-00000000000${resultSnapshotVersion}`,
      revision: 1, status: "OK" as const, reason: "COMPLETE" as const,
      cause: "CARD_READOUT" as const, createdAt: "2026-09-18T08:01:00.000Z", snapshotVersion: resultSnapshotVersion,
      // ADR-0169: aktualiteten kommer från servern; här står versionen 2 för aktuellt underlag.
      current: resultSnapshotVersion === 2
    }
  };
}

describe("TASK068 klassbegränsad omräkningsuppföljning", () => {
  it("visar endast klassens resultat från en äldre snapshot i stabil namnordning", () => {
    const candidates: ResultRecalculationCandidates = {
      formatVersion: 1, raceId, snapshotVersion: 2, engineVersion: "1.0.0",
      entries: [
        entry("70000000-0000-4000-8000-000000000007", "Östen", classId, 1),
        entry("80000000-0000-4000-8000-000000000008", "Ada", classId, 1),
        entry("90000000-0000-4000-8000-000000000009", "Aktuell", classId, 2),
        entry("a0000000-0000-4000-8000-000000000010", "Utan resultat", classId, null),
        entry("b0000000-0000-4000-8000-000000000011", "Annan klass", otherClassId, 1)
      ]
    };

    expect(projectClassResultRecalculationFollowUp(candidates, classId).map(row => row.displayName))
      .toEqual(["Ada", "Östen"]);
  });
});
