import { describe, expect, it } from "vitest";
import {
  speakerBoardEffectiveResultSchema,
  speakerBoardErrorResponseSchema,
  speakerBoardLoginRequestSchema,
  speakerBoardLoginResponseSchema,
  speakerBoardResponseSchema,
  speakerBoardRowSchema
} from "../src";

const raceId = "10000000-0000-4000-8000-000000000002";
const at = "2026-09-06T10:00:00.000Z";
const row = {
  slot: 1, givenName: "Ada", familyName: "Löpare", organisationName: null,
  className: "Öppen", selectedRevision: 3, registeredAt: at,
  state: "ACTIVE_RESULT", result: { revision: 2, status: "NT", reason: "WITHOUT_TIMING" }
};
const response = {
  formatVersion: 1, raceId, eventName: "Syntetisk tävling", raceName: "Lång",
  raceSnapshotVersion: 4, timeZone: "Europe/Stockholm", generatedAt: at,
  selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION", rows: [row]
};

describe("TASK 008 speakerkontrakt", () => {
  it("kräver separat capability och canonical credential/scope", () => {
    const accessCredential = `otid_org_speaker_board_v1.${raceId}.${"A".repeat(43)}`;
    expect(speakerBoardLoginRequestSchema.parse({ formatVersion: 1, accessCredential }).accessCredential).toBe(accessCredential);
    expect(speakerBoardLoginRequestSchema.safeParse({ formatVersion: 1,
      accessCredential: accessCredential.replace("speaker_board", "race_overview") }).success).toBe(false);
    const login = { formatVersion: 1, raceId, capability: "VIEW_SPEAKER_BOARD", expiresAt: at };
    expect(speakerBoardLoginResponseSchema.parse(login)).toEqual(login);
    expect(speakerBoardLoginResponseSchema.safeParse({ ...login, capability: "VIEW_RACE_OVERVIEW" }).success).toBe(false);
    expect(speakerBoardLoginResponseSchema.safeParse({ ...login, secret: "forbidden" }).success).toBe(false);
    expect(speakerBoardErrorResponseSchema.parse({ formatVersion: 1, error: "UNAUTHORIZED" }))
      .toEqual({ formatVersion: 1, error: "UNAUTHORIZED" });
    expect(speakerBoardErrorResponseSchema.safeParse({ formatVersion: 1, error: "UNAUTHORIZED", givenName: "private" }).success).toBe(false);
    expect(speakerBoardLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential, actor: "extra" }).success).toBe(false);
  });

  it("bevarar äldre effektivt NT utan tid och tillåter tomt underlag", () => {
    expect(speakerBoardResponseSchema.parse(response)).toEqual(response);
    expect(speakerBoardResponseSchema.parse({ ...response, rows: [] }).rows).toEqual([]);
    const { result, ...withoutResult } = row;
    expect(result.status).toBe("NT");
    const withdrawn = { ...withoutResult, state: "NO_ACTIVE_RESULT" };
    expect(speakerBoardRowSchema.parse(withdrawn)).toEqual(withdrawn);
    for (const extra of [{ result: row.result }, { status: "DNS" }, { elapsedMs: 1 }, { revision: 2 }]) {
      expect(speakerBoardRowSchema.safeParse({ ...withdrawn, ...extra }).success).toBe(false);
    }
    expect(speakerBoardRowSchema.safeParse({ ...row, result: { ...row.result, revision: 4 } }).success).toBe(false);
  });

  it("validerar status/orsak och exakt tidsmatris utan att beräkna resultat", () => {
    const statuses = [
      ["OK", "COMPLETE"], ["OK", "MANUAL_APPROVAL"], ["MP", "MISSING_CONTROL"], ["MP", "WRONG_ORDER"],
      ["MP", "MISSING_START"], ["MP", "MISSING_FINISH"], ["MP", "INVALID_TIME_ORDER"],
      ["DSQ", "MANUAL_DISQUALIFICATION"], ["OOC", "OUT_OF_COMPETITION"],
      ["DNF", "DID_NOT_FINISH"], ["DNS", "DID_NOT_START"], ["NT", "WITHOUT_TIMING"]
    ];
    for (const [status, reason] of statuses) {
      const value = { revision: 1, status, reason };
      const timed = { ...value, elapsedMs: 1234 };
      const timedMp = status === "MP" && ["MISSING_CONTROL", "WRONG_ORDER"].includes(reason!);
      const untimedMp = status === "MP" && !timedMp;
      expect(speakerBoardEffectiveResultSchema.safeParse(value).success).toBe(status !== "OK" && !timedMp);
      expect(speakerBoardEffectiveResultSchema.safeParse(timed).success).toBe(!untimedMp && !["DNF", "DNS", "NT"].includes(status!));
      expect(speakerBoardEffectiveResultSchema.safeParse({ ...timed, reason: "UNKNOWN_CARD" }).success).toBe(false);
    }
    for (const elapsedMs of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      expect(speakerBoardEffectiveResultSchema.safeParse({ revision: 1, status: "OK", reason: "COMPLETE", elapsedMs }).success).toBe(false);
    }
  });

  it("avvisar extra person-/rå-/rankingfält på varje nivå", () => {
    for (const name of ["entryId", "readoutId", "id", "cardNumber", "evaluation", "splits", "position", "deviceId", "hash", "accessCredential"]) {
      expect(speakerBoardResponseSchema.safeParse({ ...response, [name]: "forbidden" }).success).toBe(false);
      expect(speakerBoardRowSchema.safeParse({ ...row, [name]: "forbidden" }).success).toBe(false);
      expect(speakerBoardEffectiveResultSchema.safeParse({ ...row.result, [name]: "forbidden" }).success).toBe(false);
    }
  });

  it("kräver 0–25 ordnade sammanhängande slots men slår aldrig ihop lika namn", () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ ...row, slot: index + 1 }));
    expect(speakerBoardResponseSchema.parse({ ...response, rows }).rows).toHaveLength(25);
    expect(speakerBoardResponseSchema.safeParse({ ...response, rows: [...rows, { ...row, slot: 26 }] }).success).toBe(false);
    expect(speakerBoardResponseSchema.safeParse({ ...response, rows: [row, row] }).success).toBe(false);
    expect(speakerBoardResponseSchema.safeParse({ ...response, rows: [{ ...row, slot: 2 }] }).success).toBe(false);
    expect(speakerBoardResponseSchema.safeParse({ ...response, rows: [row, { ...row, slot: 2, registeredAt: "2026-09-06T10:00:01.000Z" }] }).success).toBe(false);
    for (const value of [{ timeZone: "Mars/Olympus" }, { raceId: "wrong" }, { raceSnapshotVersion: 0 },
      { generatedAt: "2026-09-06T10:00:00+02:00" }, { generatedAt: "not a date" }]) {
      expect(speakerBoardResponseSchema.safeParse({ ...response, ...value }).success).toBe(false);
    }
  });
});
