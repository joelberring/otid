import { cellMeters, type GridPart } from "@o-tid/map-revision/base-map";
import { contoursOf } from "./map-project-drawing-basis";
import type { PreparedLayer } from "./map-project-layer-file";
import { SAFE_LAYER_PIXELS } from "./map-project-layers";
import { indexedPng, quantize } from "./png-indexed";

/**
 * Täta kurvor som underlag i kartan (ägaren 2026-11-17: «kunna tända i skogen på mobilen lite svagt för att kunna jämföra mot
 * tät kurvbild var kurvorna hamnat och kunna dra lite vid behov»). Kurvorna ritas på en genomskinlig PNG i SWEREF 99 TM och
 * läggs upp som ett vanligt underlag: det tänds, tonas och sparas i telefonen som de andra, och kartans egna kurvor ligger
 * ovanpå. Allt i lila (ljusare för ekvidistansen, mörkare för hela och femte metrar), så att de inte blandas ihop med
 * kartans bruna kurvor.
 */
const STYLE = { interval: { rgb: [165, 110, 205], widthM: 0.5 }, meter: { rgb: [120, 60, 175], widthM: 0.8 }, five: { rgb: [80, 25, 135], widthM: 1.3 } } as const;

/** Bildpunktens storlek (m): en halv meter om bilden ryms, annars grövre (en hel karta blir annars för stor för mobilen). */
export function contourLayerResolution(widthM: number, heightM: number, maxSide = 8192, maxPixels = SAFE_LAYER_PIXELS): number {
  for (const meters of [0.5, 1, 2, 4]) {
    const width = Math.ceil(widthM / meters), height = Math.ceil(heightM / meters);
    if (width <= maxSide && height <= maxSide && width * height <= maxPixels) return meters;
  }
  return 8;
}

export async function contourLayer(ground: GridPart, interval: number, smooth: boolean, name: string): Promise<PreparedLayer> {
  const cell = cellMeters(ground.affine), { grid, affine } = ground;
  const minX = affine[2] - cell / 2, maxY = affine[5] + cell / 2;
  const widthM = grid.columns * cell, heightM = grid.rows * cell;
  const px = contourLayerResolution(widthM, heightM);
  const width = Math.ceil(widthM / px), height = Math.ceil(heightM / px);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.lineJoin = "round"; context.lineCap = "round";
  const lines = contoursOf(ground, interval, smooth);
  // De grövre nivåerna ovanpå.
  for (const kind of ["interval", "meter", "five"] as const) {
    const style = STYLE[kind];
    context.strokeStyle = `rgb(${style.rgb.join(",")})`;
    context.lineWidth = Math.max(1, style.widthM / px);
    context.beginPath();
    for (const line of lines) {
      const lineKind = line.major === interval ? "interval" : line.major === 1 ? "meter" : "five";
      if (lineKind !== kind) continue;
      line.points.forEach(([x, y], index) => {
        const column = (x - minX) / px, row = (maxY - y) / px;
        if (index === 0) context.moveTo(column, row); else context.lineTo(column, row);
      });
      if (line.closed) context.closePath();
    }
    context.stroke();
  }
  // Med palett i stället för canvasens RGBA-PNG: en femtedel så stor (Högdalen A: 19 MB → några MB).
  const { indices, palette } = quantize(context.getImageData(0, 0, width, height).data, Object.values(STYLE).map(style => style.rgb));
  canvas.width = canvas.height = 0;
  const bytes = new Blob([await indexedPng(width, height, indices, palette) as BlobPart], { type: "image/png" });
  // Världsfilens sätt: första bildpunktens mitt.
  return { bytes, crs: 3006, width, height, name, transform: { a: px, b: 0, c: minX + px / 2, d: 0, e: -px, f: maxY - px / 2 } };
}
