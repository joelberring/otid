import {
  canonicalJsonBytes,
  localStationEvaluationSchema,
  serverResultSummarySchema,
  type LocalStationEvaluation,
  type ServerResultSummary
} from "@o-tid/contracts";
import { sha256Hex } from "@o-tid/device-transport";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { loadValidatedActivePackage } from "./local-evaluation";
import { readStationCredentialStatus } from "./station-credential";
import { readStationPairingStatus } from "./station-pairing";
import {
  OtidStationStore,
  type ActivePackageMetadata,
  type LatestEvaluationPair,
  type LatestLocalEvaluation,
  type ServerAckObservation,
  type StationCredentialStatus,
  type StationPairingStatus,
  type StationStoreCapacitorPlugin,
  type StationStoreStatus
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

function parseActivePackage(value: unknown): ActivePackageMetadata {
  if (!isRecord(value) || !hasExactKeys(value, ["raceId", "packageVersion", "payloadSha256", "keyId"]) ||
      typeof value.raceId !== "string" || !UUID_PATTERN.test(value.raceId) ||
      typeof value.packageVersion !== "number" || !Number.isSafeInteger(value.packageVersion) || value.packageVersion < 1 ||
      typeof value.payloadSha256 !== "string" || !SHA256_PATTERN.test(value.payloadSha256) ||
      typeof value.keyId !== "string" || !SHA256_PATTERN.test(value.keyId)) {
    throw new Error("Stationslagret gav ogiltig paketstatus");
  }
  return {
    raceId: value.raceId,
    packageVersion: value.packageVersion,
    payloadSha256: value.payloadSha256,
    keyId: value.keyId
  };
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Stationslagret gav ogiltigt ${label}`);
  }
  return value;
}

function parseStatus(value: unknown): StationStoreStatus {
  if (!isRecord(value) || !hasExactKeys(value, [
    "deviceId", "nextLocalSequence", "activePackages", "pendingCount", "readoutCount",
    "acknowledgedCount", "rejectedCount", "latestLocalEvaluation"
  ]) || typeof value.deviceId !== "string" || !UUID_PATTERN.test(value.deviceId) ||
      !Array.isArray(value.activePackages)) {
    throw new Error("Stationslagret gav ogiltig status");
  }
  const nextLocalSequence = parseNonNegativeInteger(value.nextLocalSequence, "nästa sekvens");
  if (nextLocalSequence < 1) throw new Error("Stationslagret gav ogiltig nästa sekvens");
  const pendingCount = parseNonNegativeInteger(value.pendingCount, "antal väntande");
  const readoutCount = parseNonNegativeInteger(value.readoutCount, "antal avlästa");
  const acknowledgedCount = parseNonNegativeInteger(value.acknowledgedCount, "antal kvitterade");
  const rejectedCount = parseNonNegativeInteger(value.rejectedCount, "antal avvisade");
  if (pendingCount + acknowledgedCount + rejectedCount !== readoutCount || nextLocalSequence !== readoutCount + 1) {
    throw new Error("Stationslagrets räknare är inkonsistenta");
  }

  let latestLocalEvaluation: StationStoreStatus["latestLocalEvaluation"] = null;
  if (value.latestLocalEvaluation !== null) {
    if (!isRecord(value.latestLocalEvaluation) ||
        !hasExactKeys(value.latestLocalEvaluation, ["localEvaluationJson", "evaluationHash"]) ||
        typeof value.latestLocalEvaluation.localEvaluationJson !== "string" ||
        typeof value.latestLocalEvaluation.evaluationHash !== "string" ||
        !SHA256_PATTERN.test(value.latestLocalEvaluation.evaluationHash)) {
      throw new Error("Stationslagret gav ogiltig senaste bedömning");
    }
    latestLocalEvaluation = {
      localEvaluationJson: value.latestLocalEvaluation.localEvaluationJson,
      evaluationHash: value.latestLocalEvaluation.evaluationHash
    };
  }

  return {
    deviceId: value.deviceId,
    nextLocalSequence,
    activePackages: value.activePackages.map(parseActivePackage),
    pendingCount,
    readoutCount,
    acknowledgedCount,
    rejectedCount,
    latestLocalEvaluation
  };
}

function parseLocalEvaluation(record: unknown): LocalStationEvaluation | null {
  if (record === null) return null;
  if (!isRecord(record) || !hasExactKeys(record, ["localEvaluationJson", "evaluationHash"]) ||
      typeof record.localEvaluationJson !== "string" || typeof record.evaluationHash !== "string" ||
      !SHA256_PATTERN.test(record.evaluationHash)) {
    throw new Error("Stationslagret gav en ogiltig lokal bedömning");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(record.localEvaluationJson) as unknown;
  } catch {
    throw new Error("Senaste lokala bedömningen är inte giltig JSON");
  }
  const evaluation = localStationEvaluationSchema.parse(decoded);
  const expectedHash = sha256Hex(canonicalJsonBytes(evaluation));
  if (expectedHash !== record.evaluationHash) {
    throw new Error("Senaste lokala bedömningens hash matchar inte");
  }
  return evaluation;
}

function parseObservation(value: unknown): {
  observation: ServerAckObservation;
  serverResult: ServerResultSummary | null;
} {
  const keys = [
    "observationHash", "rawMessageId", "acknowledgementStatus", "rejectionReason",
    "currentPackageVersion", "packageVersionStatus", "packageUpdateRequired",
    "serverResultJson", "serverResultHash", "evaluationHash", "observedAtEpochMs"
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
      typeof value.observationHash !== "string" || !SHA256_PATTERN.test(value.observationHash) ||
      (value.rawMessageId !== null && (typeof value.rawMessageId !== "string" || !UUID_PATTERN.test(value.rawMessageId))) ||
      (value.acknowledgementStatus !== "stored" && value.acknowledgementStatus !== "duplicate" &&
        value.acknowledgementStatus !== "rejected") ||
      (value.rejectionReason !== null && typeof value.rejectionReason !== "string") ||
      typeof value.currentPackageVersion !== "number" || !Number.isSafeInteger(value.currentPackageVersion) ||
      value.currentPackageVersion < 1 ||
      (value.packageVersionStatus !== "current" && value.packageVersionStatus !== "stale" &&
        value.packageVersionStatus !== "ahead") || typeof value.packageUpdateRequired !== "boolean" ||
      value.packageUpdateRequired !== (value.packageVersionStatus === "stale") ||
      typeof value.observedAtEpochMs !== "number" || !Number.isSafeInteger(value.observedAtEpochMs) ||
      value.observedAtEpochMs < 0 ||
      (value.serverResultJson !== null && typeof value.serverResultJson !== "string") ||
      (value.serverResultHash !== null && typeof value.serverResultHash !== "string") ||
      (value.evaluationHash !== null && typeof value.evaluationHash !== "string")) {
    throw new Error("Stationslagret gav en ogiltig central observation");
  }
  const observation: ServerAckObservation = {
    observationHash: value.observationHash,
    rawMessageId: value.rawMessageId,
    acknowledgementStatus: value.acknowledgementStatus,
    rejectionReason: value.rejectionReason,
    currentPackageVersion: value.currentPackageVersion,
    packageVersionStatus: value.packageVersionStatus,
    packageUpdateRequired: value.packageUpdateRequired,
    serverResultJson: value.serverResultJson,
    serverResultHash: value.serverResultHash,
    evaluationHash: value.evaluationHash,
    observedAtEpochMs: value.observedAtEpochMs
  };
  if ((observation.acknowledgementStatus === "rejected" &&
      (observation.rawMessageId !== null || observation.rejectionReason === null || observation.serverResultJson !== null)) ||
      (observation.acknowledgementStatus !== "rejected" &&
      (observation.rawMessageId === null || observation.rejectionReason !== null))) {
    throw new Error("Den centrala observationens statusfält är motsägande");
  }
  if (value.serverResultJson === null) {
    if (value.serverResultHash !== null || value.evaluationHash !== null) {
      throw new Error("Den centrala observationens resultatfält är motsägande");
    }
    return { observation, serverResult: null };
  }
  if (value.serverResultHash === null || !SHA256_PATTERN.test(value.serverResultHash) ||
      value.evaluationHash === null || !SHA256_PATTERN.test(value.evaluationHash)) {
    throw new Error("Den centrala observationens resultathash saknas");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(value.serverResultJson) as unknown;
  } catch {
    throw new Error("Den centrala observationens resultat är inte giltig JSON");
  }
  const serverResult = serverResultSummarySchema.parse(decoded);
  const canonical = canonicalJsonBytes(serverResult);
  if (new TextDecoder().decode(canonical) !== value.serverResultJson ||
      sha256Hex(canonical) !== value.serverResultHash ||
      serverResult.evaluationHash !== value.evaluationHash) {
    throw new Error("Den centrala observationens resultat eller hash matchar inte");
  }
  return { observation, serverResult };
}

function parsePair(value: unknown, raceId: string): {
  pair: LatestEvaluationPair;
  localEvaluation: LocalStationEvaluation | null;
  serverResult: ServerResultSummary | null;
} | null {
  if (value === null) return null;
  const keys = [
    "deviceId", "localSequence", "raceId", "packageVersion", "contentHash", "outboxState",
    "rejectionReason", "localEvaluation", "serverObservation"
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
      typeof value.deviceId !== "string" || !UUID_PATTERN.test(value.deviceId) ||
      typeof value.raceId !== "string" || !UUID_PATTERN.test(value.raceId) || value.raceId !== raceId ||
      typeof value.localSequence !== "number" || !Number.isSafeInteger(value.localSequence) || value.localSequence < 1 ||
      typeof value.packageVersion !== "number" || !Number.isSafeInteger(value.packageVersion) || value.packageVersion < 1 ||
      typeof value.contentHash !== "string" || !SHA256_PATTERN.test(value.contentHash) ||
      (value.outboxState !== "PENDING" && value.outboxState !== "ACKNOWLEDGED" && value.outboxState !== "REJECTED") ||
      (value.rejectionReason !== null && typeof value.rejectionReason !== "string")) {
    throw new Error("Stationslagret gav ett ogiltigt lokalt/centralt par");
  }
  if ((value.outboxState === "REJECTED") !== (value.rejectionReason !== null)) {
    throw new Error("Stationslagrets outboxstatus och avvisningsorsak motsäger varandra");
  }
  const localEvaluation = parseLocalEvaluation(value.localEvaluation);
  if (localEvaluation !== null && (localEvaluation.deviceId !== value.deviceId ||
      localEvaluation.localSequence !== value.localSequence || localEvaluation.raceId !== value.raceId ||
      localEvaluation.packageVersion !== value.packageVersion)) {
    throw new Error("Den lokala bedömningen matchar inte outboxposten");
  }
  const parsedObservation = value.serverObservation === null ? null : parseObservation(value.serverObservation);
  const pair: LatestEvaluationPair = {
    deviceId: value.deviceId,
    localSequence: value.localSequence,
    raceId: value.raceId,
    packageVersion: value.packageVersion,
    contentHash: value.contentHash,
    outboxState: value.outboxState,
    rejectionReason: value.rejectionReason,
    localEvaluation: value.localEvaluation as LatestLocalEvaluation | null,
    serverObservation: parsedObservation?.observation ?? null
  };
  return { pair, localEvaluation, serverResult: parsedObservation?.serverResult ?? null };
}

export type PackageOperationalState =
  | { kind: "missing" }
  | { kind: "ready"; raceId: string; packageVersion: number }
  | { kind: "incompatible"; raceId: string; packageVersion: number; packageEngineVersion: string };

export interface StationOperationalStatus {
  online: boolean;
  deviceId: string;
  readoutCount: number;
  pendingCount: number;
  acknowledgedCount: number;
  rejectedCount: number;
  credentialState: StationCredentialStatus;
  pairingState: StationPairingStatus;
  packageState: PackageOperationalState;
  latestLocalEvaluation: LocalStationEvaluation | null;
  centralSync: {
    latestContactAtEpochMs: number | null;
    currentPackageVersion: number | null;
    packageVersionStatus: "current" | "stale" | "ahead" | null;
    packageUpdateRequired: boolean;
    comparison:
      | { kind: "none" }
      | { kind: "pending"; localSequence: number }
      | { kind: "rejected"; localSequence: number; reason: string }
      | { kind: "central-missing"; localSequence: number }
      | { kind: "local-missing"; localSequence: number; serverResult: ServerResultSummary }
      | { kind: "version-divergence"; localSequence: number; serverResult: ServerResultSummary }
      | { kind: "match"; localSequence: number; serverResult: ServerResultSummary }
      | { kind: "different"; localSequence: number; serverResult: ServerResultSummary };
  };
}

export async function readStationOperationalStatus(options: {
  raceId?: string;
  online: boolean;
  store?: StationStoreCapacitorPlugin;
}): Promise<StationOperationalStatus> {
  const store = options.store ?? OtidStationStore;
  const [rawStatus, credentialState, pairingState] = await Promise.all([
    store.getStatus(),
    readStationCredentialStatus(store),
    readStationPairingStatus(store)
  ]);
  const status = parseStatus(rawStatus);
  if ((credentialState.state === "active" || credentialState.state === "expired") &&
      credentialState.credential.deviceId !== status.deviceId) {
    throw new Error("Stationscredentialen är bunden till en annan enhet");
  }
  if (pairingState.state === "pending" && pairingState.attempt.deviceId !== status.deviceId) {
    throw new Error("Parningsförsöket är bundet till en annan enhet");
  }
  if (pairingState.state === "completed" && pairingState.credential.deviceId !== status.deviceId) {
    throw new Error("Completed-parningen är bunden till en annan enhet");
  }
  const selected = options.raceId === undefined
    ? status.activePackages[0]
    : status.activePackages.find((item) => item.raceId === options.raceId);

  let packageState: PackageOperationalState = { kind: "missing" };
  if (selected !== undefined) {
    const active = await loadValidatedActivePackage(selected.raceId, store);
    if (active.payload.resultEngineVersion === RESULT_ENGINE_VERSION) {
      packageState = { kind: "ready", raceId: selected.raceId, packageVersion: selected.packageVersion };
    } else {
      packageState = {
        kind: "incompatible",
        raceId: selected.raceId,
        packageVersion: selected.packageVersion,
        packageEngineVersion: active.payload.resultEngineVersion
      };
    }
  }

  const parsedPair = selected === undefined
    ? null
    : parsePair((await store.loadLatestEvaluationPair({ raceId: selected.raceId })).pair, selected.raceId);
  const latestLocalEvaluation = parsedPair?.localEvaluation ??
    (selected === undefined ? parseLocalEvaluation(status.latestLocalEvaluation) : null);
  const observation = parsedPair?.pair.serverObservation ?? null;
  let comparison: StationOperationalStatus["centralSync"]["comparison"] = { kind: "none" };
  if (parsedPair !== null) {
    const sequence = parsedPair.pair.localSequence;
    if (parsedPair.pair.outboxState === "PENDING" && observation === null) {
      comparison = { kind: "pending", localSequence: sequence };
    } else if (parsedPair.pair.outboxState === "REJECTED" || observation?.acknowledgementStatus === "rejected") {
      comparison = {
        kind: "rejected",
        localSequence: sequence,
        reason: observation?.rejectionReason ?? parsedPair.pair.rejectionReason ?? "SERVER_REJECTED"
      };
    } else if (parsedPair.serverResult === null) {
      comparison = { kind: "central-missing", localSequence: sequence };
    } else if (parsedPair.localEvaluation === null) {
      comparison = { kind: "local-missing", localSequence: sequence, serverResult: parsedPair.serverResult };
    } else if (parsedPair.localEvaluation.engineVersion !== parsedPair.serverResult.engineVersion ||
        parsedPair.localEvaluation.snapshotVersion !== parsedPair.serverResult.snapshotVersion) {
      comparison = { kind: "version-divergence", localSequence: sequence, serverResult: parsedPair.serverResult };
    } else {
      const localResultHash = sha256Hex(canonicalJsonBytes(parsedPair.localEvaluation.evaluation));
      comparison = localResultHash === parsedPair.serverResult.evaluationHash
        ? { kind: "match", localSequence: sequence, serverResult: parsedPair.serverResult }
        : { kind: "different", localSequence: sequence, serverResult: parsedPair.serverResult };
    }
  }
  return {
    online: options.online,
    deviceId: status.deviceId,
    readoutCount: status.readoutCount,
    pendingCount: status.pendingCount,
    acknowledgedCount: status.acknowledgedCount,
    rejectedCount: status.rejectedCount,
    credentialState,
    pairingState,
    packageState,
    latestLocalEvaluation,
    centralSync: {
      latestContactAtEpochMs: observation?.observedAtEpochMs ?? null,
      currentPackageVersion: observation?.currentPackageVersion ?? null,
      packageVersionStatus: observation?.packageVersionStatus ?? null,
      packageUpdateRequired: observation?.packageUpdateRequired ?? false,
      comparison
    }
  };
}
