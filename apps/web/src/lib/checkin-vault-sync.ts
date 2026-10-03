import {
  StartCheckinReceiptSchema, StartCheckinRecoveryTokenSchema, StartCheckinSyncRequestSchema,
  startCheckinDeviceRegistrationResponseSchema,
  type StartCheckinReceipt
} from "@o-tid/contracts";
import type { CheckinVault, CheckinVaultSnapshot } from "./checkin-vault";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export class CheckinSyncError extends Error {
  constructor(readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "TRANSPORT_CONFLICT" | "INVALID_REQUEST" | "INVALID_RESPONSE" | "NETWORK" | "ABORTED") {
    super("Checkin synchronization failed");
    this.name = "CheckinSyncError";
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CheckinSyncError("ABORTED");
}

async function receive(input: {
  url: string;
  body: string;
  headers: Record<string, string>;
  credentials: RequestCredentials;
  signal: AbortSignal | undefined;
  fetcher: Fetcher;
}): Promise<StartCheckinReceipt> {
  const { url, body, headers, credentials, signal, fetcher } = input;
  checkAbort(signal);
  const controller = new AbortController();
  let rejectCancellation: (error: CheckinSyncError) => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const cancel = (code: "ABORTED" | "NETWORK") => {
    controller.abort();
    rejectCancellation(new CheckinSyncError(code));
  };
  const onAbort = () => cancel("ABORTED");
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => cancel("NETWORK"), 15_000);
  try {
    return await Promise.race([cancelled, (async () => {
      const response = await fetcher(url, {
        method: "POST", credentials, cache: "no-store", redirect: "error", headers,
        body, signal: controller.signal
      });
      if (response.status !== 200) {
        const code = response.status === 401 ? "UNAUTHORIZED" : response.status === 403 ? "FORBIDDEN" :
          response.status === 409 ? "TRANSPORT_CONFLICT" : response.status === 400 ? "INVALID_REQUEST" : "NETWORK";
        throw new CheckinSyncError(code);
      }
      let json: unknown;
      try { json = await response.json(); }
      catch { throw new CheckinSyncError("INVALID_RESPONSE"); }
      const receipt = StartCheckinReceiptSchema.safeParse(json);
      if (!receipt.success) throw new CheckinSyncError("INVALID_RESPONSE");
      return receipt.data;
    })()]);
  } catch (error) {
    checkAbort(signal);
    throw error instanceof CheckinSyncError ? error : new CheckinSyncError("NETWORK");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function nextRequest(snapshot: CheckinVaultSnapshot) {
  const pending = snapshot.operations.find((row) => row.receipt === null);
  if (!pending) return undefined;
  const registration = startCheckinDeviceRegistrationResponseSchema.parse(snapshot.registration);
  const request = StartCheckinSyncRequestSchema.parse({ operation: pending.operation, contentHash: pending.contentHash });
  const operation = request.operation;
  if (operation.localSequence !== snapshot.lastReceiptSequence + 1 || operation.raceId !== registration.raceId ||
      operation.deviceId !== registration.deviceId || operation.actorCredentialId !== registration.actorCredentialId ||
      (registration.capability === "START_CHECKIN" ? operation.action.kind !== "MARK_START" : operation.action.kind !== "FINISH_CORRECTION")) {
    throw new CheckinSyncError("INVALID_REQUEST");
  }
  return { registration, request, operation, body: JSON.stringify(request) };
}

async function commitReceipt(
  vault: Pick<CheckinVault, "read" | "applyReceipt">,
  snapshot: CheckinVaultSnapshot,
  request: ReturnType<typeof StartCheckinSyncRequestSchema.parse>,
  receipt: StartCheckinReceipt,
  signal?: AbortSignal
): Promise<{ kind: "STORED"; receipt: StartCheckinReceipt; snapshot: CheckinVaultSnapshot }> {
  checkAbort(signal);
  const operation = request.operation;
  if (receipt.requestId !== operation.requestId || receipt.deviceId !== operation.deviceId || receipt.raceId !== operation.raceId ||
      receipt.entryId !== operation.entryId || receipt.localSequence !== operation.localSequence || receipt.contentHash !== request.contentHash ||
      (receipt.effect.kind === "APPLIED" && receipt.effect.revision !== operation.expectedRevision + 1) ||
      (receipt.effect.kind === "UNCHANGED" && receipt.effect.revision !== operation.expectedRevision)) {
    throw new CheckinSyncError("INVALID_RESPONSE");
  }
  // CAS failure or lock keeps the original intent. A retry sends the same identity and bytes.
  const updated = await vault.applyReceipt(snapshot.version, receipt);
  return { kind: "STORED", receipt, snapshot: updated };
}

/** One bounded step. A caller may continue only after this resolves with a durable local receipt. */
export async function syncNextCheckinOperation(
  vault: Pick<CheckinVault, "read" | "applyReceipt">,
  currentCsrf: () => string | undefined,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<{ kind: "IDLE"; snapshot: CheckinVaultSnapshot } | { kind: "STORED"; receipt: StartCheckinReceipt; snapshot: CheckinVaultSnapshot }> {
  checkAbort(signal);
  const snapshot = await vault.read();
  checkAbort(signal);
  const next = nextRequest(snapshot);
  if (!next) return { kind: "IDLE", snapshot };
  const { registration, request, body } = next;
  const csrf = currentCsrf();
  if (csrf === undefined || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) throw new CheckinSyncError("FORBIDDEN");
  const route = registration.capability === "START_CHECKIN" ? "start-checkin" : "finish-forest-watch";
  const receipt = await receive({ url: `/api/admin/races/${registration.raceId}/${route}/sync`, body,
    headers: { "content-type": "application/json", "x-otid-csrf": csrf }, credentials: "same-origin", signal, fetcher });
  return commitReceipt(vault, snapshot, request, receipt, signal);
}

/** One bounded recovery step. The bearer token stays in caller memory and is never persisted here. */
export async function syncNextCheckinRecoveryOperation(
  vault: Pick<CheckinVault, "read" | "applyReceipt">,
  currentToken: () => string | undefined,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch
): Promise<{ kind: "IDLE"; snapshot: CheckinVaultSnapshot } | { kind: "STORED"; receipt: StartCheckinReceipt; snapshot: CheckinVaultSnapshot }> {
  checkAbort(signal);
  const snapshot = await vault.read();
  checkAbort(signal);
  const next = nextRequest(snapshot);
  if (!next) return { kind: "IDLE", snapshot };
  const token = currentToken();
  if (!StartCheckinRecoveryTokenSchema.safeParse(token).success) throw new CheckinSyncError("UNAUTHORIZED");
  const { registration, request, body } = next;
  const receipt = await receive({ url: `/api/admin/races/${registration.raceId}/checkin-recovery/sync`, body,
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, credentials: "omit", signal, fetcher });
  return commitReceipt(vault, snapshot, request, receipt, signal);
}
