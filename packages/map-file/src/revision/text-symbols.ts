/**
 * K8b V6 (ägaren 2026-11-22, «som Mapper/OCAD»): kartprojektets ändrade och nya textsymboler. Typsnitt, storlek, färg, fet,
 * kursiv, justering och kontur hör till textsymbolen; objektet har text, plats och vinkel. En ändring här gäller alla texter med
 * symbolen. En ny symbol är en kopia av en textsymbol i filen med eget id, nummer och namn.
 *
 * Mapper-filen skrivs i tre kontrollerade steg (`applyMapRevisionWithTextSymbols`):
 * 1. symboltabellen: de ändrade `<symbol type="8">` lappas (bara attributen som skiljer, `<framing>` läggs till eller tas bort)
 *    och kopiorna läggs sist i `<symbols>`; allt före och efter tabellen står kvar tecken för tecken;
 * 2. objekten med den vanliga skrivaren (`applyMapRevision`), med referenserna flyttade lika långt som tabellen växte;
 * 3. justeringen: i Mapper hör den till varje textobjekt (`h_align`), så den skrivs på symbolens alla textobjekt.
 * OCAD-filer skrivs inte (vägras med ett besked); grundfilen ändras aldrig.
 */
import { parseSymbolCode } from "../geometry";
import { MapFileError, type MapColor, type MapSymbol, type ParsedMap, type TextSymbol } from "../model";
import { findTag, readOmap } from "../omap/read";
import { applyMapRevision } from "./apply";
import type { MapRevisionApplyResult, MapRevisionChangeSet } from "./change-set";
import { escapeXml, setAttribute } from "./omap-write";
import { sha256Hex } from "./sha256";
import { symbolEnd } from "./symbol-colors";

export type TextAlign = "left" | "center" | "right";

export interface MapTextSymbolChange {
  /** Symbolens id i filen (Mappers `id`), eller det nya id:t för en kopia. */
  readonly id: string;
  /** En ny symbol: id:t för textsymbolen i filen som den kopierar. */
  readonly copyOf?: string | undefined;
  /** Kopians nummer och namn. */
  readonly code?: string | undefined;
  readonly name?: string | undefined;
  readonly fontFamily: string;
  /** Teckenhöjd i mm på kartan. */
  readonly size: number;
  /** Kartans färg (id). */
  readonly color: number;
  readonly bold: boolean;
  readonly italic: boolean;
  /** Saknas = som filen har den (i Mapper per objekt). */
  readonly align?: TextAlign | undefined;
  /** Kontur runt tecknen: färgen och linjens bredd i mm, eller ingen. */
  readonly framing: { readonly color: number; readonly width: number } | null;
}

export type TextSymbolsResult = { readonly ok: true; readonly bytes: Uint8Array; readonly changed: number } | { readonly ok: false; readonly message: string };

const fontOk = (name: string) => name.length >= 1 && name.length <= 80 && !/["<>&]/.test(name) && [...name].every(char => char.charCodeAt(0) >= 32);
const CODE = /^\d{1,4}(\.\d{1,4})?$/;
const um = (mm: number) => Math.round(mm * 1000);
const isOcd = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0xad && bytes[1] === 0x0c;
const fail = (message: string) => ({ ok: false as const, message });

const textSymbolOf = (symbols: ReadonlyMap<string, MapSymbol>, id: string | undefined): TextSymbol | undefined => {
  const symbol = id === undefined ? undefined : symbols.get(id);
  return symbol?.kind === "TEXT" ? symbol : undefined;
};

/** Nästa lediga nummer i samma hundratal som `code` (t.ex. 999.0 → 999.1, 902 → 902.1), bland `taken`. */
export function nextTextSymbolCode(code: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const main = parseSymbolCode(code).main || 999;
  for (let sub = 1; sub < 10_000; sub++) if (!used.has(`${main}.${sub}`)) return `${main}.${sub}`;
  return `${main}.${Date.now() % 10_000}`;
}

/** Nästa lediga id för en ny symbol (Mappers id är heltal). */
export function nextTextSymbolId(taken: Iterable<string>): string {
  let max = -1;
  for (const id of taken) if (/^\d+$/.test(id)) max = Math.max(max, Number(id));
  return String(max + 1);
}

/**
 * Ändringarna som gäller för kartan: okända symboler (eller sådana som inte är text), kopior av något som inte är en textsymbol
 * eller med ett id som redan finns, färger som saknas, orimliga mått och ändringar som inte ändrar något hoppas över. Den sista
 * ändringen av en symbol gäller; kopiorna i den ordning de först kom.
 */
export function effectiveTextSymbolChanges(symbols: ReadonlyMap<string, MapSymbol>, colors: readonly MapColor[],
  changes: readonly MapTextSymbolChange[]): MapTextSymbolChange[] {
  const known = new Set(colors.map(color => color.id));
  const out = new Map<string, MapTextSymbolChange>();
  for (const change of changes) {
    const copy = change.copyOf !== undefined;
    const source = textSymbolOf(symbols, copy ? change.copyOf : change.id);
    if (!source || (copy && (symbols.has(change.id) || !/^\d{1,6}$/.test(change.id) || !CODE.test(change.code ?? "")))) continue;
    if (!known.has(change.color) || !fontOk(change.fontFamily.trim()) || !(change.size >= 0.1 && change.size <= 100)) continue;
    if (change.framing && (!known.has(change.framing.color) || !(change.framing.width > 0 && change.framing.width <= 10))) continue;
    if (change.align !== undefined && change.align !== "left" && change.align !== "center" && change.align !== "right") continue;
    const tidy: MapTextSymbolChange = { id: change.id, ...(copy ? { copyOf: change.copyOf, code: change.code, name: (change.name ?? source.name).slice(0, 120) } : {}),
      fontFamily: change.fontFamily.trim(), size: um(change.size) / 1000, color: change.color, bold: change.bold === true, italic: change.italic === true,
      ...(change.align ? { align: change.align } : {}), framing: change.framing ? { color: change.framing.color, width: 2 * um(change.framing.width / 2) / 1000 } : null };
    if (!copy && sameStyle(source, tidy) && (tidy.align === undefined || tidy.align === (source.align ?? "left"))) { out.delete(change.id); continue; }
    out.delete(change.id);
    out.set(change.id, tidy);
  }
  return [...out.values()];
}

function sameStyle(symbol: TextSymbol, change: MapTextSymbolChange): boolean {
  const framing = symbol.framing ?? null;
  return symbol.fontFamily === change.fontFamily && Math.abs(symbol.size - change.size) < 0.0005 && symbol.color === change.color &&
    symbol.bold === change.bold && symbol.italic === change.italic &&
    (framing === null ? change.framing === null : change.framing !== null && framing.color === change.framing.color && Math.abs(framing.width - change.framing.width) < 0.0005);
}

function styled(symbol: TextSymbol, change: MapTextSymbolChange): TextSymbol {
  const rest: TextSymbol = { ...symbol };
  delete (rest as { framing?: unknown }).framing;
  delete (rest as { align?: unknown }).align;
  return { ...rest, fontFamily: change.fontFamily, size: change.size, color: change.color, bold: change.bold, italic: change.italic,
    ...(change.align ? { align: change.align } : symbol.align ? { align: symbol.align } : {}), ...(change.framing ? { framing: change.framing } : {}) };
}

/** Symbolerna med textsymbolernas ändringar och kopior (sist, i ändringarnas ordning). */
export function withTextSymbolChanges(symbols: ReadonlyMap<string, MapSymbol>, colors: readonly MapColor[],
  changes: readonly MapTextSymbolChange[]): Map<string, MapSymbol> {
  const out = new Map(symbols);
  for (const change of effectiveTextSymbolChanges(symbols, colors, changes)) {
    if (change.copyOf === undefined) { out.set(change.id, styled(textSymbolOf(symbols, change.id)!, change)); continue; }
    const source = textSymbolOf(symbols, change.copyOf)!;
    out.set(change.id, { ...styled(source, change), id: change.id, code: parseSymbolCode(change.code!), name: change.name ?? source.name, hidden: source.hidden });
  }
  return out;
}

const decode = (original: Uint8Array): { bom: number; text: string } | null => {
  const bom = original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? 3 : 0;
  try { return { bom, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original.subarray(bom)) }; } catch { return null; }
};
const encode = (original: Uint8Array, bom: number, text: string): Uint8Array => {
  const encoded = new TextEncoder().encode(text), bytes = new Uint8Array(bom + encoded.length);
  bytes.set(original.subarray(0, bom));
  bytes.set(encoded, bom);
  return bytes;
};

/** Första elementet `<name …>` (inte `<name_…>`) i `body`: start och slut på starttaggen, eller null. */
function tagIn(body: string, name: string): { start: number; end: number } | null {
  const match = new RegExp(`<${name}(?=[\\s/>])[^>]*>`).exec(body);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

/** Symbolens element med stilen som ändringen säger (bara det som skiljer från `symbol`). Null när elementen saknas. */
function patchSymbol(body: string, symbol: TextSymbol, change: MapTextSymbolChange): string | null {
  let out = body;
  const replaceTag = (name: string, edit: (tag: string) => string): boolean => {
    const at = tagIn(out, name);
    if (!at) return false;
    out = out.slice(0, at.start) + edit(out.slice(at.start, at.end)) + out.slice(at.end);
    return true;
  };
  if (!replaceTag("font", tag => {
    let next = tag;
    if (symbol.fontFamily !== change.fontFamily) next = setAttribute(next, "family", escapeXml(change.fontFamily));
    if (Math.abs(symbol.size - change.size) >= 0.0005) next = setAttribute(next, "size", String(um(change.size)));
    if (symbol.bold !== change.bold) next = setAttribute(next, "bold", String(change.bold));
    if (symbol.italic !== change.italic) next = setAttribute(next, "italic", String(change.italic));
    return next;
  })) return null;
  if (!replaceTag("text", tag => symbol.color !== change.color ? setAttribute(tag, "color", String(change.color)) : tag)) return null;
  const framing = symbol.framing ?? null, wanted = change.framing;
  const same = framing === null ? wanted === null : wanted !== null && framing.color === wanted.color && Math.abs(framing.width - wanted.width) < 0.0005;
  if (same) return out;
  const element = /<framing(?=[\s/>])[^>]*\/>|<framing(?=[\s/>])[^>]*>[\s\S]*?<\/framing>/.exec(out);
  if (!wanted) return element ? out.slice(0, element.index) + out.slice(element.index + element[0].length) : out;
  const half = String(um(wanted.width / 2));
  if (element) {
    const tagEnd = element.index + element[0].indexOf(">") + 1;
    let tag = out.slice(element.index, tagEnd);
    tag = setAttribute(setAttribute(setAttribute(tag, "color", String(wanted.color)), "mode", "1"), "line_half_width", half);
    return out.slice(0, element.index) + tag + out.slice(tagEnd);
  }
  const text = tagIn(out, "text")!;
  const after = out.charCodeAt(text.end - 2) === 47 ? text.end : out.indexOf("</text>", text.end) + "</text>".length;
  if (after < text.end) return null;
  return `${out.slice(0, after)}<framing color="${wanted.color}" mode="1" line_half_width="${half}" shadow_x_offset="0" shadow_y_offset="0"/>${out.slice(after)}`;
}

const withoutAlign = (symbols: ReadonlyMap<string, MapSymbol>) =>
  JSON.stringify([...symbols].map(([id, symbol]) => [id, symbol.kind === "TEXT" ? { ...symbol, align: undefined } : symbol]));

/** Steg 1: symboltabellen. `shift` är hur många tecken tabellen växte (objektens platser flyttas lika långt). */
export function applyMapTextSymbols(original: Uint8Array, changes: readonly MapTextSymbolChange[])
  : TextSymbolsResult & { readonly shift?: number } {
  if (changes.length === 0) return { ok: true, bytes: original, changed: 0, shift: 0 };
  if (isOcd(original)) return fail("Textsymbolerna kan inte skrivas i en OCAD-fil här. Spara kartan i Mapper (.omap/.xmap) först.");
  const decoded = decode(original);
  if (!decoded) return fail("Mapper-filen är inte giltig UTF-8.");
  const { bom, text } = decoded;
  let before: ParsedMap;
  try { before = readOmap(text); } catch (error) { return fail(error instanceof MapFileError ? error.message : "Mapper-filen går inte att läsa."); }
  const wanted = effectiveTextSymbolChanges(before.symbols, before.colors, changes);
  if (wanted.length === 0) return { ok: true, bytes: original, changed: 0, shift: 0 };
  const start = findTag(text, "<symbols", 0), end = start < 0 ? -1 : text.indexOf("</symbols>", start);
  if (start < 0 || end < 0) return fail("Mapper-filen har ingen symboltabell.");
  const parts = findTag(text, "<parts", 0);
  if (parts >= 0 && parts < end) return fail("Mapper-filens symboltabell ligger efter objekten.");
  const elements = new Map<string, { open: number; stop: number }>();
  for (let open = findTag(text, "<symbol", start); open >= 0 && open < end;) {
    const stop = symbolEnd(text, open, end);
    if (stop < 0) return fail("Mapper-filens symboltabell är avkortad.");
    const id = /\sid="([^"]*)"/.exec(text.slice(open, text.indexOf(">", open)))?.[1];
    if (id !== undefined && !elements.has(id)) elements.set(id, { open, stop });
    open = findTag(text, "<symbol", stop);
  }
  const edits: { open: number; stop: number; body: string }[] = [];
  const copies: string[] = [];
  for (const change of wanted) {
    const sourceId = change.copyOf ?? change.id;
    const place = elements.get(sourceId), symbol = textSymbolOf(before.symbols, sourceId)!;
    if (!place) return fail(`Textsymbolen ${symbol.code.text} finns inte i filens symboltabell.`);
    let body = patchSymbol(text.slice(place.open, place.stop), symbol, change);
    if (body === null) return fail(`Textsymbolen ${symbol.code.text} har inte Mappers delar (font, text).`);
    if (change.copyOf === undefined) { edits.push({ ...place, body }); continue; }
    const tagEnd = body.indexOf(">") + 1;
    let tag = body.slice(0, tagEnd);
    tag = setAttribute(setAttribute(setAttribute(tag, "id", change.id), "code", escapeXml(change.code!)), "name", escapeXml(change.name ?? symbol.name));
    body = tag + body.slice(tagEnd);
    copies.push(body);
  }
  edits.sort((a, b) => a.open - b.open);
  let out = "", at = 0;
  for (const edit of edits) { out += text.slice(at, edit.open) + edit.body; at = edit.stop; }
  out += text.slice(at, end);
  if (copies.length > 0) out += copies.map(body => `${out.endsWith("\n") ? "" : "\n"}${body}\n`).join("");
  out += text.slice(end);
  // Antalet i <symbols count="…">.
  if (copies.length > 0) {
    const tagEnd = out.indexOf(">", start) + 1, tag = out.slice(start, tagEnd), count = /\scount="(\d+)"/.exec(tag)?.[1];
    if (count !== undefined) out = out.slice(0, start) + setAttribute(tag, "count", String(Number(count) + copies.length)) + out.slice(tagEnd);
  }
  const shift = out.length - text.length;
  // Kontrollen: allt utanför tabellen som förut; symbolerna som modellen med ändringarna; färger och objekt som förut.
  const newEnd = end + shift;
  if (out.slice(newEnd) !== text.slice(end) || out.slice(0, start) !== text.slice(0, start)) return fail("Kontrollen efter textsymbolerna: något utanför symboltabellen ändrades.");
  let after: ParsedMap;
  try { after = readOmap(out); } catch { return fail("Kontrollen efter textsymbolerna: filen går inte att läsa."); }
  const expected = withTextSymbolChanges(before.symbols, before.colors, wanted);
  const rest = (map: ParsedMap) => JSON.stringify([map.colors, map.objects, map.scale, map.georeference]);
  if (withoutAlign(after.symbols) !== withoutAlign(expected) || rest(after) !== rest(before)) {
    return fail("Kontrollen efter textsymbolerna: symbolerna läses inte tillbaka som beställt.");
  }
  return { ok: true, bytes: encode(original, bom, out), changed: wanted.length, shift };
}

const H_ALIGN: Record<TextAlign, string> = { left: "0", center: "1", right: "2" };
const H_ALIGN_ATTRIBUTE = /\sh_align\s*=\s*"[^"]*"/g;

/** Steg 3: justeringen på textobjekten med symbolerna som har en (Mappers `h_align`). */
export function applyTextAlignment(original: Uint8Array, changes: readonly MapTextSymbolChange[]): TextSymbolsResult {
  const aligned = new Map(changes.flatMap(change => change.align ? [[change.id, H_ALIGN[change.align]] as const] : []));
  if (aligned.size === 0) return { ok: true, bytes: original, changed: 0 };
  const decoded = decode(original);
  if (!decoded) return fail("Mapper-filen är inte giltig UTF-8.");
  const { bom, text } = decoded;
  const parts = findTag(text, "<parts", 0);
  if (parts < 0) return { ok: true, bytes: original, changed: 0 };
  let changed = 0;
  const out = text.slice(0, parts) + text.slice(parts).replace(/<object(?=[\s>])[^>]*>/g, tag => {
    if (!/\stype="4"/.test(tag)) return tag;
    const value = aligned.get(/\ssymbol="([^"]*)"/.exec(tag)?.[1] ?? "");
    if (value === undefined || new RegExp(`\\sh_align="${value}"`).test(tag)) return tag;
    changed++;
    return setAttribute(tag, "h_align", value);
  });
  if (changed === 0) return { ok: true, bytes: original, changed: 0 };
  let before: ParsedMap, after: ParsedMap;
  try { before = readOmap(text); after = readOmap(out); } catch { return fail("Kontrollen efter justeringen: filen går inte att läsa."); }
  const all = (map: ParsedMap) => JSON.stringify([[...map.symbols], map.colors, map.objects]);
  if (out.replace(H_ALIGN_ATTRIBUTE, "") !== text.replace(H_ALIGN_ATTRIBUTE, "") || all(after) !== all(before)) {
    return fail("Kontrollen efter justeringen: något annat än textens justering ändrades.");
  }
  return { ok: true, bytes: encode(original, bom, out), changed };
}

/** Ändringssatsen mot filen efter steg 1: samma objekt, platserna flyttade `shift` tecken och filens nya sha256. */
export function shiftedChangeSet(changeSet: MapRevisionChangeSet, sha256: string, shift: number): MapRevisionChangeSet {
  return { ...changeSet, baseFileSha256: sha256, changes: changeSet.changes.map(change => change.kind === "add" ? change : {
    ...change, ref: { ...change.ref, fileSha256: sha256, locator: change.ref.locator.format === "OMAP"
      ? { ...change.ref.locator, start: change.ref.locator.start + shift, end: change.ref.locator.end + shift } : change.ref.locator } }) };
}

/**
 * Objektens ändringar och textsymbolerna i en ny fil (de tre stegen ovan). Utan textsymboler är det `applyMapRevision`. Rapporten
 * är objektstegets (bytes och sha256 gäller den färdiga filen); dess byteintervall gäller filen efter steg 1.
 */
export function applyMapRevisionWithTextSymbols(original: Uint8Array, changeSet: MapRevisionChangeSet, textSymbols: readonly MapTextSymbolChange[],
  options: { readonly ocad?: boolean } = {}): MapRevisionApplyResult {
  if (textSymbols.length === 0) return applyMapRevision(original, changeSet, options);
  const refuse = (code: "BASE_MISMATCH" | "UNSUPPORTED_VERSION" | "VERIFY_FAILED", message: string): MapRevisionApplyResult => ({ ok: false, refusals: [{ code, message }] });
  const baseSha = sha256Hex(original);
  if (baseSha !== changeSet.baseFileSha256) return refuse("BASE_MISMATCH", "Filen är inte grundfilen som ändringarna gjordes på.");
  if (isOcd(original)) return refuse("UNSUPPORTED_VERSION", "Ändrade textsymboler kan inte skrivas i en OCAD-fil här. Spara kartan i Mapper (.omap/.xmap) först.");
  const symbols = applyMapTextSymbols(original, textSymbols);
  if (!symbols.ok) return refuse("VERIFY_FAILED", symbols.message);
  const sha = symbols.changed > 0 ? sha256Hex(symbols.bytes) : baseSha;
  const written = applyMapRevision(symbols.bytes, symbols.changed > 0 ? shiftedChangeSet(changeSet, sha, symbols.shift ?? 0) : changeSet, options);
  if (!written.ok) return written;
  const map = decode(original);
  let effective: MapTextSymbolChange[] = [];
  if (map) { try { const read = readOmap(map.text); effective = effectiveTextSymbolChanges(read.symbols, read.colors, textSymbols); } catch { effective = []; } }
  const aligned = applyTextAlignment(written.bytes, effective);
  if (!aligned.ok) return refuse("VERIFY_FAILED", aligned.message);
  return { ok: true, bytes: aligned.bytes, report: { ...written.report, baseFileSha256: baseSha, resultSha256: sha256Hex(aligned.bytes) } };
}
