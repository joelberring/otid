import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfiguredRouteStore } from "./route-store";

describe("configured private route store", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("fails closed when route-store configuration is incomplete", () => {
    vi.stubEnv("OTID_ROUTE_STORE_ID", "");
    expect(() => createConfiguredRouteStore()).toThrow("OTID_ROUTE_STORE_CONFIG_MISSING");
  });
  it("uses only server environment configuration", () => {
    vi.stubEnv("OTID_ROUTE_STORE_ID", "10000000-0000-4000-8000-000000000001");
    vi.stubEnv("OTID_ROUTE_STORE_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("OTID_ROUTE_STORE_BUCKET", "routes-private");
    vi.stubEnv("OTID_ROUTE_STORE_REGION", "us-east-1");
    vi.stubEnv("OTID_ROUTE_STORE_ACCESS_KEY", "local-access");
    vi.stubEnv("OTID_ROUTE_STORE_SECRET_KEY", "local-secret");
    vi.stubEnv("OTID_ROUTE_STORE_MODE", "loopback-development");
    expect(createConfiguredRouteStore()).toHaveProperty("put");
  });
});
