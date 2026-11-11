// Berg i dagen-provet: npx tsx scripts/learn/rock.ts <mapp från terrain.py> <ruta> <vegetationsklasser.png> <E för bildens västkant> <N för nordkant>
// Skriver ringarna som JSON (<mapp>/<ruta>.rock.json) för rock.py.
import { readFileSync, writeFileSync } from "node:fs";
import { bareRock } from "../geo-rock.ts";
import { decodeGrayPng } from "../geo-vegetation.ts";

const [dir, d, classFile, west, north] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(`${dir}/${d}.json`, "utf8")) as { width: number; height: number; minX: number; minY: number };
const z = new Float32Array(readFileSync(`${dir}/${d}.f32`).buffer.slice(0));
const ground = { minX: meta.minX, minY: meta.minY, cell: 1, width: meta.width, height: meta.height, z };
const classes = decodeGrayPng(new Uint8Array(readFileSync(classFile!)));
const classAt = (x: number, y: number) => {
  const c = Math.floor((x - Number(west)) / 2), r = Math.floor((Number(north) - y) / 2);
  return c >= 0 && r >= 0 && c < classes.width && r < classes.height ? classes.data[r * classes.width + c]! & 15 : 0;
};
const rings = bareRock(ground, (x, y) => classAt(x, y) === 1, undefined, undefined, (x, y) => { const v = classAt(x, y); return v === 2 || v === 3; });
writeFileSync(`${dir}/${d}.rock.json`, JSON.stringify(rings));
console.log(d, rings.length, "ytor");
