import { afterEach, describe, expect, it, vi } from "vitest";
import type { StartCheckinConflictReviewRequest } from "@o-tid/contracts";
import { loadCheckinConflictReview, submitCheckinConflictReview } from "./checkin-conflict-review-client";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const raceId = id(1), entryId = id(2), csrf = "c".repeat(43), hash = "a".repeat(64);
const at = "2026-09-05T10:00:00.000Z";
const intent: StartCheckinConflictReviewRequest = { formatVersion: 1, requestId: id(3), entryId,
  sourceHash: hash, conflictRequestIds: [id(4)], decision: "KEEP_CURRENT_STATE", reason: "Kontrollerat vid mål" };
const response = { ...intent, reason: undefined, raceId, reviewId: id(5), reviewedAt: at };
const candidate = { formatVersion: 1, generatedAt: at, sourceHash: hash, source: {
  formatVersion: 1, raceId, entryId, displayName: "Test Person", className: "Testklass", organisationName: null,
  snapshotVersion: 1, entryVersion: 1, revision: 0, resultRevision: 0, startState: "UNMARKED",
  manualReturnRegistered: false, readoutReturnRegistered: false, activeDns: false, conflicts: []
} };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

afterEach(() => vi.useRealTimers());

describe("private checkin conflict review client", () => {
  it("reads exact scoped evidence without caching or write headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(candidate));
    expect(await loadCheckinConflictReview(raceId, entryId, undefined, fetcher)).toEqual(candidate);
    expect(fetcher).toHaveBeenCalledWith(`/api/admin/races/${raceId}/finish-forest-watch/conflict-reviews/${entryId}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" }));
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty("body");
  });

  it("rejects other scope and unexpected private response fields", async () => {
    for (const body of [{ ...candidate, source: { ...candidate.source, raceId: id(8) } },
      { ...candidate, source: { ...candidate.source, entryId: id(8) } }, { ...candidate, secret: "never displayed" }]) {
      await expect(loadCheckinConflictReview(raceId, entryId, undefined, async () => json(body))).rejects.toMatchObject({ code: "FAILED" });
    }
  });

  it("sends the same intent after a lost reply and binds the durable response", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("private upstream details")).mockResolvedValueOnce(json(response));
    await expect(submitCheckinConflictReview(raceId, intent, csrf, undefined, fetcher)).rejects.toMatchObject({ code: "FAILED", message: "Checkin conflict review request failed" });
    expect(await submitCheckinConflictReview(raceId, intent, csrf, undefined, fetcher)).toMatchObject({ requestId: intent.requestId });
    expect((fetcher.mock.calls[0]![1] as RequestInit).body).toBe((fetcher.mock.calls[1]![1] as RequestInit).body);
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store",
      redirect: "error", headers: { "content-type": "application/json", "x-otid-csrf": csrf } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a mismatched durable receipt without treating it as success", async () => {
    for (const changed of [{ raceId: id(8) }, { entryId: id(8) }, { requestId: id(8) }, { sourceHash: "b".repeat(64) },
      { conflictRequestIds: [id(8)] }, { conflictRequestIds: [id(4), id(8)] }, { decision: "APPLY_REPORT" }]) {
      await expect(submitCheckinConflictReview(raceId, intent, csrf, undefined, async () => json({ ...response, ...changed })))
        .rejects.toMatchObject({ code: "FAILED" });
    }
  });

  it("validates inputs before network access", async () => {
    const fetcher = vi.fn();
    await expect(loadCheckinConflictReview("invalid", entryId, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(loadCheckinConflictReview(raceId, "invalid", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(submitCheckinConflictReview(raceId, intent, "bad", undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(submitCheckinConflictReview(raceId, { ...intent, reason: " " }, csrf, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps errors without reading a potentially private error body", async () => {
    for (const [status, code] of [[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [400, "INVALID_REQUEST"],
      [404, "NOT_FOUND"], [409, "CONFLICT"], [413, "TOO_LARGE"], [500, "FAILED"], [201, "FAILED"]] as const) {
      const reply = new Response("private error", { status });
      const read = vi.spyOn(reply, "json");
      await expect(submitCheckinConflictReview(raceId, intent, csrf, undefined, async () => reply)).rejects.toMatchObject({ code });
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("times out a stalled response body, even if fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    const reply = json(candidate);
    vi.spyOn(reply, "json").mockImplementation(() => new Promise(() => undefined));
    const result = loadCheckinConflictReview(raceId, entryId, undefined, async () => reply);
    const check = expect(result).rejects.toMatchObject({ code: "FAILED" });
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
  });

  it("aborts during body parsing and never accepts the late result", async () => {
    const controller = new AbortController();
    let resolveBody: (value: unknown) => void = () => undefined;
    const reply = json(candidate);
    vi.spyOn(reply, "json").mockImplementation(() => new Promise(resolve => { resolveBody = resolve; }));
    const result = loadCheckinConflictReview(raceId, entryId, controller.signal, async () => reply);
    const check = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    resolveBody(candidate);
    await check;
  });
});
