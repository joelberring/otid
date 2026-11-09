/**
 * ADR-0219 K7: begränsad revidering av OCAD-kartor (version 9 och senare) genom att lappa filen, bakom en flagga tills den är
 * prövad i riktiga OCAD. Inget i originalet flyttas:
 *
 * - **Ta bort:** indexpostens status blir 0 (borttaget). Objektets bytes ligger kvar men pekas inte ut som normala.
 * - **Ändra:** en ny objektpost skrivs på samma plats om den ryms i postens längd i indexet, annars sist i filen; indexposten
 *   får ny position, längd, symbol och omslutande rektangel. Objekthuvudets övriga fält (färg, datum, lager …) behålls, och
 *   punkter som inte ändrats får tillbaka originalets heltal och alla flaggbitar.
 * - **Lägga till:** en ny objektpost sist i filen och en ledig indexpost (position 0); finns ingen läggs ett nytt indexblock
 *   sist och länkas från det sista.
 *
 * Kontrollen efter skrivningen läser filen igen: orörda objekt ska ha samma plats och samma bytes, ändrade och nya ska läsas
 * tillbaka som det som beställdes, och allt utanför de ändrade intervallen ska vara byte för byte som i originalet.
 * Objekt med objektsträngar (databasattribut, version 12+), krypterade objekt och version 8 vägras.
 */
import { normalizeAngle, openRing } from "../geometry";
import { MapFileError, type MapObject, type ParsedMap, type PathCommand } from "../model";
import { Bytes, indexBlocks } from "../ocd/bytes";
import { HEADER, OBJECT_TYPE, STATUS_NORMAL, variantFor, type OcdVariant } from "../ocd/layout";
import { readOcd } from "../ocd/read";
import type {
  AddChange, ByteEdit, MapRevisionApplyResult, MapRevisionChangeSet, MapRevisionRefusal, ModifyChange, OcdObjectLocator, RevisionGeometry
} from "./change-set";
import { checkGeometry, geometryParts, GeometryError } from "./geometry";
import { stripSource, symbolObjectKind, withGeometry } from "./omap-write";
import { verifyOcd, type Expected } from "./ocd-verify";
import { sha256Hex } from "./sha256";

const STATUS_DELETED = 0;
/** v12+: indexpostens fält. */
const ENTRY = { rect: 0, position: 16, length: 20, symbol: 24, type: 28, encrypted: 29, status: 30, view: 31, color: 32 } as const;
/** v12+: objekthuvudets datum (Delphis TDateTime) och antal objektsträngar. */
const V12 = { created: 24, modified: 36, objectStrings: 50 } as const;
const OCD_LIMIT = (1 << 23) - 1;

const fail = (code: MapRevisionRefusal["code"], message: string, change?: number): MapRevisionApplyResult =>
  ({ ok: false, refusals: [{ code, message, ...(change !== undefined ? { change } : {}) }] });

interface Entry { readonly block: number; readonly slot: number; readonly at: number; readonly position: number; readonly length: number }
interface Raw { readonly x: number; readonly y: number; readonly xf: number; readonly yf: number }
/** En skrivning i filen: [at, at + bytes.length) får nya bytes; `appended` = sist i filen. */
interface Write { readonly at: number; readonly bytes: Uint8Array; readonly what: string }

const unit = (value: number): number => {
  if (!Number.isFinite(value)) throw new GeometryError("Geometrin har en koordinat som inte är ett tal.");
  const result = Math.round(value * 100);
  if (Math.abs(result) > OCD_LIMIT) throw new GeometryError("Geometrin ligger utanför det område som OCAD kan lagra.");
  return result === 0 ? 0 : result;
};
const GAP_X = (gap: number) => ((gap & 1) !== 0 ? 8 : 0) | ((gap & 2) !== 0 ? 4 : 0);
const GAP_Y = (gap: number) => ((gap & 4) !== 0 ? 4 : 0);
const MODELED = 0x0f;

/** Modellens delar till OCAD:s punkter (0,01 mm, y uppåt) med flaggor, exakt omvänt mot läsaren (`coordsToParts`). */
export function ocdPoints(geometry: RevisionGeometry): Raw[] {
  const out: { x: number; y: number; xf: number; yf: number }[] = [];
  const area = geometry.kind === "area";
  geometryParts(geometry).forEach((part, ringIndex) => {
    let anchor = -1;
    const push = (x: number, y: number, xf = 0, yf = 0) => { out.push({ x: unit(x), y: unit(y), xf, yf }); return out.length - 1; };
    const marks = (command: PathCommand) => (command.corner ? 1 : 0) | (command.dash ? 8 : 0);
    for (const command of part) {
      if (command.type === "M") {
        anchor = push(command.x, command.y, 0, marks(command) | (area && ringIndex > 0 ? 2 : 0));
        continue;
      }
      // Sträckans lucka hör till punkten där den börjar.
      if (command.gap && anchor >= 0) { out[anchor]!.xf |= GAP_X(command.gap); out[anchor]!.yf |= GAP_Y(command.gap); }
      if (command.type === "C") { push(command.x1, command.y1, 1); push(command.x2, command.y2, 2); }
      anchor = push(command.x, command.y, 0, marks(command));
    }
    if (!area) return;
    const first = part[0]!, last = part[part.length - 1]!;
    const closing = first.gap ?? 0;
    // Ytans ring sluts med första punkten igen; den stängande sträckans lucka hör till sista punkten före.
    if (closing && anchor >= 0) { out[anchor]!.xf |= GAP_X(closing); out[anchor]!.yf |= GAP_Y(closing); }
    if (unit(last.x) !== unit(first.x) || unit(last.y) !== unit(first.y)) push(first.x, first.y);
  });
  return out;
}

/** OCAD:s text: UTF-16 med avslutande noll, utfylld till hela 8 byte. */
function textBytes(text: string): Uint8Array {
  const value = `${text.replace(/\n/g, "\r\n")}\0`;
  const out = new Uint8Array(Math.ceil(value.length * 2 / 8) * 8);
  for (let i = 0; i < value.length; i++) { out[2 * i] = value.charCodeAt(i) & 0xff; out[2 * i + 1] = value.charCodeAt(i) >> 8; }
  return out;
}

/** Delphis TDateTime: dagar sedan 1899-12-30. */
const delphiDate = (iso: string) => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000;
const angleUnits = (degrees: number) => Math.round(normalizeAngle(degrees) * 10) % 3600;

class Out {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
}

/** Objektposten: huvudet (mall eller nollor), punkterna och texten. */
function record(variant: OcdVariant, header: Uint8Array | undefined, symbol: number, type: number, angle: number, points: readonly Raw[],
  text: Uint8Array, at: string, created: boolean): Uint8Array {
  const layout = variant.object;
  const size = layout.coords + points.length * 8 + text.length;
  const out = new Out(new Uint8Array(size));
  if (header) out.bytes.set(header.subarray(0, layout.coords));
  out.view.setInt32(0, symbol, true);
  out.view.setUint8(layout.type, type);
  out.view.setInt16(layout.angle, angle, true);
  out.view.setUint32(layout.coordCount, points.length, true);
  out.view.setUint16(layout.textCount, text.length / 8, true);
  if (variant.version >= 12) {
    if (created) out.view.setFloat64(V12.created, delphiDate(at), true);
    out.view.setFloat64(V12.modified, delphiDate(at), true);
  }
  points.forEach((point, i) => {
    out.view.setInt32(layout.coords + 8 * i, (point.x << 8) | (point.xf & 0xff), true);
    out.view.setInt32(layout.coords + 8 * i + 4, (point.y << 8) | (point.yf & 0xff), true);
  });
  out.bytes.set(text, layout.coords + points.length * 8);
  return out.bytes;
}

/** Indexpostens omslutande rektangel (nedre vänstra och övre högra hörnet som OCAD-koordinater). */
function rect(points: readonly Raw[]): Uint8Array {
  const out = new Out(new Uint8Array(16));
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  out.view.setInt32(0, Math.min(...xs) << 8, true); out.view.setInt32(4, Math.min(...ys) << 8, true);
  out.view.setInt32(8, Math.max(...xs) << 8, true); out.view.setInt32(12, Math.max(...ys) << 8, true);
  return out.bytes;
}

const i32 = (value: number) => { const out = new Out(new Uint8Array(4)); out.view.setInt32(0, value, true); return out.bytes; };

function readRaw(bytes: Bytes, at: number, count: number): Raw[] {
  const out: Raw[] = [];
  for (let i = 0; i < count; i++) {
    const x = bytes.i32(at + 8 * i), y = bytes.i32(at + 8 * i + 4);
    out.push({ x: x >> 8, y: y >> 8, xf: x & 0xff, yf: y & 0xff });
  }
  return out;
}

/** Punkter som inte ändrats (samma plats i ordningen, samma heltal och samma kända flaggor) får originalets alla flaggbitar. */
const keepOriginal = (points: readonly Raw[], original: readonly Raw[]) => points.map((point, i) => {
  const old = original[i];
  return old && old.x === point.x && old.y === point.y && (old.xf & MODELED) === point.xf && (old.yf & MODELED) === point.yf ? old : point;
});

function objectType(kind: MapObject["kind"]): number {
  return kind === "point" ? OBJECT_TYPE.point : kind === "line" ? OBJECT_TYPE.line : kind === "area" ? OBJECT_TYPE.area : OBJECT_TYPE.text;
}

/** Lappar en OCAD-fil (version 9+) med ändringssatsen och kontrollerar den. Anropas av `applyMapRevision` när flaggan är på. */
export function applyOcdRevision(original: Uint8Array, changeSet: MapRevisionChangeSet, baseSha: string): MapRevisionApplyResult {
  const bytes = new Bytes(original);
  const version = bytes.u16(HEADER.version);
  const variant = variantFor(version);
  if (!variant || variant.version < 9) return fail("UNSUPPORTED_VERSION", `OCAD ${version} kan inte revideras här; spara kartan i OCAD 9 eller senare.`);
  let map: ParsedMap;
  try {
    map = readOcd(original, { sources: true });
  } catch (error) {
    if (error instanceof MapFileError) return fail("UNSAFE_FILE", error.message);
    throw error;
  }
  const report = { format: "OCD" as const, version: map.version, baseFileSha256: baseSha };
  if (changeSet.changes.length === 0) {
    return { ok: true, bytes: original.slice(), report: { ...report, resultSha256: baseSha, modified: 0, added: 0, deleted: 0, addedObjects: [],
      edits: [], verification: { untouchedObjects: map.objects.length, checkedObjects: 0, identicalBytes: original.length } } };
  }

  const index = variant.index;
  const blocks = indexBlocks(bytes, bytes.u32(HEADER.firstObjectBlock), index.blockSize);
  const entryAt = (block: number, slot: number) => blocks[block] === undefined || slot < 0 || slot > 255 ? undefined : blocks[block] + 4 + slot * index.entrySize;
  const bySlot = new Map<string, MapObject>();
  for (const object of map.objects) {
    const locator = object.source?.locator;
    if (locator?.format === "OCD") bySlot.set(`${locator.block}:${locator.slot}`, object);
  }
  // Mall för nya objekt med en symbol: ett befintligt objekt med samma symbol (huvudet och indexets färg och visning).
  const template = new Map<string, MapObject>();
  for (const object of map.objects) if (!template.has(object.symbol)) template.set(object.symbol, object);

  const writes: Write[] = [];
  const appended: { bytes: Uint8Array; what: string; onPlaced: (at: number) => void }[] = [];
  let end = original.length;
  const append = (data: Uint8Array, what: string, onPlaced: (at: number) => void) => {
    const padding = (8 - (end % 8)) % 8;
    const at = end + padding;
    end = at + data.length;
    appended.push({ bytes: data, what, onPlaced });
    onPlaced(at);
    return at;
  };
  const expected: Expected[] = [];
  const addedRecords: { change: AddChange; built: Built }[] = [];
  const addedObjects: { id: string; locator: OcdObjectLocator }[] = [];
  let modified = 0, added = 0, deleted = 0;

  const located = (change: ModifyChange | { ref: ModifyChange["ref"] }, number: number): Entry | MapRevisionApplyResult => {
    const ref = change.ref;
    if (ref.fileSha256 !== baseSha || ref.locator.format !== "OCD") return fail("OBJECT_MISMATCH", "Ändringen gäller en annan fil.", number);
    const locator = ref.locator;
    const at = entryAt(locator.block, locator.slot);
    if (at === undefined || bytes.i32(at + ENTRY.position) !== locator.offset || !bySlot.has(`${locator.block}:${locator.slot}`)) {
      return fail("OBJECT_MISMATCH", "Objektet finns inte på sin plats i filen.", number);
    }
    if (sha256Hex(original, locator.offset, locator.offset + locator.length) !== ref.objectHash) {
      return fail("OBJECT_MISMATCH", "Objektet har ändrats i filen sedan ändringen gjordes.", number);
    }
    if (bytes.u8(at + ENTRY.encrypted) !== 0) return fail("UNSAFE_FILE", "Objektet är krypterat.", number);
    if (variant.version >= 12 && bytes.u16(locator.offset + V12.objectStrings) !== 0) {
      return fail("UNSAFE_FILE", "Objekt med objektsträngar (databasattribut) skrivs inte än.", number);
    }
    return { block: locator.block, slot: locator.slot, at, position: locator.offset, length: bytes.i32(at + ENTRY.length) };
  };

  const changes = changeSet.changes;
  for (let number = 0; number < changes.length; number++) {
    const change = changes[number]!;
    if (change.kind === "delete") {
      const entry = located(change, number);
      if ("ok" in entry) return entry;
      writes.push({ at: entry.at + ENTRY.status, bytes: Uint8Array.of(STATUS_DELETED), what: "index-status" });
      expected.push({ block: entry.block, slot: entry.slot, object: null });
      deleted += 1;
      continue;
    }
    if (change.kind === "modify") {
      const entry = located(change, number);
      if ("ok" in entry) return entry;
      const built = modifyRecord(bytes, variant, entry, bySlot.get(`${entry.block}:${entry.slot}`)!, change, number, map);
      if ("ok" in built) return built;
      if (built.record.length <= entry.length) {
        writes.push({ at: entry.position, bytes: built.record, what: "object" });
      } else {
        append(built.record, "append-object", at => {
          writes.push({ at: entry.at + ENTRY.position, bytes: i32(at), what: "index-position" });
          writes.push({ at: entry.at + ENTRY.length, bytes: i32(built.record.length), what: "index-length" });
        });
      }
      writes.push({ at: entry.at + ENTRY.rect, bytes: rect(built.points), what: "index-rect" });
      writes.push({ at: entry.at + ENTRY.symbol, bytes: i32(built.symbol), what: "index-symbol" });
      expected.push({ block: entry.block, slot: entry.slot, object: built.object });
      modified += 1;
      continue;
    }
    const built = addRecord(bytes, variant, change, number, map, template);
    if ("ok" in built) return built;
    added += 1;
    addedRecords.push({ change, built });
  }

  // Lediga indexposter för de nya objekten, sedan nya block.
  const free: { block: number; slot: number; at: number }[] = [];
  blocks.forEach((block, b) => {
    for (let slot = 0; slot < 256; slot++) {
      const at = block + 4 + slot * index.entrySize;
      if (bytes.i32(at + ENTRY.position) === 0 && bytes.i32(at + ENTRY.length) === 0) free.push({ block: b, slot, at });
    }
  });
  let lastBlock = blocks[blocks.length - 1];
  let blockCount = blocks.length;
  const newBlocks: { at: number; data: Uint8Array }[] = [];
  for (const { change, built } of addedRecords) {
    let slot = free.shift();
    if (!slot) {
      const data = new Uint8Array(index.blockSize);
      const blockAt = append(data, "index-block", () => undefined);
      newBlocks.push({ at: blockAt, data });
      if (lastBlock === undefined) writes.push({ at: HEADER.firstObjectBlock, bytes: i32(blockAt), what: "first-block" });
      else {
        const previous = newBlocks.find(block => block.at === lastBlock);
        if (previous) new Out(previous.data).view.setInt32(0, blockAt, true);
        else writes.push({ at: lastBlock, bytes: i32(blockAt), what: "next-block" });
      }
      lastBlock = blockAt;
      for (let k = 0; k < 256; k++) free.push({ block: blockCount, slot: k, at: blockAt + 4 + k * index.entrySize });
      blockCount += 1;
      slot = free.shift()!;
    }
    const target = slot;
    const recordAt = append(built.record, "append-object", () => undefined);
    const entry = new Out(new Uint8Array(index.entrySize));
    entry.bytes.set(rect(built.points), ENTRY.rect);
    entry.view.setInt32(ENTRY.position, recordAt, true);
    entry.view.setInt32(ENTRY.length, built.record.length, true);
    entry.view.setInt32(ENTRY.symbol, built.symbol, true);
    entry.view.setUint8(ENTRY.type, built.type);
    entry.view.setUint8(ENTRY.status, STATUS_NORMAL);
    if (built.templateEntry) { entry.view.setUint8(ENTRY.view, built.templateEntry.view); entry.view.setInt16(ENTRY.color, built.templateEntry.color, true); }
    const inNew = newBlocks.find(block => target.at >= block.at && target.at < block.at + index.blockSize);
    if (inNew) inNew.data.set(entry.bytes, target.at - inNew.at);
    else writes.push({ at: target.at, bytes: entry.bytes, what: "index-entry" });
    expected.push({ block: target.block, slot: target.slot, object: built.object });
    addedObjects.push({ id: change.id, locator: { format: "OCD", block: target.block, slot: target.slot, offset: recordAt, length: built.record.length } });
  }

  // Den nya filen: originalet, skrivningarna i det och det som lagts till sist.
  const result = new Uint8Array(end);
  result.set(original);
  const byteEdits: ByteEdit[] = [];
  let replaced = 0;
  for (const write of [...writes].sort((a, b) => a.at - b.at)) {
    result.set(write.bytes, write.at);
    byteEdits.push({ start: write.at, end: write.at + write.bytes.length, newStart: write.at, newEnd: write.at + write.bytes.length, what: write.what });
    replaced += write.bytes.length;
  }
  let cursor = original.length;
  for (const item of appended) {
    const padding = (8 - (cursor % 8)) % 8;
    const at = cursor + padding;
    result.set(item.bytes, at);
    byteEdits.push({ start: original.length, end: original.length, newStart: cursor, newEnd: at + item.bytes.length, what: item.what });
    cursor = at + item.bytes.length;
  }
  const verified = verifyOcd(original, result, map, expected, byteEdits);
  if (!verified.ok) return fail("VERIFY_FAILED", verified.message);
  return { ok: true, bytes: result, report: { ...report, resultSha256: sha256Hex(result), modified, added, deleted, addedObjects, edits: byteEdits,
    verification: { untouchedObjects: verified.untouched, checkedObjects: verified.checked, identicalBytes: original.length - replaced } } };
}

interface Built {
  readonly record: Uint8Array; readonly points: readonly Raw[]; readonly symbol: number; readonly type: number; readonly object: MapObject;
  readonly templateEntry?: { readonly view: number; readonly color: number } | undefined;
}
const refuse = (message: string, change: number): MapRevisionApplyResult => fail("INVALID_CHANGE", message, change);

function symbolNumber(id: string): number | undefined {
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function modifyRecord(bytes: Bytes, variant: OcdVariant, entry: Entry, original: MapObject, change: ModifyChange, number: number, map: ParsedMap)
  : Built | MapRevisionApplyResult {
  const layout = variant.object;
  const at = entry.position;
  const header = bytes.bytes.subarray(at, at + layout.coords);
  const count = bytes.u32(at + layout.coordCount), textWords = bytes.u16(at + layout.textCount);
  const raw = readRaw(bytes, at + layout.coords, count);
  let textData: Uint8Array = bytes.bytes.slice(at + layout.coords + count * 8, at + layout.coords + (count + textWords) * 8);
  let object = stripSource(original);
  let symbol = bytes.i32(at);
  if (change.symbol !== undefined && change.symbol !== original.symbol) {
    const kind = symbolObjectKind(map.symbols, change.symbol), value = symbolNumber(change.symbol);
    if (!kind || value === undefined) return refuse(`symbolen ${change.symbol} finns inte i kartfilen.`, number);
    if (kind !== original.kind) return refuse(`symbolen ${change.symbol} passar inte objektets slag.`, number);
    symbol = value;
    object = { ...object, symbol: change.symbol };
  }
  let angle = bytes.i16(at + layout.angle);
  if (change.angle !== undefined) {
    if (original.kind === "line") return refuse("en linje har ingen vinkel.", number);
    if (!Number.isFinite(change.angle)) return refuse("vinkeln är inte ett tal.", number);
    angle = angleUnits(change.angle);
    object = { ...object, angle: normalizeAngle(change.angle) } as MapObject;
  }
  let points = raw;
  if (change.geometry) {
    if (change.geometry.kind !== original.kind) return refuse("geometrin har fel slag för objektet.", number);
    try {
      checkGeometry(change.geometry);
      if (change.geometry.kind === "point" || change.geometry.kind === "text") {
        // Textens ruta (och en punkts eventuella fler punkter) flyttas med ankaret.
        const dx = unit(change.geometry.at.x) - raw[0]!.x, dy = unit(change.geometry.at.y) - raw[0]!.y;
        points = raw.map(point => ({ ...point, x: point.x + dx, y: point.y + dy }));
      } else points = keepOriginal(ocdPoints(change.geometry), raw);
    } catch (error) {
      if (error instanceof GeometryError) return refuse(error.message, number);
      throw error;
    }
    object = withGeometry(object, change.geometry);
  }
  if (change.text !== undefined) {
    if (original.kind !== "text") return refuse("bara textobjekt har text.", number);
    textData = textBytes(change.text);
    object = { ...object, text: change.text } as MapObject;
  }
  const type = bytes.u8(at + layout.type);
  return { record: record(variant, header, symbol, type, angle, points, textData, change.at, false), points, symbol, type, object };
}

function addRecord(bytes: Bytes, variant: OcdVariant, change: AddChange, number: number, map: ParsedMap, template: ReadonlyMap<string, MapObject>)
  : Built | MapRevisionApplyResult {
  const kind = symbolObjectKind(map.symbols, change.symbol), symbol = symbolNumber(change.symbol);
  if (!kind || symbol === undefined) return refuse(`symbolen ${change.symbol} finns inte i kartfilen.`, number);
  if (change.geometry.kind === "text" || kind === "text") return refuse("nya textobjekt stöds inte än.", number);
  if (kind !== change.geometry.kind) return refuse(`symbolen ${change.symbol} passar inte geometrins slag.`, number);
  if (change.angle !== undefined && !Number.isFinite(change.angle)) return refuse("vinkeln är inte ett tal.", number);
  let points: Raw[];
  try {
    checkGeometry(change.geometry);
    points = change.geometry.kind === "point" ? [{ x: unit(change.geometry.at.x), y: unit(change.geometry.at.y), xf: 0, yf: 0 }] : ocdPoints(change.geometry);
  } catch (error) {
    if (error instanceof GeometryError) return refuse(error.message, number);
    throw error;
  }
  const angle = change.geometry.kind === "line" ? 0 : angleUnits(change.angle ?? 0);
  const type = objectType(kind);
  // Huvudet från ett objekt med samma symbol (utom datum och objektsträngar), annars nollor.
  const like = template.get(change.symbol)?.source?.locator;
  let header: Uint8Array | undefined, templateEntry: Built["templateEntry"];
  if (like?.format === "OCD") {
    header = bytes.bytes.slice(like.offset, like.offset + variant.object.coords);
    if (variant.version >= 12) new Out(header).view.setUint16(V12.objectStrings, 0, true);
    const blocks = indexBlocks(bytes, bytes.u32(HEADER.firstObjectBlock), variant.index.blockSize);
    const entry = blocks[like.block]! + 4 + like.slot * variant.index.entrySize;
    templateEntry = { view: bytes.u8(entry + ENTRY.view), color: bytes.i16(entry + ENTRY.color) };
  }
  const geometry = change.geometry;
  const object: MapObject = geometry.kind === "point" ? { kind: "point", symbol: change.symbol, at: geometry.at, angle: normalizeAngle(change.angle ?? 0) }
    : geometry.kind === "line" ? { kind: "line", symbol: change.symbol, path: geometry.path }
    : { kind: "area", symbol: change.symbol, rings: (geometry).rings.map(ring => openRing(ring)),
      angle: normalizeAngle(change.angle ?? 0) };
  return { record: record(variant, header, symbol, type, angle, points, new Uint8Array(0), change.at, true), points, symbol, type, object, templateEntry };
}

