import { deviceBatchAcknowledgementSchema, readoutRegistrationResponseSchema, sportidentReadoutPayloadSchema, type DeviceBatch } from "@o-tid/contracts";
import { CardDecodeError, decodeRecordedFrames, framesFromHex, SiTimeError } from "@o-tid/sportident";
import { buildReadoutPayload, payloadHash } from "./payload";
import type { QueuedReadout, ReadoutStore } from "./store";

export type SyncOutcome =
  | { readonly kind: "idle" }
  /** `registered`: direktanmälningar som servern kvitterade nu (avläsningspaketet behöver hämtas igen). */
  | { readonly kind: "synced"; readonly count: number; readonly registered?: number }
  | { readonly kind: "offline" }
  | { readonly kind: "unauthorized" }
  /** Steg 45: servern bad oss vänta (429). Inget markeras; kön skickas igen vid nästa försök. */
  | { readonly kind: "throttled" }
  /**
   * Översynen 2026-11-02: servern svarar inte (502, 503, 504 även efter omförsöken). Inget hålls åt sidan; kön ligger
   * kvar och skickas igen automatiskt med växande väntan. `count` är det som hann kvitteras före felet.
   */
  | { readonly kind: "unavailable"; readonly status: number; readonly count: number }
  | { readonly kind: "failed"; readonly status: number };

export interface SyncDependencies {
  readonly fetch: typeof fetch;
  /** CSRF-token ur administratörens kaka, eller undefined om den saknas. */
  readonly csrf: () => string | undefined;
  /** Väntan mellan omförsöken vid 502/503/504 (bytbar i testerna). */
  readonly sleep?: (ms: number) => Promise<void>;
}

const MAX_BATCH = 100;
/**
 * Steg 45: svar som gäller själva avläsningen (felaktig, okänd tävling eller krock) och inte går över av att vänta.
 * Översynen 2026-11-02: en avläsning hålls åt sidan först när samma svar kommer igen för samma avläsning; första
 * gången hoppas den bara över i den här omgången så att resten av kön går.
 */
const ITEM_STATUSES = new Set([400, 404, 409]);
/** Servern eller vägen dit är tillfälligt borta: skicka om automatiskt, håll aldrig något åt sidan. */
export const TRANSIENT_STATUSES = new Set([502, 503, 504]);
/** Väntan före omförsök två och tre inom samma synk när servern svarar 502/503/504. */
export const TRANSIENT_RETRY_DELAYS_MS = [500, 1_500] as const;

/**
 * Väntan till nästa automatiska synk efter `failures` synkar i rad där servern inte svarade: 2, 4, 8, 16 och sedan 30 s.
 */
export function unavailableBackoffMs(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));
}

/**
 * Sammanhängande följder av väntande avläsningar med stigande löpnummer och
 * samma enhet, session och paketversion.
 */
export function pendingBatches(items: readonly QueuedReadout[]): QueuedReadout[][] {
  const pending = items.filter((item) => item.status === "pending" && !item.serverFailedAt)
    .sort((a, b) => a.localSequence - b.localSequence);
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
 * Avläsningar som avvisades här i webbläsaren (`LOCAL_INVALID`, aldrig skickade) prövas igen mot det nuvarande schemat
 * när sidan laddas. Är de giltiga nu läggs de tillbaka i kön som väntande, med samma löpnummer: servern har aldrig sett
 * löpnumret, så det tas emot som en ny avläsning och fyller luckan i följden. Steg 36: med steg 34 gav en station som
 * skickar alla åtta block nio ramar, fler än schemat tillät. Ger antalet som lades tillbaka.
 */
export async function requeueLocallyInvalid(store: ReadoutStore, raceId: string, timeZone?: string): Promise<number> {
  let count = 0;
  for (const item of await store.list(raceId)) {
    if (item.status !== "rejected" || item.rejectedReason !== "LOCAL_INVALID") continue;
    let payload = item.payload;
    let contentHash = item.contentHash;
    if (!sportidentReadoutPayloadSchema.safeParse(payload).success) {
      // Steg 39: före steg 34 lästes block 1 (SIAC:s inställningar) som stämplingar, med kontrollkod 0, och avläsningen
      // stoppades här. Avkoda råramarna på nytt med samma tidsreferens som vid avläsningen; går det inte ligger den kvar.
      const redone = timeZone ? redecoded(item, timeZone) : undefined;
      if (!redone || !sportidentReadoutPayloadSchema.safeParse(redone).success) continue;
      payload = redone;
      contentHash = await payloadHash(redone);
    }
    const copy: { -readonly [K in keyof QueuedReadout]: QueuedReadout[K] } = { ...item, payload, contentHash, status: "pending" };
    delete copy.rejectedReason;
    await store.update(copy);
    count += 1;
  }
  return count;
}

/** Avläsningen avkodad på nytt från sina råramar, eller undefined om ramarna inte räcker (aldrig påhittade stämplingar). */
function redecoded(item: QueuedReadout, timeZone: string): QueuedReadout["payload"] | undefined {
  const old = item.payload;
  if (old.simulated || old.frames.length === 0) return undefined;
  try {
    const frames = framesFromHex(old.frames);
    const card = decodeRecordedFrames(frames);
    const received = Date.parse(item.stationReceivedAt);
    const station = old.clockSource === "station" && old.clockOffsetMs !== undefined;
    return buildReadoutPayload(card, frames, { reference: new Date(station ? received + old.clockOffsetMs! : received), timeZone,
      ...(old.stationSerial !== undefined ? { stationSerial: old.stationSerial } : {}),
      ...(old.clockSource !== undefined ? { clockSource: old.clockSource } : {}),
      ...(old.clockOffsetMs !== undefined ? { clockOffsetMs: old.clockOffsetMs } : {}),
      simulated: false });
  } catch (error) {
    if (error instanceof CardDecodeError || error instanceof SiTimeError) return undefined;
    throw error;
  }
}

type RegistrationOutcome = { readonly kind: "done"; readonly count: number } | Exclude<SyncOutcome, { kind: "idle" | "synced" }>;

/**
 * Direktanmälningar (PLAN.md steg 25) skickas först, i den ordning de gjordes, så att servern känner brickan när
 * avläsningen kommer. En anmälan ändrar status först när servern svarat: kvitto (stored) eller avvisad (rejected, till
 * exempel full klass). Vid nätfel ligger den kvar och avläsningarna väntar till nästa försök.
 */
async function syncRegistrations(store: ReadoutStore, raceId: string, deps: SyncDependencies): Promise<RegistrationOutcome> {
  let count = 0;
  for (const item of (await store.listRegistrations(raceId)).filter((row) => row.status === "pending")) {
    const csrf = deps.csrf();
    if (!csrf) return { kind: "unauthorized" };
    let response: Response;
    try {
      response = await deps.fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/readout-registrations`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf, "idempotency-key": `readout-registration:${item.requestId}` },
        body: JSON.stringify(item.request)
      });
    } catch {
      return { kind: "offline" };
    }
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    if (response.status === 400 || response.status === 404 || response.status === 409) {
      await store.updateRegistration({ ...item, status: "rejected", rejectedReason: String(response.status) });
      continue;
    }
    if (!response.ok) return { kind: "failed", status: response.status };
    const receipt = readoutRegistrationResponseSchema.parse(await response.json());
    if (receipt.requestId !== item.requestId || receipt.raceId !== raceId) throw new Error("Direktanmälans kvitto gäller en annan begäran");
    await store.updateRegistration({ ...item, status: "stored", response: receipt });
    count += 1;
  }
  return { kind: "done", count };
}

/** Skickar en sats; vid 502/503/504 görs samma begäran om efter en växande väntan. Undefined = nätfel. */
async function post(raceId: string, batch: DeviceBatch, csrf: string, deps: SyncDependencies): Promise<Response | undefined> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await deps.fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/readouts`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf }, body: JSON.stringify(batch)
      });
    } catch {
      return undefined;
    }
    const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
    if (!TRANSIENT_STATUSES.has(response.status) || delay === undefined) return response;
    await sleep(delay);
  }
}

/**
 * Skickar väntande direktanmälningar och avläsningar till servern. En avläsning ändrar status först
 * när servern har kvitterat den; vid nätfel eller fel svar ligger den kvar.
 *
 * Översynen 2026-11-02: 502/503/504 skickas om automatiskt (här två gånger, sedan väntar appen allt längre mellan
 * synkarna) och håller aldrig något åt sidan. En sats som får 400, 404, 409 eller 500 skickas om en och en; en avläsning
 * hålls åt sidan först när samma svar kommer en andra gång för just den. 500 räknas bara när andra avläsningar gick
 * igenom i samma omgång, så att ett fel på hela servern inte märker hela kön.
 */
export async function syncPending(store: ReadoutStore, raceId: string, deps: SyncDependencies): Promise<SyncOutcome> {
  const registrations = await syncRegistrations(store, raceId, deps);
  if (registrations.kind !== "done") return registrations;
  const registered = registrations.count;
  const batches = pendingBatches(await store.list(raceId));
  if (batches.length === 0) return registered > 0 ? { kind: "synced", count: 0, registered } : { kind: "idle" };
  let count = 0;
  const queue = [...batches];
  let serverError: number | undefined;
  const serverErrors: QueuedReadout[] = [];
  while (queue.length > 0) {
    const items = queue.shift()!;
    const first = items[0]!;
    const batch: DeviceBatch = {
      deviceId: first.deviceId, sessionId: first.sessionId, packageVersion: first.packageVersion,
      firstSequence: first.localSequence, lastSequence: items.at(-1)!.localSequence,
      events: items.map((item) => ({ localSequence: item.localSequence, stationReceivedAt: item.stationReceivedAt,
        transport: "sportident" as const, payload: item.payload, contentHash: item.contentHash }))
    };
    const csrf = deps.csrf();
    if (!csrf) return { kind: "unauthorized" };
    const response = await post(raceId, batch, csrf, deps);
    if (!response) return { kind: "offline" };
    if (response.status === 401 || response.status === 403) return { kind: "unauthorized" };
    // Steg 45: 429 = vänta och försök igen med nästa synk, utan att hålla något åt sidan.
    if (response.status === 429) return count > 0 ? { kind: "synced", count, ...(registered > 0 ? { registered } : {}) } : { kind: "throttled" };
    if (TRANSIENT_STATUSES.has(response.status)) return { kind: "unavailable", status: response.status, count };
    const itemProblem = response.status === 500 || ITEM_STATUSES.has(response.status);
    if (itemProblem && items.length > 1) { queue.unshift(...items.map((item) => [item])); continue; }
    if (itemProblem) {
      serverError = response.status;
      if (response.status === 500 && first.serverFailedStatus !== 500) serverErrors.push(first);
      else await strike(store, first, response.status);
      continue;
    }
    if (!response.ok) return { kind: "failed", status: response.status };
    const acknowledgement = deviceBatchAcknowledgementSchema.parse(await response.json());
    for (const ack of acknowledgement.acknowledgements) {
      const item = items.find((candidate) => candidate.localSequence === ack.localSequence);
      if (!item || item.contentHash !== ack.contentHash) continue;
      await store.update({
        ...released(item),
        status: ack.status,
        ...("serverResult" in ack && ack.serverResult ? { serverResult: ack.serverResult } : {}),
        // Steg 57: placeringen när servern svarade (avläsningen kvitteras en gång).
        ...("placement" in ack && ack.placement ? { placement: ack.placement } : {}),
        ...(ack.status === "rejected" ? { rejectedReason: ack.reason } : {})
      });
      count += 1;
    }
  }
  // 500 för en enskild avläsning medan andra gick igenom: den första gången noteras, nästa gång hålls den.
  if (count > 0) for (const item of serverErrors) await strike(store, item, 500);
  if (count === 0 && serverError !== undefined) return { kind: "failed", status: serverError };
  return { kind: "synced", count, ...(registered > 0 ? { registered } : {}) };
}

/** Första gången: svaret noteras och avläsningen skickas igen nästa synk. Samma svar igen: den hålls åt sidan. */
async function strike(store: ReadoutStore, item: QueuedReadout, status: number): Promise<void> {
  if (item.serverFailedStatus === status) {
    await store.update({ ...item, serverFailedAt: new Date().toISOString(), serverFailedStatus: status });
  } else {
    const copy: { -readonly [K in keyof QueuedReadout]: QueuedReadout[K] } = { ...item, serverFailedStatus: status };
    delete copy.serverFailedAt;
    await store.update(copy);
  }
}

function released(item: QueuedReadout): QueuedReadout {
  const copy: { -readonly [K in keyof QueuedReadout]: QueuedReadout[K] } = { ...item };
  delete copy.serverFailedAt;
  delete copy.serverFailedStatus;
  return copy;
}

/** Avläsningar som servern inte kunde ta emot (serverfel, eller 400/404/409 från steg 45) och som hålls åt sidan. */
export function heldReadouts(items: readonly QueuedReadout[]): QueuedReadout[] {
  return items.filter((item) => item.status === "pending" && !!item.serverFailedAt);
}

/** "Försök igen": avläsningarna som hölls åt sidan skickas med nästa synk. */
export async function releaseHeldReadouts(store: ReadoutStore, raceId: string): Promise<number> {
  const held = heldReadouts(await store.list(raceId));
  for (const item of held) {
    await store.update(released(item));
  }
  return held.length;
}
