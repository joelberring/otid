import { describe, expect, it } from "vitest";
import {
  StartCheckinAdminErrorResponseSchema,
  finishForestWatchAdminLoginRequestSchema,
  finishForestWatchAdminLoginResponseSchema,
  startCheckinAdminLoginRequestSchema,
  startCheckinAdminLoginResponseSchema,
  startCheckinDeviceRegistrationRequestSchema,
  startCheckinDeviceRegistrationResponseSchema
} from "../src";

const ids = {
  credential: "10000000-0000-4000-8000-000000000001",
  device: "10000000-0000-4000-8000-000000000002",
  race: "10000000-0000-4000-8000-000000000003"
};
const secret = "A".repeat(43);

describe("TASK 006W avprickningsadmin-kontrakt", () => {
  it("begränsar HTTP-fel till kända koder utan interna detaljer", () => {
    for (const error of ["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "TOO_LARGE", "INTERNAL_ERROR"]) {
      expect(StartCheckinAdminErrorResponseSchema.parse({ formatVersion: 1, error })).toEqual({ formatVersion: 1, error });
    }
    expect(StartCheckinAdminErrorResponseSchema.safeParse({ formatVersion: 1, error: "DATABASE_ERROR" }).success).toBe(false);
    expect(StartCheckinAdminErrorResponseSchema.safeParse({ formatVersion: 1, error: "INTERNAL_ERROR", detail: "private" }).success).toBe(false);
  });

  it("separerar strikt de två capability-specifika login-credentials", () => {
    const start = { formatVersion: 1 as const, accessCredential: `otid_org_start_checkin_v1.${ids.credential}.${secret}` };
    const finish = { formatVersion: 1 as const, accessCredential: `otid_org_finish_forest_watch_v1.${ids.credential}.${secret}` };
    expect(startCheckinAdminLoginRequestSchema.parse(start)).toEqual(start);
    expect(finishForestWatchAdminLoginRequestSchema.parse(finish)).toEqual(finish);
    expect(startCheckinAdminLoginRequestSchema.safeParse(finish).success).toBe(false);
    expect(finishForestWatchAdminLoginRequestSchema.safeParse(start).success).toBe(false);
    expect(startCheckinAdminLoginRequestSchema.safeParse({ ...start, leak: "secret" }).success).toBe(false);
  });

  it("binder login-svar till dess capability", () => {
    const start = { formatVersion: 1 as const, raceId: ids.race, capability: "START_CHECKIN" as const, expiresAt: "2026-09-05T10:00:00.000Z" };
    const finish = { ...start, capability: "FINISH_FOREST_WATCH" as const };
    expect(startCheckinAdminLoginResponseSchema.parse(start)).toEqual(start);
    expect(finishForestWatchAdminLoginResponseSchema.parse(finish)).toEqual(finish);
    expect(startCheckinAdminLoginResponseSchema.safeParse(finish).success).toBe(false);
  });

  it("validerar den gemensamma, strikta enhetsregistreringen", () => {
    const request = { formatVersion: 1 as const, deviceId: ids.device, label: "  Startmobil  " };
    expect(startCheckinDeviceRegistrationRequestSchema.parse(request)).toEqual({ ...request, label: "Startmobil" });
    expect(startCheckinDeviceRegistrationRequestSchema.safeParse({ ...request, deviceId: "a0000000-0000-4000-8000-000000000002".toUpperCase() }).success).toBe(false);
    expect(startCheckinDeviceRegistrationRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);

    const response = {
      formatVersion: 1 as const, deviceId: ids.device, raceId: ids.race, actorCredentialId: ids.credential,
      capability: "START_CHECKIN" as const, label: "Startmobil", registeredAt: "2026-09-05T10:11:12.123Z"
    };
    expect(startCheckinDeviceRegistrationResponseSchema.parse(response)).toEqual(response);
    expect(startCheckinDeviceRegistrationResponseSchema.safeParse({ ...response, capability: "VIEW_START_LIST" }).success).toBe(false);
    expect(startCheckinDeviceRegistrationResponseSchema.safeParse({ ...response, registeredAt: "2026-09-05T10:11:12Z" }).success).toBe(false);
    expect(startCheckinDeviceRegistrationResponseSchema.safeParse({ ...response, registeredAt: "0000-09-05T10:11:12.123Z" }).success).toBe(false);
  });
});
