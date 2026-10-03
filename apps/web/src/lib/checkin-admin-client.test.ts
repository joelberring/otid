import { describe, expect, it, vi } from "vitest";
import {
  CheckinAdminClientError,
  getCheckinAdminSession,
  loadCheckinRoster,
  loginCheckinAdmin,
  logoutCheckinAdmin,
  registerCheckinDevice
} from "./checkin-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const otherRaceId = "10000000-0000-4000-8000-000000000002";
const entryId = "10000000-0000-4000-8000-000000000003";
const classId = "10000000-0000-4000-8000-000000000004";
const deviceId = "10000000-0000-4000-8000-000000000005";
const actorCredentialId = "10000000-0000-4000-8000-000000000006";
const csrf = "c".repeat(43);
const startCredential = `otid_org_start_checkin_v1.${raceId}.${"a".repeat(43)}`;
const finishCredential = `otid_org_finish_forest_watch_v1.${raceId}.${"b".repeat(43)}`;
const startSession = { formatVersion: 1 as const, raceId, capability: "START_CHECKIN" as const, expiresAt: "2026-09-05T10:12:13Z" };
const finishSession = { ...startSession, capability: "FINISH_FOREST_WATCH" as const };
const registration = { formatVersion: 1 as const, deviceId, raceId, actorCredentialId, capability: "START_CHECKIN" as const, label: "Start", registeredAt: "2026-09-05T10:12:13.000Z" };
const roster = {
  formatVersion: 1 as const, raceId, snapshotVersion: 1, timeZone: "Europe/Stockholm", generatedAt: "2026-09-05T10:12:13.000Z", knowledge: "LAST_SYNCED_ONLY" as const,
  entries: [{ entryId, entryVersion: 1, classId, className: "D21", displayName: "Ada Löpare", organisationName: null, startRule: "FIXED" as const, fixedStartTime: "2026-09-05T10:00:00Z", cardNumber: "123", multipleActiveAssignments: false, revision: 0, startState: "UNMARKED" as const, manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false, conflictingReports: false, forestState: "UNCONFIRMED" as const, needsFollowUp: true }],
  devices: [{ deviceId, label: "Start", capability: "START_CHECKIN" as const, lastReceivedAt: null, lastSequence: 0 }]
};

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("capability-parametric check-in admin browser client", () => {
  it("uses the static, private routes for each capability", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(startSession)).mockResolvedValueOnce(jsonResponse(finishSession))
      .mockResolvedValueOnce(jsonResponse(roster)).mockResolvedValueOnce(jsonResponse(registration))
      .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(loginCheckinAdmin(raceId, "START_CHECKIN", startCredential, undefined, fetcher)).resolves.toEqual(startSession);
    await expect(getCheckinAdminSession(raceId, "FINISH_FOREST_WATCH", undefined, fetcher)).resolves.toEqual(finishSession);
    await expect(loadCheckinRoster(raceId, "FINISH_FOREST_WATCH", undefined, fetcher)).resolves.toEqual(roster);
    await expect(registerCheckinDevice(raceId, "START_CHECKIN", { deviceId, label: "Start" }, csrf, undefined, fetcher)).resolves.toEqual(registration);
    await expect(logoutCheckinAdmin(raceId, "START_CHECKIN", csrf, undefined, fetcher)).resolves.toBeUndefined();
    await expect(logoutCheckinAdmin(raceId, "FINISH_FOREST_WATCH", csrf, undefined, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(1, `/api/admin/races/${raceId}/start-checkin-session`, expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", body: JSON.stringify({ formatVersion: 1, accessCredential: startCredential }) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/admin/races/${raceId}/finish-forest-watch-session`, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" }));
    expect(fetcher).toHaveBeenNthCalledWith(3, `/api/admin/races/${raceId}/finish-forest-watch/roster?reviewDetails=1`, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" }));
    expect(fetcher).toHaveBeenNthCalledWith(4, `/api/admin/races/${raceId}/start-checkin/devices`, expect.objectContaining({ method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify({ formatVersion: 1, deviceId, label: "Start" }) }));
    expect(fetcher).toHaveBeenNthCalledWith(5, `/api/admin/races/${raceId}/start-checkin-session`, expect.objectContaining({ method: "DELETE", headers: { "x-otid-csrf": csrf } }));
    expect(fetcher).toHaveBeenNthCalledWith(6, `/api/admin/races/${raceId}/finish-forest-watch-session`, expect.objectContaining({ method: "DELETE", headers: { "x-otid-csrf": csrf } }));
  });

  it("rejects invalid input and response scope without sending or returning it", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    await expect(loginCheckinAdmin(raceId, "START_CHECKIN", finishCredential, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(registerCheckinDevice(raceId, "START_CHECKIN", { deviceId, label: " " }, csrf, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(loadCheckinRoster(`${raceId.slice(0, -1)}A`, "START_CHECKIN", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(getCheckinAdminSession(raceId, "UNKNOWN" as never, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(jsonResponse({ ...startSession, raceId: otherRaceId }));
    await expect(getCheckinAdminSession(raceId, "START_CHECKIN", undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...registration, capability: "FINISH_FOREST_WATCH" }));
    await expect(registerCheckinDevice(raceId, "START_CHECKIN", { deviceId, label: "Start" }, csrf, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...registration, deviceId: otherRaceId }));
    await expect(registerCheckinDevice(raceId, "START_CHECKIN", { deviceId, label: "Start" }, csrf, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...registration, label: "Other" }));
    await expect(registerCheckinDevice(raceId, "START_CHECKIN", { deviceId, label: "Start" }, csrf, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...roster, raceId: otherRaceId }));
    await expect(loadCheckinRoster(raceId, "START_CHECKIN", undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
  });

  it("maps bounded transport failures without exposing response details", async () => {
    for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [400, "INVALID_REQUEST"], [409, "CONFLICT"], [413, "TOO_LARGE"], [500, "FAILED"]] as const) {
      await expect(loadCheckinRoster(raceId, "START_CHECKIN", undefined, vi.fn().mockResolvedValue(new Response("private detail", { status })))).rejects.toMatchObject({ code, message: "Check-in administration request failed" });
    }
    expect(new CheckinAdminClientError("FAILED").message).not.toContain("private");
  });

  it("keeps timeout through response parsing and preserves caller cancellation", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      let beginBody: () => void = () => undefined;
      const bodyStarted = new Promise<void>((resolve) => { beginBody = resolve; });
      const delayedBody = { ok: true, status: 200, json: () => { beginBody(); return new Promise<unknown>(() => {}); } } as unknown as Response;
      const timedOut = loadCheckinRoster(raceId, "START_CHECKIN", undefined, vi.fn().mockImplementation((_url: string, init?: RequestInit) => { requestSignal = init?.signal ?? undefined; return Promise.resolve(delayedBody); }));
      await bodyStarted;
      const timedOutResult = expect(timedOut).rejects.toMatchObject({ code: "FAILED" });
      await vi.advanceTimersByTimeAsync(15_000);
      await timedOutResult;
      expect(requestSignal?.aborted).toBe(true);

      const controller = new AbortController();
      const pending = loadCheckinRoster(raceId, "START_CHECKIN", controller.signal, vi.fn().mockImplementation(() => new Promise<Response>(() => {})));
      controller.abort(new DOMException("Cancelled", "AbortError"));
      await expect(pending).rejects.toBeInstanceOf(DOMException);
    } finally {
      vi.useRealTimers();
    }
  });
});
