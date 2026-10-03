import { describe, expect, it } from "vitest";
import {
  raceOverviewAdminErrorResponseSchema,
  raceOverviewAdminLoginRequestSchema,
  raceOverviewAdminLoginResponseSchema,
  raceOverviewResponseSchema
} from "../src";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "20000000-0000-4000-8000-000000000002";
const courseId = "30000000-0000-4000-8000-000000000003";

const overview = {
  formatVersion: 1 as const,
  race: {
    id: raceId,
    eventName: "Testhelgen",
    name: "Medeldistans",
    raceDate: "2026-08-31",
    timeZone: "Europe/Stockholm",
    snapshotVersion: 7
  },
  classes: [{ id: classId, name: "D21", startRule: "PUNCH" as const, entryCount: 2 }],
  courses: [{ id: courseId, name: "Bana 1" }],
  counts: {
    classes: 1,
    courses: 1,
    entries: 2,
    activeCardAssignments: 2,
    readouts: 1,
    resultRevisions: 1,
    imports: 2
  },
  latestActivity: {
    readoutAt: "2026-08-31T12:00:00.000Z",
    resultRevisionAt: "2026-08-31T12:00:01.000Z",
    importAt: null
  }
};

describe("TASK 005J raceöversiktskontrakt", () => {
  it("separerar credentialprefix och capability", () => {
    const accessCredential = `otid_org_race_overview_v1.${raceId}.${"A".repeat(43)}`;
    expect(raceOverviewAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential }))
      .toEqual({ formatVersion: 1, accessCredential });
    for (const prefix of [
      "otid_org_pair_v1",
      "otid_org_import_v1",
      "otid_org_entry_class_v1",
      "otid_org_result_recalc_v1"
    ]) {
      expect(raceOverviewAdminLoginRequestSchema.safeParse({
        formatVersion: 1,
        accessCredential: accessCredential.replace("otid_org_race_overview_v1", prefix)
      }).success).toBe(false);
    }
    expect(raceOverviewAdminLoginRequestSchema.safeParse({
      formatVersion: 1,
      accessCredential,
      token: "får inte finnas"
    }).success).toBe(false);
    expect(raceOverviewAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      expiresAt: "2026-08-31T20:00:00.000Z"
    }).capability).toBe("VIEW_RACE_OVERVIEW");
  });

  it("validerar den aggregerade PII-fria översikten", () => {
    expect(raceOverviewResponseSchema.parse(overview)).toEqual(overview);
    expect(raceOverviewResponseSchema.safeParse({
      ...overview,
      classes: [...overview.classes, overview.classes[0]],
      counts: { ...overview.counts, classes: 2, entries: 4 }
    }).success).toBe(false);
    expect(raceOverviewResponseSchema.safeParse({
      ...overview,
      counts: { ...overview.counts, entries: 3 }
    }).success).toBe(false);
  });

  it("avvisar privata och råa extrafält på varje nivå", () => {
    const forbidden = [
      "entryId", "displayName", "organisationName", "cardNumber", "assignmentId",
      "punches", "readoutId", "rawPayload", "revisionId", "evaluation",
      "importFileId", "contentHash", "originalXml", "report", "externalId",
      "deviceId", "sessionId", "credentialLabel", "secretHash"
    ];
    for (const field of forbidden) {
      expect(raceOverviewResponseSchema.safeParse({ ...overview, [field]: "canary" }).success).toBe(false);
    }
    expect(raceOverviewResponseSchema.safeParse({
      ...overview,
      race: { ...overview.race, externalId: "canary" }
    }).success).toBe(false);
    expect(raceOverviewResponseSchema.safeParse({
      ...overview,
      classes: [{ ...overview.classes[0], cardNumber: "canary" }]
    }).success).toBe(false);
  });

  it("ger endast stabila detaljfria fel", () => {
    for (const error of ["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INTERNAL_ERROR"]) {
      expect(raceOverviewAdminErrorResponseSchema.parse({ formatVersion: 1, error }))
        .toEqual({ formatVersion: 1, error });
    }
    expect(raceOverviewAdminErrorResponseSchema.safeParse({
      formatVersion: 1,
      error: "UNAUTHORIZED",
      details: "Credentialen är spärrad"
    }).success).toBe(false);
  });
});
