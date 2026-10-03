import {
  finishForestWatchAdminLoginRequestSchema,
  finishForestWatchAdminLoginResponseSchema,
  startCheckinAdminLoginRequestSchema,
  startCheckinAdminLoginResponseSchema,
  startCheckinDeviceRegistrationRequestSchema,
  startCheckinDeviceRegistrationResponseSchema,
  StartCheckinRosterResponseSchema,
  type FinishForestWatchAdminLoginResponse,
  type StartCheckinAdminLoginResponse,
  type StartCheckinDeviceRegistrationResponse,
  type StartCheckinRosterResponse
} from "@o-tid/contracts";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_TIMEOUT_MS = 15_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type CheckinAdminCapability = "START_CHECKIN" | "FINISH_FOREST_WATCH";
export type CheckinAdminSession = StartCheckinAdminLoginResponse | FinishForestWatchAdminLoginResponse;

export class CheckinAdminClientError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_REQUEST" | "CONFLICT" | "TOO_LARGE" | "FAILED") {
    super("Check-in administration request failed");
    this.name = "CheckinAdminClientError";
  }
}

function assertRaceId(raceId: string): void {
  if (!CANONICAL_UUID.test(raceId)) throw new CheckinAdminClientError("INVALID_REQUEST");
}

function assertCapability(capability: string): asserts capability is CheckinAdminCapability {
  if (capability !== "START_CHECKIN" && capability !== "FINISH_FOREST_WATCH") {
    throw new CheckinAdminClientError("INVALID_REQUEST");
  }
}

function sessionUrl(raceId: string, capability: CheckinAdminCapability): string {
  const suffix = capability === "START_CHECKIN" ? "start-checkin-session" : "finish-forest-watch-session";
  return `/api/admin/races/${encodeURIComponent(raceId)}/${suffix}`;
}

function operationalUrl(raceId: string, capability: CheckinAdminCapability, resource: "roster" | "devices"): string {
  const segment = capability === "START_CHECKIN" ? "start-checkin" : "finish-forest-watch";
  return `/api/admin/races/${encodeURIComponent(raceId)}/${segment}/${resource}`;
}

function failureForStatus(status: number): CheckinAdminClientError {
  if (status === 401) return new CheckinAdminClientError("UNAUTHORIZED");
  if (status === 403) return new CheckinAdminClientError("FORBIDDEN");
  if (status === 400) return new CheckinAdminClientError("INVALID_REQUEST");
  if (status === 409) return new CheckinAdminClientError("CONFLICT");
  if (status === 413) return new CheckinAdminClientError("TOO_LARGE");
  return new CheckinAdminClientError("FAILED");
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
    rejectTimeout(new CheckinAdminClientError("FAILED"));
  }, REQUEST_TIMEOUT_MS);
  let rejectCaller: (reason: unknown) => void = () => undefined;
  const callerResult = new Promise<never>((_resolve, reject) => { rejectCaller = reject; });
  const onCallerAbort = () => {
    controller.abort(signal?.reason);
    if (signal) rejectCaller(callerAbort(signal));
  };
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    return await Promise.race([operation(controller.signal), timeoutResult, callerResult]);
  } catch (error) {
    if (signal?.aborted) throw callerAbort(signal);
    if (timedOut) throw new CheckinAdminClientError("FAILED");
    if (error instanceof CheckinAdminClientError) throw error;
    throw new CheckinAdminClientError("FAILED");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new CheckinAdminClientError("FAILED");
  }
}

function parseSession(value: unknown, raceId: string, capability: CheckinAdminCapability): CheckinAdminSession {
  const parsed = capability === "START_CHECKIN"
    ? startCheckinAdminLoginResponseSchema.safeParse(value)
    : finishForestWatchAdminLoginResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.capability !== capability) {
    throw new CheckinAdminClientError("FAILED");
  }
  return parsed.data;
}

async function requestSession(
  raceId: string,
  capability: CheckinAdminCapability,
  method: "GET" | "POST",
  body: string | undefined,
  signal: AbortSignal | undefined,
  fetcher: Fetcher
): Promise<CheckinAdminSession> {
  assertRaceId(raceId);
  assertCapability(capability);
  return withRequestTimeout(signal, async (requestSignal) => {
    const response = await fetcher(sessionUrl(raceId, capability), {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body })
    });
    if (!response.ok) throw failureForStatus(response.status);
    return parseSession(await responseJson(response), raceId, capability);
  });
}

export function loginCheckinAdmin(
  raceId: string,
  capability: CheckinAdminCapability,
  accessCredential: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<CheckinAdminSession> {
  assertRaceId(raceId);
  assertCapability(capability);
  const schema = capability === "START_CHECKIN" ? startCheckinAdminLoginRequestSchema : finishForestWatchAdminLoginRequestSchema;
  const body = schema.safeParse({ formatVersion: 1, accessCredential });
  if (!body.success) return Promise.reject(new CheckinAdminClientError("INVALID_REQUEST"));
  return requestSession(raceId, capability, "POST", JSON.stringify(body.data), signal, fetcher);
}

export function getCheckinAdminSession(
  raceId: string,
  capability: CheckinAdminCapability,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<CheckinAdminSession> {
  return requestSession(raceId, capability, "GET", undefined, signal, fetcher);
}

export async function logoutCheckinAdmin(
  raceId: string,
  capability: CheckinAdminCapability,
  csrf: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<void> {
  assertRaceId(raceId);
  assertCapability(capability);
  if (!CSRF_TOKEN.test(csrf)) throw new CheckinAdminClientError("INVALID_REQUEST");
  await withRequestTimeout(signal, async (requestSignal) => {
    const response = await fetcher(sessionUrl(raceId, capability), {
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

export async function loadCheckinRoster(
  raceId: string,
  capability: CheckinAdminCapability,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<StartCheckinRosterResponse> {
  assertRaceId(raceId);
  assertCapability(capability);
  return withRequestTimeout(signal, async (requestSignal) => {
    const response = await fetcher(`${operationalUrl(raceId, capability, "roster")}?reviewDetails=1`, {
      method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal: requestSignal
    });
    if (!response.ok) throw failureForStatus(response.status);
    const parsed = StartCheckinRosterResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.raceId !== raceId) throw new CheckinAdminClientError("FAILED");
    return parsed.data;
  });
}

export async function registerCheckinDevice(
  raceId: string,
  capability: CheckinAdminCapability,
  device: { deviceId: string; label: string },
  csrf: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<StartCheckinDeviceRegistrationResponse> {
  assertRaceId(raceId);
  assertCapability(capability);
  if (!CSRF_TOKEN.test(csrf)) throw new CheckinAdminClientError("INVALID_REQUEST");
  const body = startCheckinDeviceRegistrationRequestSchema.safeParse({ formatVersion: 1, ...device });
  if (!body.success) throw new CheckinAdminClientError("INVALID_REQUEST");
  return withRequestTimeout(signal, async (requestSignal) => {
    const response = await fetcher(operationalUrl(raceId, capability, "devices"), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: requestSignal,
      headers: { "content-type": "application/json", "x-otid-csrf": csrf },
      body: JSON.stringify(body.data)
    });
    if (!response.ok) throw failureForStatus(response.status);
    const parsed = startCheckinDeviceRegistrationResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.raceId !== raceId || parsed.data.capability !== capability ||
      parsed.data.deviceId !== body.data.deviceId || parsed.data.label !== body.data.label) {
      throw new CheckinAdminClientError("FAILED");
    }
    return parsed.data;
  });
}
