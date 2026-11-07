/**
 * ADR-0219: kontrollen efter skrivningen. Den nya texten gås igenom rått och läses om med läsaren: allt utanför `<parts>` ska
 * vara som förut (utom borttagen ångrahistorik), orörda objekt tecken för tecken som i originalet och i samma ordning, och
 * ändrade och nya objekt ska läsas tillbaka som det som beställdes. Hittar kontrollen något lämnas filen inte ut.
 */
import { normalizeAngle, openRing } from "../geometry";
import { MapFileError, type MapObject, type Path, type PathCommand } from "../model";
import { readOmap } from "../omap/read";
import type { XmlObjectLocator } from "./change-set";
import { scanParts, ScanError, type RawElement, type RawParts } from "./omap-scan";
import type { OmapPlan } from "./omap-write";

/** Avrundningen till 0,001 mm ger högst 0,0005 mm fel. */
const TOLERANCE = 0.0006;

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

function nearAngle(a: number, b: number): boolean {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, 360 - difference) <= 0.00011;
}

function sameCommand(expected: PathCommand, actual: PathCommand): boolean {
  if (expected.type !== actual.type || !near(expected.x, actual.x) || !near(expected.y, actual.y)) return false;
  if (Boolean(expected.corner || expected.dash) !== Boolean(actual.corner)) return false;
  if (expected.type === "C" && actual.type === "C") {
    return near(expected.x1, actual.x1) && near(expected.y1, actual.y1) && near(expected.x2, actual.x2) && near(expected.y2, actual.y2);
  }
  return true;
}

const samePath = (expected: Path, actual: Path) => expected.length === actual.length && expected.every((command, i) => sameCommand(command, actual[i]!));

/** Objektet som läsaren gav är det som beställdes (Mapper har inga luckor; `dash` läses tillbaka som `corner`). */
export function sameObject(expected: MapObject, actual: MapObject): boolean {
  if (expected.kind !== actual.kind || expected.symbol !== actual.symbol) return false;
  switch (expected.kind) {
    case "point":
      return actual.kind === "point" && near(expected.at.x, actual.at.x) && near(expected.at.y, actual.at.y) && nearAngle(expected.angle, actual.angle);
    case "text":
      return actual.kind === "text" && near(expected.at.x, actual.at.x) && near(expected.at.y, actual.at.y) && nearAngle(expected.angle, actual.angle) &&
        expected.text === actual.text;
    case "line":
      return actual.kind === "line" && samePath(expected.path, actual.path);
    case "area": {
      if (actual.kind !== "area" || !nearAngle(expected.angle, actual.angle) || expected.rings.length !== actual.rings.length) return false;
      return expected.rings.every((ring, i) => samePath(openRing(ring), actual.rings[i]!));
    }
  }
}

function withoutRanges(text: string, from: number, ranges: readonly RawElement[]): string {
  let out = "", at = from;
  for (const range of ranges) {
    if (range.start < from) continue;
    out += text.slice(at, range.start);
    at = range.end;
  }
  return out + text.slice(at);
}

export type VerifyResult =
  | { readonly ok: true; readonly untouched: number; readonly checked: number; readonly added: readonly { readonly id: string; readonly locator: XmlObjectLocator }[] }
  | { readonly ok: false; readonly message: string };

export function verifyOmap(originalText: string, original: RawParts | null, newText: string, plan: OmapPlan): VerifyResult {
  const fail = (message: string): VerifyResult => ({ ok: false, message: `Kontrollen efter skrivningen: ${message}` });
  let next: RawParts | null;
  let reread;
  try {
    next = scanParts(newText);
    reread = readOmap(newText, { sources: true });
  } catch (error) {
    if (error instanceof ScanError || error instanceof MapFileError) return fail(`den nya filen går inte att läsa (${error.message}).`);
    throw error;
  }
  if (!original || !next) return original === next ? { ok: true, untouched: 0, checked: 0, added: [] } : fail("kartdelarna saknas.");
  if (originalText.slice(0, original.start) !== newText.slice(0, next.start)) return fail("filhuvudet före objekten har ändrats.");
  if (withoutRanges(originalText, original.end, plan.history) !== newText.slice(next.end)) return fail("filen efter objekten har ändrats.");
  if (next.parts.length !== original.parts.length || next.parts.length !== plan.parts.length) return fail("antalet kartdelar har ändrats.");
  const byPlace = new Map(reread.objects.flatMap(object => object.source?.locator.format === "OMAP"
    ? [[`${object.source.locator.part}:${object.source.locator.ordinal}`, object] as const] : []));
  let untouched = 0, checked = 0;
  const added: { id: string; locator: XmlObjectLocator }[] = [];
  for (let p = 0; p < next.parts.length; p++) {
    const expected = plan.parts[p]!;
    const part = next.parts[p]!;
    if (part.elements.length !== expected.length) return fail(`kartdel ${p + 1} har ${part.elements.length} objekt, väntat ${expected.length}.`);
    const tag = part.objectsTag;
    const count = tag ? /\scount\s*=\s*"(\d+)"/.exec(newText.slice(tag.start, tag.end))?.[1] : undefined;
    if (count !== undefined && Number(count) !== expected.length) return fail(`kartdel ${p + 1} anger fel antal objekt.`);
    for (let k = 0; k < expected.length; k++) {
      const want = expected[k]!;
      const element = part.elements[k]!;
      const actual = newText.slice(element.start, element.end);
      if (want.kind === "kept") {
        if (actual !== originalText.slice(want.start, want.end)) return fail(`ett orört objekt i kartdel ${p + 1} har ändrats.`);
        untouched++;
        continue;
      }
      if (actual !== want.text) return fail(`ett skrivet objekt i kartdel ${p + 1} hamnade fel.`);
      const object = byPlace.get(`${p}:${k}`);
      if (!object || !sameObject(want.object, object)) return fail(`ett ändrat eller nytt objekt i kartdel ${p + 1} läses inte tillbaka som beställt.`);
      checked++;
      if (want.addId !== undefined) added.push({ id: want.addId, locator: { format: "OMAP", part: p, ordinal: k, start: element.start, end: element.end } });
    }
  }
  return { ok: true, untouched, checked, added };
}
