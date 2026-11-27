#!/usr/bin/env node
/**
 * En falsk `otidgeo` för webbläsartesterna (`kartprojekt-geo.spec.ts` och `bildspel.spec.ts`, Etapp G4B).
 * Stöder `run`, `veg` och `rasters`: läser JSON-rutan ur de falska laserfilerna (eller 40-bytes-huvudet ur `mark*.bin`)
 * och skriver minimala men fullständiga DXF-, PNG/PGW-, GeoJSON- och JSON-utdata i SWEREF 99 TM.
 */
import { Buffer } from "node:buffer";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { crc32, deflateSync } from "node:zlib";

const args = process.argv.slice(2);
const sub = args[0] ?? "";

const flagValue = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};
const flagValues = (name) => {
  const out = [];
  for (let i = 1; i < args.length; i += 1) if (args[i] === name && args[i + 1] !== undefined) out.push(args[i + 1]);
  return out;
};
const hasFlag = (name) => args.includes(name);

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
};
const rgbaPng = (w, h, pixel) => {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y += 1) {
    const row = y * (1 + w * 4);
    for (let x = 0; x < w; x += 1) raw.set(pixel(x, y), row + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
};
const squareGrid = (box, targetSide) => {
  const size = Math.max(2, Math.ceil(Math.max(box.maxX - box.minX, box.maxY - box.minY) / targetSide));
  const w = Math.max(8, Math.ceil((box.maxX - box.minX) / size));
  const h = Math.max(8, Math.ceil((box.maxY - box.minY) / size));
  const pgw = [size, 0, 0, -size, box.minX + size / 2, box.maxY - size / 2].join("\n") + "\n";
  return { size, w, h, pgw };
};
const lwPolyline = (layer, points, closed) => [
  "0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", closed ? "1" : "0",
  ...points.flatMap(([x, y]) => ["10", x.toFixed(2), "20", y.toFixed(2)])
];
const dxfDoc = (entities) => ["0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC", "0", "EOF", ""].join("\n");

const readBoxFromInput = () => {
  const input = flagValues("--input")[0];
  if (!input) process.exit(1);
  const raw = JSON.parse(readFileSync(input, "utf8"));
  const clipStr = flagValue("--clip") ?? flagValue("--bbox");
  if (clipStr) {
    const [minX, minY, maxX, maxY] = clipStr.split(",").map(Number);
    return { minX, minY, maxX, maxY };
  }
  if (Array.isArray(raw.clip) && raw.clip.length === 4) {
    const [minX, minY, maxX, maxY] = raw.clip.map(Number);
    return { minX, minY, maxX, maxY };
  }
  return { minX: raw.minE, minY: raw.minN, maxX: raw.maxE, maxY: raw.maxN };
};

const writeVegOutputs = (outDir, box) => {
  const size = Math.max(2, Math.ceil((box.maxX - box.minX) / 300));
  const w = Math.max(4, Math.ceil((box.maxX - box.minX) / size));
  const h = Math.max(4, Math.ceil((box.maxY - box.minY) / size));
  // Väster: öppen mark (401 -> R=1), öster: mycket svårlöpt grönt (410 -> R=6), mitten: vanlig skog (R=2).
  const bytes = rgbaPng(w, h, x => {
    const code = x < w / 3 ? 1 : x > w / 2 ? 6 : 2;
    return [code, 160, code, 255];
  });
  writeFileSync(join(outDir, "vegetationsklasser.png"), bytes);
  writeFileSync(join(outDir, "vegetationsklasser.pgw"), [size, 0, 0, -size, box.minX + size / 2, box.maxY - size / 2].join("\n") + "\n");
};

const outDir = flagValue("--out");
if (!outDir) process.exit(2);
mkdirSync(outDir, { recursive: true });

if (sub === "run" || sub === "veg") {
  const box = readBoxFromInput();
  writeVegOutputs(outDir, box);
  if (sub === "run") {
    const ready = process.env.OTID_BILDSPEL_LASER;
    if (ready && existsSync(join(ready, "merged_contours.dxf"))) {
      copyFileSync(join(ready, "merged_contours.dxf"), join(outDir, "kurvor.dxf"));
      writeFileSync(join(outDir, "formlinjer.dxf"), dxfDoc([]));
      writeFileSync(join(outDir, "knollar.dxf"), dxfDoc([]));
      if (hasFlag("--overview") && existsSync(join(ready, "merged.png"))) {
        copyFileSync(join(ready, "merged.png"), join(outDir, "karta.png"));
        copyFileSync(join(ready, "merged.pgw"), join(outDir, "karta.pgw"));
      }
    } else {
      const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2, r = (box.maxX - box.minX) / 6;
      const ring = Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos(i / 24 * 2 * Math.PI), cy + r * Math.sin(i / 24 * 2 * Math.PI)]);
      const outer = ring.map(([x, y]) => [cx + (x - cx) * 2, cy + (y - cy) * 2]);
      writeFileSync(join(outDir, "kurvor.dxf"), dxfDoc([...lwPolyline("contour", ring, true), ...lwPolyline("contour_index", outer, true)]));
      writeFileSync(join(outDir, "formlinjer.dxf"), dxfDoc([]));
      writeFileSync(join(outDir, "knollar.dxf"), dxfDoc([]));
      if (hasFlag("--overview")) {
        const w = 200, a = (box.maxX - box.minX) / w, h = Math.max(10, Math.round((box.maxY - box.minY) / a));
        writeFileSync(join(outDir, "karta.png"), rgbaPng(w, h, () => [200, 120, 40, 255]));
        writeFileSync(join(outDir, "karta.pgw"), [a, 0, 0, -a, box.minX + a / 2, box.maxY - a / 2].join("\n") + "\n");
      }
    }
  }
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ mode: sub, msTotal: 5 }) + "\n");
  process.exit(0);
}

if (sub === "rasters") {
  const groundPaths = flagValues("--ground");
  if (groundPaths.length === 0) process.exit(2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const path of groundPaths) {
    const buf = readFileSync(path);
    const gx = buf.readDoubleLE(0), gy = buf.readDoubleLE(8), cell = buf.readDoubleLE(16);
    const gw = Number(buf.readBigUInt64LE(24)), gh = Number(buf.readBigUInt64LE(32));
    minX = Math.min(minX, gx);
    minY = Math.min(minY, gy);
    maxX = Math.max(maxX, gx + gw * cell);
    maxY = Math.max(maxY, gy + gh * cell);
  }
  const box = { minX, minY, maxX, maxY };
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, r = (maxX - minX) / 6;
  const { w, h, pgw } = squareGrid(box, 64);

  if (hasFlag("--height-rasters")) {
    writeFileSync(join(outDir, "hojd.png"), rgbaPng(w, h, () => [0, 39, 16, 255]));
    writeFileSync(join(outDir, "hojd.pgw"), pgw);
    writeFileSync(join(outDir, "skuggning.png"), rgbaPng(w, h, () => [180, 180, 180, 255]));
    writeFileSync(join(outDir, "skuggning.pgw"), pgw);
    writeFileSync(join(outDir, "relief.png"), rgbaPng(w, h, () => [128, 128, 128, 255]));
    writeFileSync(join(outDir, "relief.pgw"), pgw);
  }
  let waterAreas = 0, waterHa = 0;
  if (hasFlag("--water-geojson") && flagValues("--water").length > 0) {
    const lx0 = minX + 60, ly0 = minY + 60, lx1 = Math.min(maxX - 10, lx0 + 80), ly1 = Math.min(maxY - 10, ly0 + 80);
    if (lx1 > lx0 && ly1 > ly0) {
      waterAreas = 1;
      waterHa = Math.round((lx1 - lx0) * (ly1 - ly0) / 100) / 100;
      const poly = [[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1], [lx0, ly0]];
      writeFileSync(join(outDir, "vatten.geojson"), JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { layer: "vatten" }, geometry: { type: "Polygon", coordinates: [poly] } }]
      }));
    }
  }
  let wetHa = 0, moistHa = 0, wetAreas = 0;
  if (hasFlag("--moisture")) {
    const { w: mw, h: mh, pgw: mPgw } = squareGrid(box, 100);
    const x1 = Math.floor(mw * 0.08), x2 = Math.floor(mw * 0.48), ix1 = Math.floor(mw * 0.15), ix2 = Math.floor(mw * 0.35);
    const y1 = Math.floor(mh * 0.08), y2 = Math.floor(mh * 0.48), iy1 = Math.floor(mh * 0.15), iy2 = Math.floor(mh * 0.35);
    writeFileSync(join(outDir, "fukt.png"), rgbaPng(mw, mh, (x, y) => (x >= x1 && x < x2 && y >= y1 && y < y2 ? [40, 110, 220, 200] : [0, 0, 0, 0])));
    writeFileSync(join(outDir, "fukt.pgw"), mPgw);
    // fuktdjup.png: inre rutan har HAND = 0,10 m (R=5), yttre zonen HAND = 0,80 m (R=40), lutning 5° (B=50), markandel 40 % (G=100).
    // Vid wet=1,5 och slope=15 räknas båda zonerna som blött; vid wet=0,3 bara den inre -> texten ändras i reglaget.
    writeFileSync(join(outDir, "fuktdjup.png"), rgbaPng(mw, mh, (x, y) => {
      if (x >= ix1 && x < ix2 && y >= iy1 && y < iy2) return [5, 100, 50, 255];
      if (x >= x1 && x < x2 && y >= y1 && y < y2) return [40, 100, 50, 255];
      return [250, 100, 50, 255];
    }));
    writeFileSync(join(outDir, "fuktdjup.pgw"), mPgw);
    const bx0 = minX + (maxX - minX) * 0.15, bx1 = minX + (maxX - minX) * 0.35;
    const by0 = minY + (maxY - minY) * 0.65, by1 = minY + (maxY - minY) * 0.85;
    const wetPoly = [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]];
    writeFileSync(join(outDir, "fukt.dxf"), dxfDoc(lwPolyline("blott", wetPoly, true)));
    wetHa = 0.64; moistHa = 0.4; wetAreas = 1;
  }
  let cliffs202 = 0, cliffMeters202 = 0;
  if (hasFlag("--cliffs")) {
    const yCliff = Math.max(minY + 10, cy - r * 2);
    const pts = [[cx - r, yCliff], [cx + r, yCliff]];
    cliffs202 = 1;
    cliffMeters202 = Math.round(r * 2);
    writeFileSync(join(outDir, "brantlinjer.dxf"), dxfDoc(lwPolyline("brant_passerbar", pts, false)));
    writeFileSync(join(outDir, "brantlinjer.geojson"), JSON.stringify({
      type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:3006" } },
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: { drop3: 2.5, drop6: 3.0, length: cliffMeters202 } }]
    }));
  }
  let ditches = 0;
  if (hasFlag("--ditches-tracks")) {
    if (!existsSync(join(outDir, "relief.png"))) {
      writeFileSync(join(outDir, "relief.png"), rgbaPng(w, h, () => [128, 128, 128, 255]));
      writeFileSync(join(outDir, "relief.pgw"), pgw);
    }
    const yDitch = minY + (maxY - minY) * 0.75;
    writeFileSync(join(outDir, "diken.dxf"), dxfDoc(lwPolyline("dike", [[cx - 18, yDitch], [cx + 18, yDitch]], false)));
    ditches = 1;
  }
  if (hasFlag("--rock") && flagValue("--veg-png")) {
    writeFileSync(join(outDir, "berg.png"), rgbaPng(w, h, () => [40, 200, 120, 255]));
    writeFileSync(join(outDir, "berg.pgw"), pgw);
  }
  writeFileSync(join(outDir, "rasters-summary.json"), JSON.stringify({
    waterHa, waterAreas, wetHa, moistHa, wetAreas, moistAreas: 0, channels: 0, terrainChannels: 0,
    cliffs201: 0, cliffs202, cliffMeters201: 0, cliffMeters202, cliffsDropped: 0,
    ditches, tracks: 0, boulders: 0, knolls: 0, bareRockAreas: 0, cappedPoints: 0,
    msHeight: 2, msMoisture: 2, msCliffs: 1, msTracks: 1, msRock: 1, msTotal: 7
  }) + "\n");
  process.exit(0);
}

process.exit(2);
