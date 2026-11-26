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
import { maxOf, minOf, normalizeAngle, openRing } from "../geometry";
import { MapFileError, type MapObject, type MapSymbol, type ParsedMap, type PathCommand, type StrokeStyle } from "../model";
import { Bytes, indexBlocks } from "../ocd/bytes";
import { HEADER, OBJECT_TYPE, STATUS_NORMAL, variantFor, type OcdVariant } from "../ocd/layout";
import { readOcd } from "../ocd/read";
import { linkedStringObjectIndices } from "../ocd/strings";
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
/** v9–11: objekthuvudets `nObjectString` (v10–11), färg och objekt-specifika fält (40 byte). */
const V9 = { objectStrings: 14, color: 16, lineWidth: 20 } as const;
/** v12+: objekthuvudets färg, överstyrningar, datum (Delphis TDateTime) och antal objekt-/databassträngar. */
const V12 = { color: 8, lineWidth: 12, serverIdEnd: 24, created: 24, multiRep: 32, modified: 36, objectStrings: 50, databaseStrings: 52 } as const;
const OCD_LIMIT = (1 << 23) - 1;
const MAX_TEXT_WORDS = 0xffff;

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
  geometryParts(geometry).forEach((rawPart, ringIndex) => {
    const part = area ? openRing(rawPart) : rawPart;
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
    const closing = part[0]!.gap ?? 0;
    // OCAD sluter raka ytringar implicit utan extra dubblettpunkt; stängningssträckans lucka hör till sista punkten före.
    if (closing && anchor >= 0) { out[anchor]!.xf |= GAP_X(closing); out[anchor]!.yf |= GAP_Y(closing); }
  });
  return out;
}

/** OCAD:s text: UTF-16 med avslutande noll, utfylld till hela 8 byte. Normaliserar radbrytningar innan \r\n skrivs. */
function textBytes(text: string): Uint8Array {
  const value = `${text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n")}\0`;
  const out = new Uint8Array(Math.ceil(value.length * 2 / 8) * 8);
  for (let i = 0; i < value.length; i++) { out[2 * i] = value.charCodeAt(i) & 0xff; out[2 * i + 1] = value.charCodeAt(i) >> 8; }
  return out;
}

/** Delphis TDateTime: dagar sedan 1899-12-30. Ogiltigt datum faller tillbaka på nu (skriver aldrig NaN). */
function delphiDate(iso: string): number {
  const parsed = Date.parse(iso);
  const ms = Number.isFinite(parsed) ? parsed : Date.now();
  return (ms - Date.UTC(1899, 11, 30)) / 86_400_000;
}
const angleUnits = (degrees: number) => Math.round(normalizeAngle(degrees) * 10) % 3600;
const clampOcd = (value: number): number => Math.max(-OCD_LIMIT, Math.min(OCD_LIMIT, Math.round(value)));
const ceilUnits = (mm: number): number => Math.ceil(mm * 100 - 1e-9);

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

/** Symbolens huvudfärg för OCAD:s indexpost och v12-huvud, när ingen mall finns. */
function symbolColor(symbol: MapSymbol | undefined): number {
  switch (symbol?.kind) {
    case "POINT": return symbol.elements[0]?.color ?? 0;
    case "LINE": return symbol.strokes[0]?.color ?? symbol.repeated?.elements[0]?.color ?? 0;
    case "AREA": return symbol.fill ?? symbol.hatches[0]?.color ?? symbol.pattern?.elements[0]?.color ?? symbol.border?.[0]?.color ?? 0;
    case "TEXT": return symbol.color;
    default: return 0;
  }
}

interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** Roterar hörnen av en lokal ruta moturs med `angleDegrees` och returnerar omslutande axelparallell ruta. */
function rotateBox(box: Box, angleDegrees: number): Box {
  const angle = normalizeAngle(angleDegrees);
  if (angle === 0) return { minX: Math.floor(box.minX), minY: Math.floor(box.minY), maxX: Math.ceil(box.maxX), maxY: Math.ceil(box.maxY) };
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]] as const) {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return { minX: Math.floor(minX + 1e-9), minY: Math.floor(minY + 1e-9), maxX: Math.ceil(maxX - 1e-9), maxY: Math.ceil(maxY - 1e-9) };
}

/** Punktsymbolens utsträckning i OCAD-enheter (0,01 mm) så att indexets omslutande rektangel aldrig blir 0×0. */
function pointExtent(symbol: MapSymbol | undefined): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    const ux = Math.round(x * 100), uy = Math.round(y * 100);
    if (ux < minX) minX = ux;
    if (ux > maxX) maxX = ux;
    if (uy < minY) minY = uy;
    if (uy > maxY) maxY = uy;
  };
  if (symbol?.kind === "POINT") {
    for (const element of symbol.elements) {
      if (element.kind === "circle" || element.kind === "dot") {
        const half = (element.diameter + (element.kind === "circle" ? element.lineWidth : 0)) / 2;
        grow(element.center.x - half, element.center.y - half);
        grow(element.center.x + half, element.center.y + half);
      } else {
        const paths = element.kind === "line" ? [element.path] : element.rings;
        const pad = element.kind === "line" ? element.width / 2 : 0;
        for (const path of paths) for (const cmd of path) {
          grow(cmd.x - pad, cmd.y - pad);
          grow(cmd.x + pad, cmd.y + pad);
          if (cmd.type === "C") { grow(cmd.x1, cmd.y1); grow(cmd.x2, cmd.y2); }
        }
      }
    }
  }
  if (!Number.isFinite(minX) || minX === maxX || minY === maxY) {
    const ext = symbol?.extent !== undefined && symbol.extent > 0 ? Math.round(symbol.extent * 100) : 100;
    return { minX: -ext, minY: -ext, maxX: ext, maxY: ext };
  }
  // Inkludera ankarpunkten (0, 0) så att klick på punktens läge alltid träffar indexets rektangel.
  return { minX: Math.min(0, minX), minY: Math.min(0, minY), maxX: Math.max(0, maxX), maxY: Math.max(0, maxY) };
}

/** Oformaterad text: ungefärlig lokal textruta i OCAD-enheter (0,01 mm) kring ankaret (0, 0). */
function textLocalBox(symbol: MapSymbol | undefined, text: string): Box {
  const sizeMm = symbol?.kind === "TEXT" && symbol.size > 0 ? symbol.size : 2.5;
  const h = Math.max(10, Math.round(sizeMm * 100));
  const lineStep = symbol?.kind === "TEXT" && symbol.lineSpacing && symbol.lineSpacing > 0 ? symbol.lineSpacing : 1.15;
  const align = symbol?.kind === "TEXT" ? symbol.align ?? "left" : "left";
  const baseline = symbol?.kind === "TEXT" ? symbol.baseline ?? "alphabetic" : "alphabetic";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const lineCount = Math.max(1, lines.length);
  const maxChars = Math.max(1, ...lines.map(line => line.length));
  const width = Math.max(h, Math.ceil(maxChars * h * 0.7));
  const minX = align === "center" ? -Math.ceil(width / 2) : align === "right" ? -width : 0;
  const maxX = align === "center" ? Math.ceil(width / 2) : align === "right" ? 0 : width;
  let minY: number, maxY: number;
  if (baseline === "top") {
    maxY = Math.ceil(0.1 * h);
    minY = -Math.ceil(((lineCount - 1) * lineStep + 1.3) * h);
  } else if (baseline === "middle") {
    maxY = Math.ceil(0.65 * h);
    minY = -Math.ceil(((lineCount - 1) * lineStep + 0.65) * h);
  } else {
    maxY = Math.ceil(1.1 * h);
    minY = -Math.ceil(((lineCount - 1) * lineStep + 0.3) * h);
  }
  return { minX, minY, maxX, maxY };
}

/** OCAD:s 5 punkter för oformaterad text (`ObjType = 4`): ankare + textrutans fyra roterade hörn (NV, NH, ÖH, ÖV). */
function textBoxPoints(anchor: Raw, symbol: MapSymbol | undefined, text: string, angleDegrees: number): Raw[] {
  const local = textLocalBox(symbol, text);
  const rad = (normalizeAngle(angleDegrees) * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const corner = (lx: number, ly: number): Raw => ({
    x: clampOcd(anchor.x + lx * cos - ly * sin),
    y: clampOcd(anchor.y + lx * sin + ly * cos),
    xf: 0,
    yf: 0
  });
  return [
    anchor,
    corner(local.minX, local.minY),
    corner(local.maxX, local.minY),
    corner(local.maxX, local.maxY),
    corner(local.minX, local.maxY)
  ];
}

function strokeHalfWidthUnits(strokes: readonly StrokeStyle[] | undefined): number {
  if (!strokes) return 0;
  let maxHalf = 0;
  for (const stroke of strokes) {
    const reach = Math.abs(stroke.offset ?? 0) + stroke.width / 2;
    if (reach > maxHalf) maxHalf = reach;
  }
  return maxHalf > 0 ? ceilUnits(maxHalf) : 0;
}

/** Marginal (i 0,01 mm) för linjer/ytor: i första hand `TBaseSym.Extent`, annars halv linjebredd (aldrig 0 på rak linje). */
function lineOrAreaMargin(symbol: MapSymbol | undefined, degenerate: boolean): number {
  if (symbol?.extent !== undefined && symbol.extent > 0) return Math.round(symbol.extent * 100);
  if (symbol?.kind === "LINE") {
    const half = strokeHalfWidthUnits(symbol.strokes);
    return half > 0 ? half : degenerate ? 10 : 0;
  }
  if (symbol?.kind === "AREA") {
    const half = strokeHalfWidthUnits(symbol.border);
    return half > 0 ? half : degenerate ? 10 : 0;
  }
  return degenerate ? 10 : 0;
}

/** Indexpostens omslutande rektangel (nedre vänstra och övre högra hörnet som OCAD-koordinater). */
function rect(points: readonly Raw[], symbol: MapSymbol | undefined, object: MapObject, type: number): Uint8Array {
  const out = new Out(new Uint8Array(16));
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  let x0 = minOf(xs), y0 = minOf(ys), x1 = maxOf(xs), y1 = maxOf(ys);
  const symExtent = symbol?.extent !== undefined && symbol.extent > 0 ? Math.round(symbol.extent * 100) : 0;
  if (object.kind === "point") {
    const rotated = rotateBox(pointExtent(symbol), object.angle);
    x0 += rotated.minX; y0 += rotated.minY; x1 += rotated.maxX; y1 += rotated.maxY;
  } else if (object.kind === "text") {
    const framingPad = symbol?.kind === "TEXT" && symbol.framing && symbol.framing.width > 0 ? ceilUnits(symbol.framing.width / 2) : 0;
    const pad = Math.max(symExtent, framingPad);
    if (type === OBJECT_TYPE.text) {
      const anchor = points[0]!;
      const rotated = rotateBox(textLocalBox(symbol, object.text), object.angle);
      x0 = Math.min(x0, anchor.x + rotated.minX) - pad;
      y0 = Math.min(y0, anchor.y + rotated.minY) - pad;
      x1 = Math.max(x1, anchor.x + rotated.maxX) + pad;
      y1 = Math.max(y1, anchor.y + rotated.maxY) + pad;
    } else {
      const extra = pad > 0 ? pad : x0 === x1 || y0 === y1 ? 10 : 0;
      x0 -= extra; y0 -= extra; x1 += extra; y1 += extra;
    }
  } else {
    const margin = lineOrAreaMargin(symbol, x0 === x1 || y0 === y1);
    x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  }
  out.view.setInt32(0, clampOcd(x0) << 8, true); out.view.setInt32(4, clampOcd(y0) << 8, true);
  out.view.setInt32(8, clampOcd(x1) << 8, true); out.view.setInt32(12, clampOcd(y1) << 8, true);
  return out.bytes;
}

const i16 = (value: number) => { const out = new Out(new Uint8Array(2)); out.view.setInt16(0, value, true); return out.bytes; };
const i32 = (value: number) => { const out = new Out(new Uint8Array(4)); out.view.setInt32(0, value, true); return out.bytes; };

function readRaw(bytes: Bytes, at: number, count: number): Raw[] {
  const out: Raw[] = [];
  for (let i = 0; i < count; i++) {
    const x = bytes.i32(at + 8 * i), y = bytes.i32(at + 8 * i + 4);
    out.push({ x: x >> 8, y: y >> 8, xf: x & 0xff, yf: y & 0xff });
  }
  return out;
}

/** Punkter som inte ändrats får originalets alla flaggbitar; om bara kända flaggor växlats behålls övre nibbeln (0xf0). */
function keepOriginal(points: readonly Raw[], original: readonly Raw[]): Raw[] {
  const exact = new Map<string, number[]>();
  for (let i = 0; i < original.length; i++) {
    const old = original[i]!;
    const key = `${old.x},${old.y},${old.xf & MODELED},${old.yf & MODELED}`;
    const list = exact.get(key);
    if (list) list.push(i);
    else exact.set(key, [i]);
  }
  const used = new Uint8Array(original.length);
  const matched: (Raw | undefined)[] = points.map(point => {
    const idx = exact.get(`${point.x},${point.y},${point.xf & MODELED},${point.yf & MODELED}`)?.shift();
    if (idx === undefined) return undefined;
    used[idx] = 1;
    return original[idx]!;
  });
  const byCoord = new Map<string, number[]>();
  for (let i = 0; i < original.length; i++) {
    if (used[i]) continue;
    const old = original[i]!;
    const key = `${old.x},${old.y}`;
    const list = byCoord.get(key);
    if (list) list.push(i);
    else byCoord.set(key, [i]);
  }
  return points.map((point, i) => {
    const exactMatch = matched[i];
    if (exactMatch) return exactMatch;
    const idx = byCoord.get(`${point.x},${point.y}`)?.shift();
    if (idx === undefined) return point;
    const old = original[idx]!;
    return { x: point.x, y: point.y, xf: (old.xf & ~MODELED) | (point.xf & MODELED), yf: (old.yf & ~MODELED) | (point.yf & MODELED) };
  });
}

function objectType(kind: MapObject["kind"]): number {
  return kind === "point" ? OBJECT_TYPE.point : kind === "line" ? OBJECT_TYPE.line : kind === "area" ? OBJECT_TYPE.area : OBJECT_TYPE.text;
}

/** Lappar en OCAD-fil (version 9+) med ändringssatsen och kontrollerar den. Anropas av `applyMapRevision` när flaggan är på. */
export function applyOcdRevision(original: Uint8Array, changeSet: MapRevisionChangeSet, baseSha: string): MapRevisionApplyResult {
  const bytes = new Bytes(original);
  if (!bytes.has(0, HEADER.size)) return fail("UNSAFE_FILE", "OCAD-filen är för kort för att ha ett filhuvud.");
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
  const fileType = bytes.u16(HEADER.fileType);
  if (fileType !== 0) {
    const baseType = fileType & 0xff;
    const detail = baseType === 1 ? "en banläggningsfil (FileType 1)"
      : baseType === 8 ? "en OCAD Server-fil (FileType 8)"
      : `en OCAD-specialfil (FileType ${fileType})`;
    return fail("UNSAFE_FILE", `OCAD-filen är ${detail} och kan inte revideras här.`);
  }
  if (variant.version >= 12 && bytes.i32(HEADER.offlineSyncSerial) !== 0) {
    return fail("UNSAFE_FILE", "OCAD-filen är kopplad till OCAD Server (OfflineSyncSerial) och kan inte revideras här.");
  }
  const report = { format: "OCD" as const, version: map.version, baseFileSha256: baseSha };
  if (changeSet.changes.length === 0) {
    return { ok: true, bytes: original.slice(), report: { ...report, resultSha256: baseSha, modified: 0, added: 0, deleted: 0, addedObjects: [],
      edits: [], verification: { untouchedObjects: map.objects.length, checkedObjects: 0, identicalBytes: original.length } } };
  }

  const index = variant.index;
  const blocks = indexBlocks(bytes, bytes.u32(HEADER.firstObjectBlock), index.blockSize);
  const linkedStrings = linkedStringObjectIndices(bytes, bytes.u32(HEADER.firstStringBlock));
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
    if (variant.version >= 12 && (bytes.u16(locator.offset + V12.objectStrings) !== 0 || bytes.u16(locator.offset + V12.databaseStrings) !== 0)) {
      return fail("UNSAFE_FILE", "Objekt med objekt- eller databassträngar skrivs inte än.", number);
    }
    if (variant.version >= 10 && variant.version < 12 && bytes.u16(locator.offset + V9.objectStrings) !== 0) {
      return fail("UNSAFE_FILE", "Objekt med objektsträngar skrivs inte än.", number);
    }
    if (linkedStrings.has(locator.block * 256 + locator.slot + 1)) {
      return fail("UNSAFE_FILE", "Objektet har knutna strängposter (TStringIndex.ObjIndex) och kan inte ändras eller tas bort här.", number);
    }
    return { block: locator.block, slot: locator.slot, at, position: locator.offset, length: bytes.i32(at + ENTRY.length) };
  };

  const byTarget = new Map<string, { kind: "delete"; entry: Entry } | { kind: "modify"; entry: Entry; built: Built }>();
  const changes = changeSet.changes;
  for (let number = 0; number < changes.length; number++) {
    const change = changes[number]!;
    if (change.kind === "delete") {
      const entry = located(change, number);
      if ("ok" in entry) return entry;
      byTarget.set(`${entry.block}:${entry.slot}`, { kind: "delete", entry });
      continue;
    }
    if (change.kind === "modify") {
      const entry = located(change, number);
      if ("ok" in entry) return entry;
      const built = modifyRecord(bytes, variant, entry, bySlot.get(`${entry.block}:${entry.slot}`)!, change, number, map, template, blocks);
      if ("ok" in built) return built;
      byTarget.set(`${entry.block}:${entry.slot}`, { kind: "modify", entry, built });
      continue;
    }
    const built = addRecord(bytes, variant, change, number, map, template, blocks);
    if ("ok" in built) return built;
    added += 1;
    addedRecords.push({ change, built });
  }
  for (const target of byTarget.values()) {
    const { entry } = target;
    if (target.kind === "delete") {
      writes.push({ at: entry.at + ENTRY.status, bytes: Uint8Array.of(STATUS_DELETED), what: "index-status" });
      expected.push({ block: entry.block, slot: entry.slot, object: null });
      deleted += 1;
      continue;
    }
    const { built } = target;
    if (built.record.length <= entry.length) {
      const padded = built.record.length < entry.length ? new Uint8Array(entry.length) : built.record;
      if (padded !== built.record) padded.set(built.record);
      writes.push({ at: entry.position, bytes: padded, what: "object" });
    } else {
      append(built.record, "append-object", at => {
        writes.push({ at: entry.at + ENTRY.position, bytes: i32(at), what: "index-position" });
        writes.push({ at: entry.at + ENTRY.length, bytes: i32(built.record.length), what: "index-length" });
      });
    }
    writes.push({ at: entry.at + ENTRY.rect, bytes: rect(built.points, map.symbols.get(built.object.symbol), built.object, built.type), what: "index-rect" });
    writes.push({ at: entry.at + ENTRY.symbol, bytes: i32(built.symbol), what: "index-symbol" });
    if (built.typeChanged) writes.push({ at: entry.at + ENTRY.type, bytes: Uint8Array.of(built.type), what: "index-type" });
    if (built.entryView !== undefined) writes.push({ at: entry.at + ENTRY.view, bytes: Uint8Array.of(built.entryView), what: "index-view" });
    if (built.entryColor !== undefined) writes.push({ at: entry.at + ENTRY.color, bytes: i16(built.entryColor), what: "index-color" });
    expected.push({ block: entry.block, slot: entry.slot, object: built.object, type: built.type });
    modified += 1;
  }

  // Lediga indexposter för de nya objekten, sedan nya block.
  const free: { block: number; slot: number; at: number }[] = [];
  blocks.forEach((block, b) => {
    for (let slot = 0; slot < 256; slot++) {
      const at = block + 4 + slot * index.entrySize;
      if (bytes.i32(at + ENTRY.position) === 0 && bytes.i32(at + ENTRY.length) === 0 && !linkedStrings.has(b * 256 + slot + 1)) {
        free.push({ block: b, slot, at });
      }
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
    entry.bytes.set(rect(built.points, map.symbols.get(built.object.symbol), built.object, built.type), ENTRY.rect);
    entry.view.setInt32(ENTRY.position, recordAt, true);
    entry.view.setInt32(ENTRY.length, built.record.length, true);
    entry.view.setInt32(ENTRY.symbol, built.symbol, true);
    entry.view.setUint8(ENTRY.type, built.type);
    entry.view.setUint8(ENTRY.status, STATUS_NORMAL);
    if (built.templateEntry) {
      entry.view.setUint8(ENTRY.view, built.templateEntry.view);
      entry.view.setInt16(ENTRY.color, built.templateEntry.color, true);
    } else if (built.entryColor !== undefined) {
      entry.view.setInt16(ENTRY.color, built.entryColor, true);
    }
    const inNew = newBlocks.find(block => target.at >= block.at && target.at < block.at + index.blockSize);
    if (inNew) inNew.data.set(entry.bytes, target.at - inNew.at);
    else writes.push({ at: target.at, bytes: entry.bytes, what: "index-entry" });
    expected.push({ block: target.block, slot: target.slot, object: built.object, type: built.type });
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
  readonly entryColor?: number | undefined; readonly entryView?: number | undefined; readonly typeChanged?: boolean | undefined;
}
const refuse = (message: string, change: number): MapRevisionApplyResult => fail("INVALID_CHANGE", message, change);

function symbolNumber(id: string): number | undefined {
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function modifyRecord(bytes: Bytes, variant: OcdVariant, entry: Entry, original: MapObject, change: ModifyChange, number: number, map: ParsedMap,
  template: ReadonlyMap<string, MapObject>, blocks: readonly number[]): Built | MapRevisionApplyResult {
  const layout = variant.object;
  const at = entry.position;
  const header = bytes.bytes.slice(at, at + layout.coords);
  const originalType = bytes.u8(at + layout.type);
  const count = bytes.u32(at + layout.coordCount), textWords = bytes.u16(at + layout.textCount);
  const raw = readRaw(bytes, at + layout.coords, count);
  let textData: Uint8Array = bytes.bytes.slice(at + layout.coords + count * 8, at + layout.coords + (count + textWords) * 8);
  let object = stripSource(original);
  let symbol = bytes.i32(at);
  let type = originalType;
  let entryColor: number | undefined, entryView: number | undefined;
  if (change.symbol !== undefined && change.symbol !== original.symbol) {
    const kind = symbolObjectKind(map.symbols, change.symbol), value = symbolNumber(change.symbol);
    if (!kind || value === undefined) return refuse(`symbolen ${change.symbol} finns inte i kartfilen.`, number);
    if (kind !== original.kind) return refuse(`symbolen ${change.symbol} passar inte objektets slag.`, number);
    const targetSym = map.symbols.get(change.symbol);
    if (original.kind === "text" && targetSym?.kind === "TEXT") {
      const isLineText = originalType === OBJECT_TYPE.lineText;
      if (Boolean(targetSym.lineText) !== isLineText) return refuse("kan inte byta mellan vanlig text och linjetext.", number);
    }
    if (original.kind === "line" && targetSym?.kind === "LINE") {
      if (targetSym.rectangle) type = OBJECT_TYPE.rectangle;
      else if (originalType === OBJECT_TYPE.rectangle) type = OBJECT_TYPE.line;
    }
    symbol = value;
    object = { ...object, symbol: change.symbol };
    const like = template.get(change.symbol)?.source?.locator;
    if (like?.format === "OCD" && blocks[like.block] !== undefined) {
      const likeEntry = blocks[like.block]! + 4 + like.slot * variant.index.entrySize;
      entryView = bytes.u8(likeEntry + ENTRY.view);
      entryColor = bytes.i16(likeEntry + ENTRY.color);
    } else {
      entryColor = symbolColor(targetSym);
    }
    new Out(header).view.setInt32(variant.version >= 12 ? V12.color : V9.color, entryColor, true);
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
        // Formaterad text (typ 5) har ankaret i hörn 3 (övre vänstra), precis som läsaren (`read.ts:130`).
        const anchor = originalType === OBJECT_TYPE.formattedText && raw.length >= 4 ? raw[3]! : raw[0]!;
        const dx = unit(change.geometry.at.x) - anchor.x, dy = unit(change.geometry.at.y) - anchor.y;
        points = raw.map(point => {
          const x = point.x + dx, y = point.y + dy;
          if (Math.abs(x) > OCD_LIMIT || Math.abs(y) > OCD_LIMIT) throw new GeometryError("Geometrin ligger utanför det område som OCAD kan lagra.");
          return { ...point, x, y };
        });
      } else points = keepOriginal(ocdPoints(change.geometry), raw);
    } catch (error) {
      if (error instanceof GeometryError) return refuse(error.message, number);
      throw error;
    }
    object = withGeometry(object, change.geometry);
  }
  if (change.text !== undefined) {
    if (original.kind !== "text") return refuse("bara textobjekt har text.", number);
    const normalized = change.text.replace(/\r\n?/g, "\n");
    textData = textBytes(normalized);
    if (textData.length / 8 > MAX_TEXT_WORDS) return refuse("texten är för lång för OCAD.", number);
    object = { ...object, text: normalized } as MapObject;
  }
  // Uppdatera textrutans fyra hörn för 5-punkts oformaterad text när text, vinkel eller symbol ändrats.
  if (originalType === OBJECT_TYPE.text && raw.length === 5 && object.kind === "text" &&
      (change.text !== undefined || change.angle !== undefined || change.symbol !== undefined)) {
    points = textBoxPoints(points[0]!, map.symbols.get(object.symbol), object.text, object.angle);
  }
  return { record: record(variant, header, symbol, type, angle, points, textData, change.at, false), points, symbol, type, object,
    entryColor, entryView, typeChanged: type !== originalType };
}

function addRecord(bytes: Bytes, variant: OcdVariant, change: AddChange, number: number, map: ParsedMap,
  template: ReadonlyMap<string, MapObject>, blocks: readonly number[]): Built | MapRevisionApplyResult {
  const kind = symbolObjectKind(map.symbols, change.symbol), symbol = symbolNumber(change.symbol);
  if (!kind || symbol === undefined) return refuse(`symbolen ${change.symbol} finns inte i kartfilen.`, number);
  if (kind !== change.geometry.kind) return refuse(`symbolen ${change.symbol} passar inte geometrins slag.`, number);
  const targetSym = map.symbols.get(change.symbol);
  if (targetSym?.kind === "TEXT" && targetSym.lineText) return refuse("linjetextsymboler stöds inte för nya textobjekt.", number);
  if (change.angle !== undefined && !Number.isFinite(change.angle)) return refuse("vinkeln är inte ett tal.", number);
  let textData: Uint8Array = new Uint8Array(0);
  let normalizedText = "";
  if (change.geometry.kind === "text") {
    const rawText = change.text ?? "";
    if (!rawText.trim()) return refuse("en ny text får inte vara tom.", number);
    normalizedText = rawText.replace(/\r\n?/g, "\n");
    textData = textBytes(normalizedText);
    if (textData.length / 8 > MAX_TEXT_WORDS) return refuse("texten är för lång för OCAD.", number);
  }
  const normalizedAngle = normalizeAngle(change.angle ?? 0);
  let points: Raw[];
  try {
    checkGeometry(change.geometry);
    if (change.geometry.kind === "point") points = [{ x: unit(change.geometry.at.x), y: unit(change.geometry.at.y), xf: 0, yf: 0 }];
    else if (change.geometry.kind === "text") {
      const anchor: Raw = { x: unit(change.geometry.at.x), y: unit(change.geometry.at.y), xf: 0, yf: 0 };
      points = textBoxPoints(anchor, targetSym, normalizedText, normalizedAngle);
    } else points = ocdPoints(change.geometry);
  } catch (error) {
    if (error instanceof GeometryError) return refuse(error.message, number);
    throw error;
  }
  const angle = change.geometry.kind === "line" ? 0 : angleUnits(change.angle ?? 0);
  const type = targetSym?.kind === "LINE" && targetSym.rectangle ? OBJECT_TYPE.rectangle : objectType(kind);
  // Huvudet från ett objekt med samma symbol (utom objekt-specifika fält, datum och strängar), annars symbolens färg.
  const like = template.get(change.symbol)?.source?.locator;
  let header: Uint8Array | undefined, templateEntry: Built["templateEntry"], entryColor: number | undefined;
  if (like?.format === "OCD") {
    header = bytes.bytes.slice(like.offset, like.offset + variant.object.coords);
    if (variant.version >= 12) {
      header.fill(0, V12.lineWidth, V12.serverIdEnd);
      header.fill(0, V12.multiRep, V12.modified);
      header.fill(0, V12.objectStrings, variant.object.coords);
    } else {
      header.fill(0, V9.objectStrings, V9.color);
      header.fill(0, V9.lineWidth, variant.object.coords);
    }
    if (blocks[like.block] !== undefined) {
      const entry = blocks[like.block]! + 4 + like.slot * variant.index.entrySize;
      templateEntry = { view: bytes.u8(entry + ENTRY.view), color: bytes.i16(entry + ENTRY.color) };
    }
  } else {
    entryColor = symbolColor(targetSym);
    if (entryColor !== 0) {
      header = new Uint8Array(variant.object.coords);
      new Out(header).view.setInt32(variant.version >= 12 ? V12.color : V9.color, entryColor, true);
    }
  }
  const geometry = change.geometry;
  const object: MapObject = geometry.kind === "point"
    ? { kind: "point", symbol: change.symbol, at: geometry.at, angle: normalizedAngle }
    : geometry.kind === "text"
    ? { kind: "text", symbol: change.symbol, at: geometry.at, angle: normalizedAngle, text: normalizedText }
    : geometry.kind === "line"
    ? { kind: "line", symbol: change.symbol, path: geometry.path }
    : { kind: "area", symbol: change.symbol, rings: geometry.rings.map(ring => openRing(ring)), angle: normalizedAngle };
  return { record: record(variant, header, symbol, type, angle, points, textData, change.at, true), points, symbol, type, object, templateEntry, entryColor };
}

