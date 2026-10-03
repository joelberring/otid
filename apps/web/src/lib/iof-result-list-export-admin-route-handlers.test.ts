import { describe, expect, it, vi } from "vitest";
import type {
  exportFrozenIofResultListAsAdmin,
  exportIofResultListAsAdmin,
  listFrozenRaceFinalizationsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  frozenIofResultListDownloadRoute,
  frozenRaceFinalizationListRoute,
  iofResultListExportAdminLoginRoute,
  iofResultListExportAdminLogoutRoute,
  iofResultListExportDownloadRoute
} from "./iof-result-list-export-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const credentialId = "30000000-0000-4000-8000-000000000003";
const sessionId = "40000000-0000-4000-8000-000000000004";
const accessCredential = `otid_org_result_list_export_v1.${credentialId}.${"a".repeat(43)}`;
const sessionToken = `otid_org_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrf = "c".repeat(43);
const sessionCookie = `__Host-otid-result-list-export-session=${sessionToken}`;
const bytes = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><ResultList/>');
const sha256 = "a".repeat(64);
const finalizationId = "50000000-0000-4000-8000-000000000005";

function request(path: string, method = "GET", body?: BodyInit, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example${path}`, init);
}

const metadata = {
  formatVersion: 1 as const,
  raceId,
  snapshotVersion: 7,
  classCount: 2,
  resultCount: 3,
  staleResultCount: 1,
  omittedEntryCount: 4,
  sha256
};

const finalization = {
  id: finalizationId,
  raceId,
  scope: "RACE" as const,
  classId: null,
  scopeRevision: 2,
  sourceSnapshotVersion: 7,
  basisHash: "b".repeat(64),
  frozenProjectionHash: "c".repeat(64),
  entryCount: 3,
  classCount: 2,
  completeXmlSha256: sha256,
  finalizedAt: "2026-08-31T10:00:00.000Z"
};

describe("TASK 006B exportroutar", () => {
  it("loggar in endast med exportcapability och sätter isolerade host-cookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "EXPORT_IOF_RESULT_LIST" as const,
        expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken, csrfToken: csrf
    })) as unknown as typeof loginPairingAdmin;
    const response = await iofResultListExportAdminLoginRoute(db, request("/session", "POST", JSON.stringify({
      formatVersion: 1, accessCredential
    }), { origin: "https://otid.example", "content-type": "application/json" }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, { formatVersion: 1, accessCredential }, {
      expectedRaceId: raceId, expectedCapability: "EXPORT_IOF_RESULT_LIST"
    });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-result-list-export-session");
    expect(cookies).toContain("__Host-otid-result-list-export-csrf");
    expect(cookies).not.toMatch(/race-overview|readout-result-history|pairing-admin|import-admin/);
  });

  it("returnerar exakta privata downloadheaders, metadata och oförändrade bytes", async () => {
    const exportResultList = vi.fn(async () => ({
      status: "ok" as const, bytes, metadata
    })) as unknown as typeof exportIofResultListAsAdmin;
    const response = await iofResultListExportDownloadRoute(db, request("/result-list.xml", "GET", undefined, {
      cookie: sessionCookie
    }), raceId, exportResultList, environment);
    expect(exportResultList).toHaveBeenCalledWith(db, { sessionToken, raceId });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="otid-result-list-${raceId}.xml"`
    );
    expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("etag")).toBe(`"sha256-${sha256}"`);
    expect(response.headers.get("x-otid-content-sha256")).toBe(sha256);
    expect(response.headers.get("x-otid-snapshot-version")).toBe("7");
    expect(response.headers.get("x-otid-stale-result-count")).toBe("1");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("mappar exportfel detaljfritt och läcker inte oväntat applicationdata", async () => {
    for (const [status, http, error] of [
      ["invalid-request", 400, "INVALID_REQUEST"], ["unauthorized", 401, "UNAUTHORIZED"],
      ["forbidden", 403, "FORBIDDEN"], ["not-found", 404, "NOT_FOUND"],
      ["conflict", 409, "CONFLICT"], ["too-large", 413, "TOO_LARGE"]
    ] as const) {
      const exportResultList = vi.fn(async () => ({ status })) as unknown as typeof exportIofResultListAsAdmin;
      const response = await iofResultListExportDownloadRoute(db, request("/result-list.xml"), raceId,
        exportResultList, environment);
      expect(response.status).toBe(http);
      expect(await response.json()).toEqual({ formatVersion: 1, error });
    }
    const canary = vi.fn(async () => ({ status: "ok" as const, bytes,
      metadata: { ...metadata, secret: "CANARY" } })) as unknown as typeof exportIofResultListAsAdmin;
    const invalid = await iofResultListExportDownloadRoute(db, request("/result-list.xml"), raceId,
      canary, environment);
    expect(invalid.status).toBe(500);
    expect(await invalid.text()).not.toContain("CANARY");
  });

  it("logout kräver origin/CSRF/tom body och rensar bara exportcookies", async () => {
    const logout = vi.fn(async (_db: Database, input: Parameters<typeof logoutPairingAdminSession>[1]) => ({
      status: await input.readBodyIsEmpty?.() ? "logged-out" as const : "invalid-request" as const
    })) as unknown as typeof logoutPairingAdminSession;
    const response = await iofResultListExportAdminLogoutRoute(db, request("/session", "DELETE", undefined, {
      origin: "https://otid.example",
      cookie: `${sessionCookie}; __Host-otid-result-list-export-csrf=${csrf}`,
      "x-otid-csrf": csrf
    }), raceId, logout, environment);
    expect(response.status).toBe(204);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({
      raceId, capability: "EXPORT_IOF_RESULT_LIST", sessionToken, csrfCookie: csrf, csrfHeader: csrf
    }));
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/result-list-export-(session|csrf)=deleted/);
    expect(cookies).not.toMatch(/race-overview|readout-result-history/);
  });

  it("listar endast fryst RACE-metadata och levererar exakt sparade Complete-bytes", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const, response: {
      formatVersion: 1 as const,
      raceId,
      finalizations: [finalization]
    } })) as unknown as typeof listFrozenRaceFinalizationsAsAdmin;
    const listResponse = await frozenRaceFinalizationListRoute(
      db, request("/final-result-lists", "GET", undefined, { cookie: sessionCookie }), raceId, list, environment
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({ formatVersion: 1, raceId, finalizations: [finalization] });
    expect(list).toHaveBeenCalledWith(db, { sessionToken, raceId });

    const frozenExport = vi.fn(async () => ({ status: "ok" as const, bytes, finalization })) as unknown as
      typeof exportFrozenIofResultListAsAdmin;
    const response = await frozenIofResultListDownloadRoute(
      db, request(`/final-result-lists/${finalizationId}`, "GET", undefined, { cookie: sessionCookie }),
      raceId, finalizationId, frozenExport, environment
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(frozenExport).toHaveBeenCalledWith(db, { sessionToken, raceId, finalizationId });
    expect(response.headers.get("content-disposition"))
      .toBe(`attachment; filename="otid-complete-result-list-${raceId}-r2.xml"`);
    expect(response.headers.get("x-otid-finalization-id")).toBe(finalizationId);
    expect(response.headers.get("x-otid-finalization-revision")).toBe("2");
    expect(response.headers.get("x-otid-content-sha256")).toBe(sha256);
  });
});
