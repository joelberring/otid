/**
 * ADR-0219 K7: kontrollen efter att en OCAD-fil lappats. Filen läses igen: orörda objekt ska ligga kvar på sin plats i
 * indexet med samma bytes, ändrade och nya ska läsas tillbaka som det som beställdes (på 0,01 mm, med hörn-, streck- och
 * luckflaggor), borttagna ska vara borta, och allt i originalet utanför de ändrade intervallen ska vara byte för byte lika.
 */
import { normalizeAngle, openRing } from "../geometry";
import { MapFileError, type MapObject, type ParsedMap, type Path, type PathCommand } from "../model";
import { readOcd } from "../ocd/read";
import type { ByteEdit } from "./change-set";

export interface Expected { readonly block: number; readonly slot: number; readonly object: MapObject | null }
type VerifyResult = { readonly ok: true; readonly untouched: number; readonly checked: number } | { readonly ok: false; readonly message: string };

const TOLERANCE = 0.0051;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
function nearAngle(a: number, b: number): boolean {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, 360 - difference) <= 0.051;
}

function sameCommand(expected: PathCommand, actual: PathCommand): boolean {
  if (expected.type !== actual.type || !near(expected.x, actual.x) || !near(expected.y, actual.y)) return false;
  if (Boolean(expected.corner) !== Boolean(actual.corner) || Boolean(expected.dash) !== Boolean(actual.dash) || (expected.gap ?? 0) !== (actual.gap ?? 0)) return false;
  if (expected.type === "C" && actual.type === "C") {
    return near(expected.x1, actual.x1) && near(expected.y1, actual.y1) && near(expected.x2, actual.x2) && near(expected.y2, actual.y2);
  }
  return true;
}
const samePath = (expected: Path, actual: Path) => expected.length === actual.length && expected.every((command, i) => sameCommand(command, actual[i]!));

/** Objektet som läsaren gav är det som beställdes. */
export function sameOcdObject(expected: MapObject, actual: MapObject): boolean {
  if (expected.kind !== actual.kind || expected.symbol !== actual.symbol) return false;
  switch (expected.kind) {
    case "point":
      return actual.kind === "point" && near(expected.at.x, actual.at.x) && near(expected.at.y, actual.at.y) && nearAngle(expected.angle, actual.angle);
    case "text":
      return actual.kind === "text" && near(expected.at.x, actual.at.x) && near(expected.at.y, actual.at.y) && nearAngle(expected.angle, actual.angle) &&
        expected.text === actual.text;
    case "line":
      return actual.kind === "line" && samePath(expected.path, actual.path);
    case "area":
      return actual.kind === "area" && nearAngle(expected.angle, actual.angle) && expected.rings.length === actual.rings.length &&
        expected.rings.every((ring, i) => samePath(openRing(ring), actual.rings[i]!));
  }
}

export function verifyOcd(original: Uint8Array, result: Uint8Array, map: ParsedMap, expected: readonly Expected[], edits: readonly ByteEdit[]): VerifyResult {
  // Allt i originalet utom de skrivna intervallen är oförändrat.
  let at = 0;
  for (const edit of [...edits].filter(row => row.start < original.length).sort((a, b) => a.start - b.start)) {
    for (let i = at; i < edit.start; i++) if (original[i] !== result[i]) return { ok: false, message: `Byte ${i} ändrades utanför ändringarna.` };
    at = Math.max(at, edit.end);
  }
  for (let i = at; i < original.length; i++) if (original[i] !== result[i]) return { ok: false, message: `Byte ${i} ändrades utanför ändringarna.` };

  let reread: ParsedMap;
  try {
    reread = readOcd(result, { sources: true });
  } catch (error) {
    if (error instanceof MapFileError) return { ok: false, message: `Den nya filen går inte att läsa: ${error.message}` };
    throw error;
  }
  const after = new Map<string, MapObject>();
  for (const object of reread.objects) {
    const locator = object.source?.locator;
    if (locator?.format === "OCD") after.set(`${locator.block}:${locator.slot}`, object);
  }
  const touched = new Set(expected.map(row => `${row.block}:${row.slot}`));
  let untouched = 0;
  for (const object of map.objects) {
    const locator = object.source?.locator;
    if (locator?.format !== "OCD") continue;
    const key = `${locator.block}:${locator.slot}`;
    if (touched.has(key)) continue;
    const now = after.get(key), nowLocator = now?.source?.locator;
    if (!now || nowLocator?.format !== "OCD" || nowLocator.offset !== locator.offset || now.source!.objectHash !== object.source!.objectHash) {
      return { ok: false, message: `Ett orört objekt (block ${locator.block}, plats ${locator.slot}) ändrades.` };
    }
    untouched += 1;
  }
  for (const row of expected) {
    const now = after.get(`${row.block}:${row.slot}`);
    if (row.object === null) { if (now) return { ok: false, message: `Ett borttaget objekt (block ${row.block}, plats ${row.slot}) finns kvar.` }; continue; }
    if (!now || !sameOcdObject(row.object, now)) return { ok: false, message: `Objektet i block ${row.block}, plats ${row.slot} läses inte tillbaka som beställt.` };
  }
  const removed = expected.filter(row => row.object === null).length;
  const touchedBefore = map.objects.filter(object => object.source?.locator.format === "OCD" && touched.has(`${object.source.locator.block}:${object.source.locator.slot}`)).length;
  if (reread.objects.length !== map.objects.length - removed + (expected.length - touchedBefore)) {
    return { ok: false, message: "Den nya filen har fel antal objekt." };
  }
  return { ok: true, untouched, checked: expected.length };
}
