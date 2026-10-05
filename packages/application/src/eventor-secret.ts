import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isPlausibleEventorApiKey, normalizeEventorBaseUrl } from "@o-tid/eventor";

/**
 * Klubbens Eventor-nyckel (ADR-0170 beslut 4) lagras bara krypterad med AES-256-GCM.
 * Masternyckeln finns i serverns miljö (`OTID_EVENTOR_MASTER_KEY`, 32 slumpade bytes i
 * base64, t.ex. `openssl rand -base64 32`), aldrig i databasen eller dess backup.
 * Tävlingens id och masternyckelns id autentiseras med chiffret: en nyckel kan inte
 * flyttas till en annan tävling. Fel är generiska och innehåller aldrig nyckeln.
 */

export type EventorServerConfiguration =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ok"; keyId: string; masterKey: Uint8Array; baseUrl?: string };

/**
 * Läser driftens inställningar. Utan masternyckel startar appen ändå och visar att Eventor
 * inte är konfigurerat. `OTID_EVENTOR_BASE_URL` sätts bara av driften (t.ex. en testserver);
 * utan den används Eventor Sverige.
 */
export function eventorConfigurationFromEnvironment(environment: Record<string, string | undefined>): EventorServerConfiguration {
  const encoded = environment.OTID_EVENTOR_MASTER_KEY?.trim();
  if (!encoded) return { status: "missing" };
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return { status: "invalid" };
  const masterKey = Buffer.from(encoded, "base64");
  if (masterKey.length !== 32) return { status: "invalid" };
  const keyId = `k-${createHash("sha256").update(masterKey).digest("hex").slice(0, 16)}`;
  const base = environment.OTID_EVENTOR_BASE_URL?.trim();
  if (!base) return { status: "ok", keyId, masterKey };
  try {
    return { status: "ok", keyId, masterKey, baseUrl: normalizeEventorBaseUrl(base) };
  } catch {
    return { status: "invalid" };
  }
}

export interface EventorSecretEnvelope {
  readonly keyId: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export class EventorSecretError extends Error {
  constructor(readonly code: "INVALID_KEY" | "DECRYPTION_FAILED") {
    super(code);
    this.name = "EventorSecretError";
  }
}

function associatedData(raceId: string, keyId: string): Buffer {
  return Buffer.from(JSON.stringify(["o-tid:eventor-api-key", 2, "aes-256-gcm", raceId, keyId]), "utf8");
}

function decode(value: string, length?: number): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (!/^[A-Za-z0-9_-]+$/.test(value) || bytes.toString("base64url") !== value || (length !== undefined && bytes.length !== length)) {
    throw new EventorSecretError("DECRYPTION_FAILED");
  }
  return bytes;
}

export function sealEventorApiKey(apiKey: string, context: { raceId: string; keyId: string }, masterKey: Uint8Array): EventorSecretEnvelope {
  if (!isPlausibleEventorApiKey(apiKey) || masterKey.byteLength !== 32) throw new EventorSecretError("INVALID_KEY");
  const plaintext = Buffer.from(apiKey, "ascii");
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv, { authTagLength: 16 });
    cipher.setAAD(associatedData(context.raceId, context.keyId));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { keyId: context.keyId, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url") };
  } finally {
    plaintext.fill(0);
  }
}

/** Öppnar nyckeln. En annan masternyckel (bytt i driften) ger DECRYPTION_FAILED: nyckeln måste sparas igen. */
export function openEventorApiKey(envelope: EventorSecretEnvelope, context: { raceId: string; keyId: string }, masterKey: Uint8Array): string {
  if (envelope.keyId !== context.keyId || masterKey.byteLength !== 32) throw new EventorSecretError("DECRYPTION_FAILED");
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, decode(envelope.iv, 12), { authTagLength: 16 });
    decipher.setAAD(associatedData(context.raceId, context.keyId));
    decipher.setAuthTag(decode(envelope.tag, 16));
    plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
    const value = plaintext.toString("utf8");
    if (!isPlausibleEventorApiKey(value)) throw new EventorSecretError("DECRYPTION_FAILED");
    return value;
  } catch {
    throw new EventorSecretError("DECRYPTION_FAILED");
  } finally {
    plaintext?.fill(0);
  }
}
