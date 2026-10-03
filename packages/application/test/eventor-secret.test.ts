import { describe, expect, it } from "vitest";
import {
  EventorSecretError, openEventorApiKey, sealEventorApiKey,
  type EventorSecretContext, type EventorSecretEnvelope,
} from "../src/eventor-secret.js";

const context: EventorSecretContext = {
  environment: "testeventor-se",
  connectionId: "10000000-0000-4000-8000-000000000001",
  ownerCredentialId: "20000000-0000-4000-8000-000000000001",
  keyId: "test-key-1",
};
const masterKey = new Uint8Array(32).fill(42);
const apiKey = "SyntheticEventorKey-1234567890ab";

describe("server-only Eventor secret envelope", () => {
  it("roundtrips using random IVs without mutating caller-owned key/context", () => {
    expect(apiKey).toHaveLength(32);
    const first = sealEventorApiKey(apiKey, Object.freeze({ ...context }), masterKey);
    const second = sealEventorApiKey(apiKey, context, masterKey);
    expect(first).not.toEqual(second);
    expect(Buffer.from(first.iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(first.tag, "base64url")).toHaveLength(16);
    expect(openEventorApiKey(first, context, masterKey)).toBe(apiKey);
    expect(openEventorApiKey(second, context, masterKey)).toBe(apiKey);
    expect(masterKey).toEqual(new Uint8Array(32).fill(42));
    expect(JSON.stringify(first)).not.toContain(apiKey);
  });

  it.each([
    { connectionId: "10000000-0000-4000-8000-000000000002" },
    { ownerCredentialId: "20000000-0000-4000-8000-000000000002" },
    { keyId: "test-key-2" },
  ])("binds the envelope to its full context: %j", (change) => {
    const envelope = sealEventorApiKey(apiKey, context, masterKey);
    expect(() => openEventorApiKey(envelope, { ...context, ...change }, masterKey))
      .toThrowError("DECRYPTION_FAILED");
  });

  it("binds a production envelope to its exact immutable profile", () => {
    const production = { ...context, environment: "production-se" as const };
    const envelope = sealEventorApiKey(apiKey, production, masterKey);
    expect(openEventorApiKey(envelope, production, masterKey)).toBe(apiKey);
    expect(() => openEventorApiKey(envelope, context, masterKey)).toThrowError("DECRYPTION_FAILED");
  });

  it.each(["iv", "tag", "ciphertext"] as const)("rejects modified %s", (field) => {
    const envelope = sealEventorApiKey(apiKey, context, masterKey);
    const bytes = Buffer.from(envelope[field], "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(() => openEventorApiKey({ ...envelope, [field]: bytes.toString("base64url") }, context, masterKey))
      .toThrowError("DECRYPTION_FAILED");
  });

  it("rejects the wrong master key without exposing crypto internals or a cause", () => {
    const envelope = sealEventorApiKey(apiKey, context, masterKey);
    let caught: unknown;
    try { openEventorApiKey(envelope, context, new Uint8Array(32).fill(43)); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(EventorSecretError);
    expect(caught).toMatchObject({ message: "DECRYPTION_FAILED", code: "DECRYPTION_FAILED" });
    expect(caught).not.toHaveProperty("cause");
    expect(JSON.stringify(caught)).not.toContain(apiKey);
  });

  it.each([null, {}, { ...context, environment: "production" },
    { ...context, connectionId: context.connectionId.toUpperCase().replace("10000000", "AAAAAAAA") },
    { ...context, ownerCredentialId: "not-an-id" }, { ...context, keyId: "../key" },
    { ...context, secret: apiKey }, { ...context, keyId: "key\n" },
    { ...context, connectionId: context.connectionId + "\n" },
    { ...context, ownerCredentialId: context.ownerCredentialId + "\n" },
  ])("rejects invalid context %j", (invalid) => {
    expect(() => sealEventorApiKey(apiKey, invalid as EventorSecretContext, masterKey))
      .toThrowError("INVALID_CONFIGURATION");
  });

  it.each([0, 16, 31, 33, 64])("requires exactly 32 master key bytes, not %i", (length) => {
    expect(() => sealEventorApiKey(apiKey, context, new Uint8Array(length)))
      .toThrowError("INVALID_CONFIGURATION");
  });

  it.each(["", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "\r",
    "a".repeat(31) + "\n", "a".repeat(32) + "\n", "a".repeat(31) + " ", "å".repeat(32), "\0".repeat(32),
  ])("rejects invalid API key fixture %#", (invalid) => {
    expect(() => sealEventorApiKey(invalid, context, masterKey))
      .toThrowError("INVALID_CONFIGURATION");
  });

  it("rejects invalid version, extra fields, padding, truncation and noncanonical base64url", () => {
    const envelope = sealEventorApiKey(apiKey, context, masterKey);
    const invalid = [null, {}, { ...envelope, formatVersion: 2 }, { ...envelope, extra: 1 },
      { ...envelope, tag: envelope.tag + "==" }, { ...envelope, iv: envelope.iv.slice(1) },
      { ...envelope, ciphertext: "!".repeat(43) },
      { ...envelope, tag: "A".repeat(21) + "B" },
    ];
    for (const value of invalid) {
      expect(() => openEventorApiKey(value as EventorSecretEnvelope, context, masterKey))
        .toThrowError("DECRYPTION_FAILED");
    }
  });
});
