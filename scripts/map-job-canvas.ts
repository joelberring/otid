/**
 * ADR-0219 (K2): canvasen för kartjobben i utskriftsarbetaren (`@napi-rs/canvas`, Skia). Samma ritkod som i webbläsaren
 * (`drawMap`) ritar på den; resultatet blir en PNG.
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { CreateMapJobCanvas, MapJobCanvas } from "../packages/application/src/map-project-job-run.ts";

/** Ett underlag (JPEG, PNG eller WebP) som bild att rita med `drawImage` (ägaren 2026-11-17, render_view med underlag). */
export const loadMapJobImage = (bytes: Uint8Array): Promise<unknown> => loadImage(Buffer.from(bytes));

export const createMapJobCanvas: CreateMapJobCanvas = (width, height) => {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  return { context: context as unknown as MapJobCanvas["context"], png: () => new Uint8Array(canvas.toBuffer("image/png")),
    rgba: () => new Uint8Array(context.getImageData(0, 0, width, height).data.buffer) };
};
