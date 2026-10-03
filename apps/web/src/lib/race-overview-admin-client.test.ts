import { describe, expect, it } from "vitest";
import { parseRaceOverview, readRaceOverviewAdminCsrf } from "./race-overview-admin-client";
import {
  RACE_OVERVIEW_ADMIN_LOOPBACK_COOKIE_NAMES,
  RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES
} from "./race-overview-admin-cookies";

const raceId = "10000000-0000-4000-8000-000000000001";
const classId = "10000000-0000-4000-8000-000000000002";
const courseId = "10000000-0000-4000-8000-000000000003";
const csrf = "c".repeat(43);
const response = {
  formatVersion: 1 as const,
  race: {
    id: raceId,
    eventName: "Testtävling",
    name: "Individuellt",
    raceDate: "2026-08-31",
    timeZone: "Europe/Stockholm",
    snapshotVersion: 4
  },
  classes: [{ id: classId, name: "H21", startRule: "FIXED" as const, entryCount: 2 }],
  courses: [{ id: courseId, name: "Långa" }],
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
    readoutAt: "2026-08-31T10:00:00.000Z",
    resultRevisionAt: null,
    importAt: "2026-08-31T09:00:00.000Z"
  }
};

describe("race overview admin client", () => {
  it("accepts only the strict expected-race DTO", () => {
    expect(parseRaceOverview(response, raceId)).toEqual(response);
    expect(() => parseRaceOverview({ ...response, rawPayload: "CANARY" }, raceId)).toThrow();
    expect(() => parseRaceOverview(response, "20000000-0000-4000-8000-000000000001")).toThrow();
  });

  it("rejects inconsistent aggregate counts", () => {
    expect(() => parseRaceOverview({
      ...response,
      counts: { ...response.counts, entries: 3 }
    }, raceId)).toThrow();
  });

  it("selects isolated production and loopback CSRF cookies", () => {
    expect(readRaceOverviewAdminCsrf(
      `${RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES.csrf}=${csrf}; otid_import_admin_csrf=${"i".repeat(43)}`,
      new URL("https://otid.example/admin")
    )).toBe(csrf);
    expect(readRaceOverviewAdminCsrf(
      `${RACE_OVERVIEW_ADMIN_LOOPBACK_COOKIE_NAMES.csrf}=${csrf}`,
      new URL("http://127.0.0.1:3000/admin")
    )).toBe(csrf);
  });

  it("rejects duplicate, malformed and wrong-surface CSRF cookies", () => {
    expect(() => readRaceOverviewAdminCsrf(
      `${RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES.csrf}=${csrf}; ${RACE_OVERVIEW_ADMIN_PRODUCTION_COOKIE_NAMES.csrf}=${csrf}`,
      new URL("https://otid.example/admin")
    )).toThrow();
    expect(() => readRaceOverviewAdminCsrf(
      `__Host-otid-pairing-admin-csrf=${csrf}`,
      new URL("https://otid.example/admin")
    )).toThrow();
  });
});
