import { afterEach, describe, expect, it, vi } from "vitest";
import { eventorRuntime, legacyEventorEnvironmentWarning } from "./eventor-runtime";

const key = Buffer.alloc(32, 7).toString("base64");

describe("Eventors miljövariabler (PLAN.md steg 27)", () => {
  afterEach(() => { vi.restoreAllMocks(); delete (globalThis as { oTidEventorConfigLogged?: string }).oTidEventorConfigLogged; });

  it("varnar för de gamla namnen utan den nya nyckeln, utan att skriva ut värdena", () => {
    const warning = legacyEventorEnvironmentWarning({ OTID_EVENTOR_MASTER_KEY_ID: "k1", OTID_EVENTOR_MASTER_KEY_BASE64: "hemligt" });
    expect(warning).toContain("OTID_EVENTOR_MASTER_KEY_ID och OTID_EVENTOR_MASTER_KEY_BASE64");
    expect(warning).toContain("OTID_EVENTOR_MASTER_KEY ");
    expect(warning).not.toContain("hemligt");
    expect(legacyEventorEnvironmentWarning({ OTID_EVENTOR_MASTER_KEY_ID: "k1", OTID_EVENTOR_MASTER_KEY: key })).toBeUndefined();
    expect(legacyEventorEnvironmentWarning({})).toBeUndefined();
  });

  it("loggar en gång att nyckeln saknas, bara i serverns logg", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(eventorRuntime({}).configuration.status).toBe("missing");
    eventorRuntime({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("servern saknar OTID_EVENTOR_MASTER_KEY");
    expect(eventorRuntime({ OTID_EVENTOR_MASTER_KEY: key }).configuration.status).toBe("ok");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
