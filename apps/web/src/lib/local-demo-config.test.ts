import { afterEach, describe, expect, it, vi } from "vitest";

type ConfigEnvironment = {
  nodeEnvironment: "development" | "production";
  localDemo?: "1";
  demoE2e?: "1";
};

async function loadNextConfig(environment: ConfigEnvironment) {
  vi.stubEnv("NODE_ENV", environment.nodeEnvironment);
  vi.stubEnv("O_TID_LOCAL_DEMO", environment.localDemo);
  vi.stubEnv("O_TID_DEMO_E2E", environment.demoE2e);
  vi.resetModules();
  return (await import("../../next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("lokal demo Next-utkatalog", () => {
  it("isolerar den manuella utvecklingsdemon i .next-local-demo", async () => {
    const config = await loadNextConfig({ nodeEnvironment: "development", localDemo: "1" });
    expect(config.distDir).toBe(".next-local-demo");
  });

  it("isolerar demo-E2E i .next-demo-test", async () => {
    const config = await loadNextConfig({ nodeEnvironment: "development", demoE2e: "1" });
    expect(config.distDir).toBe(".next-demo-test");
  });

  it("behåller Next-standardens distDir utan utvecklingsflagga", async () => {
    const config = await loadNextConfig({ nodeEnvironment: "development" });
    expect(config.distDir).toBeUndefined();
  });

  it("avvisar motstridiga utvecklingslägen utan att röja konfiguration", async () => {
    let error: unknown;
    try {
      await loadNextConfig({ nodeEnvironment: "development", localDemo: "1", demoE2e: "1" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/O_TID|\.next|environment/i);
  });

  it("ignorerar demo-flaggor i produktion och behåller standalone-output", async () => {
    const config = await loadNextConfig({ nodeEnvironment: "production", localDemo: "1", demoE2e: "1" });
    expect(config.distDir).toBeUndefined();
    expect(config.output).toBe("standalone");
  });
});
