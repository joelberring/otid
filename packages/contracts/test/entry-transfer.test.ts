import { describe, expect, it } from "vitest";
import { entryTransferRequestSchema, entryTransferResponseSchema, entryTransferCandidatesSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001", target = "10000000-0000-4000-8000-000000000002";
const request = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: id, expectedSnapshotVersion: 3,
  expectedFixedStartTime: null, targetClassId: target, expectedTargetCourseVersionId: id,
  expectedTargetStartRule: "FIXED", fixedStartTime: "2026-09-12T12:30:00+02:00" };

describe("TASK029 atomiskt klass-/startbyteskontrakt", () => {
  it("binder startregel till explicit tid utan att gissa tidszon eller klassnamn", () => {
    expect(entryTransferRequestSchema.parse(request).fixedStartTime).toBe("2026-09-12T10:30:00.000Z");
    expect(entryTransferRequestSchema.safeParse({ ...request, expectedTargetStartRule: "PUNCH", fixedStartTime: null }).success).toBe(true);
    for (const change of [{ fixedStartTime: null }, { expectedTargetStartRule: "PUNCH" },
      { fixedStartTime: "2026-09-12T12:30:00" }, { targetClassId: id }, { expectedEntryVersion: 2147483648 },
      { resultStatus: "OK" }]) expect(entryTransferRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
  });
  it("binder kvittensens båda versioner till sparat intent", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id, entryId: id, request,
      entryVersionAfter: 2, snapshotVersionAfter: 4, changedAt: "2026-09-12T12:00:00Z" };
    expect(entryTransferResponseSchema.safeParse(response).success).toBe(true);
    expect(entryTransferResponseSchema.safeParse({ ...response, snapshotVersionAfter: 5 }).success).toBe(false);
    expect(entryTransferResponseSchema.safeParse({ ...response, entryVersionAfter: 1 }).success).toBe(false);
  });
  it("kräver kompletta unika klassrelationer i tidszonsbundet underlag", () => {
    const raceClass = { id, name: "Öppen", courseVersionId: id, courseName: "Utan kontroller", courseVersion: 101,
      startRule: "FIXED", maxEntries: null, capacityVersion: 1, entryCount: 1, startDrawn: false, courseVariants: [] };
    const entry = { id, displayName: "Ada Test", organisationName: null, classId: id, version: 1,
      paymentStatus: "UNMARKED", paymentStatusVersion: 1, fixedStartTime: null, courseVariantCode: null,
      resultFreshness: "NO_PUBLISHED_RESULT", effectiveResult: { state: "NO_PUBLISHED_RESULT", selectedRevision: null },
      resultRevisionMarker: null, activeAssignment: null, multipleActiveAssignments: false };
    const value = { formatVersion: 2, raceId: id, eventName: "Skärgårdshelgen", raceName: "Lång",
      snapshotVersion: 1, raceDate: "2026-09-12", raceType: "STANDARD", generatedAt: "2026-09-12T08:00:00Z",
      timeZone: "Europe/Stockholm", classes: [raceClass], entries: [entry] };
    expect(entryTransferCandidatesSchema.safeParse(value).success).toBe(true);
    expect(entryTransferCandidatesSchema.safeParse({ ...value, formatVersion: 1 }).success).toBe(false);
    const manyClasses = Array.from({ length: 101 }, (_, index) => ({ ...raceClass,
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      courseVersionId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      courseVersion: index + 1, entryCount: 0 }));
    expect(entryTransferCandidatesSchema.safeParse({ ...value, classes: manyClasses, entries: [] }).success).toBe(true);
    for (const badClass of [{ ...raceClass, courseName: "" }, { ...raceClass, courseName: "x".repeat(161) },
      { ...raceClass, courseVersion: 0 }, { ...raceClass, courseVersion: 2_147_483_648 },
      { ...raceClass, courseName: undefined }, { ...raceClass, courseVersion: undefined }]) {
      expect(entryTransferCandidatesSchema.safeParse({ ...value, classes: [badClass] }).success).toBe(false);
    }
    expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry,
      activeAssignment: { id, cardNumber: "123456", isRental: false, rentalReturned: false }, multipleActiveAssignments: true }] }).success).toBe(false);
    expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry,
      activeAssignment: { id, cardNumber: "123456", isRental: true, rentalReturned: false } }] }).success).toBe(true);
    expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry,
      activeAssignment: { id, cardNumber: "123456" } }] }).success).toBe(false);
    const selectedRevision = { id, revision: 2 };
    const active = { state: "ACTIVE_RESULT", selectedRevision, resultSnapshotVersion: 1,
      result: { revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 120_000 } };
    for (const [resultFreshness, effectiveResult] of [
      ["NO_PUBLISHED_RESULT", entry.effectiveResult],
      ["NO_ACTIVE_RESULT", { state: "NO_ACTIVE_RESULT", selectedRevision }],
      ["CURRENT_SNAPSHOT", active],
    ] as const) expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry,
      resultFreshness, effectiveResult }] }).success).toBe(true);
    expect(entryTransferCandidatesSchema.safeParse({ ...value, snapshotVersion: 2,
      entries: [{ ...entry, resultFreshness: "OLDER_SNAPSHOT", effectiveResult: active }] }).success).toBe(true);
    // ADR-0169: aktualiteten avgörs av löparens underlag, så ett äldre resultat kan ha samma tävlingsversion
    // och ett aktuellt resultat en äldre.
    expect(entryTransferCandidatesSchema.safeParse({ ...value,
      entries: [{ ...entry, resultFreshness: "OLDER_SNAPSHOT", effectiveResult: active }] }).success).toBe(true);
    expect(entryTransferCandidatesSchema.safeParse({ ...value, snapshotVersion: 2,
      entries: [{ ...entry, resultFreshness: "CURRENT_SNAPSHOT", effectiveResult: active }] }).success).toBe(true);
    for (const change of [
      { resultFreshness: "CURRENT_SNAPSHOT", effectiveResult: entry.effectiveResult },
      { resultFreshness: "NO_ACTIVE_RESULT", effectiveResult: { state: "NO_ACTIVE_RESULT", selectedRevision: null } },
      { resultFreshness: "CURRENT_SNAPSHOT", effectiveResult: { ...active, result: { ...active.result, revision: 3 } } },
      { resultFreshness: "CURRENT_SNAPSHOT", effectiveResult: { ...active, resultSnapshotVersion: 2 } },
      { resultFreshness: "CURRENT_SNAPSHOT", effectiveResult: { ...active, result: {
        revision: 1, status: "DNS", reason: "DID_NOT_START", elapsedMs: 120_000 } } },
    ]) expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry, ...change }] }).success).toBe(false);
    for (const resultRevisionMarker of [null, "MANUAL_FINISH_TIME_CORRECTION", "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL"]) {
      expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry, resultRevisionMarker }] }).success).toBe(true);
    }
    expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry, resultFreshness: "STALE" }] }).success).toBe(false);
    expect(entryTransferCandidatesSchema.safeParse({ ...value, entries: [{ ...entry, resultRevisionMarker: "UNKNOWN" }] }).success).toBe(false);
    for (const change of [{ eventName: "" }, { raceName: "" }, { generatedAt: "2026-09-12" },
      { timeZone: "Unknown/Zone" }, { classes: [] }, { entries: [entry, entry] },
      { classes: [raceClass, raceClass] }]) expect(entryTransferCandidatesSchema.safeParse({ ...value, ...change }).success).toBe(false);
  });
});
