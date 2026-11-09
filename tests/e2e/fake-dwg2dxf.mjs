#!/usr/bin/env node
/**
 * En falsk dwg2dxf (LibreDWG) för webbläsartestet av DWG-jobben (ADR-0219 K6b): `dwg2dxf -y -o ut.dxf in.dwg`. Prövar att
 * indata är en DWG (börjar med versionen, t.ex. AC1015) och skriver en DXF med en väg i SWEREF 99 TM.
 */
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);
const out = args[args.indexOf("-o") + 1], input = args[args.length - 1];
if (!out || !input || !/^AC10\d\d/.test(readFileSync(input).subarray(0, 6).toString("latin1"))) { process.stderr.write("ingen DWG\n"); process.exit(1); }
const polyline = (layer, points) => ["0", "POLYLINE", "8", layer, "66", "1", "70", "0",
  ...points.flatMap(([x, y]) => ["0", "VERTEX", "8", layer, "10", String(x), "20", String(y)]), "0", "SEQEND"];
writeFileSync(out, ["0", "SECTION", "2", "ENTITIES", ...polyline("VAG", [[675000, 6580000], [675100, 6580050]]), "0", "ENDSEC", "0", "EOF"].join("\n"));
