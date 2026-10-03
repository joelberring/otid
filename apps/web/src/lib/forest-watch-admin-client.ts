import {
  finishForestWatchAdminLoginRequestSchema,
  finishForestWatchAdminLoginResponseSchema,
  StartCheckinRosterResponseSchema,
  type FinishForestWatchAdminLoginResponse,
  type StartCheckinRosterResponse
} from "@o-tid/contracts";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_TIMEOUT_MS = 15_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ForestWatchClientError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST" | "TOO_LARGE" | "FAILED") {
    super("Forest watch request failed");
    this.name = "ForestWatchClientError";
  }
}

function assertRaceId(raceId: string): void {
  if (!CANONICAL_UUID.test(raceId)) throw new ForestWatchClientError("INVALID_REQUEST");
}

function sessionUrl(raceId: string): string {
  return `/api/admin/races/${encodeURIComponent(raceId)}/finish-forest-watch-session`;
}

function rosterUrl(raceId: string): string {
  return `/api/admin/races/${encodeURIComponent(raceId)}/finish-forest-watch/roster`;
}

function failureForStatus(status: number): ForestWatchClientError {
  if (status === 401) return new ForestWatchClientError("UNAUTHORIZED");
  if (status === 403) return new ForestWatchClientError("FORBIDDEN");
  if (status === 400) return new ForestWatchClientError("INVALID_REQUEST");
  if (status === 413) return new ForestWatchClientError("TOO_LARGE");
  return new ForestWatchClientError("FAILED");
}

function callerAbort(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

async function withRequestTimeout<T>(
  signal: AbortSignal | undefined,
  operation: (requestSignal: AbortSignal) => Promise<T>
): Promise<T> {
  if (signal?.aborted) throw callerAbort(signal);
  const controller = new AbortController();
  let timedOut = false;
  let rejectTimeout: (reason: unknown) => void = () => undefined;
  const timeoutResult = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout(new ForestWatchClientError("FAILED"));
  }, REQUEST_TIMEOUT_MS);
  let rejectCaller: (reason: unknown) => void = () => undefined;
  const callerResult = new Promise<never>((_resolve, reject) => { rejectCaller = reject; });
  const onCallerAbort = () => {
    controller.abort(signal?.reason);
    if (signal) rejectCaller(callerAbort(signal));
  };
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    return await Promise.race([operation(controller.signal), timeoutResult, callerResult]);
  } catch (error) {
    if (signal?.aborted) throw callerAbort(signal);
    if (timedOut) throw new ForestWatchClientError("FAILED");
    if (error instanceof ForestWatchClientError) throw error;
    throw new ForestWatchClientError("FAILED");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ForestWatchClientError("FAILED");
  }
}

async function requestSession(
  raceId: string,
  method: "GET" | "POST",
  body: string | undefined,
  signal: AbortSignal | undefined,
  fetcher: Fetcher
): Promise<FinishForestWatchAdminLoginResponse> {
  assertRaceId(raceId);
  return withRequestTimeout(signal, async (requestSignal) => {
    const response = await fetcher(sessionUrl(raceId), {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body })
    });
    if (!response.ok) throw failureForStatus(response.status);
    const parsed = finishForestWatchAdminLoginResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.capability !== "FINISH_FOREST_WATCH") {
      throw new ForestWatchClientError("FAILED");
    }
    return parsed.data;
  });
}

export async function loadForestWatch(
  raceId: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<StartCheckinRosterResponse> {
  assertRaceId(raceId);
  return withRequestTimeout(signal, async (requestSignal) => {
    const response = await fetcher(rosterUrl(raceId), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: requestSignal
    });
    if (!response.ok) throw failureForStatus(response.status);
    const parsed = StartCheckinRosterResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.raceId !== raceId) throw new ForestWatchClientError("FAILED");
    return parsed.data;
  });
}

export function loginForestWatch(
  raceId: string,
  accessCredential: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<FinishForestWatchAdminLoginResponse> {
  assertRaceId(raceId);
  const body = finishForestWatchAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
  if (!body.success) return Promise.reject(new ForestWatchClientError("INVALID_REQUEST"));
  return requestSession(raceId, "POST", JSON.stringify(body.data), signal, fetcher);
}

export function getForestWatchSession(
  raceId: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<FinishForestWatchAdminLoginResponse> {
  return requestSession(raceId, "GET", undefined, signal, fetcher);
}

export async function logoutForestWatch(
  raceId: string,
  csrf: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<void> {
  assertRaceId(raceId);
  if (!CSRF_TOKEN.test(csrf)) throw new ForestWatchClientError("INVALID_REQUEST");
  await withRequestTimeout(signal, async (requestSignal) => {
    const response = await fetcher(sessionUrl(raceId), {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
      headers: { "x-otid-csrf": csrf }
    });
    if (response.status === 204 || response.status === 401) return;
    throw failureForStatus(response.status);
  });
}
