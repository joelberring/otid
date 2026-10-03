/** Gemensamma testdata och hjälpfunktioner för administratörsroutes. */
import { vi } from "vitest";
import type { Database } from "@o-tid/database";
import type { authenticatePairingAdminSession, changeEntryClassAsAdmin, listEntryClassesAsAdmin,
  logoutPairingAdminSession } from "@o-tid/application";

export const db = {} as Database;
export const id = "10000000-0000-4000-8000-000000000001";
export const other = "10000000-0000-4000-8000-000000000002";
export const csrf = "c".repeat(43);
export const token = `otid_org_session_v1.${id}.${"s".repeat(43)}`;
export const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
export const session = { formatVersion: 1 as const, raceId: id, capability: "MANAGE_RACE" as const, expiresAt: "2026-09-12T13:00:00Z" };
export const list = { formatVersion: 1 as const, raceId: id, snapshotVersion: 1,
  classes: [{ id, name: "Öppen" }], entries: [] };
export function dependencies() {
  return {
    authenticate: vi.fn<typeof authenticatePairingAdminSession>().mockResolvedValue({ status: "authenticated", principal: {
      accessCredentialId: id, raceId: id, capability: "MANAGE_RACE", sessionId: id, expiresAt: session.expiresAt } }),
    logout: vi.fn<typeof logoutPairingAdminSession>().mockResolvedValue({ status: "logged-out" }),
    participants: vi.fn<typeof listEntryClassesAsAdmin>().mockResolvedValue({ status: "ok", response: list }),
    changeClass: vi.fn<typeof changeEntryClassAsAdmin>().mockResolvedValue({ status: "conflict" })
  };
}
export function request(method: string, body?: string, headers: Record<string, string> = {}) {
  return new Request("https://otid.example/api/admin", { method, ...(body === undefined ? {} : { body }), headers: {
    origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json", "x-otid-csrf": csrf,
    "idempotency-key": `entry-class-change:${id}`,
    cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}`, ...headers } });
}
export const intent = JSON.stringify({ formatVersion: 1, classId: other, expectedEntryVersion: 1 });
