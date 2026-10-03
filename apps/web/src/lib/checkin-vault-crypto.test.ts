import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CheckinVaultCryptoError,
  createCheckinVaultSalt,
  decryptCheckinVaultValue,
  deriveCheckinVaultKey,
  encryptCheckinVaultValue,
  hashCheckinBytes
} from "./checkin-vault-crypto";

const crypto = webcrypto as unknown as Crypto;
const passphrase = "a long local passphrase";
const salt = "0123456789abcdef0123456789abcdef";
const context = "checkin-vault/v1/vault-1/operation/7";

describe("check-in vault crypto", () => {
  it("creates lowercase 16-byte salts and a non-extractable AES-256-GCM key", async () => {
    const first = createCheckinVaultSalt(crypto);
    const second = createCheckinVaultSalt(crypto);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
    const key = await deriveCheckinVaultKey(passphrase, salt, crypto);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(key.usages).toEqual(["encrypt", "decrypt"]);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toBeDefined();
  });

  it("round-trips JSON with new random IVs", async () => {
    const key = await deriveCheckinVaultKey(passphrase, salt, crypto);
    const value = { entryId: "entry-1", checked: true, history: [null, 12.5] };
    const first = await encryptCheckinVaultValue(key, value, context, crypto);
    const second = await encryptCheckinVaultValue(key, value, context, crypto);
    expect(first.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(first.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(first.iv).not.toBe(second.iv);
    await expect(decryptCheckinVaultValue(key, first, context, crypto)).resolves.toEqual(value);
  });

  it("preserves an own __proto__ JSON key and rejects own symbol keys", async () => {
    const key = await deriveCheckinVaultKey(passphrase, salt, crypto);
    const value = JSON.parse('{"__proto__":{"x":1}}') as unknown;
    const envelope = await encryptCheckinVaultValue(key, value, context, crypto);
    const decrypted = await decryptCheckinVaultValue(key, envelope, context, crypto) as Record<string, unknown>;
    expect(Object.hasOwn(decrypted, "__proto__")).toBe(true);
    expect(decrypted["__proto__"]).toEqual({ x: 1 });
    await expect(encryptCheckinVaultValue(key, { [Symbol("lost")]: "value" }, context, crypto)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("maps authentication failures to UNLOCK_FAILED without crypto details", async () => {
    const key = await deriveCheckinVaultKey(passphrase, salt, crypto);
    const envelope = await encryptCheckinVaultValue(key, { privateName: "Ada" }, context, crypto);
    const wrongKey = await deriveCheckinVaultKey("another long local phrase", salt, crypto);
    const alteredIv = { ...envelope, iv: `${envelope.iv.slice(0, -1)}${envelope.iv.endsWith("0") ? "1" : "0"}` };
    const alteredCiphertext = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith("0") ? "1" : "0"}` };
    for (const attempt of [
      () => decryptCheckinVaultValue(wrongKey, envelope, context, crypto),
      () => decryptCheckinVaultValue(key, envelope, `${context}-other`, crypto),
      () => decryptCheckinVaultValue(key, alteredIv, context, crypto),
      () => decryptCheckinVaultValue(key, alteredCiphertext, context, crypto)
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "UNLOCK_FAILED", message: "Check-in vault operation failed" });
    }
  });

  it("rejects malformed passphrases, salts, envelopes, contexts, and non-JSON values", async () => {
    const malformedCredentials: Array<[string, string]> = [
      ["short", salt],
      [" ".repeat(16), salt],
      [passphrase, salt.toUpperCase()],
      [passphrase, "00"],
      [passphrase, 1 as unknown as string]
    ];
    for (const [candidatePassphrase, candidateSalt] of malformedCredentials) {
      await expect(deriveCheckinVaultKey(candidatePassphrase, candidateSalt, crypto)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    const key = await deriveCheckinVaultKey(passphrase, salt, crypto);
    for (const envelope of [null, {}, { iv: "00".repeat(12), ciphertext: "00".repeat(17), extra: true }, { iv: "AA".repeat(12), ciphertext: "00".repeat(17) }]) {
      await expect(decryptCheckinVaultValue(key, envelope, context, crypto)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(encryptCheckinVaultValue(key, undefined, context, crypto)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(encryptCheckinVaultValue(key, { invalid: Number.NaN }, context, crypto)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(encryptCheckinVaultValue(key, circular, context, crypto)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(encryptCheckinVaultValue(key, {}, "", crypto)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("hashes bytes as lowercase SHA-256", async () => {
    await expect(hashCheckinBytes(new TextEncoder().encode("abc"), crypto)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("does not expose an error cause", () => {
    const error = new CheckinVaultCryptoError("UNLOCK_FAILED");
    expect(error.message).not.toContain("passphrase");
    expect(error).not.toHaveProperty("cause");
  });
});
