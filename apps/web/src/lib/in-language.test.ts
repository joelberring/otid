import { afterEach, describe, expect, it, vi } from "vitest";
import { inLanguage } from "./in-language";

describe("inLanguage", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("svenska utan dokument (servern och testerna)", () => expect(inLanguage("Fel", "Error")).toBe("Fel"));
  it("följer sidans lang", () => {
    vi.stubGlobal("document", { documentElement: { lang: "en" } });
    expect(inLanguage("Fel", "Error")).toBe("Error");
    vi.stubGlobal("document", { documentElement: { lang: "sv" } });
    expect(inLanguage("Fel", "Error")).toBe("Fel");
  });
});
