import {
  pairingAdminGrantIssueRequestSchema,
  pairingAdminGrantIssueResponseSchema,
  pairingAdminGrantListResponseSchema,
  pairingAdminGrantMetadataSchema,
  type PairingAdminGrantIssueResponse,
  type PairingAdminGrantMetadata
} from "@o-tid/contracts";
import { readPairingAdminCsrfCookie } from "./pairing-admin-cookies";

export const pairingGrantStatuses = ["ACTIVE", "REDEEMED", "REVOKED", "EXPIRED"] as const;
export type PairingGrantStatus = typeof pairingGrantStatuses[number];
export type CredentialLifetimeHours = 8 | 24 | 72;
export type PairingGrantMetadata = PairingAdminGrantMetadata;

export interface PairingGrantMaterial {
  grantId: string;
  secret: Uint8Array;
  grantSecretHash: string;
  credentialLifetimeHours: CredentialLifetimeHours;
}

export type PairingGrantIssueResponse = PairingAdminGrantIssueResponse;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function parsePairingGrantMetadata(value: unknown): PairingGrantMetadata {
  const parsed = pairingAdminGrantMetadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Servern gav ogiltig grantmetadata");
  }
  const metadata = parsed.data;
  const timestampsMatchStatus = metadata.status === "ACTIVE"
    ? metadata.redeemedAt === null && metadata.revokedAt === null
    : metadata.status === "REDEEMED"
      ? metadata.redeemedAt !== null
      : metadata.status === "REVOKED"
        ? metadata.redeemedAt === null && metadata.revokedAt !== null
        : metadata.redeemedAt === null && metadata.revokedAt === null;
  if (!timestampsMatchStatus) {
    throw new Error("Servern gav motsägande grantstatus");
  }
  return metadata;
}

export function parsePairingGrantList(value: unknown, expectedRaceId: string): PairingGrantMetadata[] {
  const parsed = pairingAdminGrantListResponseSchema.safeParse(value);
  if (!UUID_PATTERN.test(expectedRaceId) || !parsed.success) {
    throw new Error("Servern gav en ogiltig grantlista");
  }
  return parsed.data.grants.map(parsePairingGrantMetadata).map((grant) => {
    if (grant.raceId !== expectedRaceId) throw new Error("Grantlistan innehåller ett annat lopp");
    return grant;
  });
}

export function parsePairingGrantIssue(value: unknown, material: PairingGrantMaterial, expectedRaceId: string): PairingGrantIssueResponse {
  const parsed = pairingAdminGrantIssueResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Servern gav ett ogiltigt utfärdandesvar");
  }
  const grant = parsePairingGrantMetadata(parsed.data.grant);
  if (grant.grantId !== material.grantId || grant.raceId !== expectedRaceId) {
    throw new Error("Utfärdandesvaret matchar inte det lokala försöket");
  }
  return { formatVersion: 1, status: parsed.data.status, grant };
}

export async function createPairingGrantMaterial(
  credentialLifetimeHours: CredentialLifetimeHours,
  webCrypto: Crypto = globalThis.crypto
): Promise<PairingGrantMaterial> {
  if (![8, 24, 72].includes(credentialLifetimeHours)) throw new Error("Credentialens giltighet är ogiltig");
  const grantId = webCrypto.randomUUID();
  if (!UUID_PATTERN.test(grantId)) throw new Error("Web Crypto gav ett ogiltigt grant-id");
  const secret = webCrypto.getRandomValues(new Uint8Array(32));
  const digest = new Uint8Array(await webCrypto.subtle.digest("SHA-256", secret));
  const grantSecretHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!HASH_PATTERN.test(grantSecretHash)) throw new Error("Web Crypto gav en ogiltig hash");
  return { grantId, secret, grantSecretHash, credentialLifetimeHours };
}

export function pairingGrantIssueBody(material: PairingGrantMaterial) {
  return pairingAdminGrantIssueRequestSchema.parse({
    formatVersion: 1 as const,
    grantId: material.grantId,
    grantSecretHash: material.grantSecretHash,
    credentialLifetimeHours: material.credentialLifetimeHours
  });
}

export function pairingGrantToken(material: PairingGrantMaterial): string {
  if (!UUID_PATTERN.test(material.grantId) || material.secret.length !== 32 ||
      !HASH_PATTERN.test(material.grantSecretHash)) throw new Error("Grantmaterialet är ogiltigt");
  let binary = "";
  material.secret.forEach((byte) => { binary += String.fromCharCode(byte); });
  const secret = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (secret.length !== 43) throw new Error("Grantsecret kunde inte kodas kanoniskt");
  return `otid_pair_v1.${material.grantId}.${secret}`;
}

export function clearPairingGrantMaterial(material: PairingGrantMaterial): void {
  material.secret.fill(0);
}

export function readPairingAdminCsrf(cookieText: string, currentUrl: URL): string {
  const value = readPairingAdminCsrfCookie(cookieText, currentUrl);
  if (value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  throw new Error("CSRF-session saknas; logga in igen");
}
