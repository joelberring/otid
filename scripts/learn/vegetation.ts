// Generaliseringsprovet: npx tsx scripts/learn/vegetation.ts <gråskalebild med klasserna (2 m)> <ut.png> [utjämning i celler]
// Kör vegetationens ytor på en färdig klassbild och skriver den generaliserade klassbilden, för jämförelse mot facit.
import { readFileSync, writeFileSync } from "node:fs";
import { decodeGrayPng, vegetationFromTiles } from "../geo-vegetation.ts";

const [input, output, cells] = process.argv.slice(2);
const vege = decodeGrayPng(new Uint8Array(readFileSync(input!)));
const started = Date.now();
const result = vegetationFromTiles([{ vege, world: { size: 2, left: 0, top: 0 } }], { minAreaM2: 300, ...(cells === undefined ? {} : { smoothCells: Number(cells) }) });
writeFileSync(output!, result.classPng);
console.log(JSON.stringify({ ms: Date.now() - started, ...result.summary }));
