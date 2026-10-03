import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  importIofXmlAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  authenticatedIofImportRoute,
  importAdminLoginRoute,
  importAdminLogoutRoute,
  importAdminSessionStatusRoute
} from "./import-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const importFileId = "10000000-0000-4000-8000-000000000003";
const accessCredential = `otid_org_import_v1.10000000-0000-4000-8000-000000000004.${"a".repeat(43)}`;
const sessionToken = `otid_org_session_v1.10000000-0000-4000-8000-000000000005.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const sessionCookie = `__Host-otid-import-admin-session=${sessionToken}`;
const csrfCookie = `__Host-otid-import-admin-csrf=${csrfToken}`;

function request(method: "GET" | "POST" | "DELETE", body?: BodyInit, extra: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers: extra };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example/api/races/${raceId}/imports`, init);
}

function unsafeHeaders(extra: Record<string, string> = {}) {
  return {
    origin: "https://otid.example",
    cookie: `${sessionCookie}; ${csrfCookie}`,
    "x-otid-csrf": csrfToken,
    ...extra
  };
}

function authenticated() {
  return {
    status: "authenticated" as const,
    principal: {
      accessCredentialId: "10000000-0000-4000-8000-000000000006",
      raceId,
      capability: "IMPORT_IOF" as const,
      sessionId: "10000000-0000-4000-8000-000000000005",
      expiresAt: "2026-08-31T13:00:00.000Z"
    }
  };
}

describe("TASK 005G importadmin-routes", () => {
  it("race-scopar login före sessionskapande och sätter endast importcookies", async () => {
    const login = vi.fn(async () => ({
      status: "authenticated" as const,
      response: { formatVersion: 1 as const, raceId, capability: "IMPORT_IOF" as const, expiresAt: "2026-08-31T13:00:00.000Z" },
      sessionToken,
      csrfToken
    })) as unknown as typeof loginPairingAdmin;
    const response = await importAdminLoginRoute(db, request("POST", JSON.stringify({ formatVersion: 1, accessCredential }), {
      origin: "https://otid.example", "content-type": "application/json"
    }), raceId, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: raceId, expectedCapability: "IMPORT_IOF" });
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies.join("\n")).toContain("__Host-otid-import-admin-session");
    expect(cookies.join("\n")).toContain("__Host-otid-import-admin-csrf");
    expect(cookies.join("\n")).not.toContain("pairing-admin");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).not.toContain("HttpOnly");
    expect(cookies.every((cookie) => cookie.includes("Secure") && cookie.includes("SameSite=Strict") && cookie.includes("Path=/"))).toBe(true);
  });

  it("skriver inga cookies när credentialen avvisas för route-racet", async () => {
    const login = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof loginPairingAdmin;
    const response = await importAdminLoginRoute(db, request("POST", JSON.stringify({ formatVersion: 1, accessCredential }), {
      origin: "https://otid.example", "content-type": "application/json"
    }), raceId, login, environment);
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("avvisar fel Origin före loginbody och application", async () => {
    const login = vi.fn() as unknown as typeof loginPairingAdmin;
    const response = await importAdminLoginRoute(db, request("POST", "hemlig body", {
      origin: "https://evil.example", "content-type": "text/plain"
    }), raceId, login, environment);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "FORBIDDEN" });
    expect(login).not.toHaveBeenCalled();
  });

  it("provar befintlig session race- och capabilitybundet utan CSRF för GET", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const response = await importAdminSessionStatusRoute(db, request("GET", undefined, { cookie: sessionCookie }), raceId, authenticate, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ formatVersion: 1, raceId, capability: "IMPORT_IOF", expiresAt: "2026-08-31T13:00:00.000Z" });
    expect(authenticate).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, capability: "IMPORT_IOF", sessionToken }));
  });

  it("läser inte en enda bodybyte när Origin/session/race/capability/CSRF avvisas", async () => {
    let pulled = 0;
    const unreadRequest = {
      headers: new Headers(unsafeHeaders({
        "content-type": "application/xml", "idempotency-key": `iof-import:${requestId}`
      })),
      body: { getReader() { pulled += 1; throw new Error("body lästes"); } }
    } as unknown as Request;
    const authenticate = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof authenticatePairingAdminSession;
    const runImport = vi.fn() as unknown as typeof importIofXmlAsAdmin;
    const response = await authenticatedIofImportRoute(db, unreadRequest, raceId, authenticate, runImport, environment);
    expect(response.status).toBe(401);
    expect(pulled).toBe(0);
    expect(runImport).not.toHaveBeenCalled();
  });

  it("skickar exakt BOM-innehållande råbytesföljd till det återautentiserande usecaset", async () => {
    const xmlBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<CourseData/>")]);
    const hash = createHash("sha256").update(xmlBytes).digest("hex");
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const runImportImplementation = async (
      _db: Parameters<typeof importIofXmlAsAdmin>[0],
      input: Parameters<typeof importIofXmlAsAdmin>[1]
    ): ReturnType<typeof importIofXmlAsAdmin> => {
      expect([...input.xmlBytes]).toEqual([...xmlBytes]);
      return {
        status: "stored" as const,
        response: {
          formatVersion: 1 as const, status: "stored" as const, replayed: false, requestId, raceId,
          importFileId, contentHash: hash, byteCount: xmlBytes.byteLength,
          report: { kind: "CourseData" as const, warnings: [], imported: { courses: 1, classes: 1 } }
        }
      };
    };
    const runImport = vi.fn(runImportImplementation) as unknown as typeof importIofXmlAsAdmin;
    const response = await authenticatedIofImportRoute(db, request("POST", xmlBytes, unsafeHeaders({
      "content-type": "application/xml", "idempotency-key": `iof-import:${requestId}`
    })), raceId, authenticate, runImport, environment);
    expect(response.status).toBe(201);
    expect(runImport).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, idempotencyKey: `iof-import:${requestId}` }));
  });

  it.each([
    ["text/xml", `iof-import:${requestId}`, new TextEncoder().encode("<CourseData/>"), 400],
    ["application/xml; charset=utf-8", `iof-import:${requestId}`, new TextEncoder().encode("<CourseData/>"), 400],
    ["application/xml", "iof-import:NOT-A-UUID", new TextEncoder().encode("<CourseData/>"), 400],
    ["application/xml", `iof-import:${requestId}`, new Uint8Array([0xff]), 400]
  ] as const)("avvisar content-type/idempotens/UTF-8 stabilt", async (contentType, key, body, expected) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const runImport = vi.fn() as unknown as typeof importIofXmlAsAdmin;
    const response = await authenticatedIofImportRoute(db, request("POST", body, unsafeHeaders({
      "content-type": contentType, "idempotency-key": key
    })), raceId, authenticate, runImport, environment);
    expect(response.status).toBe(expected);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "INVALID_REQUEST" });
    expect(runImport).not.toHaveBeenCalled();
  });

  it("stoppar faktisk chunked body över 5 000 000 bytes oberoende av deklarerad längd", async () => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const runImport = vi.fn() as unknown as typeof importIofXmlAsAdmin;
    const response = await authenticatedIofImportRoute(db, request("POST", new Uint8Array(5_000_001), unsafeHeaders({
      "content-type": "application/xml", "idempotency-key": `iof-import:${requestId}`
    })), raceId, authenticate, runImport, environment);
    expect(response.status).toBe(400);
    expect(runImport).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthorized", 401, "UNAUTHORIZED"],
    ["forbidden", 403, "FORBIDDEN"],
    ["invalid-request", 400, "INVALID_REQUEST"],
    ["invalid-iof-xml", 422, "INVALID_IOF_XML"],
    ["conflict", 409, "CONFLICT"]
  ] as const)("mappar usecase-%s utan intern detalj", async (status, expectedStatus, code) => {
    const authenticate = vi.fn(async () => authenticated()) as unknown as typeof authenticatePairingAdminSession;
    const runImport = vi.fn(async () => ({ status })) as unknown as typeof importIofXmlAsAdmin;
    const response = await authenticatedIofImportRoute(db, request("POST", "<CourseData/>", unsafeHeaders({
      "content-type": "application/xml", "idempotency-key": `iof-import:${requestId}`
    })), raceId, authenticate, runImport, environment);
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ formatVersion: 1, error: code });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("race-scopar logout, rensar importcookies och kräver tom body", async () => {
    const logoutImplementation = async (
      _db: Parameters<typeof logoutPairingAdminSession>[0],
      input: Parameters<typeof logoutPairingAdminSession>[1]
    ): ReturnType<typeof logoutPairingAdminSession> => {
      if (input.readBodyIsEmpty && !await input.readBodyIsEmpty()) return { status: "invalid-request" as const };
      return { status: "logged-out" as const };
    };
    const logout = vi.fn(logoutImplementation) as unknown as typeof logoutPairingAdminSession;
    const response = await importAdminLogoutRoute(db, request("DELETE", undefined, unsafeHeaders()), raceId, logout, environment);
    expect(response.status).toBe(204);
    expect(logout).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, capability: "IMPORT_IOF" }));
    expect((response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n")).toContain("Max-Age=0");
  });

  it("maskerar oväntade fel och rå Error.message", async () => {
    const authenticate = vi.fn(async () => { throw new Error("hemlig databasdetalj"); }) as unknown as typeof authenticatePairingAdminSession;
    const response = await authenticatedIofImportRoute(db, request("POST", "<CourseData/>", unsafeHeaders({
      "content-type": "application/xml", "idempotency-key": `iof-import:${requestId}`
    })), raceId, authenticate, vi.fn() as unknown as typeof importIofXmlAsAdmin, environment);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("hemlig databasdetalj");
  });
});
