#!/usr/bin/env node
/**
 * En falsk lasclip för webbläsartestet av geo-arbetaren (grundkartan G1). Den falska laserfilen är JSON med rutan; den kopieras
 * till utfilen med klipprutan tillagd, så att testet kan se att geo-arbetaren klippte innan Karttapullautin kördes.
 * Vattenrastret (sjunde argumentet) får mark överallt utom en sjö på 80 × 80 m, 60 m in från rutans sydvästra hörn.
 */
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const [input, output, minX, minY, maxX, maxY, water, ground] = process.argv.slice(2);
const box = JSON.parse(readFileSync(input, "utf8"));
writeFileSync(output, JSON.stringify({ ...box, clip: [minX, minY, maxX, maxY].map(Number) }));
if (water) {
  const width = Math.ceil((maxX - minX) / 2), height = Math.ceil((maxY - minY) / 2);
  const bytes = Buffer.alloc(40 + width * height, 1);
  bytes.writeDoubleLE(Number(minX), 0); bytes.writeDoubleLE(Number(minY), 8); bytes.writeDoubleLE(2, 16);
  bytes.writeBigUInt64LE(BigInt(width), 24); bytes.writeBigUInt64LE(BigInt(height), 32);
  for (let x = 30; x < 70 && x < width; x += 1) for (let y = 30; y < 70 && y < height; y += 1) bytes[40 + x * height + y] = (x + y) % 3 === 0 ? 2 : 0;
  writeFileSync(water, bytes);
}
// Markrastret (åttonde argumentet): en sluttning österut i 1 m-celler, så att terrängskuggningen går att rita.
if (ground) {
  const width = Math.ceil(maxX - minX), height = Math.ceil(maxY - minY);
  const bytes = Buffer.alloc(40 + width * height * 4);
  bytes.writeDoubleLE(Number(minX), 0); bytes.writeDoubleLE(Number(minY), 8); bytes.writeDoubleLE(1, 16);
  bytes.writeBigUInt64LE(BigInt(width), 24); bytes.writeBigUInt64LE(BigInt(height), 32);
  // Södra halvan saknar markpunkter (NaN): där ligger den falska branten, som då behålls utan uppmätt fall.
  // Ett rakt dike (1 m brett, 0,5 m djupt) tvärs över norra halvan, för dikena ur terrängformen.
  const ditch = Math.round(height * 3 / 4);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const dug = y === ditch && x > width / 10 && x < width * 9 / 10 ? 0.5 : 0;
    bytes.writeFloatLE(y < height / 2 ? NaN : 20 + x * 0.1 - dug, 40 + (x * height + y) * 4);
  }
  writeFileSync(ground, bytes);
}
process.stdout.write("1\n");
