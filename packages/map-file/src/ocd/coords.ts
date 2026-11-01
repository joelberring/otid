/** OCAD-koordinater: två int32 per punkt, värdet i de höga 24 bitarna (0,01 mm, y uppåt) och flaggor i de låga 8. */
import { GAP, type Path, type PathCommand, type Point } from "../model";
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
 *
 * Med `flags` följer punkternas flaggor med (se `PathCommand`): y 1 = hörnpunkt, y 8 = streckpunkt, och på punkten där
 * en sträcka börjar x 8 = ingen huvudlinje, x 4 = ingen vänster och y 4 = ingen höger kantlinje fram till nästa punkt.
 */
export function coordsToParts(coords: RawCoords, offset: Point = { x: 0, y: 0 }, flags = false): Path[] {
  const n = coords.x.length;
  const parts: Path[] = [];
  let current: PathCommand[] = [];
  let anchor = 0;
  const px = (i: number) => coords.x[i]! + offset.x;
  const py = (i: number) => coords.y[i]! + offset.y;
  const gapAfter = (start: number) => ((coords.xFlags[start]! & COORD_FLAG.mainGap) !== 0 ? GAP.main : 0) |
    ((coords.xFlags[start]! & COORD_FLAG.leftGap) !== 0 ? GAP.left : 0) | ((coords.yFlags[start]! & COORD_FLAG.rightGap) !== 0 ? GAP.right : 0);
  const flush = () => {
    if (current.length > 1) {
      // Den sista punktens lucka gäller sträckan som stänger en yta; den sparas på delens första punkt.
      const closing = flags ? gapAfter(anchor) : 0;
      if (closing !== 0) current[0] = { ...current[0]!, gap: closing };
      parts.push(current);
    }
    current = [];
  };
  const marks = (end: number, start: number) => {
    if (!flags) return {};
    const y = coords.yFlags[end]!;
    const gap = start < 0 ? 0 : gapAfter(start);
    return {
      ...((y & COORD_FLAG.corner) !== 0 ? { corner: true as const } : {}),
      ...((y & COORD_FLAG.dash) !== 0 ? { dash: true as const } : {}),
      ...(gap !== 0 ? { gap } : {})
    };
  };
  let i = 0;
  while (i < n) {
    if (current.length === 0 || (coords.yFlags[i]! & COORD_FLAG.holeStart) !== 0 && (coords.xFlags[i]! & 3) === 0) {
      flush();
      current.push({ type: "M", x: px(i), y: py(i), ...marks(i, -1) });
      anchor = i;
      i++;
      continue;
    }
    const isFirstControl = (coords.xFlags[i]! & COORD_FLAG.firstControl) !== 0;
    if (isFirstControl && i + 2 < n && (coords.xFlags[i + 1]! & COORD_FLAG.secondControl) !== 0) {
      current.push({ type: "C", x1: px(i), y1: py(i), x2: px(i + 1), y2: py(i + 1), x: px(i + 2), y: py(i + 2), ...marks(i + 2, anchor) });
      anchor = i + 2;
      i += 3;
      continue;
    }
    current.push({ type: "L", x: px(i), y: py(i), ...marks(i, anchor) });
    anchor = i;
    i++;
  }
  flush();
  return parts;
}
