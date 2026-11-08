/**
 * ADR-0219 (K2): canvasen för kartjobben i utskriftsarbetaren (`@napi-rs/canvas`, Skia). Samma ritkod som i webbläsaren
 * (`drawMap`) ritar på den; resultatet blir en PNG.
 */
import { createCanvas } from "@napi-rs/canvas";
import type { CreateMapJobCanvas, MapJobCanvas } from "../packages/application/src/map-project-job-run.ts";

export const createMapJobCanvas: CreateMapJobCanvas = (width, height) => {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  return { context: context as unknown as MapJobCanvas["context"], png: () => new Uint8Array(canvas.toBuffer("image/png")) };
};
