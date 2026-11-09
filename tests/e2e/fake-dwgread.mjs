#!/usr/bin/env node
/**
 * En falsk dwgread (LibreDWG) för webbläsartestet av DWG-jobben (ADR-0219 K6b): `dwgread -O JSON -o ut.json in.dwg`. Prövar
 * att indata är en DWG (börjar med versionen, t.ex. AC1015) och skriver JSON som dwgread: ett lager, modellrymden och en
 * väg (LWPOLYLINE) och ett hus (HATCH) i SWEREF 99 TM.
 */
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const out = args[args.indexOf("-o") + 1], input = args[args.length - 1];
if (!out || !input || !/^AC10\d\d/.test(readFileSync(input).subarray(0, 6).toString("latin1"))) { process.stderr.write("ingen DWG\n"); process.exit(1); }
const objects = [
  { object: "BLOCK_HEADER", handle: [0, 1, 31], name: "*Model_Space" },
  { object: "LAYER", handle: [0, 1, 40], name: "VAG" },
  { object: "LAYER", handle: [0, 1, 41], name: "BostadsbyggnadBostadsbyggnadgyBBefintl" },
  { entity: "LWPOLYLINE", handle: [0, 1, 50], entmode: 2, layer: [5, 1, 40, 40], flag: 0, points: [[675000, 6580000], [675100, 6580050]], bulges: [] },
  { entity: "HATCH", handle: [0, 1, 51], entmode: 2, layer: [5, 1, 41, 41], paths: [{ flag: 1, segs: [
    { curve_type: 1, first_endpoint: [675010, 6580010], second_endpoint: [675030, 6580010] },
    { curve_type: 1, first_endpoint: [675030, 6580010], second_endpoint: [675030, 6580025] },
    { curve_type: 1, first_endpoint: [675030, 6580025], second_endpoint: [675010, 6580025] },
    { curve_type: 1, first_endpoint: [675010, 6580025], second_endpoint: [675010, 6580010] }] }] }
];
writeFileSync(out, JSON.stringify({ created_by: "fake", FILEHEADER: {}, OBJECTS: objects }, null, 2));
