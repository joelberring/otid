import { describe, expect, it } from "vitest";
import {
  didNotStartResultSchema,
  didNotFinishResultSchema,
  disqualifiedResultSchema,
  evaluationResultSchema,
  manualApprovedResultSchema,
  outOfCompetitionResultSchema,
  resultOutcomeV4Schema,
  resultOutcomeV6Schema,
  resultOutcomeV7Schema,
  resultOutcomeV8Schema,
  resultOutcomeSchema,
  withoutTimingResultSchema
} from "../src";

const dns = {
  status: "DNS" as const,
  reason: "DID_NOT_START" as const,
  entryId: "10000000-0000-4000-8000-000000000001",
  classId: "20000000-0000-4000-8000-000000000002",
  courseVersionId: "30000000-0000-4000-8000-000000000003"
};

describe("lagrad ResultOutcome", () => {
  it("accepterar DNS endast som separat strikt lagrad utgång", () => {
    expect(didNotStartResultSchema.parse(dns)).toEqual(dns);
    expect(resultOutcomeSchema.parse(dns)).toEqual(dns);
    expect(evaluationResultSchema.safeParse(dns).success).toBe(false);
  });

  it.each([
    ["tid", { startTime: "2026-08-31T12:00:00.000Z" }],
    ["sluttid", { elapsedMs: 1 }],
    ["splits", { splits: [] }],
    ["fel status", { status: "MP" }]
  ])("avvisar DNS med %s", (_name, mutation) => {
    expect(didNotStartResultSchema.safeParse({ ...dns, ...mutation }).success).toBe(false);
  });
});

describe("lagrat manuellt DNF", () => {
  const dnf = {
    status: "DNF" as const,
    reason: "DID_NOT_FINISH" as const,
    entryId: dns.entryId,
    classId: dns.classId,
    courseVersionId: dns.courseVersionId
  };

  it("är status-only och aldrig en stationsevaluation", () => {
    expect(didNotFinishResultSchema.parse(dnf)).toEqual(dnf);
    expect(resultOutcomeSchema.parse(dnf)).toEqual(dnf);
    expect(evaluationResultSchema.safeParse(dnf).success).toBe(false);
  });

  it.each([
    { startTime: "2026-09-01T10:00:00.000Z" },
    { finishTime: "2026-09-01T10:01:00.000Z" },
    { elapsedMs: 1 },
    { missingControls: [] },
    { extraPunches: [] },
    { splits: [] },
    { status: "MP" }
  ])("avvisar DNF med tider eller kontrollfakta", (mutation) => {
    expect(didNotFinishResultSchema.safeParse({ ...dnf, ...mutation }).success).toBe(false);
  });
});

describe("lagrat manuellt utan tidtagning", () => {
  const withoutTiming = {
    status: "NT" as const,
    reason: "WITHOUT_TIMING" as const,
    entryId: dns.entryId,
    classId: dns.classId,
    courseVersionId: dns.courseVersionId
  };

  it("är strikt status-only i format 7 och håller äldre format frysta", () => {
    expect(withoutTimingResultSchema.parse(withoutTiming)).toEqual(withoutTiming);
    expect(resultOutcomeV7Schema.parse(withoutTiming)).toEqual(withoutTiming);
    expect(resultOutcomeV8Schema.parse(withoutTiming)).toEqual(withoutTiming);
    expect(resultOutcomeV6Schema.safeParse(withoutTiming).success).toBe(false);
    expect(evaluationResultSchema.safeParse(withoutTiming).success).toBe(false);
  });

  it.each([{ elapsedMs: 1 }, { splits: [] }, { missingControls: [] }, { extraPunches: [] }, { startTime: "2026-09-01T10:00:00.000Z" }])(
    "avvisar NT med tekniska fakta", (mutation) => {
      expect(withoutTimingResultSchema.safeParse({ ...withoutTiming, ...mutation }).success).toBe(false);
    });
});

describe("lagrat manuellt godkännande", () => {
  const approved = {
    status: "OK" as const,
    reason: "MANUAL_APPROVAL" as const,
    entryId: dns.entryId,
    classId: dns.classId,
    courseVersionId: dns.courseVersionId,
    startTime: "2026-08-31T12:00:00.000Z",
    finishTime: "2026-08-31T12:01:00.000Z",
    elapsedMs: 60_000,
    missingControls: [45],
    extraPunches: [99],
    splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
  };

  it("är stored-only och bevarar tids- och kontrollfakta", () => {
    expect(manualApprovedResultSchema.parse(approved)).toEqual(approved);
    expect(resultOutcomeSchema.parse(approved)).toEqual(approved);
    expect(evaluationResultSchema.safeParse(approved).success).toBe(false);
  });

  it.each([
    { ...approved, status: "MP" },
    { ...approved, reason: "COMPLETE" },
    { ...approved, finishTime: "2026-08-31T12:02:00.000Z" },
    { ...approved, splits: [{ ...approved.splits[0], elapsedMs: 70_000 }] },
    { ...approved, proof: "inte lagrad här" }
  ])("avvisar ändrade fakta eller okända fält", (invalid) => {
    expect(manualApprovedResultSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("lagrad manuell diskvalifikation", () => {
  const timed = {
    status: "DSQ" as const,
    reason: "MANUAL_DISQUALIFICATION" as const,
    entryId: dns.entryId,
    classId: dns.classId,
    courseVersionId: dns.courseVersionId,
    startTime: "2026-08-31T12:00:00.000Z",
    finishTime: "2026-08-31T12:01:00.000Z",
    elapsedMs: 60_000,
    missingControls: [45],
    extraPunches: [99],
    splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
  };

  it("accepterar bevarade source facts endast i lagrad ResultOutcome", () => {
    expect(disqualifiedResultSchema.parse(timed)).toEqual(timed);
    expect(resultOutcomeSchema.parse(timed)).toEqual(timed);
    expect(evaluationResultSchema.safeParse(timed).success).toBe(false);
  });

  it.each([
    { ...timed, status: "MP" },
    { ...timed, reason: "COMPLETE" },
    { ...timed, entryId: "not-a-uuid" },
    { ...timed, secret: "får inte läcka" }
  ])("avvisar status/reason/identitet och okända fält", (invalid) => {
    expect(disqualifiedResultSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("lagrat manuellt OOC", () => {
  const timed = {
    status: "OOC" as const,
    reason: "OUT_OF_COMPETITION" as const,
    entryId: dns.entryId,
    classId: dns.classId,
    courseVersionId: dns.courseVersionId,
    startTime: "2026-08-31T12:00:00.000Z",
    finishTime: "2026-08-31T12:01:00.000Z",
    elapsedMs: 60_000,
    missingControls: [45],
    extraPunches: [99],
    splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 30_000, legMs: 30_000 }]
  };
  const timeLess = {
    status: "OOC" as const,
    reason: "OUT_OF_COMPETITION" as const,
    entryId: dns.entryId,
    classId: dns.classId,
    courseVersionId: dns.courseVersionId,
    missingControls: [],
    extraPunches: [],
    splits: []
  };

  it("bevarar strikt teknisk fakta stored-only i format 5", () => {
    expect(outOfCompetitionResultSchema.parse(timed)).toEqual(timed);
    expect(outOfCompetitionResultSchema.parse(timeLess)).toEqual(timeLess);
    expect(resultOutcomeSchema.parse(timed)).toEqual(timed);
    expect(evaluationResultSchema.safeParse(timed).success).toBe(false);
    expect(resultOutcomeV4Schema.safeParse(timed).success).toBe(false);
  });

  it.each([
    { ...timed, status: "OK" },
    { ...timed, reason: "COMPLETE" },
    { ...timed, elapsedMs: 59_999 },
    { ...timed, secret: "får inte läcka" },
    { ...timeLess, missingControls: [31] },
    { ...timeLess, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 1, legMs: 1 }] }
  ])("avvisar motsägande status, fakta eller okända fält", (invalid) => {
    expect(outOfCompetitionResultSchema.safeParse(invalid).success).toBe(false);
  });
});
