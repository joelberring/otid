/**
 * ADR-0219: lappa en Mapper-fil (.omap/.xmap, XML) med en ändringssats. Bara de ändrade `<object>`-elementen byts, nya
 * objekt läggs sist i sin kartdel och borttagna tas bort; allt annat i texten står kvar tecken för tecken. Inom ett ändrat
 * element behålls alla attribut och barn utom det som ändras (symbol, vinkel, koordinater, text, mönstrets vinkel).
 */
import { normalizeAngle } from "../geometry";
import type { MapObject, MapSymbol, ParsedMap, Point } from "../model";
import { readCoords } from "../omap/read";
import type { AddChange, MapRevisionChangeSet, MapRevisionRefusal, ModifyChange, RevisionGeometry } from "./change-set";
import { checkGeometry, GeometryError, xmlCoordsText, xmlPoints, xmlUnitX, xmlUnitY } from "./geometry";
import { elementEnd, historyRanges, leadingWhitespace, lineStart, type RawElement, type RawParts } from "./omap-scan";

/** Ett textbyte [start, end) → `text` i originaltexten. */
export interface PlannedEdit { readonly start: number; readonly end: number; readonly text: string; readonly what: string }

/** Vad kontrollen väntar sig i en kartdel: orörda element (originalets intervall) och ändrade eller nya (text och objekt). */
export type ExpectedElement =
  | { readonly kind: "kept"; readonly start: number; readonly end: number }
  | { readonly kind: "written"; readonly text: string; readonly object: MapObject; readonly addId?: string | undefined };

export interface OmapPlan {
  readonly edits: readonly PlannedEdit[];
  readonly parts: readonly (readonly ExpectedElement[])[];
  readonly history: readonly RawElement[];
  readonly modified: number;
  readonly added: number;
  readonly deleted: number;
}

type ObjectKind = MapObject["kind"];
type Built = { ok: true; text: string; object: MapObject } | { ok: false; refusal: MapRevisionRefusal };

const HOLE_POINT = 16;
const refuse = (code: MapRevisionRefusal["code"], message: string, change: number): { ok: false; refusal: MapRevisionRefusal } =>
  ({ ok: false, refusal: { code, message: `Ändring ${change + 1}: ${message}`, change } });

export const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Radianer som Mapper skriver dem (högst nio decimaler, inga onödiga nollor). */
export function radiansText(degrees: number): string {
  const value = Number(((degrees * Math.PI) / 180).toFixed(9));
  return Object.is(value, -0) ? "0" : String(value);
}

/** Sätter (eller lägger till) ett attribut i en starttagg. */
export function setAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
  if (pattern.test(tag)) return tag.replace(pattern, (_whole, prefix: string) => `${prefix}"${value}"`);
  const close = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
  return `${tag.slice(0, close)} ${name}="${value}"${tag.slice(close)}`;
}

/** Objektslaget som symbolen ger i Mapper (sammansatt: yta om någon del är en yta), eller null. */
export function symbolObjectKind(symbols: ReadonlyMap<string, MapSymbol>, id: string, depth = 0): ObjectKind | null {
  const symbol = symbols.get(id);
  switch (symbol?.kind) {
    case "POINT": return "point";
    case "TEXT": return "text";
    case "LINE": return "line";
    case "AREA": return "area";
    case "COMBINED": return depth < 8 && symbol.parts.some(part => symbolObjectKind(symbols, part, depth + 1) === "area") ? "area" : "line";
    default: return null;
  }
}

/** Ett objekt med ny geometri (typen är redan kontrollerad). */
function withGeometry(object: MapObject, geometry: RevisionGeometry): MapObject {
  if (geometry.kind === "line" && object.kind === "line") return { ...object, path: geometry.path };
  if (geometry.kind === "area" && object.kind === "area") return { ...object, rings: geometry.rings };
  if ((geometry.kind === "point" || geometry.kind === "text") && (object.kind === "point" || object.kind === "text")) return { ...object, at: geometry.at };
  return object;
}

function stripSource(object: MapObject): MapObject {
  const copy = { ...object };
  delete copy.source;
  return copy;
}

/** Ett sub-byte inom ett element: [start, end) → text, i elementets egna positioner. */
interface Splice { readonly start: number; readonly end: number; readonly text: string }

function spliced(text: string, splices: readonly Splice[]): string {
  let out = text;
  for (const splice of [...splices].sort((a, b) => b.start - a.start)) out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
  return out;
}

function coordsElement(startTag: string, triples: readonly number[]): string {
  const open = setAttribute(startTag.endsWith("/>") ? `${startTag.slice(0, -2)}>` : startTag, "count", String(triples.length / 3));
  return `${open}${xmlCoordsText(triples)}</coords>`;
}

function tagEndAt(element: string, open: number): number {
  return element.indexOf(">", open) + 1;
}

function findChild(element: string, name: string, from: number): number {
  for (let at = element.indexOf(`<${name}`, from); at >= 0; at = element.indexOf(`<${name}`, at + 1)) {
    const next = element.charCodeAt(at + name.length + 1);
    if (next === 62 || next === 32 || next === 47 || next === 9 || next === 10 || next === 13) return at;
  }
  return -1;
}

function modifyElement(element: string, original: MapObject, change: ModifyChange, index: number, map: ParsedMap): Built {
  const startEnd = element.indexOf(">") + 1;
  const splices: Splice[] = [];
  let startTag = element.slice(0, startEnd);
  let object = stripSource(original);
  if (change.symbol !== undefined && change.symbol !== original.symbol) {
    const kind = symbolObjectKind(map.symbols, change.symbol);
    if (!kind) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} finns inte i kartfilen.`, index);
    if (kind !== original.kind) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} passar inte objektets slag.`, index);
    startTag = setAttribute(startTag, "symbol", escapeXml(change.symbol));
    object = { ...object, symbol: change.symbol };
  }
  if (change.angle !== undefined && original.kind !== "line") {
    if (!Number.isFinite(change.angle)) return refuse("INVALID_CHANGE", "vinkeln är inte ett tal.", index);
    object = { ...object, angle: normalizeAngle(change.angle) } as MapObject;
    if (original.kind === "point" || original.kind === "text") startTag = setAttribute(startTag, "rotation", radiansText(change.angle));
  } else if (change.angle !== undefined) {
    return refuse("INVALID_CHANGE", "en linje har ingen vinkel.", index);
  }
  if (startTag !== element.slice(0, startEnd)) splices.push({ start: 0, end: startEnd, text: startTag });

  const coordsOpen = findChild(element, "coords", startEnd);
  const coordsStop = coordsOpen < 0 ? -1 : elementEnd(element, coordsOpen, "coords");
  if (coordsOpen < 0 || coordsStop < 0) return refuse("UNSAFE_FILE", "objektet saknar koordinater.", index);
  if (change.geometry) {
    if (change.geometry.kind !== original.kind) return refuse("INVALID_CHANGE", "geometrin har fel slag för objektet.", index);
    const triples = readCoords(element, startEnd, element.length);
    if (!triples || triples.length < 3) return refuse("UNSAFE_FILE", "objektets koordinater går inte att läsa.", index);
    let next: number[];
    try {
      checkGeometry(change.geometry);
      if (change.geometry.kind === "point" || change.geometry.kind === "text") {
        // Bara första punkten flyttas: en text med ruta har rutans storlek som andra koordinat.
        next = [...triples];
        next[0] = xmlUnitX(change.geometry.at.x);
        next[1] = xmlUnitY(change.geometry.at.y);
      } else {
        next = xmlPoints(change.geometry, triples, (triples[triples.length - 1]! & HOLE_POINT) !== 0);
      }
    } catch (error) {
      if (error instanceof GeometryError) return refuse("INVALID_CHANGE", error.message, index);
      throw error;
    }
    splices.push({ start: coordsOpen, end: coordsStop, text: coordsElement(element.slice(coordsOpen, tagEndAt(element, coordsOpen)), next) });
    object = withGeometry(object, change.geometry);
  }
  if (change.text !== undefined) {
    if (original.kind !== "text") return refuse("INVALID_CHANGE", "bara textobjekt har text.", index);
    const textOpen = findChild(element, "text", coordsStop);
    const value = `<text>${escapeXml(change.text)}</text>`;
    if (textOpen < 0) splices.push({ start: coordsStop, end: coordsStop, text: value });
    else {
      const textTagEnd = tagEndAt(element, textOpen);
      const selfClosing = element.charCodeAt(textTagEnd - 2) === 47;
      const stop = elementEnd(element, textOpen, "text");
      const tag = selfClosing ? `${element.slice(textOpen, textTagEnd - 2)}>` : element.slice(textOpen, textTagEnd);
      splices.push({ start: textOpen, end: stop, text: `${tag}${escapeXml(change.text)}</text>` });
    }
    object = { ...object, text: change.text } as MapObject;
  }
  if (change.angle !== undefined && original.kind === "area") {
    const patternOpen = findChild(element, "pattern", coordsStop);
    if (patternOpen < 0) {
      splices.push({ start: coordsStop, end: coordsStop, text: `<pattern rotation="${radiansText(change.angle)}"><coord x="0" y="0"/></pattern>` });
    } else {
      const patternTagEnd = tagEndAt(element, patternOpen);
      splices.push({ start: patternOpen, end: patternTagEnd, text: setAttribute(element.slice(patternOpen, patternTagEnd), "rotation", radiansText(change.angle)) });
    }
  }
  return { ok: true, text: spliced(element, splices), object };
}

function addElement(change: AddChange, index: number, map: ParsedMap): Built {
  const kind = symbolObjectKind(map.symbols, change.symbol);
  if (!kind) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} finns inte i kartfilen.`, index);
  if (change.geometry.kind === "text" || kind === "text") return refuse("INVALID_CHANGE", "nya textobjekt stöds inte än.", index);
  if (kind !== change.geometry.kind) return refuse("INVALID_CHANGE", `symbolen ${change.symbol} passar inte geometrins slag.`, index);
  if (change.angle !== undefined && !Number.isFinite(change.angle)) return refuse("INVALID_CHANGE", "vinkeln är inte ett tal.", index);
  const angle = normalizeAngle(change.angle ?? 0);
  const symbol = escapeXml(change.symbol);
  try {
    checkGeometry(change.geometry);
    const geometry = change.geometry;
    if (geometry.kind === "point") {
      const at: Point = geometry.at;
      const coords = xmlCoordsText([xmlUnitX(at.x), xmlUnitY(at.y), 0]);
      const rotation = angle !== 0 ? ` rotation="${radiansText(change.angle!)}"` : "";
      return { ok: true, text: `<object type="0" symbol="${symbol}"${rotation}><coords count="1">${coords}</coords></object>`,
        object: { kind: "point", symbol: change.symbol, at, angle } };
    }
    const triples = xmlPoints(geometry);
    const coords = `<coords count="${triples.length / 3}">${xmlCoordsText(triples)}</coords>`;
    if (geometry.kind === "line") {
      return { ok: true, text: `<object type="1" symbol="${symbol}">${coords}</object>`, object: { kind: "line", symbol: change.symbol, path: geometry.path } };
    }
    if (geometry.kind !== "area") return refuse("INVALID_CHANGE", "geometrin har fel slag.", index);
    const pattern = angle !== 0 ? `<pattern rotation="${radiansText(change.angle!)}"><coord x="0" y="0"/></pattern>` : "";
    return { ok: true, text: `<object type="1" symbol="${symbol}">${coords}${pattern}</object>`,
      object: { kind: "area", symbol: change.symbol, rings: geometry.rings, angle } };
  } catch (error) {
    if (error instanceof GeometryError) return refuse("INVALID_CHANGE", error.message, index);
    throw error;
  }
}

/**
 * Planerar lappningen: textbytena och vad kontrollen ska vänta sig per kartdel. `map` är `text` läst med `sources`, `raw`
 * samma text genomgången rått (`scanParts`). Vägrar med alla skäl på en gång.
 */
export function planOmapRevision(text: string, map: ParsedMap, raw: RawParts | null, changeSet: MapRevisionChangeSet)
  : { ok: true; plan: OmapPlan } | { ok: false; refusals: MapRevisionRefusal[] } {
  const refusals: MapRevisionRefusal[] = [];
  const parts = raw?.parts ?? [];
  const byPlace = new Map(map.objects.flatMap(object => object.source?.locator.format === "OMAP"
    ? [[`${object.source.locator.part}:${object.source.locator.ordinal}`, object] as const] : []));
  const replaced = new Map<string, { text: string; object: MapObject } | null>();
  const adds: { part: number; text: string; object: MapObject; id: string }[] = [];
  changeSet.changes.forEach((change, index) => {
    if (change.kind === "add") {
      const part = change.part ?? raw?.current ?? 0;
      if (!raw || !Number.isInteger(part) || part < 0 || part >= parts.length || !parts[part]!.objectsTag) {
        refusals.push(refuse("INVALID_CHANGE", "kartdelen finns inte i filen.", index).refusal);
        return;
      }
      const built = addElement(change, index, map);
      if (built.ok) adds.push({ part, text: built.text, object: built.object, id: change.id });
      else refusals.push(built.refusal);
      return;
    }
    const { ref } = change;
    const locator = ref.locator;
    const original = locator.format === "OMAP" ? byPlace.get(`${locator.part}:${locator.ordinal}`) : undefined;
    const element = locator.format === "OMAP" ? parts[locator.part]?.elements[locator.ordinal] : undefined;
    if (ref.fileSha256 !== changeSet.baseFileSha256 || locator.format !== "OMAP" || !original?.source || !element ||
        original.source.objectHash !== ref.objectHash || element.start !== locator.start || element.end !== locator.end) {
      refusals.push(refuse("OBJECT_MISMATCH", "objektet finns inte på den platsen i grundfilen.", index).refusal);
      return;
    }
    const key = `${locator.part}:${locator.ordinal}`;
    if (change.kind === "delete") { replaced.set(key, null); return; }
    const built = modifyElement(text.slice(element.start, element.end), original, change, index, map);
    if (built.ok) replaced.set(key, { text: built.text, object: built.object });
    else refusals.push(built.refusal);
  });
  if (refusals.length > 0) return { ok: false, refusals };

  const edits: PlannedEdit[] = [];
  const expected: ExpectedElement[][] = [];
  parts.forEach((part, partIndex) => {
    const list: ExpectedElement[] = [];
    part.elements.forEach((element, ordinal) => {
      const replacement = replaced.get(`${partIndex}:${ordinal}`);
      if (replacement === undefined) { list.push({ kind: "kept", start: element.start, end: element.end }); return; }
      if (replacement === null) { edits.push({ start: lineStart(text, element.start), end: element.end, text: "", what: "delete" }); return; }
      edits.push({ start: element.start, end: element.end, text: replacement.text, what: "object" });
      list.push({ kind: "written", text: replacement.text, object: replacement.object });
    });
    const partAdds = adds.filter(add => add.part === partIndex);
    for (const add of partAdds) list.push({ kind: "written", text: add.text, object: add.object, addId: add.id });
    expected.push(list);
    const tag = part.objectsTag;
    if (!tag) return;
    const count = list.length;
    const tagText = text.slice(tag.start, tag.end);
    if (tag.selfClosing) {
      if (partAdds.length > 0) {
        const open = setAttribute(`${tagText.slice(0, -2)}>`, "count", String(count));
        edits.push({ start: tag.start, end: tag.end, text: `${open}${partAdds.map(add => add.text).join("")}</objects>`, what: "append" });
      }
      return;
    }
    if (partAdds.length > 0) {
      const last = part.elements[part.elements.length - 1];
      const at = last ? last.end : tag.end;
      const separator = last ? leadingWhitespace(text, last.start) : /^\s*\n/.test(text.slice(tag.end, part.objectsClose)) ? "\n" : "";
      edits.push({ start: at, end: at, text: partAdds.map(add => separator + add.text).join(""), what: "append" });
    }
    if (count !== part.elements.length && /\scount\s*=/.test(tagText)) {
      edits.push({ start: tag.start, end: tag.end, text: setAttribute(tagText, "count", String(count)), what: "count" });
    }
  });
  const history = changeSet.changes.length > 0 ? historyRanges(text, raw) : [];
  for (const range of history) edits.push({ start: range.start, end: range.end, text: "", what: "undo" });
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const modified = changeSet.changes.filter(change => change.kind === "modify").length;
  const deleted = changeSet.changes.filter(change => change.kind === "delete").length;
  return { ok: true, plan: { edits, parts: expected, history, modified, added: adds.length, deleted } };
}
