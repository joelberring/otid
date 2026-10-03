import { signedStationPackageEnvelopeSchema } from "@o-tid/contracts";
import type {
  InstalledPackageMetadata,
  StationStoreCapacitorPlugin
} from "./station-store-plugin";
import { OtidStationStore } from "./station-store-plugin";
import { parseBoundedJsonResponse } from "./native-http";
import {
  authorizedStationRequester,
  type AuthorizedStationRequester
} from "./station-credential";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STANDARD_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_ENVELOPE_JSON_LENGTH = 11 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInstalledPackageMetadata(value: unknown): InstalledPackageMetadata {
  if (!isRecord(value) || Object.keys(value).some((key) =>
    !["status", "raceId", "packageVersion", "payloadSha256", "keyId"].includes(key)
  )) throw new Error("Stationen gav ett ogiltigt installationssvar");
  if ((value.status !== "installed" && value.status !== "duplicate") ||
      typeof value.raceId !== "string" || !UUID_PATTERN.test(value.raceId) ||
      typeof value.packageVersion !== "number" || !Number.isSafeInteger(value.packageVersion) || value.packageVersion < 1 ||
      typeof value.payloadSha256 !== "string" || !SHA256_PATTERN.test(value.payloadSha256) ||
      typeof value.keyId !== "string" || !SHA256_PATTERN.test(value.keyId)) {
    throw new Error("Stationen gav ett ogiltigt installationssvar");
  }
  return {
    status: value.status,
    raceId: value.raceId,
    packageVersion: value.packageVersion,
    payloadSha256: value.payloadSha256,
    keyId: value.keyId
  };
}

export interface InstallDownloadedStationPackageOptions {
  baseUrl: string;
  raceId: string;
  trustedPublicKeySpkiBase64: string;
  requester?: AuthorizedStationRequester;
  store?: StationStoreCapacitorPlugin;
}

export async function installDownloadedStationPackage(
  options: InstallDownloadedStationPackageOptions
): Promise<InstalledPackageMetadata> {
  if (options.trustedPublicKeySpkiBase64.length === 0 ||
      options.trustedPublicKeySpkiBase64.length > 16_384 ||
      !STANDARD_BASE64_PATTERN.test(options.trustedPublicKeySpkiBase64)) {
    throw new Error("Betrodd publik nyckel är ogiltig");
  }

  const store = options.store ?? OtidStationStore;
  const response = await (options.requester ?? authorizedStationRequester(store))({
    baseUrl: options.baseUrl,
    raceId: options.raceId,
    resource: "station-package",
    method: "GET",
    connectTimeoutMs: 10_000,
    readTimeoutMs: 30_000
  });
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Stationscredentialen godkändes inte (${response.status})`);
    }
    throw new Error(`Tävlingspaketet kunde inte hämtas (${response.status})`);
  }
  let body: unknown;
  try {
    body = parseBoundedJsonResponse(response, MAX_ENVELOPE_JSON_LENGTH, "ett giltigt tävlingspaket");
  } catch {
    throw new Error("Servern gav inte ett giltigt tävlingspaket");
  }
  const envelope = signedStationPackageEnvelopeSchema.safeParse(body);
  if (!envelope.success) throw new Error("Servern gav inte ett giltigt tävlingspaket");

  const installed = await store.installPackage({
    envelopeJson: JSON.stringify(envelope.data),
    trustedPublicKeySpkiBase64: options.trustedPublicKeySpkiBase64
  });
  return parseInstalledPackageMetadata(installed);
}
