import {
  OtidStationStore,
  type AuthorizedStationRequest,
  type AuthorizedStationResponse,
  type StationCredentialMetadata,
  type StationCredentialStatus,
  type StationStoreCapacitorPlugin
} from "./station-store-plugin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseIso(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

export function parseStationCredentialMetadata(value: unknown): StationCredentialMetadata {
  const keys = ["credentialId", "deviceId", "raceId", "scope", "generation", "issuedAt", "expiresAt"];
  if (!isRecord(value) || !hasExactKeys(value, keys) ||
      typeof value.credentialId !== "string" || !UUID_PATTERN.test(value.credentialId) ||
      typeof value.deviceId !== "string" || !UUID_PATTERN.test(value.deviceId) ||
      typeof value.raceId !== "string" || !UUID_PATTERN.test(value.raceId) ||
      value.scope !== "READOUT" || typeof value.generation !== "number" ||
      !Number.isSafeInteger(value.generation) || value.generation < 1 ||
      !parseIso(value.issuedAt) || !parseIso(value.expiresAt) ||
      Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    throw new Error("Stationslagret gav ogiltig credentialmetadata");
  }
  return {
    credentialId: value.credentialId,
    deviceId: value.deviceId,
    raceId: value.raceId,
    scope: value.scope,
    generation: value.generation,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt
  };
}

export function parseStationCredentialStatus(value: unknown): StationCredentialStatus {
  if (!isRecord(value) || typeof value.state !== "string") {
    throw new Error("Stationslagret gav ogiltig credentialstatus");
  }
  if (value.state === "missing" || value.state === "invalid") {
    if (!hasExactKeys(value, ["state"])) throw new Error("Stationslagret gav ogiltig credentialstatus");
    return { state: value.state };
  }
  if ((value.state !== "active" && value.state !== "expired") ||
      !hasExactKeys(value, ["state", "credential"])) {
    throw new Error("Stationslagret gav ogiltig credentialstatus");
  }
  return { state: value.state, credential: parseStationCredentialMetadata(value.credential) };
}

export async function readStationCredentialStatus(
  store: StationStoreCapacitorPlugin = OtidStationStore
): Promise<StationCredentialStatus> {
  return parseStationCredentialStatus(await store.getDeviceCredentialStatus());
}

export type AuthorizedStationRequester = (
  request: AuthorizedStationRequest
) => Promise<AuthorizedStationResponse>;

export function authorizedStationRequester(
  store: StationStoreCapacitorPlugin = OtidStationStore
): AuthorizedStationRequester {
  return async (request) => parseAuthorizedStationResponse(await store.authorizedStationRequest(request));
}

export function parseAuthorizedStationResponse(value: unknown): AuthorizedStationResponse {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "headers", "data", "url"]) ||
      typeof value.status !== "number" || !Number.isSafeInteger(value.status) ||
      value.status < 100 || value.status > 599 || typeof value.data !== "string" ||
      typeof value.url !== "string" || !isRecord(value.headers)) {
    throw new Error("Den autentiserade native-klienten gav ett ogiltigt svar");
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(value.headers)) {
    if (typeof header !== "string") throw new Error("Den autentiserade native-klienten gav ogiltiga headers");
    headers[key.toLowerCase()] = header;
  }
  return { status: value.status, headers, data: value.data, url: value.url };
}
