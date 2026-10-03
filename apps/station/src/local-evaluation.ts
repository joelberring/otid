import {
  canonicalJsonBytes,
  evaluationResultSchema,
  localStationEvaluationSchema,
  simulatorPayloadSchema,
  stationPackagePayloadSchema,
  type LocalStationEvaluation,
  type SimulatorPayload,
  type StationPackagePayload
} from "@o-tid/contracts";
import { sha256Hex } from "@o-tid/device-transport";
import {
  evaluateCardReadout,
  RESULT_ENGINE_VERSION,
  type EvaluationReadout,
  type EvaluationResult,
  type RaceSnapshot
} from "@o-tid/domain";
import {
  OtidStationStore,
  type LoadedActivePackage,
  type RecordedLocalEvaluation,
  type StationStoreCapacitorPlugin,
  type StoredOutboxEvent
} from "./station-store-plugin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseLoadedActivePackage(value: unknown): LoadedActivePackage {
  if (!isRecord(value) || !hasExactKeys(value, [
    "raceId", "packageVersion", "payloadSha256", "keyId", "payloadJson"
  ])) throw new Error("Stationslagret gav ett ogiltigt aktivt paket");
  if (typeof value.raceId !== "string" || !UUID_PATTERN.test(value.raceId) ||
      typeof value.packageVersion !== "number" || !Number.isSafeInteger(value.packageVersion) || value.packageVersion < 1 ||
      typeof value.payloadSha256 !== "string" || !SHA256_PATTERN.test(value.payloadSha256) ||
      typeof value.keyId !== "string" || !SHA256_PATTERN.test(value.keyId) ||
      typeof value.payloadJson !== "string" || value.payloadJson.length === 0) {
    throw new Error("Stationslagret gav ett ogiltigt aktivt paket");
  }
  return {
    raceId: value.raceId,
    packageVersion: value.packageVersion,
    payloadSha256: value.payloadSha256,
    keyId: value.keyId,
    payloadJson: value.payloadJson
  };
}

function parseRecordedEvaluation(value: unknown): RecordedLocalEvaluation {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "deviceId", "localSequence", "evaluationHash"]) ||
      (value.status !== "stored" && value.status !== "duplicate") ||
      typeof value.deviceId !== "string" || !UUID_PATTERN.test(value.deviceId) ||
      typeof value.localSequence !== "number" || !Number.isSafeInteger(value.localSequence) || value.localSequence < 1 ||
      typeof value.evaluationHash !== "string" || !SHA256_PATTERN.test(value.evaluationHash)) {
    throw new Error("Stationslagret gav ett ogiltigt bedömningssvar");
  }
  return {
    status: value.status,
    deviceId: value.deviceId,
    localSequence: value.localSequence,
    evaluationHash: value.evaluationHash
  };
}

function toDomainReadout(payload: SimulatorPayload): EvaluationReadout {
  return {
    cardNumber: payload.cardNumber,
    punches: payload.punches.map((punch) => ({ ...punch })),
    ...(payload.startPunchedAt === undefined ? {} : { startPunchedAt: payload.startPunchedAt }),
    ...(payload.finishPunchedAt === undefined ? {} : { finishPunchedAt: payload.finishPunchedAt })
  };
}

function toDomainSnapshot(snapshot: StationPackagePayload["raceSnapshot"]): RaceSnapshot {
  return {
    race: { ...snapshot.race },
    classes: snapshot.classes.map((raceClass) => ({
      id: raceClass.id,
      raceId: raceClass.raceId,
      name: raceClass.name,
      courseVersionId: raceClass.courseVersionId,
      startRule: raceClass.startRule,
      ...(raceClass.externalIdentity === undefined ? {} : { externalIdentity: { ...raceClass.externalIdentity } })
    })),
    courses: snapshot.courses.map((course) => ({
      id: course.id,
      raceId: course.raceId,
      name: course.name,
      ...(course.externalIdentity === undefined ? {} : { externalIdentity: { ...course.externalIdentity } }),
      versions: course.versions.map((version) => ({
        id: version.id,
        courseId: version.courseId,
        version: version.version,
        createdAt: version.createdAt,
        controls: version.controls.map((control) => ({ ...control }))
      }))
    })),
    entries: snapshot.entries.map((entry) => ({
      id: entry.id,
      raceId: entry.raceId,
      classId: entry.classId,
      givenName: entry.givenName,
      familyName: entry.familyName,
      ...(entry.organisationName === undefined ? {} : { organisationName: entry.organisationName }),
      ...(entry.fixedStartTime === undefined ? {} : { fixedStartTime: entry.fixedStartTime }),
      ...(entry.externalIdentity === undefined ? {} : { externalIdentity: { ...entry.externalIdentity } })
    })),
    cardAssignments: snapshot.cardAssignments.map((assignment) => ({ ...assignment })),
    classControlNeutralizations: snapshot.classControlNeutralizations.map((neutralization) => ({ ...neutralization }))
  };
}

export interface ValidatedActivePackage {
  metadata: Omit<LoadedActivePackage, "payloadJson">;
  payload: StationPackagePayload;
}

export async function loadValidatedActivePackage(
  raceId: string,
  store: StationStoreCapacitorPlugin = OtidStationStore
): Promise<ValidatedActivePackage> {
  if (!UUID_PATTERN.test(raceId)) throw new Error("Lopp-id är ogiltigt");
  const loaded = parseLoadedActivePackage(await store.loadActivePackage({ raceId }));
  const payloadHash = sha256Hex(new TextEncoder().encode(loaded.payloadJson));
  if (payloadHash !== loaded.payloadSha256) throw new Error("Det aktiva paketets payloadhash matchar inte metadata");

  let decoded: unknown;
  try {
    decoded = JSON.parse(loaded.payloadJson);
  } catch {
    throw new Error("Det aktiva paketets payload är inte giltig JSON");
  }
  const payload = stationPackagePayloadSchema.parse(decoded);
  if (payload.raceId !== loaded.raceId || payload.packageVersion !== loaded.packageVersion ||
      payload.verificationKey.keyId !== loaded.keyId) {
    throw new Error("Det aktiva paketets metadata matchar inte payloaden");
  }
  if (new TextDecoder().decode(canonicalJsonBytes(payload)) !== loaded.payloadJson) {
    throw new Error("Det aktiva paketets payload är inte canonical JSON");
  }
  return {
    metadata: {
      raceId: loaded.raceId,
      packageVersion: loaded.packageVersion,
      payloadSha256: loaded.payloadSha256,
      keyId: loaded.keyId
    },
    payload
  };
}

export type LocalEvaluationOutcome =
  | {
      kind: "evaluated";
      event: StoredOutboxEvent;
      evaluation: EvaluationResult;
      persisted: RecordedLocalEvaluation;
      packagePayloadSha256: string;
    }
  | {
      kind: "queued-without-evaluation";
      reason: "ENGINE_VERSION_MISMATCH";
      event: StoredOutboxEvent;
      packageEngineVersion: string;
      localEngineVersion: string;
    };

export interface EvaluateAndPersistOptions {
  raceId: string;
  sessionId: string;
  simulatorPayload: unknown;
  stationReceivedAt?: string;
  store?: StationStoreCapacitorPlugin;
}

export async function evaluateAndPersistSimulatorReadout(
  options: EvaluateAndPersistOptions
): Promise<LocalEvaluationOutcome> {
  if (!UUID_PATTERN.test(options.sessionId)) throw new Error("Sessions-id är ogiltigt");
  const store = options.store ?? OtidStationStore;
  const active = await loadValidatedActivePackage(options.raceId, store);
  const simulatorPayload: SimulatorPayload = simulatorPayloadSchema.parse(options.simulatorPayload);
  // Device ingest has always defined contentHash over JSON.stringify(payload).
  // Preserve that wire contract; canonical JSON is reserved for signed packages
  // and the separately hashed local evaluation record.
  const payloadJson = JSON.stringify(simulatorPayload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const contentHash = sha256Hex(payloadBytes);
  const stationReceivedAt = options.stationReceivedAt ?? new Date().toISOString();

  const event = await store.enqueueEvent({
    raceId: active.metadata.raceId,
    sessionId: options.sessionId,
    packageVersion: active.metadata.packageVersion,
    stationReceivedAt,
    transport: "simulator",
    payloadJson,
    contentHash
  });

  if (active.payload.resultEngineVersion !== RESULT_ENGINE_VERSION) {
    return {
      kind: "queued-without-evaluation",
      reason: "ENGINE_VERSION_MISMATCH",
      event,
      packageEngineVersion: active.payload.resultEngineVersion,
      localEngineVersion: RESULT_ENGINE_VERSION
    };
  }

  const evaluation: EvaluationResult = evaluateCardReadout(
    toDomainReadout(simulatorPayload),
    toDomainSnapshot(active.payload.raceSnapshot)
  );
  evaluationResultSchema.parse(evaluation);
  const localEvaluation: LocalStationEvaluation = localStationEvaluationSchema.parse({
    formatVersion: 1,
    deviceId: event.deviceId,
    localSequence: event.localSequence,
    raceId: event.raceId,
    packageVersion: event.packageVersion,
    packagePayloadSha256: active.metadata.payloadSha256,
    engineVersion: RESULT_ENGINE_VERSION,
    snapshotVersion: active.payload.raceSnapshot.race.snapshotVersion,
    evaluation
  });
  const evaluationBytes = canonicalJsonBytes(localEvaluation);
  const localEvaluationJson = new TextDecoder().decode(evaluationBytes);
  const evaluationHash = sha256Hex(evaluationBytes);
  const persisted = parseRecordedEvaluation(await store.recordLocalEvaluation({
    localEvaluationJson,
    evaluationHash
  }));
  if (persisted.deviceId !== event.deviceId || persisted.localSequence !== event.localSequence ||
      persisted.evaluationHash !== evaluationHash) {
    throw new Error("Stationslagrets bedömningssvar matchar inte den lokala sekvensen");
  }
  return {
    kind: "evaluated",
    event,
    evaluation,
    persisted,
    packagePayloadSha256: active.metadata.payloadSha256
  };
}
