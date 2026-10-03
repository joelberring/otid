import { describe, expect, it } from "vitest";
import { StartCheckinRosterResponseSchema } from "../src";

const ids = {
  race: "10000000-0000-4000-8000-000000000001",
  entry: "20000000-0000-4000-8000-000000000002",
  class: "30000000-0000-4000-8000-000000000003",
  device: "40000000-0000-4000-8000-000000000004"
};

const entry = {
  entryId: ids.entry,
  entryVersion: 1,
  classId: ids.class,
  className: "D21",
  displayName: "Ada Löpare",
  organisationName: "Orienteringsklubben",
  startRule: "FIXED" as const,
  fixedStartTime: "2026-09-05T09:30:00.000Z",
  cardNumber: "123456",
  multipleActiveAssignments: false,
  revision: 1,
  startState: "STARTED" as const,
  manualReturnRegistered: false,
  readoutReturnRegistered: false,
  activeDns: false,
  conflictingReports: false,
  forestState: "STARTED_NO_RETURN" as const,
  needsFollowUp: true
};

const device = {
  deviceId: ids.device,
  label: "Startmobil",
  capability: "START_CHECKIN" as const,
  lastReceivedAt: "2026-09-05T10:11:12.123Z",
  lastSequence: 7
};

const response = {
  formatVersion: 1 as const,
  raceId: ids.race,
  snapshotVersion: 3,
  timeZone: "Europe/Stockholm",
  generatedAt: "2026-09-05T10:12:13.456Z",
  knowledge: "LAST_SYNCED_ONLY" as const,
  entries: [entry],
  devices: [device]
};

describe("TASK 006W avprickningsroster-kontrakt", () => {
  it("accepts legacy rosters and sorted review details but rejects duplicate or invalid IDs", () => {
    expect(StartCheckinRosterResponseSchema.parse(response).entries[0]).not.toHaveProperty("reviewedConflictRequestIds");
    for (const reviewedConflictRequestIds of [[], [ids.entry]]) {
      expect(StartCheckinRosterResponseSchema.parse({ ...response, entries: [{ ...entry, reviewedConflictRequestIds }] }).entries[0]?.reviewedConflictRequestIds)
        .toEqual(reviewedConflictRequestIds);
    }
    for (const reviewedConflictRequestIds of [[ids.entry, ids.entry], [ids.device, ids.entry], ["invalid"]]) {
      expect(StartCheckinRosterResponseSchema.safeParse({ ...response, entries: [{ ...entry, reviewedConflictRequestIds }] }).success).toBe(false);
    }
  });
  it("validerar ADR-0052:s privata, versionsmärkta roster", () => {
    expect(StartCheckinRosterResponseSchema.parse(response)).toEqual(response);
    expect(StartCheckinRosterResponseSchema.parse({
      ...response,
      entries: [{ ...entry, startRule: "PUNCH", fixedStartTime: null, multipleActiveAssignments: true, cardNumber: null,
        forestState: "CONFLICT", needsFollowUp: true }],
      devices: [{ ...device, capability: "FINISH_FOREST_WATCH", lastReceivedAt: null, lastSequence: 0 }]
    }).knowledge).toBe("LAST_SYNCED_ONLY");
  });

  it("avvisar korsfältsmotsägelser och dubletter", () => {
    const invalidEntries = [
      { ...entry, startRule: "PUNCH", fixedStartTime: entry.fixedStartTime },
      { ...entry, multipleActiveAssignments: true },
      { ...entry, revision: 0, startState: "STARTED" },
      { ...entry, revision: 0, manualReturnRegistered: true },
      { ...entry, needsFollowUp: false },
      { ...entry, forestState: "RETURNED", needsFollowUp: true }
    ];
    for (const invalidEntry of invalidEntries) {
      expect(StartCheckinRosterResponseSchema.safeParse({ ...response, entries: [invalidEntry] }).success).toBe(false);
    }
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, entries: [entry, entry] }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, devices: [device, device] }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, devices: [{ ...device, lastSequence: 0 }] }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, devices: [{ ...device, lastReceivedAt: null }] }).success).toBe(false);
  });

  it("avvisar extra och privata källfält på varje nivå", () => {
    for (const value of [
      { ...response, rawPayload: "canary" },
      { ...response, entries: [{ ...entry, readoutId: "canary" }] },
      { ...response, entries: [{ ...entry, credential: "canary" }] },
      { ...response, devices: [{ ...device, credentialSecret: "canary" }] }
    ]) {
      expect(StartCheckinRosterResponseSchema.safeParse(value).success).toBe(false);
    }
  });

  it("håller format, storlek, UUID, tid och tidszon strikta", () => {
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, formatVersion: 2 }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, raceId: "a0000000-0000-4000-8000-000000000001".toUpperCase() }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, timeZone: "Mars/Olympus_Mons" }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, generatedAt: "2026-09-05T10:12:13Z" }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, entries: Array.from({ length: 10_001 }, () => entry) }).success).toBe(false);
    expect(StartCheckinRosterResponseSchema.safeParse({ ...response, devices: Array.from({ length: 1_001 }, () => device) }).success).toBe(false);
  });
});
