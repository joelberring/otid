// Kullprovet: npx tsx scripts/learn/knolls.ts <mapp från terrain.py> <ruta …>. Jämför laserns små kullar med kartans punkthöjder
// (inom 10 m) med hela ringen lägre (gamla regeln) och med 80 % (nya).
import { readFileSync } from "node:fs";
import { knolls } from "../geo-rock.ts";
import { decodeGrayPng } from "../geo-vegetation.ts";

const [dir, ...names] = process.argv.slice(2);
for (const d of names) {
  const meta = JSON.parse(readFileSync(`${dir}/${d}.json`, "utf8")) as { width: number; height: number; minX: number; minY: number; maxN: number; lw: number; lh: number; pts: number[][] };
  const z = new Float32Array(readFileSync(`${dir}/${d}.f32`).buffer.slice(0));
  const ground = { minX: meta.minX, minY: meta.minY, cell: 1, width: meta.width, height: meta.height, z };
  const dom = decodeGrayPng(new Uint8Array(readFileSync(`${dir}/${d}.dom.png`)));
  const inDom = (p: readonly number[]) => { const c = Math.floor((p[0]! - meta.minX) / 2), r = Math.floor((meta.maxN - p[1]!) / 2); return c >= 0 && r >= 0 && c < meta.lw && r < meta.lh && dom.data[r * meta.lw + c]! > 0; };
  const truth = meta.pts.map(p => [p[1]!, p[2]!]).filter(inDom);
  for (const share of [1, 0.8]) {
    const found = knolls(ground, [], undefined, undefined, undefined, share).filter(inDom);
    const hit = found.filter(k => truth.some(t => Math.hypot(t[0]! - k[0], t[1]! - k[1]) < 10)).length;
    const got = truth.filter(t => found.some(k => Math.hypot(t[0]! - k[0], t[1]! - k[1]) < 10)).length;
    console.log(d, `andel ${share}: ${found.length} funna, ${truth.length} i facit, träffsäkerhet ${(hit / Math.max(1, found.length)).toFixed(2)}, hittade ${(got / Math.max(1, truth.length)).toFixed(2)}`);
  }
}
