import { describe, expect, it } from "vitest";
import { eventorMasterKeyFromEnvironment, readEventorApiKeyInput } from "../src/eventor-configuration";

const encoded = Buffer.alloc(32, 42).toString("base64");
async function* input(value: Uint8Array) { for (const byte of value) yield Uint8Array.of(byte); }
describe("Eventor server configuration", () => {
  it("requires an exact canonical 32-byte base64 key with a separate nonsecret id", () => {
    const environment = { OTID_EVENTOR_MASTER_KEY_ID: "test-key", OTID_EVENTOR_MASTER_KEY_BASE64: encoded };
    expect(eventorMasterKeyFromEnvironment(environment)).toEqual({ keyId: "test-key", masterKey: Buffer.alloc(32, 42) });
    for (const invalid of [undefined, "", encoded + "\n", Buffer.alloc(31).toString("base64"), "A".repeat(42) + "B="]) {
      expect(() => eventorMasterKeyFromEnvironment({ ...environment, OTID_EVENTOR_MASTER_KEY_BASE64: invalid }))
        .toThrow("EVENTOR_CONFIGURATION_INVALID");
    }
    expect(() => eventorMasterKeyFromEnvironment({ ...environment, OTID_EVENTOR_MASTER_KEY_ID: "test-key\n" }))
      .toThrow("EVENTOR_CONFIGURATION_INVALID");
  });
  it("reads one bounded key line over arbitrary chunk boundaries", async () => {
    for (const ending of ["", "\n", "\r\n"]) {
      expect(await readEventorApiKeyInput(input(Buffer.from("a".repeat(32) + ending)))).toBe("a".repeat(32));
    }
  });
  it("rejects long/multiline/non-UTF8/control-containing input without copying input into the error", async () => {
    for (const value of [Buffer.from("a".repeat(35)), Buffer.from("a".repeat(31)), Buffer.from("a".repeat(32) + "\n\n"),
      Buffer.from("a".repeat(31) + "\t"), Buffer.alloc(32, 0xff)]) {
      await expect(readEventorApiKeyInput(input(value))).rejects.toThrow("EVENTOR_KEY_INPUT_INVALID");
    }
  });
});
