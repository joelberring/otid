import { describe, expect, it } from "vitest";
import { eventorConfigurationFromEnvironment, openEventorApiKey, sealEventorApiKey } from "../src/eventor-secret";

const masterKey = Buffer.alloc(32, 7);
const encoded = masterKey.toString("base64");
const apiKey = "0123456789abcdef0123456789abcdef";
const raceId = "00000000-0000-4000-8000-000000000001";

describe("Eventor-nyckelns konfiguration och kryptering", () => {
  it("startar utan masternyckel och avvisar en felaktig", () => {
    expect(eventorConfigurationFromEnvironment({})).toEqual({ status: "missing" });
    expect(eventorConfigurationFromEnvironment({ OTID_EVENTOR_MASTER_KEY: " " })).toEqual({ status: "missing" });
    for (const invalid of ["kort", Buffer.alloc(31).toString("base64"), `${encoded}x`]) {
      expect(eventorConfigurationFromEnvironment({ OTID_EVENTOR_MASTER_KEY: invalid })).toEqual({ status: "invalid" });
    }
    expect(eventorConfigurationFromEnvironment({ OTID_EVENTOR_MASTER_KEY: encoded, OTID_EVENTOR_BASE_URL: "https://x/api" }))
      .toEqual({ status: "invalid" });
  });

  it("härleder ett id för masternyckeln och tar emot driftens basadress", () => {
    const configuration = eventorConfigurationFromEnvironment({ OTID_EVENTOR_MASTER_KEY: `${encoded}\n`,
      OTID_EVENTOR_BASE_URL: "http://127.0.0.1:4319/" });
    if (configuration.status !== "ok") throw new Error("Konfigurationen ska gälla");
    expect(configuration.keyId).toMatch(/^k-[a-f0-9]{16}$/);
    expect(configuration.baseUrl).toBe("http://127.0.0.1:4319");
  });

  it("krypterar med tävlingen som autentiserad kontext och öppnar bara med samma tävling och masternyckel", () => {
    const context = { raceId, keyId: "k-test" };
    const sealed = sealEventorApiKey(apiKey, context, masterKey);
    expect(JSON.stringify(sealed)).not.toContain(apiKey);
    expect(openEventorApiKey(sealed, context, masterKey)).toBe(apiKey);
    expect(() => openEventorApiKey(sealed, { raceId: "00000000-0000-4000-8000-000000000002", keyId: "k-test" }, masterKey))
      .toThrow("DECRYPTION_FAILED");
    expect(() => openEventorApiKey(sealed, context, Buffer.alloc(32, 8))).toThrow("DECRYPTION_FAILED");
    expect(() => openEventorApiKey({ ...sealed, keyId: "k-annan" }, context, masterKey)).toThrow("DECRYPTION_FAILED");
    const tampered = `${sealed.tag[0] === "A" ? "B" : "A"}${sealed.tag.slice(1)}`;
    expect(() => openEventorApiKey({ ...sealed, tag: tampered }, context, masterKey)).toThrow("DECRYPTION_FAILED");
    expect(() => sealEventorApiKey("kort nyckel", context, masterKey)).toThrow("INVALID_KEY");
  });
});
