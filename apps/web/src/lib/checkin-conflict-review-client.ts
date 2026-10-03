import {
  StartCheckinConflictReviewCandidateSchema,
  StartCheckinConflictReviewRequestSchema,
  StartCheckinConflictReviewResponseSchema,
  type StartCheckinConflictReviewCandidate,
  type StartCheckinConflictReviewRequest,
  type StartCheckinConflictReviewResponse
} from "@o-tid/contracts";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class CheckinConflictReviewClientError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST" | "NOT_FOUND" | "CONFLICT" | "TOO_LARGE" | "FAILED") {
    super("Checkin conflict review request failed");
    this.name = "CheckinConflictReviewClientError";
  }
}

function url(raceId: string): string {
  if (!uuid.test(raceId)) throw new CheckinConflictReviewClientError("INVALID_REQUEST");
  return `/api/admin/races/${raceId}/finish-forest-watch/conflict-reviews`;
}

/** Deadline includes body decoding. Unknown write outcomes never imply a stored review. */
async function request<T>(
  path: string, init: RequestInit, signal: AbortSignal | undefined, fetcher: Fetcher,
  decode: (body: unknown) => T
): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    controller.abort(signal?.reason);
    rejectAbort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
    rejectAbort(new CheckinConflictReviewClientError("FAILED"));
  }, 15_000);
  try {
    return await Promise.race([aborted, (async () => {
      const response = await fetcher(path, {
        ...init, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal
      });
      if (response.status !== 200) {
        const codes = { 400: "INVALID_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "TOO_LARGE" } as const;
        throw new CheckinConflictReviewClientError(codes[response.status as keyof typeof codes] ?? "FAILED");
      }
      const result = decode(await response.json());
      controller.signal.throwIfAborted();
      return result;
    })()]);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof CheckinConflictReviewClientError) throw error;
    throw new CheckinConflictReviewClientError("FAILED");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function loadCheckinConflictReview(
  raceId: string, entryId: string, signal?: AbortSignal, fetcher: Fetcher = fetch
): Promise<StartCheckinConflictReviewCandidate> {
  const path = url(raceId);
  if (!uuid.test(entryId)) throw new CheckinConflictReviewClientError("INVALID_REQUEST");
  return request(`${path}/${entryId}`, { method: "GET" }, signal, fetcher, body => {
    const value = StartCheckinConflictReviewCandidateSchema.parse(body);
    if (value.source.raceId !== raceId || value.source.entryId !== entryId) throw new CheckinConflictReviewClientError("FAILED");
    return value;
  });
}

/** Caller retains the same intent/request ID until a definitive response or fresh explicit review. */
export async function submitCheckinConflictReview(
  raceId: string, intent: StartCheckinConflictReviewRequest, csrf: string,
  signal?: AbortSignal, fetcher: Fetcher = fetch
): Promise<StartCheckinConflictReviewResponse> {
  const path = url(raceId);
  const parsed = StartCheckinConflictReviewRequestSchema.safeParse(intent);
  if (!parsed.success || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new CheckinConflictReviewClientError("INVALID_REQUEST");
  // Parse copies arrays, so caller mutation while awaiting cannot change receipt validation.
  const frozen = parsed.data;
  return request(path, {
    method: "POST", headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify(frozen)
  }, signal, fetcher, body => {
    const value = StartCheckinConflictReviewResponseSchema.parse(body);
    if (value.raceId !== raceId || value.entryId !== frozen.entryId || value.requestId !== frozen.requestId ||
      value.sourceHash !== frozen.sourceHash || value.decision !== frozen.decision ||
      value.conflictRequestIds.length !== frozen.conflictRequestIds.length ||
      value.conflictRequestIds.some((id, index) => id !== frozen.conflictRequestIds[index])) {
      throw new CheckinConflictReviewClientError("FAILED");
    }
    return value;
  });
}
