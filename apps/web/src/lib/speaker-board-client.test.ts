import { describe, expect, it, vi } from "vitest";
import {
  SpeakerBoardClientError,
  getSpeakerBoardSession,
  loadSpeakerBoard,
  loginSpeakerBoard,
  logoutSpeakerBoard
} from "./speaker-board-client";

const raceId = "10000000-0000-4000-8000-000000000001";
const otherRaceId = "10000000-0000-4000-8000-000000000002";
const credential = `otid_org_speaker_board_v1.${raceId}.${"a".repeat(43)}`;
const csrf = "c".repeat(43);
const session = {
  formatVersion: 1 as const,
  raceId,
  capability: "VIEW_SPEAKER_BOARD" as const,
  expiresAt: "2026-09-06T10:12:13.000Z"
};
const board = {
  formatVersion: 1 as const,
  raceId,
  eventName: "Syntetisk tävling",
  raceName: "Långdistans",
  raceSnapshotVersion: 1,
  timeZone: "Europe/Stockholm",
  generatedAt: "2026-09-06T10:12:13.000Z",
  selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION" as const,
  rows: [{
    slot: 1,
    givenName: "Ada",
    familyName: "Löpare",
    organisationName: null,
    className: "D21",
    selectedRevision: 1,
    registeredAt: "2026-09-06T10:12:13.000Z",
    state: "ACTIVE_RESULT" as const,
    result: { revision: 1, status: "OK" as const, reason: "COMPLETE" as const, elapsedMs: 12_000 }
  }]
};

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" }
});

describe("speaker board browser client", () => {
  it("uses private no-store same-origin requests with the fixed URLs", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(board))
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(loadSpeakerBoard(raceId, undefined, fetcher)).resolves.toEqual(board);
    await expect(loginSpeakerBoard(raceId, credential, undefined, fetcher)).resolves.toEqual(session);
    await expect(getSpeakerBoardSession(raceId, undefined, fetcher)).resolves.toEqual(session);
    await expect(logoutSpeakerBoard(raceId, csrf, undefined, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenNthCalledWith(1, `/api/admin/races/${raceId}/speaker-board`, expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/admin/races/${raceId}/speaker-board-session`, expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formatVersion: 1, accessCredential: credential }) }));
    expect(fetcher).toHaveBeenNthCalledWith(3, `/api/admin/races/${raceId}/speaker-board-session`, expect.objectContaining({ method: "GET" }));
    expect(fetcher).toHaveBeenNthCalledWith(4, `/api/admin/races/${raceId}/speaker-board-session`, expect.objectContaining({ method: "DELETE", headers: { "x-otid-csrf": csrf } }));
    expect(fetcher.mock.calls[3]?.[1]).not.toHaveProperty("body");
  });

  it("validates input and refuses wrong scope or extra private fields", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    await expect(loadSpeakerBoard(`${raceId.slice(0, -1)}A`, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(loginSpeakerBoard(raceId, "secret", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(logoutSpeakerBoard(raceId, "short", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(jsonResponse({ ...session, raceId: otherRaceId }));
    await expect(getSpeakerBoardSession(raceId, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...session, capability: "VIEW_RACE_OVERVIEW" }));
    await expect(getSpeakerBoardSession(raceId, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...board, privateCanary: "must not reach the UI" }));
    await expect(loadSpeakerBoard(raceId, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
    fetcher.mockResolvedValueOnce(jsonResponse({ ...board, rows: [{ ...board.rows[0], entryId: otherRaceId }] }));
    await expect(loadSpeakerBoard(raceId, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED" });
  });

  it("maps auth and request failures without exposing response details", async () => {
    for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [400, "INVALID_REQUEST"], [413, "TOO_LARGE"], [500, "FAILED"]] as const) {
      await expect(loadSpeakerBoard(raceId, undefined, vi.fn().mockResolvedValue(new Response("Ada's secret", { status })))).rejects.toMatchObject({ code, message: "Speaker board request failed" });
    }
    expect(new SpeakerBoardClientError("FAILED").message).not.toContain("Ada");
  });

  it("keeps the timeout active through body parsing and contains late answers after caller abort", async () => {
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
      const timedOut = loadSpeakerBoard(raceId, undefined, fetcher);
      await started;
      await bodyStarted;
      const timedOutResult = expect(timedOut).rejects.toMatchObject({ code: "FAILED" });
      await vi.advanceTimersByTimeAsync(15_000);
      await timedOutResult;
      expect(requestSignal?.aborted).toBe(true);

      const controller = new AbortController();
      let resolveLate: (value: Response) => void = () => undefined;
      const pending = loadSpeakerBoard(raceId, controller.signal, vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveLate = resolve; })));
      controller.abort(new DOMException("Cancelled", "AbortError"));
      await expect(pending).rejects.toBeInstanceOf(DOMException);
      resolveLate(jsonResponse(board));
      await Promise.resolve();

      const preAborted = new AbortController();
      const preAbortedFetcher = vi.fn();
      preAborted.abort(new DOMException("Cancelled", "AbortError"));
      await expect(loadSpeakerBoard(raceId, preAborted.signal, preAbortedFetcher)).rejects.toBeInstanceOf(DOMException);
      expect(preAbortedFetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a valid CSRF token for logout and treats an already-expired session as logged out", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(logoutSpeakerBoard(raceId, csrf, undefined, fetcher)).resolves.toBeUndefined();
    await expect(logoutSpeakerBoard(raceId, "not-a-token", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
