import { deviceBatchAcknowledgementSchema, type DeviceBatch } from "@o-tid/contracts";
import type { QueuedReadout, ReadoutStore } from "./store";

export type SyncOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "synced"; readonly count: number }
  | { readonly kind: "offline" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "failed"; readonly status: number };

export interface SyncDependencies {
  readonly fetch: typeof fetch;
  /** CSRF-token ur administratörens kaka, eller undefined om den saknas. */
  readonly csrf: () => string | undefined;
}

const MAX_BATCH = 100;

/**
 * Sammanhängande följder av väntande avläsningar med stigande löpnummer och
 * samma enhet, session och paketversion.
 */
export function pendingBatches(items: readonly QueuedReadout[]): QueuedReadout[][] {
  const pending = items.filter((item) => item.status === "pending").sort((a, b) => a.localSequence - b.localSequence);
  const batches: QueuedReadout[][] = [];
  for (const item of pending) {
    const current = batches.at(-1);
    const last = current?.at(-1);
    const joins = current && last && last.localSequence + 1 === item.localSequence && current.length < MAX_BATCH &&
      last.deviceId === item.deviceId && last.sessionId === item.sessionId && last.packageVersion === item.packageVersion;
    if (joins && current) current.push(item);
    else batches.push([item]);
  }
  return batches;
}

/**
 * Skickar väntande avläsningar till servern. En avläsning ändrar status först
 * när servern har kvitterat den; vid nätfel eller fel svar ligger den kvar.
 */
export async function syncPending(store: ReadoutStore, raceId: string, deps: SyncDependencies): Promise<SyncOutcome> {
  const batches = pendingBatches(await store.list(raceId));
  if (batches.length === 0) return { kind: "idle" };
  let count = 0;
  for (const items of batches) {
    const first = items[0]!;
    const batch: DeviceBatch = {
      deviceId: first.deviceId, sessionId: first.sessionId, packageVersion: first.packageVersion,
      firstSequence: first.localSequence, lastSequence: items.at(-1)!.localSequence,
      events: items.map((item) => ({ localSequence: item.localSequence, stationReceivedAt: item.stationReceivedAt,
        transport: "sportident" as const, payload: item.payload, contentHash: item.contentHash }))
    };
    const csrf = deps.csrf();
    if (!csrf) return { kind: "unauthorized" };
    let response: Response;
    try {
      response = await deps.fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/readouts`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify(batch)
      });
    } catch {
      return { kind: "offline" };
    }
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (!response.ok) return { kind: "failed", status: response.status };
    const acknowledgement = deviceBatchAcknowledgementSchema.parse(await response.json());
    for (const ack of acknowledgement.acknowledgements) {
      const item = items.find((candidate) => candidate.localSequence === ack.localSequence);
      if (!item || item.contentHash !== ack.contentHash) continue;
      await store.update({
        ...item,
        status: ack.status,
        ...("serverResult" in ack && ack.serverResult ? { serverResult: ack.serverResult } : {}),
        ...(ack.status === "rejected" ? { rejectedReason: ack.reason } : {})
      });
      count += 1;
    }
  }
  return { kind: "synced", count };
}
