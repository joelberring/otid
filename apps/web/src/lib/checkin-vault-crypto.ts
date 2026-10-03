export type CheckinVaultEnvelope = {
  iv: string;
  ciphertext: string;
};

type CheckinVaultCryptoErrorCode = "INVALID_INPUT" | "UNLOCK_FAILED";

const SALT_BYTES = 16;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const PBKDF2_ITERATIONS = 600_000;
const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const LOWERCASE_HEX = /^[0-9a-f]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class CheckinVaultCryptoError extends Error {
  constructor(readonly code: CheckinVaultCryptoErrorCode) {
    super("Check-in vault operation failed");
    this.name = "CheckinVaultCryptoError";
  }
}

function invalidInput(): never {
  throw new CheckinVaultCryptoError("INVALID_INPUT");
}

function unlockFailed(): never {
  throw new CheckinVaultCryptoError("UNLOCK_FAILED");
}

function cryptoFor(webCrypto: Crypto | undefined): Crypto {
  const candidate = webCrypto ?? globalThis.crypto;
  if (!candidate || typeof candidate.getRandomValues !== "function" || !candidate.subtle) invalidInput();
  return candidate;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function cryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function hexToBytes(hex: string, expectedBytes: number): Uint8Array {
  if (typeof hex !== "string" || hex.length !== expectedBytes * 2 || !LOWERCASE_HEX.test(hex)) invalidInput();
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function assertContext(context: string): Uint8Array {
  if (typeof context !== "string" || context.length < 1 || context.length > 256) invalidInput();
  return encoder.encode(context);
}

function assertPassphrase(passphrase: string): Uint8Array {
  if (typeof passphrase !== "string" || passphrase.length < 16 || passphrase.length > 1024 || passphrase.trim().length === 0) {
    invalidInput();
  }
  return encoder.encode(passphrase);
}

function jsonValue(value: unknown, visiting: Set<object> = new Set()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidInput();
    return value;
  }
  if (typeof value !== "object" || value === undefined) invalidInput();
  if (visiting.has(value)) invalidInput();
  visiting.add(value);
  try {
    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) invalidInput();
        copy.push(jsonValue(value[index], visiting));
      }
      return copy;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) invalidInput();
    if (Object.getOwnPropertySymbols(value).length !== 0) invalidInput();
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) copy[key] = jsonValue((value as Record<string, unknown>)[key], visiting);
    return copy;
  } finally {
    visiting.delete(value);
  }
}

function serializeJson(value: unknown): Uint8Array {
  let serialized: string;
  try {
    serialized = JSON.stringify(jsonValue(value));
  } catch {
    invalidInput();
  }
  const bytes = encoder.encode(serialized);
  if (bytes.byteLength > MAX_PLAINTEXT_BYTES) invalidInput();
  return bytes;
}

function parseEnvelope(envelope: unknown): CheckinVaultEnvelope {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) invalidInput();
  const prototype = Object.getPrototypeOf(envelope) as object | null;
  if (prototype !== Object.prototype && prototype !== null) invalidInput();
  const keys = Object.keys(envelope);
  if (keys.length !== 2 || !keys.includes("iv") || !keys.includes("ciphertext")) invalidInput();
  const candidate = envelope as Record<string, unknown>;
  if (typeof candidate.iv !== "string" || typeof candidate.ciphertext !== "string") invalidInput();
  hexToBytes(candidate.iv, IV_BYTES);
  const maxCiphertextHexLength = (MAX_PLAINTEXT_BYTES + GCM_TAG_BYTES) * 2;
  if (
    candidate.ciphertext.length <= GCM_TAG_BYTES * 2 ||
    candidate.ciphertext.length > maxCiphertextHexLength ||
    candidate.ciphertext.length % 2 !== 0 ||
    !LOWERCASE_HEX.test(candidate.ciphertext)
  ) invalidInput();
  return { iv: candidate.iv, ciphertext: candidate.ciphertext };
}

export function createCheckinVaultSalt(webCrypto: Crypto = globalThis.crypto): string {
  try {
    const bytes = new Uint8Array(SALT_BYTES);
    cryptoFor(webCrypto).getRandomValues(bytes);
    return bytesToHex(bytes);
  } catch (error) {
    if (error instanceof CheckinVaultCryptoError) throw error;
    invalidInput();
  }
}

export async function deriveCheckinVaultKey(
  passphrase: string,
  saltHex: string,
  webCrypto?: Crypto
): Promise<CryptoKey> {
  try {
    const crypto = cryptoFor(webCrypto);
    const keyMaterial = await crypto.subtle.importKey("raw", cryptoBytes(assertPassphrase(passphrase)), "PBKDF2", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: cryptoBytes(hexToBytes(saltHex, SALT_BYTES)), iterations: PBKDF2_ITERATIONS },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    if (error instanceof CheckinVaultCryptoError) throw error;
    unlockFailed();
  }
}

export async function encryptCheckinVaultValue(
  key: CryptoKey,
  value: unknown,
  context: string,
  webCrypto?: Crypto
): Promise<CheckinVaultEnvelope> {
  try {
    const crypto = cryptoFor(webCrypto);
    const iv = new Uint8Array(IV_BYTES);
    crypto.getRandomValues(iv);
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: cryptoBytes(iv), additionalData: cryptoBytes(assertContext(context)), tagLength: 128 },
      key,
      cryptoBytes(serializeJson(value))
    );
    const ciphertext = bytesToHex(new Uint8Array(encrypted));
    if (ciphertext.length <= GCM_TAG_BYTES * 2) invalidInput();
    return { iv: bytesToHex(iv), ciphertext };
  } catch (error) {
    if (error instanceof CheckinVaultCryptoError) throw error;
    invalidInput();
  }
}

export async function decryptCheckinVaultValue(
  key: CryptoKey,
  envelope: unknown,
  context: string,
  webCrypto?: Crypto
): Promise<unknown> {
  let parsed: CheckinVaultEnvelope;
  let additionalData: Uint8Array;
  try {
    parsed = parseEnvelope(envelope);
    additionalData = assertContext(context);
  } catch (error) {
    if (error instanceof CheckinVaultCryptoError) throw error;
    invalidInput();
  }
  try {
    const crypto = cryptoFor(webCrypto);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: cryptoBytes(hexToBytes(parsed.iv, IV_BYTES)), additionalData: cryptoBytes(additionalData), tagLength: 128 },
      key,
      cryptoBytes(hexToBytes(parsed.ciphertext, parsed.ciphertext.length / 2))
    );
    const bytes = new Uint8Array(plaintext);
    if (bytes.byteLength > MAX_PLAINTEXT_BYTES) unlockFailed();
    return JSON.parse(decoder.decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof CheckinVaultCryptoError) throw error;
    unlockFailed();
  }
}

export async function hashCheckinBytes(bytes: Uint8Array, webCrypto?: Crypto): Promise<string> {
  try {
    if (!(bytes instanceof Uint8Array)) invalidInput();
    const digest = await cryptoFor(webCrypto).subtle.digest("SHA-256", cryptoBytes(bytes));
    return bytesToHex(new Uint8Array(digest));
  } catch (error) {
    if (error instanceof CheckinVaultCryptoError) throw error;
    invalidInput();
  }
}
