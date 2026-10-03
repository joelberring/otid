import { expect, it } from "vitest";
import { raceAdministratorLoginRequestSchema, raceAdministratorLoginResponseSchema } from "../src";

const id = "10000000-0000-4000-8000-000000000001";

it("TASK029 kräver explicit administratörscredential, inte en gammal funktionsnyckel", () => {
  const value = { formatVersion: 1, accessCredential: `otid_org_race_admin_v1.${id}.${"a".repeat(43)}` };
  expect(raceAdministratorLoginRequestSchema.safeParse(value).success).toBe(true);
  for (const prefix of ["otid_org_entry_class_v1", "otid_org_pair_v1", "otid_org_start_checkin_v1"]) {
    expect(raceAdministratorLoginRequestSchema.safeParse({ ...value,
      accessCredential: `${prefix}.${id}.${"a".repeat(43)}` }).success).toBe(false);
  }
  expect(raceAdministratorLoginRequestSchema.safeParse({ ...value, role: "MANAGE_RACE" }).success).toBe(false);
});

it("TASK029 behåller verklig administratörsroll i sessionssvaret", () => {
  const value = { formatVersion: 1, raceId: id, capability: "MANAGE_RACE", expiresAt: "2026-09-12T14:00:00Z" };
  expect(raceAdministratorLoginResponseSchema.safeParse(value).success).toBe(true);
  expect(raceAdministratorLoginResponseSchema.safeParse({ ...value, capability: "CHANGE_ENTRY_CLASS" }).success).toBe(false);
});
