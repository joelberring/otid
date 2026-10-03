import { describe, expect, it, vi } from "vitest";
import {
  ForestWatchClientError,
  getForestWatchSession,
  loadForestWatch,
  loginForestWatch,
  logoutForestWatch
} from "./forest-watch-admin-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const classId = "10000000-0000-4000-8000-000000000003";
const deviceId = "10000000-0000-4000-8000-000000000004";
const credential = `otid_org_finish_forest_watch_v1.${raceId}.${"a".repeat(43)}`;
const csrf = "c".repeat(43);
const session = { formatVersion: 1 as const, raceId, capability: "FINISH_FOREST_WATCH" as const, expiresAt: "2026-09-05T10:12:13Z" };
const roster = {
  formatVersion: 1 as const, raceId, snapshotVersion: 1, timeZone: "Europe/Stockholm", generatedAt: "2026-09-05T10:12:13.000Z",
  knowledge: "LAST_SYNCED_ONLY" as const,
  entries: [{ entryId, entryVersion: 1, classId, className: "D21", displayName: "Ada Löpare", organisationName: null,
    startRule: "FIXED" as const, fixedStartTime: "2026-09-05T10:00:00Z", cardNumber: "123", multipleActiveAssignments: false,
    revision: 0, startState: "UNMARKED" as const, manualReturnRegistered: false, readoutReturnRegistered: false,
    activeDns: false, conflictingReports: false, forestState: "UNCONFIRMED" as const, needsFollowUp: true }],
  devices: [{ deviceId, label: "Mål", capability: "FINISH_FOREST_WATCH" as const, lastReceivedAt: null, lastSequence: 0 }]
};

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" }
});

describe("finish forest watch browser client", () => {
  it("uses private no-store same-origin requests with the fixed URLs", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockResolvedValueOnce(jsonResponse(roster)).mockResolvedValueOnce(jsonResponse(session)).mockResolvedValueOnce(jsonResponse(session)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(loadForestWatch(raceId, undefined, fetcher)).resolves.toEqual(roster);
    await expect(loginForestWatch(raceId, credential, undefined, fetcher)).resolves.toEqual(session);
    await expect(getForestWatchSession(raceId, undefined, fetcher)).resolves.toEqual(session);
    await expect(logoutForestWatch(raceId, csrf, undefined, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(1, `/api/admin/races/${raceId}/finish-forest-watch/roster`, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/admin/races/${raceId}/finish-forest-watch-session`, expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formatVersion: 1, accessCredential: credential }) }));
    expect(fetcher).toHaveBeenNthCalledWith(3, `/api/admin/races/${raceId}/finish-forest-watch-session`, expect.objectContaining({ method: "GET" }));
    expect(fetcher).toHaveBeenNthCalledWith(4, `/api/admin/races/${raceId}/finish-forest-watch-session`, expect.objectContaining({ method: "DELETE", headers: { "x-otid-csrf": csrf } }));
    expect(fetcher.mock.calls[3]?.[1]).not.toHaveProperty("body");
  });

  it("validates caller input, strict responses, and exact race scope before fetching or returning data", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    await expect(loadForestWatch(`${raceId.slice(0, -1)}A`, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(loginForestWatch(raceId, "secret", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(logoutForestWatch(raceId, "short", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(jsonResponse({ ...roster, raceId: classId }));
    await expect(loadForestWatch(raceId, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...session, capability: "START_CHECKIN" }));
    await expect(getForestWatchSession(raceId, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...roster, entries: [{ ...roster.entries[0], entryId, cardNumber: "123", multipleActiveAssignments: true }] }));
    await expect(loadForestWatch(raceId, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
  });

  it("maps auth and request failures without exposing a response detail", async () => {
    for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [400, "INVALID_REQUEST"], [413, "TOO_LARGE"], [500, "FAILED"]] as const) {
      await expect(loadForestWatch(raceId, undefined, vi.fn().mockResolvedValue(new Response("Ada's secret", { status })))).rejects.toMatchObject({ code, message: "Forest watch request failed" });
    }
    expect(new ForestWatchClientError("FAILED").message).not.toContain("Ada");
  });

  it("keeps the timeout active through body parsing and clears it on caller cancellation", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      let markStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      let markBodyStarted: () => void = () => undefined;
      const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
      const delayedBody = { ok: true, status: 200, json: () => {
        markBodyStarted();
        return new Promise<unknown>(() => {});
      } } as unknown as Response;
      const fetcher = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        markStarted();
        return Promise.resolve(delayedBody);
      });
      const timedOut = loadForestWatch(raceId, undefined, fetcher);
      await started;
      await bodyStarted;
      const timedOutResult = expect(timedOut).rejects.toMatchObject({ code: "FAILED" });
      await vi.advanceTimersByTimeAsync(15_000);
      await timedOutResult;
      expect(requestSignal?.aborted).toBe(true);

      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const pending = loadForestWatch(raceId, controller.signal, vi.fn().mockImplementation(() => new Promise<Response>(() => {})));
      controller.abort(new DOMException("Cancelled", "AbortError"));
      await expect(pending).rejects.toBeInstanceOf(DOMException);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));

      const preAborted = new AbortController();
      const preAbortedFetcher = vi.fn();
      preAborted.abort(new DOMException("Cancelled", "AbortError"));
      await expect(loadForestWatch(raceId, preAborted.signal, preAbortedFetcher)).rejects.toBeInstanceOf(DOMException);
      expect(preAbortedFetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
