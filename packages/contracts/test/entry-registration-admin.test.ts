import { describe, expect, it } from "vitest";
import { entryRegistrationClassesResponseSchema, entryRegistrationRequestSchema,
  entryRegistrationResponseSchema, entryRegistrationStartSlotCandidatesSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";
const request = { formatVersion: 1, classId: id, expectedCourseVersionId: id,
  expectedStartRule: "PUNCH", expectedSnapshotVersion: 3,
  givenName: " Anna ", familyName: " Andersson ", organisationName: null,
  cardNumber: null, fixedStartTime: null };

describe("TASK 006Q registreringskontrakt", () => {
  it("kräver en giltig tävlingszon i båda privata lässvaren", () => {
    const classes = { formatVersion: 1, raceId: id, snapshotVersion: 3,
      timeZone: "Europe/Stockholm", classes: [{ id, name: "H21", courseVersionId: id, startRule: "FIXED" }] };
    const slots = { formatVersion: 1, raceId: id, targetClassId: id, snapshotVersion: 3,
      timeZone: "Europe/Stockholm", targetCourseVersionId: id, targetCapacityVersion: 2,
      startRule: "FIXED", plan: { status: "AVAILABLE", drawRequestId: id, sourceHash: "a".repeat(64),
        slots: [{ fixedStartTime: "2026-09-04T10:00:00Z" }] } };
    expect(entryRegistrationClassesResponseSchema.safeParse(classes).success).toBe(true);
    expect(entryRegistrationStartSlotCandidatesSchema.safeParse(slots).success).toBe(true);
    for (const timeZone of [undefined, "", "Invalid/Zone", 17]) {
      expect(entryRegistrationClassesResponseSchema.safeParse({ ...classes, timeZone }).success).toBe(false);
      expect(entryRegistrationStartSlotCandidatesSchema.safeParse({ ...slots, timeZone }).success).toBe(false);
    }
    expect(entryRegistrationStartSlotCandidatesSchema.safeParse({ ...slots,
      plan: { status: "UNAVAILABLE", reason: "NO_SAVED_DRAW" } }).success).toBe(true);
  });
  it("normaliserar namn och fast tid men gissar inte startregel eller bricknummer", () => {
    expect(entryRegistrationRequestSchema.parse(request)).toMatchObject({ givenName: "Anna", familyName: "Andersson" });
    expect(entryRegistrationRequestSchema.parse({ ...request, expectedStartRule: "FIXED",
      fixedStartTime: "2026-09-04T12:00:00+02:00", cardNumber: " 54321 " })).toMatchObject({
      fixedStartTime: "2026-09-04T10:00:00.000Z", cardNumber: "54321" });
    for (const change of [{ givenName: " " }, { familyName: "a".repeat(161) },
      { organisationName: "" }, { cardNumber: "0123" }, { expectedSnapshotVersion: 0 },
      { expectedStartRule: "FIXED" }, { fixedStartTime: "2026-09-04T10:00:00Z" },
      { expectedStartRule: "FIXED", fixedStartTime: "2026-09-04T10:00:00" }, { published: true }]) {
      expect(entryRegistrationRequestSchema.safeParse({ ...request, ...change }).success).toBe(false);
    }
  });
  it("kräver sammanhängande skapandekvittens och binder valfri bricka till assignment", () => {
    const response = { formatVersion: 1, replayed: false, requestId: id, raceId: id,
      entryId: id, entryVersion: 1, classId: id, givenName: "Anna", familyName: "Andersson",
      organisationName: null, cardNumber: null, assignmentId: null, fixedStartTime: null, assignedStartSlot: null,
      snapshotVersionBefore: 3, snapshotVersionAfter: 4, createdAt: "2026-09-04T10:00:00Z" };
    expect(entryRegistrationResponseSchema.safeParse(response).success).toBe(true);
    for (const change of [{ snapshotVersionAfter: 3 }, { entryVersion: 2 },
      { cardNumber: "54321" }, { assignmentId: id }]) {
      expect(entryRegistrationResponseSchema.safeParse({ ...response, ...change }).success).toBe(false);
    }
  });
  it("binder en lottad slot till samma exakta starttid och kräver kapacitetsversion", () => {
    const fixed = { ...request, expectedStartRule: "FIXED" as const, fixedStartTime: "2026-09-04T10:00:00Z",
      expectedTargetCapacityVersion: 1, assignedStartSlot: { drawRequestId: id, sourceHash: "a".repeat(64), fixedStartTime: "2026-09-04T10:00:00Z" } };
    expect(entryRegistrationRequestSchema.safeParse(fixed).success).toBe(true);
    expect(entryRegistrationRequestSchema.safeParse({ ...fixed, expectedTargetCapacityVersion: undefined }).success).toBe(false);
    expect(entryRegistrationRequestSchema.safeParse({ ...fixed, fixedStartTime: "2026-09-04T10:01:00Z" }).success).toBe(false);
  });
});
