import { MAX_RENDER_SIDE, type MapRenderRequest, type MapRenderSession } from "./course-setting-map-protocol";
import type { Bounds } from "./course-setting-viewport";

export type MapBounds = Bounds;

export interface RasterRenderMeta {
  readonly pxPerMm: number;
  readonly originX: number;
  readonly originY: number;
}

export interface RasterMapMeta {
  readonly bounds: MapBounds;
  readonly render: RasterRenderMeta;
}

export interface RasterMapRenderSession extends Pick<MapRenderSession, "render"> {
  readonly bounds: MapBounds;
  close(): void;
}

export interface RasterCropRect {
  readonly srcX: number;
  readonly srcY: number;
  readonly srcW: number;
  readonly srcH: number;
  readonly dstX: number;
  readonly dstY: number;
  readonly dstW: number;
  readonly dstH: number;
}

type RenderRequest = Omit<Extract<MapRenderRequest, { type: "render" }>, "type" | "id">;

/**
 * Computes the intersecting source rectangle in the backing raster image and its destination rectangle
 * in the target canvas. Coordinates follow `drawMap`: map mm with y pointing up, `origin` is top-left.
 */
export function computeRasterCrop(
  imageSize: { readonly width: number; readonly height: number },
  render: RasterRenderMeta,
  request: Pick<RenderRequest, "width" | "height" | "pxPerMm" | "origin">
): RasterCropRect | null {
  if (imageSize.width <= 0 || imageSize.height <= 0 || render.pxPerMm <= 0 || request.pxPerMm <= 0) return null;
  const width = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.width)));
  const height = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.height)));
  const reqSrcLeft = (request.origin.x - render.originX) * render.pxPerMm;
  const reqSrcTop = (render.originY - request.origin.y) * render.pxPerMm;
  const reqSrcRight = reqSrcLeft + (width / request.pxPerMm) * render.pxPerMm;
  const reqSrcBottom = reqSrcTop + (height / request.pxPerMm) * render.pxPerMm;

  const srcX = Math.max(0, reqSrcLeft);
  const srcY = Math.max(0, reqSrcTop);
  const srcRight = Math.min(imageSize.width, reqSrcRight);
  const srcBottom = Math.min(imageSize.height, reqSrcBottom);
  const srcW = srcRight - srcX;
  const srcH = srcBottom - srcY;
  if (srcW <= 0 || srcH <= 0) return null;

  const scale = request.pxPerMm / render.pxPerMm;
  return {
    srcX,
    srcY,
    srcW,
    srcH,
    dstX: (srcX - reqSrcLeft) * scale,
    dstY: (srcY - reqSrcTop) * scale,
    dstW: srcW * scale,
    dstH: srcH * scale
  };
}

/**
 * Fallback render metadata when only map bounds and raster dimensions are available.
 */
export function fallbackRasterRenderMeta(
  bounds: MapBounds,
  imageSize: { readonly width: number; readonly height: number }
): RasterRenderMeta {
  const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
  const pxPerMm = Math.min(imageSize.width / spanX, imageSize.height / spanY);
  return { pxPerMm, originX: bounds.minX, originY: bounds.maxY };
}

/**
 * Raster-backed `MapRenderSession` for download-locked maps: slices and scales the server-rendered
 * `race_map` `ImageBitmap` without ever loading raw `.ocd`/`.omap` source bytes in the browser.
 */
export function createRasterMapRenderSession(image: ImageBitmap, meta: RasterMapMeta): RasterMapRenderSession {
  let closed = false;
  let latest = 0;

  function render(request: RenderRequest, onRendered: (id: number, bitmap: ImageBitmap) => void): number {
    const id = ++latest;
    if (closed) return id;
    const width = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.width)));
    const height = Math.max(1, Math.min(MAX_RENDER_SIDE, Math.round(request.height)));
    const crop = computeRasterCrop(image, meta.render, { ...request, width, height });

    const drawOnto = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
      if (request.background !== false) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
      }
      if (crop) {
        ctx.imageSmoothingEnabled = true;
        if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, crop.srcX, crop.srcY, crop.srcW, crop.srcH, crop.dstX, crop.dstY, crop.dstW, crop.dstH);
      }
    };

    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return id;
      drawOnto(ctx);
      const bitmap = canvas.transferToImageBitmap();
      if (closed || id !== latest) {
        bitmap.close();
        return id;
      }
      onRendered(id, bitmap);
      return id;
    }

    if (typeof document !== "undefined" && typeof createImageBitmap === "function") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return id;
      drawOnto(ctx);
      void createImageBitmap(canvas).then(bitmap => {
        if (closed || id !== latest) {
          bitmap.close();
          return;
        }
        onRendered(id, bitmap);
      }).catch(() => undefined);
    }

    return id;
  }

  function close() {
    if (closed) return;
    closed = true;
    image.close();
  }

  return { bounds: meta.bounds, render, close };
}
