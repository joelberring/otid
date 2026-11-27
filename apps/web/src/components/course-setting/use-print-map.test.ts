import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColorUsage } from "@o-tid/map-file";
import { MapRenderSession, type MapRenderRequest, type MapRenderResponse } from "../../lib/course-setting-map-protocol";
import { renderPrintView, startPrintMapSession } from "./use-print-map";

describe("use-print-map: worker-PNG och parallell workeruppstart", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("renderPrintView ber Workern om asPng: true och skapar objekt-URL utan huvudtrådens <canvas>", async () => {
    const posted: MapRenderRequest[] = [];
    const fake = { postMessage: (message: MapRenderRequest) => posted.push(message), terminate: () => undefined } as unknown as Worker;
    const session = new MapRenderSession(() => fake, () => undefined, () => undefined);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:worker-png-1");

    const promise = renderPrintView(session, { width: 400, height: 300, pxPerMm: 6, origin: { x: 10, y: 50 } });
    expect(posted).toEqual([{ type: "render", id: 1, width: 400, height: 300, pxPerMm: 6, origin: { x: 10, y: 50 }, asPng: true }]);

    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    fake.onmessage!({ data: { type: "renderedPng", id: 1, blob: png } satisfies MapRenderResponse } as MessageEvent);

    await expect(promise).resolves.toBe("blob:worker-png-1");
    expect(createObjectURL).toHaveBeenCalledWith(png);
  });

  it("MapRenderSession.renderPng ignorerar föråldrade svar när en nyare beställning hunnit före", () => {
    const posted: MapRenderRequest[] = [];
    const fake = { postMessage: (message: MapRenderRequest) => posted.push(message), terminate: () => undefined } as unknown as Worker;
    const session = new MapRenderSession(() => fake, () => undefined, () => undefined);
    const received: number[] = [];
    session.renderPng({ width: 100, height: 100, pxPerMm: 2, origin: { x: 0, y: 0 } }, id => received.push(id));
    session.renderPng({ width: 200, height: 200, pxPerMm: 4, origin: { x: 0, y: 0 } }, id => received.push(id));
    const blob = new Blob(["png"], { type: "image/png" });
    fake.onmessage!({ data: { type: "renderedPng", id: 1, blob } satisfies MapRenderResponse } as MessageEvent);
    fake.onmessage!({ data: { type: "renderedPng", id: 2, blob } satisfies MapRenderResponse } as MessageEvent);
    expect(posted.map(row => row.type === "render" ? row.asPng : undefined)).toEqual([true, true]);
    expect(received).toEqual([2]);
  });

  it("startPrintMapSession startar kartworkern parallellt innan kartfilen hunnit hämtas och avbryter rent vid cleanup", async () => {
    const order: string[] = [];
    let resolveFile!: (file: { bytes: ArrayBuffer; fileName: string }) => void;
    let triggerLoaded!: (bounds: { minX: number; minY: number; maxX: number; maxY: number }, scale: number, georef: null, colors: readonly [], usage: ReadonlyMap<number, ColorUsage>) => void;
    const load = vi.fn(() => { order.push("load"); });
    const close = vi.fn(() => { order.push("close"); });
    const onReady = vi.fn(() => { order.push("ready"); });
    const onFailed = vi.fn();

    const stop = startPrintMapSession({
      createSession: onLoaded => {
        order.push("createSession");
        triggerLoaded = onLoaded;
        return { load, close };
      },
      fetchFile: () => {
        order.push("fetchFile");
        return new Promise(resolve => { resolveFile = resolve; });
      },
      onReady,
      onFailed
    });

    // Workern skapas omedelbart (parallellt med fetchFile), inte efter att filen laddats klart.
    expect(order).toEqual(["createSession", "fetchFile"]);
    expect(load).not.toHaveBeenCalled();

    const bytes = new ArrayBuffer(16);
    resolveFile({ bytes, fileName: "karta.omap" });
    await Promise.resolve();
    expect(load).toHaveBeenCalledWith(bytes, "karta.omap");
    triggerLoaded({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, 10000, null, [], new Map());
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
    stop();
    expect(close).toHaveBeenCalledTimes(1);

    // Avbryts effekten före filen kommer ska varken load eller onFailed anropas.
    let rejectLate!: (error: unknown) => void;
    const load2 = vi.fn();
    const onFailed2 = vi.fn();
    const stop2 = startPrintMapSession({
      createSession: () => ({ load: load2, close: vi.fn() }),
      fetchFile: () => new Promise((_resolve, reject) => { rejectLate = reject; }),
      onReady: vi.fn(),
      onFailed: onFailed2
    });
    stop2();
    rejectLate(new Error("aborted"));
    await Promise.resolve();
    expect(load2).not.toHaveBeenCalled();
    expect(onFailed2).not.toHaveBeenCalled();
  });
});
