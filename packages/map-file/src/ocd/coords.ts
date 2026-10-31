/** OCAD-koordinater: två int32 per punkt, värdet i de höga 24 bitarna (0,01 mm, y uppåt) och flaggor i de låga 8. */
import type { Path, PathCommand, Point } from "../model";
import type { Bytes } from "./bytes";
import { COORD_FLAG, UNIT } from "./layout";

export interface RawCoords { readonly x: Float64Array; readonly y: Float64Array; readonly xFlags: Uint8Array; readonly yFlags: Uint8Array }

export function readCoords(bytes: Bytes, offset: number, count: number): RawCoords {
  bytes.check(offset, count * 8, "koordinater");
  const x = new Float64Array(count), y = new Float64Array(count);
  const xFlags = new Uint8Array(count), yFlags = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const rawX = bytes.i32(offset + 8 * i);
    const rawY = bytes.i32(offset + 8 * i + 4);
    x[i] = (rawX >> 8) * UNIT;
    y[i] = (rawY >> 8) * UNIT;
    xFlags[i] = rawX & 0xff;
    yFlags[i] = rawY & 0xff;
  }
  return { x, y, xFlags, yFlags };
}

/**
 * Punkter → delar (ytterkant och hål). En punkt med x-flaggan 1 följd av en med x-flaggan 2 är kurvans styrpunkter; nästa
 * punkt är kurvans slut. y-flaggan 2 börjar ett nytt hål. Trasiga kurvor (styrpunkt utan slut) blir raka linjer.
 */
export function coordsToParts(coords: RawCoords, offset: Point = { x: 0, y: 0 }): Path[] {
  const n = coords.x.length;
  const parts: Path[] = [];
  let current: PathCommand[] = [];
  const px = (i: number) => coords.x[i]! + offset.x;
  const py = (i: number) => coords.y[i]! + offset.y;
  const flush = () => { if (current.length > 1) parts.push(current); current = []; };
  let i = 0;
  while (i < n) {
    if (current.length === 0 || (coords.yFlags[i]! & COORD_FLAG.holeStart) !== 0 && (coords.xFlags[i]! & 3) === 0) {
      flush();
      current.push({ type: "M", x: px(i), y: py(i) });
      i++;
      continue;
    }
    const isFirstControl = (coords.xFlags[i]! & COORD_FLAG.firstControl) !== 0;
    if (isFirstControl && i + 2 < n && (coords.xFlags[i + 1]! & COORD_FLAG.secondControl) !== 0) {
      current.push({ type: "C", x1: px(i), y1: py(i), x2: px(i + 1), y2: py(i + 1), x: px(i + 2), y: py(i + 2) });
      i += 3;
      continue;
    }
    current.push({ type: "L", x: px(i), y: py(i) });
    i++;
  }
  flush();
  return parts;
}
