import {
  objectRefOf, type MapFileFormat, type MapObject, type MapRevisionChange as FileChange, type MapRevisionChangeSet, type ObjectLocator,
  type ObjectRef, type ParsedMap, type RevisionGeometry
} from "@o-tid/map-file";

/**
 * ADR-0219: adaptern mellan kartprojektets ändringar och skrivaren i `@o-tid/map-file`. Ett objekt i grundfilen pekas ut
 * med kartfilens `ObjectRef` (grundfilens sha256, objektets plats och objektets hash), som läsarna sätter med
 * `readMapFile(bytes, namn, { sources: true })`. Referensen lagras på servern som JSON och går orörd till skrivaren, som
 * vägrar om platsen inte längre har objektet med samma hash.
 */
export type { ObjectRef } from "@o-tid/map-file";

/** En ändring som revideringen ser den: hela objektets nya läge (skrivaren får bara det som skiljer, `toChangeSet`). */
export type ObjectChange =
  | { readonly kind: "ADD"; readonly id: string; readonly object: MapObject; readonly author: string; readonly at: string }
  | { readonly kind: "MODIFY"; readonly ref: ObjectRef; readonly object: MapObject; readonly author: string; readonly at: string }
  | { readonly kind: "DELETE"; readonly ref: ObjectRef; readonly author: string; readonly at: string };

/** Platsen som text: samma plats ger alltid samma text (nyckeln i revideringens logg, utan filens sha256). */
export function locatorKey(locator: ObjectLocator): string {
  return locator.format === "OCD" ? `ocd:${locator.block}:${locator.slot}` : `omap:${locator.part}:${locator.ordinal}`;
}

export const objectRefKey = (ref: ObjectRef): string => locatorKey(ref.locator);

/** Grundfilens objekt per platsnyckel (läst med `sources`). Objekt utan källa kan inte revideras och saknas. */
export function objectsByKey(map: ParsedMap): Map<string, MapObject> {
  const out = new Map<string, MapObject>();
  for (const object of map.objects) if (object.source) out.set(locatorKey(object.source.locator), object);
  return out;
}

/** Objektets referens i grundfilen med sha256 `fileSha256`, eller null när läsaren inte satte någon källa. */
export const objectRefFor = (fileSha256: string, object: MapObject): ObjectRef | null => objectRefOf(fileSha256, object);

const HEX64 = /^[0-9a-f]{64}$/;
const integer = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

/** En referens ur lagrad JSON eller en begäran, eller undefined om den inte är en referens. */
export function parseObjectRef(value: unknown): ObjectRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const ref = value as { fileSha256?: unknown; objectHash?: unknown; locator?: unknown };
  if (typeof ref.fileSha256 !== "string" || !HEX64.test(ref.fileSha256)) return undefined;
  if (typeof ref.objectHash !== "string" || !HEX64.test(ref.objectHash)) return undefined;
  const locator = ref.locator as Record<string, unknown> | null | undefined;
  if (!locator || typeof locator !== "object") return undefined;
  const big = 2 ** 31;
  if (locator.format === "OCD" && integer(locator.block, 1_000_000) && integer(locator.slot, 255) && integer(locator.offset, big) &&
    integer(locator.length, big) && Object.keys(locator).length === 5) {
    return { fileSha256: ref.fileSha256, objectHash: ref.objectHash,
      locator: { format: "OCD", block: locator.block, slot: locator.slot, offset: locator.offset, length: locator.length } };
  }
  if (locator.format === "OMAP" && integer(locator.part, 10_000) && integer(locator.ordinal, 10_000_000) && integer(locator.start, big) &&
    integer(locator.end, big) && locator.end > locator.start && Object.keys(locator).length === 5) {
    return { fileSha256: ref.fileSha256, objectHash: ref.objectHash,
      locator: { format: "OMAP", part: locator.part, ordinal: locator.ordinal, start: locator.start, end: locator.end } };
  }
  return undefined;
}

/** Objektets geometri i skrivarens form. */
export function geometryOf(object: MapObject): RevisionGeometry {
  switch (object.kind) {
    case "point": return { kind: "point", at: object.at };
    case "text": return { kind: "text", at: object.at };
    case "line": return { kind: "line", path: object.path };
    case "area": return { kind: "area", rings: object.rings };
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const angleOf = (object: MapObject) => (object.kind === "line" ? undefined : object.angle);

/**
 * Ändringssatsen till skrivaren. En ändring av ett befintligt objekt tar bara med det som skiljer från grundfilens objekt
 * (geometri, symbol, text, vinkel), så att resten av objektet skrivs som det var. En ändring som inte skiljer i något faller
 * bort. Ändringar vars objekt saknas i grundfilen (fel plats) går med som de är; skrivaren vägrar dem.
 */
export function toChangeSet(base: ParsedMap, baseSha256: string, format: MapFileFormat, changes: readonly ObjectChange[]): MapRevisionChangeSet {
  const byKey = objectsByKey(base);
  const out: FileChange[] = [];
  for (const change of changes) {
    const meta = { author: change.author, at: change.at };
    if (change.kind === "ADD") {
      const object = change.object;
      out.push({ kind: "add", id: change.id, symbol: object.symbol, geometry: geometryOf(object), ...meta,
        ...(object.kind === "text" ? { text: object.text } : {}), ...(angleOf(object) ? { angle: angleOf(object) } : {}) });
      continue;
    }
    if (change.kind === "DELETE") { out.push({ kind: "delete", ref: change.ref, ...meta }); continue; }
    const original = byKey.get(objectRefKey(change.ref));
    const object = change.object;
    if (!original) { out.push({ kind: "modify", ref: change.ref, geometry: geometryOf(object), symbol: object.symbol, ...meta }); continue; }
    const geometry = same(geometryOf(original), geometryOf(object)) ? undefined : geometryOf(object);
    const symbol = original.symbol === object.symbol ? undefined : object.symbol;
    const text = object.kind === "text" && original.kind === "text" && original.text !== object.text ? object.text : undefined;
    const angle = angleOf(object) !== undefined && angleOf(object) !== angleOf(original) ? angleOf(object) : undefined;
    if (geometry === undefined && symbol === undefined && text === undefined && angle === undefined) continue;
    out.push({ kind: "modify", ref: change.ref, ...meta, ...(geometry ? { geometry } : {}), ...(symbol !== undefined ? { symbol } : {}),
      ...(text !== undefined ? { text } : {}), ...(angle !== undefined ? { angle } : {}) });
  }
  return { baseFileSha256: baseSha256, format, changes: out };
}
