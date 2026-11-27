import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { storedRosterResultStatus } from "../src/start-checkin-roster";
import { StoredResultRevisionConflict, type StoredResultRevisionInput } from "../src/stored-result-revision";
import { fixture } from "./fixtures/start-checkin-dns";

type Eval = StoredResultRevisionInput["evaluation"];
const asEval = (value: unknown) => value as Eval;

const ids = () => ({
  id: randomUUID(),
  raceId: randomUUID(),
  entryId: randomUUID(),
  classId: randomUUID(),
  courseVersionId: randomUUID(),
  readoutId: randomUUID()
});

function baseRow(overrides: Partial<StoredResultRevisionInput> = {}): StoredResultRevisionInput {
  const id = ids();
  return {
    id: id.id,
    raceId: id.raceId,
    entryId: id.entryId,
    revision: 1,
    status: "OK",
    reason: "COMPLETE",
    cause: "CARD_READOUT",
    readoutId: id.readoutId,
    startCheckinDnsDecisionId: null,
    shortenedCourseClassTransferId: null,
    evaluation: asEval({
      status: "OK",
      reason: "COMPLETE",
      entryId: id.entryId,
      classId: id.classId,
      courseVersionId: id.courseVersionId
    }),
    engineVersion: "1",
    snapshotVersion: 1,
    courseVersionId: id.courseVersionId,
    published: true,
    createdAt: new Date("2026-09-05T10:00:00.000Z"),
    ...overrides
  };
}

describe("start-checkin-roster lättvikts-DNS/status-extraktion", () => {
  it("läser ut status för kompakt SQL-projektion utan full Zod-parsning av sträcktider", () => {
    const okRow = baseRow();
    expect(storedRosterResultStatus(okRow)).toBe("OK");
    const classId = (okRow.evaluation as unknown as { classId: string }).classId;

    const manualDns = baseRow({
      status: "DNS",
      reason: "DID_NOT_START",
      cause: "MANUAL_DID_NOT_START",
      readoutId: null,
      evaluation: asEval({
        status: "DNS",
        reason: "DID_NOT_START",
        entryId: okRow.entryId,
        classId,
        courseVersionId: okRow.courseVersionId
      }),
      entryId: okRow.entryId,
      courseVersionId: okRow.courseVersionId
    });
    expect(storedRosterResultStatus(manualDns)).toBe("DNS");

    const dnfRow = baseRow({
      status: "DNF",
      reason: "DID_NOT_FINISH",
      cause: "MANUAL_DID_NOT_FINISH",
      readoutId: null,
      evaluation: asEval({
        status: "DNF",
        reason: "DID_NOT_FINISH",
        entryId: okRow.entryId,
        classId,
        courseVersionId: okRow.courseVersionId
      }),
      entryId: okRow.entryId,
      courseVersionId: okRow.courseVersionId
    });
    expect(storedRosterResultStatus(dnfRow)).toBe("DNF");
  });

  it("kräver full källvalidering för START_CHECKIN_DID_NOT_START", () => {
    const source = fixture();
    expect(storedRosterResultStatus(source.result, source)).toBe("DNS");
    expect(() => storedRosterResultStatus(source.result)).toThrow(StoredResultRevisionConflict);
  });

  it("avvisar motsägande eller manipulerad evaluation och orsak/utfall-kombination", () => {
    const ok = baseRow();
    const evalBase = ok.evaluation as unknown as Record<string, unknown>;
    const badRows: StoredResultRevisionInput[] = [
      { ...ok, evaluation: asEval({ ...evalBase, status: "DNS" }) },
      { ...ok, evaluation: asEval({ ...evalBase, status: "UNKNOWN_CARD" }) },
      { ...ok, evaluation: asEval({ ...evalBase, reason: "MANUAL_APPROVAL" }) },
      { ...ok, evaluation: asEval({ ...evalBase, entryId: randomUUID() }) },
      { ...ok, evaluation: asEval({ ...evalBase, classId: "inte-uuid" }) },
      { ...ok, evaluation: asEval({ ...evalBase, courseVersionId: randomUUID() }) },
      { ...ok, evaluation: asEval([]) },
      { ...ok, readoutId: null },
      { ...ok, revision: 0 },
      { ...ok, status: "OK", reason: "MANUAL_APPROVAL", evaluation: asEval({ ...evalBase, reason: "MANUAL_APPROVAL" }) }
    ];
    for (const row of badRows) {
      expect(() => storedRosterResultStatus(row)).toThrow(StoredResultRevisionConflict);
    }
  });
});
