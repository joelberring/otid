import { describe, expect, it } from "vitest";
import {
  startListAdminErrorResponseSchema,
  startListAdminListResponseSchema,
  startListAdminLoginRequestSchema,
  startListAdminLoginResponseSchema
} from "../src";

const raceId = "10000000-0000-4000-8000-000000000001";
const fixedClassId = "20000000-0000-4000-8000-000000000002";
const punchClassId = "30000000-0000-4000-8000-000000000003";
const entryId = "40000000-0000-4000-8000-000000000004";

describe("TASK 006R startlistekontrakt", () => {
  it("separerar startlistecredentialen och validerar den privata projektionen", () => {
    const accessCredential = `otid_org_start_list_v1.${raceId}.${"A".repeat(43)}`;
    expect(startListAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential })).toEqual({ formatVersion: 1, accessCredential });
    expect(startListAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential: accessCredential.replace("otid_org_start_list_v1", "otid_org_race_overview_v1")
    }).success).toBe(false);
    expect(startListAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId, capability: "VIEW_START_LIST", expiresAt: "2026-09-04T08:00:00.000Z"
    }).capability).toBe("VIEW_START_LIST");

    const response = {
      formatVersion: 1 as const, raceId, snapshotVersion: 3, timeZone: "Europe/Stockholm",
      generatedAt: "2026-09-04T08:00:00.000Z",
      classes: [{
        id: fixedClassId, name: "D21", startRule: "FIXED" as const,
        entries: [{ id: entryId, displayName: "Ada Löpare", organisationName: null,
          fixedStartTime: "2026-09-04T08:30:00.123Z", cardNumber: null, multipleActiveAssignments: false }]
      }, { id: punchClassId, name: "H21", startRule: "PUNCH" as const, entries: [] }]
    };
    expect(startListAdminListResponseSchema.parse(response)).toEqual(response);
    expect(startListAdminListResponseSchema.safeParse({ ...response, timeZone: "Mars/Olympus_Mons" }).success).toBe(false);
    const fixedClass = response.classes[0];
    if (!fixedClass) throw new Error("FIXED-klassen saknas");
    expect(startListAdminListResponseSchema.safeParse({
      ...response,
      classes: [{ ...fixedClass, startRule: "PUNCH", entries: fixedClass.entries }]
    }).success).toBe(false);
  });

  it("avvisar motsägande eller för stora listor och använder det stabila adminfelet", () => {
    expect(startListAdminErrorResponseSchema.parse({ formatVersion: 1, error: "UNAUTHORIZED" }))
      .toEqual({ formatVersion: 1, error: "UNAUTHORIZED" });
    const entry = { id: entryId, displayName: "Ada", organisationName: null,
      fixedStartTime: null, cardNumber: null, multipleActiveAssignments: false };
    const raceClass = { id: fixedClassId, name: "D21", startRule: "FIXED", entries: [entry] };
    const response = { formatVersion: 1, raceId, snapshotVersion: 1, timeZone: "UTC",
      generatedAt: "2026-09-04T08:00:00Z", classes: [raceClass] };
    expect(startListAdminListResponseSchema.safeParse({ ...response, classes: [raceClass, raceClass] }).success).toBe(false);
    expect(startListAdminListResponseSchema.safeParse({ ...response, classes: [raceClass, { ...raceClass, id: punchClassId }] }).success).toBe(false);
    expect(startListAdminListResponseSchema.safeParse({ ...response, classes: [{ ...raceClass,
      entries: [{ ...entry, cardNumber: "12345", multipleActiveAssignments: true }] }] }).success).toBe(false);
    const entries = Array.from({ length: 10_001 }, (_, index) => ({ ...entry,
      id: `50000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` }));
    expect(startListAdminListResponseSchema.safeParse({ ...response, classes: [
      { ...raceClass, entries: entries.slice(0, 5_000) },
      { ...raceClass, id: punchClassId, entries: entries.slice(5_000) }
    ] }).success).toBe(false);
  });
});
