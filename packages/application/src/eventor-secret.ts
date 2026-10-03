import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EventorProfile } from "@o-tid/contracts";

export interface EventorSecretContext {
  environment: EventorProfile;
  connectionId: string;
  ownerCredentialId: string;
  keyId: string;
}

export interface EventorSecretEnvelope {
  formatVersion: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class EventorSecretError extends Error {
  constructor(readonly code: "INVALID_CONFIGURATION" | "DECRYPTION_FAILED") {
    super(code);
    this.name = "EventorSecretError";
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const apiKeyPattern = /^[\x21-\x7e]{32}$/;

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function associatedData(context: EventorSecretContext, masterKey: Uint8Array): Buffer {
  if (!(masterKey instanceof Uint8Array) || masterKey.byteLength !== 32
    || !record(context, ["environment", "connectionId", "ownerCredentialId", "keyId"])
    || (context.environment !== "testeventor-se" && context.environment !== "production-se")
    || typeof context.connectionId !== "string" || context.connectionId.length !== 36 || !uuid.test(context.connectionId)
    || typeof context.ownerCredentialId !== "string" || context.ownerCredentialId.length !== 36 || !uuid.test(context.ownerCredentialId)
    || typeof context.keyId !== "string" || context.keyId.trim() !== context.keyId
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(context.keyId)) {
    throw new EventorSecretError("INVALID_CONFIGURATION");
  }
  return Buffer.from(JSON.stringify([
    "o-tid:eventor-api-key", 1, "aes-256-gcm", context.environment,
    context.connectionId, context.ownerCredentialId, context.keyId,
  ]), "utf8");
}

function decode(value: unknown, length: number): Buffer {
  if (typeof value !== "string" || value.length !== Math.ceil(length * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new EventorSecretError("DECRYPTION_FAILED");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) {
    throw new EventorSecretError("DECRYPTION_FAILED");
  }
  return bytes;
}

/** Server-only envelope; no plaintext or underlying crypto errors may be logged. */
export function sealEventorApiKey(
  apiKey: string,
  context: EventorSecretContext,
  masterKey: Uint8Array,
): EventorSecretEnvelope {
  const aad = associatedData(context, masterKey);
  if (typeof apiKey !== "string" || apiKey.length !== 32 || !apiKeyPattern.test(apiKey)) {
    throw new EventorSecretError("INVALID_CONFIGURATION");
  }
  const key = Buffer.from(masterKey);
  const plaintext = Buffer.from(apiKey, "ascii");
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      formatVersion: 1,
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  } catch {
    throw new EventorSecretError("INVALID_CONFIGURATION");
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

export function openEventorApiKey(
  envelope: EventorSecretEnvelope,
  context: EventorSecretContext,
  masterKey: Uint8Array,
): string {
  const aad = associatedData(context, masterKey);
  if (!record(envelope, ["formatVersion", "iv", "tag", "ciphertext"])
    || envelope.formatVersion !== 1) {
    throw new EventorSecretError("DECRYPTION_FAILED");
  }
  const iv = decode(envelope.iv, 12);
  const tag = decode(envelope.tag, 16);
  const ciphertext = decode(envelope.ciphertext, 32);
  const key = Buffer.from(masterKey);
  let pending: Buffer | undefined;
  let final: Buffer | undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    pending = decipher.update(ciphertext);
    final = decipher.final();
    // Decode only after authentication succeeds. UTF-8 prevents high-bit bytes
    // from being silently coerced to an ASCII header value.
    const value = pending.toString("utf8") + final.toString("utf8");
    if (value.length !== 32 || !apiKeyPattern.test(value)) throw new EventorSecretError("DECRYPTION_FAILED");
    return value;
  } catch {
    throw new EventorSecretError("DECRYPTION_FAILED");
  } finally {
    key.fill(0);
    pending?.fill(0);
    final?.fill(0);
  }
}
