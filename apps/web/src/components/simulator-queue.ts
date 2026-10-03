import {
  deviceBatchAcknowledgementSchema,
  type DeviceBatchAcknowledgement,
  type DeviceEventAcknowledgement
} from "@o-tid/contracts";

export type SimulatorPayload = {
  cardNumber: string;
  startPunchedAt: string;
  finishPunchedAt: string;
  punches: Array<{ code: number; punchedAt: string }>;
};

export type SimulatorEvent = {
  localSequence: number;
  stationReceivedAt: string;
  transport: "simulator";
  payload: SimulatorPayload;
  contentHash: string;
};

export type PendingSimulatorBatch = {
  queueId: string;
  deviceId: string;
  sessionId: string;
  packageVersion: number;
  event: SimulatorEvent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSimulatorPayload(value: unknown): value is SimulatorPayload {
  if (!isRecord(value) || typeof value.cardNumber !== "string" ||
      typeof value.startPunchedAt !== "string" || typeof value.finishPunchedAt !== "string" ||
      !Array.isArray(value.punches)) return false;

  return value.punches.every((punch) => isRecord(punch) && Number.isInteger(punch.code) && typeof punch.punchedAt === "string");
}

function isSimulatorEvent(value: unknown): value is SimulatorEvent {
  return isRecord(value) && Number.isInteger(value.localSequence) && Number(value.localSequence) > 0 &&
    typeof value.stationReceivedAt === "string" && value.transport === "simulator" &&
    isSimulatorPayload(value.payload) && typeof value.contentHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.contentHash);
}

export function isValidSimulatorIdentity(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseBatch(
  value: unknown,
  fallbackPackageVersion: number,
  fallbackDeviceId: string,
  createQueueId: () => string
): PendingSimulatorBatch | undefined {
  if (isRecord(value) && Number.isInteger(value.packageVersion) && Number(value.packageVersion) > 0 && isSimulatorEvent(value.event)) {
    const hasStoredIdentity = "queueId" in value || "deviceId" in value || "sessionId" in value;
    if (hasStoredIdentity) {
      if (!isValidSimulatorIdentity(value.queueId) || !isValidSimulatorIdentity(value.deviceId) ||
          !isValidSimulatorIdentity(value.sessionId)) return undefined;
      return {
        queueId: value.queueId,
        deviceId: value.deviceId,
        sessionId: value.sessionId,
        packageVersion: Number(value.packageVersion),
        event: value.event
      };
    }
    const queueId = createQueueId();
    if (!isValidSimulatorIdentity(queueId) || !isValidSimulatorIdentity(fallbackDeviceId)) return undefined;
    return {
      queueId,
      deviceId: fallbackDeviceId,
      sessionId: fallbackDeviceId,
      packageVersion: Number(value.packageVersion),
      event: value.event
    };
  }

  // TASK 001 initially stored bare events. They can only be migrated with the
  // package version and device identity current on the first load after this
  // upgrade. The caller immediately persists the migrated shape.
  if (isSimulatorEvent(value) && isValidSimulatorIdentity(fallbackDeviceId)) {
    const queueId = createQueueId();
    if (!isValidSimulatorIdentity(queueId)) return undefined;
    return {
      queueId,
      deviceId: fallbackDeviceId,
      sessionId: fallbackDeviceId,
      packageVersion: fallbackPackageVersion,
      event: value
    };
  }
  return undefined;
}

export function parseStoredQueue(
  serialized: string | null,
  fallbackPackageVersion: number,
  fallbackDeviceId: string,
  createQueueId: () => string = () => crypto.randomUUID()
): PendingSimulatorBatch[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const batch = parseBatch(item, fallbackPackageVersion, fallbackDeviceId, createQueueId);
      return batch ? [batch] : [];
    });
  } catch {
    return [];
  }
}

export function storedQueueItemCount(serialized: string | null): number | undefined {
  if (serialized === null) return 0;
  try {
    const value: unknown = JSON.parse(serialized);
    return Array.isArray(value) ? value.length : undefined;
  } catch {
    return undefined;
  }
}

export function parseStoredBatch(
  serialized: string | null,
  fallbackPackageVersion: number,
  fallbackDeviceId: string,
  createQueueId: () => string = () => crypto.randomUUID()
): PendingSimulatorBatch | undefined {
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    return parseBatch(value, fallbackPackageVersion, fallbackDeviceId, createQueueId);
  } catch {
    return undefined;
  }
}

export function withoutAcknowledgedBatch(
  queue: PendingSimulatorBatch[],
  acknowledged: PendingSimulatorBatch
): PendingSimulatorBatch[] {
  const index = queue.findIndex((batch) => batch.queueId === acknowledged.queueId);
  return index < 0 ? queue : [...queue.slice(0, index), ...queue.slice(index + 1)];
}

export function validatedAcknowledgementForEvent(
  value: unknown,
  expected: PendingSimulatorBatch
): { batch: DeviceBatchAcknowledgement; event: DeviceEventAcknowledgement } | undefined {
  const parsed = deviceBatchAcknowledgementSchema.safeParse(value);
  if (!parsed.success || parsed.data.deviceId !== expected.deviceId ||
      parsed.data.acknowledgements.length !== 1) return undefined;
  const expectedStatus = expected.packageVersion === parsed.data.currentPackageVersion
    ? "current"
    : expected.packageVersion < parsed.data.currentPackageVersion ? "stale" : "ahead";
  if (parsed.data.packageVersionStatus !== expectedStatus) return undefined;
  const [event] = parsed.data.acknowledgements;
  if (!event || event.localSequence !== expected.event.localSequence ||
      event.contentHash !== expected.event.contentHash) return undefined;
  return { batch: parsed.data, event };
}

export function isDurablyAcknowledged(event: DeviceEventAcknowledgement): boolean {
  return event.status === "stored" || event.status === "duplicate";
}

export function packageStatusNotice(acknowledgement: DeviceBatchAcknowledgement): string {
  if (acknowledgement.packageUpdateRequired) {
    return ` Nytt tävlingspaket krävs (serverversion ${acknowledgement.currentPackageVersion}).`;
  }
  if (acknowledgement.packageVersionStatus === "ahead") {
    return ` Stationens paketversion är högre än serverns (${acknowledgement.currentPackageVersion}).`;
  }
  return "";
}
