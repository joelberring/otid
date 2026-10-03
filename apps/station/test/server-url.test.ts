import { describe, expect, it } from "vitest";
import { normalizeServerBaseUrl, stationApiUrl } from "../src/server-url";

describe("station server URLs", () => {
  it("normalizes HTTPS and permits explicit loopback development", () => {
    expect(normalizeServerBaseUrl(" https://otid.example/base ")).toBe("https://otid.example/base/");
    expect(stationApiUrl(
      "http://127.0.0.1:3000",
      "10000000-0000-4000-8000-000000000001",
      "device-batches"
    ).toString()).toBe("http://127.0.0.1:3000/api/races/10000000-0000-4000-8000-000000000001/device-batches");
  });

  it("rejects remote cleartext and embedded credentials/query", () => {
    expect(() => normalizeServerBaseUrl("http://otid.example")).toThrow("HTTPS");
    expect(() => normalizeServerBaseUrl("https://user:secret@otid.example")).toThrow("inloggning");
    expect(() => normalizeServerBaseUrl("https://otid.example/?token=secret")).toThrow("query");
  });
});
