import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { isSimulatorPageAllowed, resolveSimulatorPage } from "./simulator-access-policy";

const enabledEnvironment = {
  NODE_ENV: "development",
  O_TID_SIMULATOR_MODE: "loopback-development",
  O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000"
} as const;
const matchingAuthority = {
  host: "127.0.0.1:3000",
  forwardedHost: "127.0.0.1:3000",
  forwardedProto: "http"
} as const;

describe("TASK 005L simulatorgrind", () => {
  it.each([
    ["http://localhost:3000", "localhost:3000"],
    ["http://127.0.0.1:3000", "127.0.0.1:3000"],
    ["http://[::1]:3000", "[::1]:3000"],
    ["http://localhost", "localhost"]
  ])("tillåter explicit development på canonical loopback %s", (publicOrigin, host) => {
    expect(isSimulatorPageAllowed({
      ...enabledEnvironment,
      O_TID_PUBLIC_ORIGIN: publicOrigin
    }, { host, forwardedHost: host, forwardedProto: "http" })).toBe(true);
  });

  it.each([
    [{ ...enabledEnvironment, NODE_ENV: "production" }, matchingAuthority],
    [{ ...enabledEnvironment, NODE_ENV: "test" }, matchingAuthority],
    [{ ...enabledEnvironment, NODE_ENV: "staging" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_SIMULATOR_MODE: undefined }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_SIMULATOR_MODE: "true" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: undefined }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "not-a-url" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "https://127.0.0.1:3000" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000/" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://user@127.0.0.1:3000" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000/path" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000?query=1" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000#fragment" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://192.168.1.20:3000" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://0.0.0.0:3000" }, matchingAuthority],
    [{ ...enabledEnvironment, O_TID_PUBLIC_ORIGIN: "http://localhost.evil:3000" }, matchingAuthority],
    [enabledEnvironment, { ...matchingAuthority, host: null }],
    [enabledEnvironment, { ...matchingAuthority, host: "localhost:3000" }],
    [enabledEnvironment, { ...matchingAuthority, forwardedHost: null }],
    [enabledEnvironment, { ...matchingAuthority, forwardedHost: "127.0.0.1:3000, attacker.invalid" }],
    [enabledEnvironment, { ...matchingAuthority, forwardedProto: null }],
    [enabledEnvironment, { ...matchingAuthority, forwardedProto: "https" }],
    [enabledEnvironment, { ...matchingAuthority, forwardedProto: "http,https" }]
  ])("avvisar fail-closed miljö eller authority %#", (environment, authority) => {
    expect(isSimulatorPageAllowed(environment, authority)).toBe(false);
  });

  it("avvisar före routeparametrar och snapshot-loader", async () => {
    let paramsObserved = false;
    const params = {
      then: () => {
        paramsObserved = true;
        throw new Error("params får inte observeras");
      }
    } as unknown as Promise<{ raceId: string }>;
    const loader = vi.fn<(raceId: string) => Promise<number | null>>();

    await expect(resolveSimulatorPage({
      environment: { ...enabledEnvironment, NODE_ENV: "production" },
      authority: matchingAuthority,
      params
    }, loader)).resolves.toBeNull();
    expect(paramsObserved).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  it("validerar race-id före loader och returnerar bara den minimala projektionen", async () => {
    const loader = vi.fn(async () => 7);
    await expect(resolveSimulatorPage({
      environment: enabledEnvironment,
      authority: matchingAuthority,
      params: Promise.resolve({ raceId: "inte-ett-uuid" })
    }, loader)).resolves.toBeNull();
    expect(loader).not.toHaveBeenCalled();

    const raceId = "10000000-0000-4000-8000-000000000002";
    await expect(resolveSimulatorPage({
      environment: enabledEnvironment,
      authority: matchingAuthority,
      params: Promise.resolve({ raceId })
    }, loader)).resolves.toEqual({ raceId, snapshotVersion: 7 });
    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith(raceId);
  });

  it("returnerar samma not-found-projektion för okänt race", async () => {
    await expect(resolveSimulatorPage({
      environment: enabledEnvironment,
      authority: matchingAuthority,
      params: Promise.resolve({ raceId: "10000000-0000-4000-8000-000000000099" })
    }, async () => null)).resolves.toBeNull();
  });

  it("binder ordinarie devserver till loopback", () => {
    const webPackage = readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8");
    const nextConfig = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");
    expect(webPackage).toContain('"dev": "pnpm build:checkin && next dev --hostname 127.0.0.1"');
    expect(nextConfig).toContain('source: "/admin/:raceId/simulator"');
    expect(nextConfig).toContain('{ key: "X-Robots-Tag", value: "noindex, nofollow" }');
  });
});
