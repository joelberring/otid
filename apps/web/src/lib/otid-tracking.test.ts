import { afterEach, describe, expect, it, vi } from "vitest";
import { postThroughApp, trackingBridge } from "./otid-tracking";

const plugin = () => ({ requestPermission: vi.fn(), start: vi.fn(), stop: vi.fn(), status: vi.fn(), read: vi.fn(), addListener: vi.fn() });

describe("bryggan till appen (ADR-0227)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("finns bara i appen och bara med spårningens metoder; annars webbläsarens väg", () => {
    vi.stubGlobal("window", {});
    expect(trackingBridge()).toBeUndefined();
    const withoutRead: Partial<ReturnType<typeof plugin>> = plugin();
    delete withoutRead.read;
    vi.stubGlobal("window", { Capacitor: { Plugins: { OTidTracking: withoutRead } } });
    expect(trackingBridge()).toBeUndefined();
    vi.stubGlobal("window", { Capacitor: { Plugins: { OTidTracking: plugin() } } });
    const bridge = trackingBridge();
    expect(bridge).toBeDefined();
    expect(bridge?.post).toBeUndefined();
    vi.stubGlobal("window", { Capacitor: { Plugins: { OTidTracking: { ...plugin(), post: vi.fn(), signal: vi.fn(), purge: vi.fn() } } } });
    expect(typeof trackingBridge()?.post).toBe("function");
  });

  it("post genom appen: samma adress under sidans server och samma body; svaret blir ett Response", async () => {
    vi.stubGlobal("window", { location: { origin: "https://otid.example" } });
    const post = vi.fn(async () => ({ status: 200, body: "{\"formatVersion\":1}" }));
    const response = await postThroughApp(post, "/api/public/races/r/bingo", "{\"a\":1}", 1000);
    expect(post).toHaveBeenCalledWith({ url: "https://otid.example/api/public/races/r/bingo", body: "{\"a\":1}" });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ formatVersion: 1 });
    expect((await postThroughApp(async () => ({ status: 429, body: "{}" }), "/x", "{}", 1000)).status).toBe(429);
    await expect(postThroughApp(async () => ({ status: 0, body: "" }), "/x", "{}", 1000)).rejects.toThrow();
    await expect(postThroughApp(() => new Promise(() => undefined), "/x", "{}", 5)).rejects.toThrow();
  });
});
