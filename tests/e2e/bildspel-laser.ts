import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { drawMap, mapPointToProjected, readMapFile, type Path } from "../../packages/map-file/src/index";
import { DEMO_MAP_BOUNDS, demoMapFile } from "./bildspel-karta";

/**
 * Bildspelets laserkörning på Tallbacken (`bildspel.spec.ts`, `bildspel-pullauta.mjs`): det Karttapullautin skulle ha lämnat
 * för den påhittade terrängen – bilden (merged.png med världsfil) och kurvorna som DXF i SWEREF 99 TM – ur den färdiga kartan.
 * Branterna lämnas tomma (den falska markmodellen hör inte till Tallbacken).
 */
const PX_PER_MM = 4;

const pointsOf = (path: Path) => path.map(command => ({ x: command.x, y: command.y }));

export function writeDemoLaser(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const map = readMapFile(demoMapFile(), "tallbacken.omap");
  const georef = map.georeference!;
  const { minX, maxX, minY, maxY } = DEMO_MAP_BOUNDS;
  const width = (maxX - minX) * PX_PER_MM, height = (maxY - minY) * PX_PER_MM;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  drawMap(context as never, map, { pxPerMm: PX_PER_MM, origin: { x: minX, y: maxY } });
  writeFileSync(join(dir, "merged.png"), canvas.toBuffer("image/png"));
  const topLeft = mapPointToProjected(georef, { x: minX, y: maxY }), bottomRight = mapPointToProjected(georef, { x: maxX, y: minY });
  const a = (bottomRight.easting - topLeft.easting) / width, e = (bottomRight.northing - topLeft.northing) / height;
  writeFileSync(join(dir, "merged.pgw"), [a, 0, 0, e, topLeft.easting + a / 2, topLeft.northing + e / 2].join("\n") + "\n");

  const codeOf = new Map([...map.symbols.values()].map(symbol => [symbol.id, `${symbol.code.main}.${symbol.code.sub}`]));
  const entities: string[] = [];
  for (const object of map.objects) {
    const code = object.kind === "line" ? codeOf.get(object.symbol) : undefined;
    if (object.kind !== "line" || (code !== "101.0" && code !== "102.0")) continue;
    const points = pointsOf(object.path).map(point => mapPointToProjected(georef, point));
    const layer = code === "102.0" ? "contour_index" : "contour";
    entities.push("0", "POLYLINE", "8", layer, "66", "1", "70", "0",
      ...points.flatMap(point => ["0", "VERTEX", "8", layer, "10", point.easting.toFixed(2), "20", point.northing.toFixed(2)]), "0", "SEQEND");
  }
  const dxf = (rows: readonly string[]) => ["0", "SECTION", "2", "ENTITIES", ...rows, "0", "ENDSEC", "0", "EOF"].join("\n");
  writeFileSync(join(dir, "merged_contours.dxf"), dxf(entities));
  writeFileSync(join(dir, "merged_c2g.dxf"), dxf([]));
}
