import { stationPairingCredentialMetadataSchema } from "@o-tid/contracts";
import {
  OtidStationStore,
  type StationPairingRedeemResult,
  type StationPairingStatus,
  type StationStoreCapacitorPlugin
} from "./station-store-plugin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRANT_PATTERN = /^otid_pair_v1\.[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseCredential(value: unknown) {
  const parsed = stationPairingCredentialMetadataSchema.safeParse(value);
  if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.parse(parsed.data.issuedAt)) {
    throw new Error("Stationslagret gav ogiltig credentialmetadata");
  }
  return parsed.data;
}

export function parseStationPairingStatus(value: unknown): StationPairingStatus {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new Error("Stationslagret gav ogiltig pairingstatus");
  }
  if (value.state === "none" || value.state === "invalid") {
    if (!hasExactKeys(value, ["state"])) throw new Error("Stationslagret gav ogiltig pairingstatus");
    return { state: value.state };
  }
  if (value.state === "pending") {
    if (!hasExactKeys(value, ["state", "attempt"]) || !isRecord(value.attempt) ||
        !hasExactKeys(value.attempt, ["attemptId", "deviceId", "startedAtEpochMs"]) ||
        typeof value.attempt.attemptId !== "string" || !UUID_PATTERN.test(value.attempt.attemptId) ||
        typeof value.attempt.deviceId !== "string" || !UUID_PATTERN.test(value.attempt.deviceId) ||
        typeof value.attempt.startedAtEpochMs !== "number" ||
        !Number.isSafeInteger(value.attempt.startedAtEpochMs) || value.attempt.startedAtEpochMs < 0) {
      throw new Error("Stationslagret gav ogiltig pairingstatus");
    }
    return {
      state: "pending",
      attempt: {
        attemptId: value.attempt.attemptId,
        deviceId: value.attempt.deviceId,
        startedAtEpochMs: value.attempt.startedAtEpochMs
      }
    };
  }
  if (value.state !== "completed" || !hasExactKeys(value, ["state", "attemptId", "credential"]) ||
      typeof value.attemptId !== "string" || !UUID_PATTERN.test(value.attemptId)) {
    throw new Error("Stationslagret gav ogiltig pairingstatus");
  }
  return { state: "completed", attemptId: value.attemptId, credential: parseCredential(value.credential) };
}

export async function beginStationPairing(
  input: { baseUrl: string; grantToken: string },
  store: StationStoreCapacitorPlugin = OtidStationStore
): Promise<StationPairingStatus> {
  if (!GRANT_PATTERN.test(input.grantToken) || input.grantToken.length > 128) {
    throw new Error("Parningsgrantet är ogiltigt");
  }
  return parseStationPairingStatus(await store.beginDevicePairing(input));
}

export async function readStationPairingStatus(
  store: StationStoreCapacitorPlugin = OtidStationStore
): Promise<StationPairingStatus> {
  return parseStationPairingStatus(await store.getDevicePairingStatus());
}

export async function redeemStationPairing(
  attemptId: string,
  store: StationStoreCapacitorPlugin = OtidStationStore
): Promise<StationPairingRedeemResult> {
  if (!UUID_PATTERN.test(attemptId)) throw new Error("Parningsförsöket är ogiltigt");
  const value: unknown = await store.redeemDevicePairing({
    attemptId,
    connectTimeoutMs: 10_000,
    readTimeoutMs: 30_000
  });
  if (!isRecord(value) || !hasExactKeys(value, ["status", "credential"]) ||
      (value.status !== "installed" && value.status !== "already-installed")) {
    throw new Error("Stationslagret gav ogiltigt pairingsvar");
  }
  return { status: value.status, credential: parseCredential(value.credential) };
}

export async function discardStationPairing(
  expectedAttemptId: string,
  store: StationStoreCapacitorPlugin = OtidStationStore
): Promise<{ state: "none" }> {
  if (!UUID_PATTERN.test(expectedAttemptId)) throw new Error("Parningsförsöket är ogiltigt");
  const response: unknown = await store.discardDevicePairing({ expectedAttemptId });
  if (!isRecord(response) || !hasExactKeys(response, ["state"]) || response.state !== "none") {
    throw new Error("Stationslagret bekräftade inte att parningsförsöket kastades");
  }
  return { state: "none" };
}

export async function discardInvalidStationPairing(
  confirmDeviceId: string,
  store: StationStoreCapacitorPlugin = OtidStationStore
): Promise<{ state: "none" }> {
  if (!UUID_PATTERN.test(confirmDeviceId)) throw new Error("Enhets-id är ogiltigt");
  const response: unknown = await store.discardInvalidDevicePairing({ confirmDeviceId });
  if (!isRecord(response) || !hasExactKeys(response, ["state"]) || response.state !== "none") {
    throw new Error("Stationslagret bekräftade inte rensning av ogiltig pairingstate");
  }
  return { state: "none" };
}
