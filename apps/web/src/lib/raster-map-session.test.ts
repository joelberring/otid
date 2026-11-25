import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRasterCrop, createRasterMapRenderSession, fallbackRasterRenderMeta } from "./raster-map-session";

describe("computeRasterCrop", () => {
  const render = { pxPerMm: 10, originX: 0, originY: 100 };
  const imageSize = { width: 1000, height: 1000 };

  it("maps an interior viewport slice accurately with scale", () => {
    // Viewport: 200x100 px at 20 px/mm (2x zoom), top-left at map (10, 90)
    // In source px: left = (10 - 0)*10 = 100, top = (100 - 90)*10 = 100
    // Viewport span in mm: 10mm x 5mm -> in source px: 100 x 50
    const crop = computeRasterCrop(imageSize, render, { width: 200, height: 100, pxPerMm: 20, origin: { x: 10, y: 90 } });
    expect(crop).toEqual({ srcX: 100, srcY: 100, srcW: 100, srcH: 50, dstX: 0, dstY: 0, dstW: 200, dstH: 100 });
  });

  it("clips viewports extending outside the raster image and offsets destination", () => {
    // Viewport starts 20mm left and 10mm above the image origin (0, 100) at 5 px/mm (0.5x)
    const crop = computeRasterCrop(imageSize, render, { width: 400, height: 300, pxPerMm: 5, origin: { x: -20, y: 110 } });
    expect(crop).not.toBeNull();
    expect(crop!.srcX).toBe(0);
    expect(crop!.srcY).toBe(0);
    expect(crop!.dstX).toBeCloseTo(100); // 20mm * 5 px/mm
    expect(crop!.dstY).toBeCloseTo(50);  // 10mm * 5 px/mm
    expect(crop!.srcW).toBeCloseTo(600); // remaining 300 dest px / 0.5
    expect(crop!.srcH).toBeCloseTo(500); // remaining 250 dest px / 0.5
    expect(crop!.dstW).toBeCloseTo(300);
    expect(crop!.dstH).toBeCloseTo(250);
  });

  it("returns null when the viewport does not intersect the image", () => {
    const crop = computeRasterCrop(imageSize, render, { width: 100, height: 100, pxPerMm: 10, origin: { x: 200, y: 50 } });
    expect(crop).toBeNull();
  });

  it("derives fallback render metadata from bounds and image dimensions", () => {
    expect(fallbackRasterRenderMeta({ minX: -50, minY: -20, maxX: 50, maxY: 30 }, { width: 1000, height: 500 }))
      .toEqual({ pxPerMm: 10, originX: -50, originY: 30 });
  });
});

describe("createRasterMapRenderSession", () => {
  const originalOffscreen = globalThis.OffscreenCanvas;

  afterEach(() => {
    globalThis.OffscreenCanvas = originalOffscreen;
  });

  it("renders a cropped slice via OffscreenCanvas and releases the backing ImageBitmap on close()", () => {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const transferClose = vi.fn();
    const outputBitmap = { width: 200, height: 100, close: transferClose } as unknown as ImageBitmap;

    class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) { this.width = width; this.height = height; }
      getContext() {
        return { fillStyle: "", imageSmoothingEnabled: false, imageSmoothingQuality: "low", fillRect, drawImage };
      }
      transferToImageBitmap() { return outputBitmap; }
    }
    globalThis.OffscreenCanvas = MockOffscreenCanvas as unknown as typeof OffscreenCanvas;

    const backingClose = vi.fn();
    const backing = { width: 1000, height: 1000, close: backingClose } as unknown as ImageBitmap;
    const session = createRasterMapRenderSession(backing, {
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      render: { pxPerMm: 10, originX: 0, originY: 100 }
    });

    const onRendered = vi.fn();
    const id = session.render({ width: 200, height: 100, pxPerMm: 20, origin: { x: 10, y: 90 } }, onRendered);
    expect(id).toBe(1);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(drawImage).toHaveBeenCalledWith(backing, 100, 100, 100, 50, 0, 0, 200, 100);
    expect(onRendered).toHaveBeenCalledWith(1, outputBitmap);

    session.close();
    session.close(); // idempotent
    expect(backingClose).toHaveBeenCalledTimes(1);

    // Subsequent renders after close are ignored
    onRendered.mockClear();
    session.render({ width: 200, height: 100, pxPerMm: 20, origin: { x: 10, y: 90 } }, onRendered);
    expect(onRendered).not.toHaveBeenCalled();
  });
});
