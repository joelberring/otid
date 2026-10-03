import {
  deviceBatchAcknowledgementSchema,
  deviceBatchSchema,
  simulatorPayloadSchema,
  type DeviceBatchAcknowledgement
} from "@o-tid/contracts";
import { sha256Hex } from "@o-tid/device-transport";
import { parseBoundedJsonResponse } from "./native-http";
import { authorizedStationRequester, type AuthorizedStationRequester } from "./station-credential";
import { OtidStationStore, type StationStoreCapacitorPlugin, type StoredOutboxEvent } from "./station-store-plugin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ACK_JSON_LENGTH = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parsePendingEvent(value: unknown): StoredOutboxEvent {
  const keys = [
    "raceId", "sessionId", "packageVersion", "stationReceivedAt", "transport",
    "payloadJson", "contentHash", "deviceId", "localSequence"
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
      typeof value.raceId !== "string" || !UUID_PATTERN.test(value.raceId) ||
      typeof value.sessionId !== "string" || !UUID_PATTERN.test(value.sessionId) ||
      typeof value.deviceId !== "string" || !UUID_PATTERN.test(value.deviceId) ||
      typeof value.packageVersion !== "number" || !Number.isSafeInteger(value.packageVersion) || value.packageVersion < 1 ||
      typeof value.localSequence !== "number" || !Number.isSafeInteger(value.localSequence) || value.localSequence < 1 ||
      typeof value.stationReceivedAt !== "string" || !Number.isFinite(Date.parse(value.stationReceivedAt)) ||
      value.transport !== "simulator" || typeof value.payloadJson !== "string" ||
      typeof value.contentHash !== "string" || !SHA256_PATTERN.test(value.contentHash)) {
    throw new Error("Stationslagret gav en ogiltig pending-post");
  }
  return {
    raceId: value.raceId,
    sessionId: value.sessionId,
    packageVersion: value.packageVersion,
    stationReceivedAt: value.stationReceivedAt,
    transport: value.transport,
    payloadJson: value.payloadJson,
    contentHash: value.contentHash,
    deviceId: value.deviceId,
    localSequence: value.localSequence
  };
}

function parsePendingList(value: unknown): StoredOutboxEvent[] {
  if (!isRecord(value) || !hasExactKeys(value, ["events"]) || !Array.isArray(value.events) || value.events.length > 1) {
    throw new Error("Stationslagret gav en ogiltig pending-lista");
  }
  return value.events.map(parsePendingEvent);
}

function payloadFor(event: StoredOutboxEvent) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(event.payloadJson) as unknown;
  } catch {
    throw new Error("Pending-postens payload är inte giltig JSON");
  }
  const payload = simulatorPayloadSchema.parse(decoded);
  const wireJson = JSON.stringify(payload);
  if (wireJson !== event.payloadJson || sha256Hex(new TextEncoder().encode(wireJson)) !== event.contentHash) {
    throw new Error("Pending-postens payload eller innehållshash är korrupt");
  }
  return payload;
}

function assertExactAcknowledgement(
  event: StoredOutboxEvent,
  acknowledgement: DeviceBatchAcknowledgement
): void {
  if (acknowledgement.deviceId !== event.deviceId || acknowledgement.acknowledgements.length !== 1) {
    throw new Error("Serverkvittensen matchar inte skickad enhet och kardinalitet");
  }
  const [item] = acknowledgement.acknowledgements;
  if (item === undefined || item.localSequence !== event.localSequence || item.contentHash !== event.contentHash) {
    throw new Error("Serverkvittensen matchar inte skickad sekvens och hash");
  }
  const expectedStatus = event.packageVersion === acknowledgement.currentPackageVersion
    ? "current"
    : event.packageVersion < acknowledgement.currentPackageVersion ? "stale" : "ahead";
  if (acknowledgement.packageVersionStatus !== expectedStatus ||
      acknowledgement.packageUpdateRequired !== (expectedStatus === "stale")) {
    throw new Error("Serverkvittensen har en motsägande paketstatus");
  }
}

function parseAppliedAcknowledgements(value: unknown): {
  acknowledgedCount: number;
  rejectedCount: number;
  unchangedCount: number;
  pendingCount: number;
} {
  const keys = ["acknowledgedCount", "rejectedCount", "unchangedCount", "pendingCount"];
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw new Error("Stationslagret gav ett ogiltigt kvittensresultat");
  }
  for (const key of keys) {
    if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new Error("Stationslagret gav ett ogiltigt kvittensresultat");
    }
  }
  return {
    acknowledgedCount: value.acknowledgedCount as number,
    rejectedCount: value.rejectedCount as number,
    unchangedCount: value.unchangedCount as number,
    pendingCount: value.pendingCount as number
  };
}

export interface StationSyncResult {
  processedCount: number;
  pendingCount: number;
  lastAcknowledgement: DeviceBatchAcknowledgement | null;
}

export interface StationSyncCoordinatorOptions {
  baseUrl: string;
  store?: StationStoreCapacitorPlugin;
  requester?: AuthorizedStationRequester;
  maxEventsPerFlush?: number;
}

export class StationSyncCoordinator {
  readonly #baseUrl: string;
  readonly #store: StationStoreCapacitorPlugin;
  readonly #requester: AuthorizedStationRequester;
  readonly #maxEventsPerFlush: number;
  #inFlight: Promise<StationSyncResult> | undefined;

  constructor(options: StationSyncCoordinatorOptions) {
    this.#baseUrl = options.baseUrl;
    this.#store = options.store ?? OtidStationStore;
    this.#requester = options.requester ?? authorizedStationRequester(this.#store);
    this.#maxEventsPerFlush = options.maxEventsPerFlush ?? 100;
    if (!Number.isSafeInteger(this.#maxEventsPerFlush) || this.#maxEventsPerFlush < 1 || this.#maxEventsPerFlush > 1_000) {
      throw new Error("Synkgränsen är ogiltig");
    }
  }

  flush(): Promise<StationSyncResult> {
    this.#inFlight ??= this.#flushOrdered().finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  async #flushOrdered(): Promise<StationSyncResult> {
    let processedCount = 0;
    let pendingCount = 0;
    let lastAcknowledgement: DeviceBatchAcknowledgement | null = null;
    while (processedCount < this.#maxEventsPerFlush) {
      const [event] = parsePendingList(await this.#store.listPending({ limit: 1 }));
      if (event === undefined) break;
      const payload = payloadFor(event);
      const batch = deviceBatchSchema.parse({
        deviceId: event.deviceId,
        sessionId: event.sessionId,
        packageVersion: event.packageVersion,
        firstSequence: event.localSequence,
        lastSequence: event.localSequence,
        events: [{
          localSequence: event.localSequence,
          stationReceivedAt: event.stationReceivedAt,
          transport: event.transport,
          payload,
          contentHash: event.contentHash
        }]
      });
      const response = await this.#requester({
        baseUrl: this.#baseUrl,
        raceId: event.raceId,
        resource: "device-batches",
        method: "POST",
        bodyJson: JSON.stringify(batch),
        idempotencyKey: `${event.deviceId}:${event.localSequence}:${event.localSequence}`,
        connectTimeoutMs: 10_000,
        readTimeoutMs: 30_000
      });
      if (response.status < 200 || response.status >= 300) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Stationsautentisering krävs; kön ligger kvar lokalt (${response.status})`);
        }
        throw new Error(`Stationssynken misslyckades (${response.status})`);
      }
      const decoded = parseBoundedJsonResponse(response, MAX_ACK_JSON_LENGTH, "en giltig stationskvittens");
      const acknowledgement = deviceBatchAcknowledgementSchema.parse(decoded);
      assertExactAcknowledgement(event, acknowledgement);
      const applied = parseAppliedAcknowledgements(
        await this.#store.applyAcknowledgements({ acknowledgementJson: JSON.stringify(acknowledgement) })
      );
      pendingCount = applied.pendingCount;
      processedCount += 1;
      lastAcknowledgement = acknowledgement;
    }
    return { processedCount, pendingCount, lastAcknowledgement };
  }
}
