/**
 * Mappers koordinater: heltal i 0,001 mm med y nedåt, som text "x y flaggor;". Flaggor: 1 = kurvan börjar här (de två
 * följande punkterna är styrpunkter), 2 = stängningspunkt, 16 = sista punkten i en del (nästa punkt börjar ett hål).
 */
import type { Path, PathCommand } from "../model";

const CURVE_START = 1;
const HOLE_POINT = 16;

/** Tolkar "x y f;x y;…" i `text[start, end)` till trippel (x, y, flaggor). Null om texten inte är koordinater. */
export function parseCoordText(text: string, start: number, end: number): number[] | null {
  const out: number[] = [];
  let field = 0;
  let x = 0, y = 0, flags = 0;
  let i = start;
  while (i < end) {
    let c = text.charCodeAt(i);
    if (c === 59) {
      if (field >= 2) out.push(x, y, flags);
      else if (field !== 0) return null;
      field = 0; flags = 0; i++;
      continue;
    }
    if (c <= 32) { i++; continue; }
    let negative = false;
    if (c === 45) { negative = true; i++; c = text.charCodeAt(i); }
    if (!(c >= 48 && c <= 57)) return null;
    let value = 0;
    while (i < end && (c = text.charCodeAt(i)) >= 48 && c <= 57) { value = value * 10 + (c - 48); i++; }
    if (negative) value = -value;
    if (field === 0) x = value;
    else if (field === 1) y = value;
    else if (field === 2) flags = value;
    else return null;
    field++;
  }
  if (field >= 2) out.push(x, y, flags);
  else if (field !== 0) return null;
  return out;
}

/** Trippel → delar (yttre ring och hål, eller delar av en linje), i mm med y uppåt. Delar utan sträcka tas bort. */
export function coordsToParts(triples: readonly number[]): Path[] {
  const n = Math.floor(triples.length / 3);
  const px = (i: number) => triples[3 * i]! / 1000;
  const py = (i: number) => (0 - triples[3 * i + 1]!) / 1000;
  const flag = (i: number) => triples[3 * i + 2]!;
  const parts: Path[] = [];
  let i = 0;
  while (i < n) {
    const commands: PathCommand[] = [{ type: "M", x: px(i), y: py(i) }];
    for (;;) {
      if (i >= n - 1 || (flag(i) & HOLE_POINT) !== 0) { i++; break; }
      if ((flag(i) & CURVE_START) !== 0 && i + 3 < n) {
        commands.push({ type: "C", x1: px(i + 1), y1: py(i + 1), x2: px(i + 2), y2: py(i + 2), x: px(i + 3), y: py(i + 3) });
        i += 3;
      } else {
        commands.push({ type: "L", x: px(i + 1), y: py(i + 1) });
        i += 1;
      }
    }
    if (commands.length > 1) parts.push(commands);
  }
  return parts;
}

/** Alla delar som en väg med en flyttning per del. */
export function joinParts(parts: readonly Path[]): Path {
  return parts.length === 1 ? parts[0]! : parts.flat();
}
