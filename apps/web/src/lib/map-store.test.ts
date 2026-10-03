import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfiguredMapStore } from "./map-store";

afterEach(() => vi.unstubAllEnvs());

describe("TASK106 private map-store configuration", () => {
  it("fails closed when a server-only value is absent", () => {
    vi.stubEnv("OTID_MAP_STORE_ID", "");
    expect(() => createConfiguredMapStore()).toThrow("OTID_MAP_STORE_CONFIG_MISSING");
  });

  it("accepts only an explicit loopback development store without contacting it", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OTID_MAP_STORE_ID", "10000000-0000-4000-8000-000000000001");
    vi.stubEnv("OTID_MAP_STORE_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("OTID_MAP_STORE_BUCKET", "otid-private");
    vi.stubEnv("OTID_MAP_STORE_REGION", "us-east-1");
    vi.stubEnv("OTID_MAP_STORE_ACCESS_KEY", "local-access");
    vi.stubEnv("OTID_MAP_STORE_SECRET_KEY", "local-secret");
    vi.stubEnv("OTID_MAP_STORE_MODE", "loopback-development");
    const store = createConfiguredMapStore();
    expect(typeof store.put).toBe("function");
    expect(typeof store.read).toBe("function");
  });
});
