#!/usr/bin/env node
/**
 * En falsk Karttapullautin för webbläsartestet av geo-arbetaren (ADR-0219 K5). Läser rutan (JSON från den falska laserfilen i
 * ./in) och skriver det som geo-arbetaren skickar: merged.png med världsfil och kurvor som DXF i SWEREF 99 TM.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { Buffer } from "node:buffer";
import process from "node:process";

const command = process.argv[2] ?? "";
const box = JSON.parse(readFileSync(`in/${readdirSync("in").find(name => name.endsWith(".laz"))}`, "utf8"));
const width = 200, height = 200;
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
};
const png = (w, h, colorType, channels, pixel) => {
  const raw = Buffer.alloc(h * (1 + w * channels));
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) raw.set(pixel(x, y), y * (1 + w * channels) + 1 + x * channels);
  const header = Buffer.alloc(13); header.writeUInt32BE(w, 0); header.writeUInt32BE(h, 4); header.set([8, colorType, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))]);
};
if (command === "") {
  mkdirSync("out", { recursive: true });
  // Med vege_bitmode=1 (vegetationen, K5c del 3): klassbilderna per ruta, öppen mark i väster och grönt i öster.
  if (/^vege_bitmode=1$/m.test(readFileSync("pullauta.ini", "utf8"))) {
    const size = Math.max(1, Math.ceil((box.maxE - box.minE) / 300)), w = Math.ceil((box.maxE - box.minE) / size), h = Math.ceil((box.maxN - box.minN) / size);
    writeFileSync("out/ruta00_vege_bit.png", png(w, h, 0, 1, x => [x < w / 3 ? 1 : x > w / 2 ? 8 : 0]));
    writeFileSync("out/ruta00_undergrowth_bit.png", png(w, h, 0, 1, () => [0]));
    writeFileSync("out/ruta00_vege_bit.pgw", [size, 0, 0, -size, box.minE + size / 2, box.maxN - size / 2].join("\r\n") + "\r\n");
  }
  // Med savetempfolders=1 (fuktigheten, K5c): ett höjdraster på 2 m, som Karttapullautins xyz2.hmap.
  if (/^savetempfolders=1$/m.test(readFileSync("pullauta.ini", "utf8"))) {
    const cell = 2, width = Math.floor((box.maxE - box.minE) / cell) + 1, height = Math.floor((box.maxN - box.minN) / cell) + 1;
    const bytes = Buffer.alloc(40 + width * height * 8);
    bytes.writeDoubleLE(box.minE, 0); bytes.writeDoubleLE(box.minN, 8); bytes.writeDoubleLE(cell, 16);
    bytes.writeBigUInt64LE(BigInt(width), 24); bytes.writeBigUInt64LE(BigInt(height), 32);
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        // En dal som lutar söderut med en sänka i nordväst (samma som enhetstestet för fuktigheten).
        const pit = Math.hypot(x - width / 4, y - height * 0.75) < Math.max(6, width / 15) ? 5 : 0;
        bytes.writeDoubleLE(20 + Math.abs(x - width / 2) * 0.3 + y * 0.05 - pit, 40 + (x * height + y) * 8);
      }
    }
    mkdirSync("temp_ruta00.laz_dir", { recursive: true });
    writeFileSync("temp_ruta00.laz_dir/xyz2.hmap", bytes);
  }
  process.exit(0);
}
if (command === "pngmerge") {
  writeFileSync("merged.png", png(width, height, 6, 4, () => [200, 120, 40, 255]));
  const a = (box.maxE - box.minE) / width, e = -(box.maxN - box.minN) / height;
  writeFileSync("merged.pgw", [a, 0, 0, e, box.minE + a / 2, box.maxN + e / 2].join("\n") + "\n");
  process.exit(0);
}
if (command === "dxfmerge") {
  const cx = (box.minE + box.maxE) / 2, cy = (box.minN + box.maxN) / 2, r = (box.maxE - box.minE) / 6;
  const ring = Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos(i / 24 * 2 * Math.PI), cy + r * Math.sin(i / 24 * 2 * Math.PI)]);
  const polyline = (layer, points) => ["0", "POLYLINE", "8", layer, "66", "1", "70", "1",
    ...points.flatMap(([x, y]) => ["0", "VERTEX", "8", layer, "10", String(x), "20", String(y)]), "0", "SEQEND"];
  const dxf = (entities) => ["0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC", "0", "EOF"].join("\n");
  writeFileSync("merged_contours.dxf", dxf([...polyline("contour", ring), ...polyline("contour_index", ring.map(([x, y]) => [cx + (x - cx) * 2, cy + (y - cy) * 2]))]));
  writeFileSync("merged_c2g.dxf", dxf(polyline("cliff2", [[cx - r, cy - r * 2], [cx + r, cy - r * 2]])));
  process.exit(0);
}
process.exit(2);
