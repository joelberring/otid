/**
 * Ägaren 2026-11-23 («husen blev helt svarta … trappa är fel liksom många andra symboler som inte följer sprintnorm»): en
 * symbols utseende byts mot normens (O-Tids mall, `SymbolDef`). Numret, namnet och id:t står kvar, så objekten behåller sin
 * symbol; bara definitionen (färger, bredder, mönster, kant) byts. Saknas en färg som normen använder (t.ex. svart 50 % för
 * byggnaden) läggs den in i färgtabellen där mallen har den: närmast ovanför den första av mallens följande färger som kartan har.
 *
 * - `withSymbolReplacements`: modellen (ritläget). Nya färger får nya id efter filens och en rang mellan grannarna.
 * - `applyMapSymbolReplacements`: Mapper-filen, som ett eget steg sist (efter objekten, färgerna och textsymbolerna). Nya färger
 *   kräver att färgernas prioritet räknas om; alla symbolers färgreferenser flyttas lika mycket. Filen läses om och jämförs:
 *   färgerna i samma ordning med samma värden, övriga symboler oförändrade (utom flyttade färgreferenser), lika många objekt.
 *   OCAD-filer vägras.
 */
import { MapFileError, type MapColor, type MapSymbol, type ParsedMap } from "../model";
import { findTag, readOmap } from "../omap/read";
import { SymbolWriter } from "../template/new-map";
import type { ColorDef, ElementDef, SymbolDef } from "../template/symbol-def";
import type { MapColorsResult } from "./colors";
import { elementEnd } from "./omap-scan";
import type { MapRevisionApplyResult, MapRevisionChangeSet } from "./change-set";
import { sha256Hex } from "./sha256";
import { recolor, symbolEnd } from "./symbol-colors";
import { applyMapRevisionWithTextSymbols, shiftedChangeSet, type MapTextSymbolChange } from "./text-symbols";

export interface SymbolReplacement {
  /** Symbolnumret som i filen ("521"); symbolerna med numret byts. */
  readonly code: string;
  /** Normens symbol (numret och namnet i den används inte). */
  readonly def: SymbolDef;
  /** Normens färger överst först (mallens), för färgnycklarna i `def` och var en ny färg ska ligga. */
  readonly palette: readonly ColorDef[];
  /** Måttens förstoring i kartans skala (ISOM 1:10 000 = 1,5); förval 1. */
  readonly factor?: number | undefined;
  /** En ny symbol (normens nummer och namn ur `def`, nästa lediga id) i stället för ett byte; bara om numret inte finns. */
  readonly add?: true | undefined;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.011;
const sameCmyk = (color: MapColor, def: ColorDef) =>
  !color.spot && close(color.cmyk.c, def.cmyk[0]) && close(color.cmyk.m, def.cmyk[1]) && close(color.cmyk.y, def.cmyk[2]) && close(color.cmyk.k, def.cmyk[3]);

function elementKeys(elements: readonly ElementDef[] | undefined): string[] { return (elements ?? []).map(element => element.color); }
/** Färgnycklarna symbolen använder. */
export function symbolDefColorKeys(def: SymbolDef): string[] {
  switch (def.kind) {
    case "point": return elementKeys(def.elements);
    case "text": return [def.color];
    case "line": return [...(def.color ? [def.color] : []), ...(def.border ? [def.border.color] : []), ...elementKeys(def.mid?.elements)];
    case "area": return [...(def.fill ? [def.fill] : []), ...(def.hatches ?? []).map(hatch => hatch.color), ...elementKeys(def.dots?.elements),
      ...(def.border ? [def.border.color] : [])];
  }
}

/** En färg som ska läggas in: mallens färg och kartans färg den ska ligga ovanför (eller sist). */
interface NewColor { readonly key: string; readonly def: ColorDef; readonly before: number | undefined }
interface ColorPlan { readonly existing: ReadonlyMap<string, number>; readonly added: readonly NewColor[] }

/** Mallens färgnycklar → kartans färger; det som saknas blir nya färger. Samma namn går före samma CMYK. */
export function planColors(colors: readonly MapColor[], replacements: readonly SymbolReplacement[]): ColorPlan {
  const existing = new Map<string, number>(), added: NewColor[] = [];
  const find = (def: ColorDef) => colors.find(color => color.name === def.name && sameCmyk(color, def))
    ?? (def.distinct ? undefined : colors.find(color => sameCmyk(color, def)));
  // Grannen som en ny färg läggs ovanför: vitt hittas bara på namnet (kartans vita ligger på många ställen, t.ex. banans vita överst).
  const white = (def: ColorDef) => def.cmyk.every(value => value === 0);
  const neighbour = (def: ColorDef) => white(def) ? colors.find(color => color.name === def.name && sameCmyk(color, def)) : find(def);
  for (const replacement of replacements) {
    for (const key of symbolDefColorKeys(replacement.def)) {
      if (existing.has(key) || added.some(row => row.key === key)) continue;
      const index = replacement.palette.findIndex(color => color.key === key);
      const def = replacement.palette[index];
      if (!def) throw new MapFileError("INVALID", `Normens färg ${key} saknas.`);
      const found = find(def);
      if (found) { existing.set(key, found.id); continue; }
      // Ovanför den första av mallens följande färger som kartan har.
      const below = replacement.palette.slice(index + 1).map(neighbour).find(color => !!color);
      added.push({ key, def, before: below?.id });
    }
  }
  return { existing, added };
}

/** Färgerna i den nya ordningen (överst först): kartans och de nya. */
function ordered(colors: readonly MapColor[], plan: ColorPlan): ({ readonly old: MapColor } | { readonly add: NewColor })[] {
  const out: ({ readonly old: MapColor } | { readonly add: NewColor })[] = [];
  for (const color of [...colors].sort((a, b) => a.rank - b.rank)) {
    for (const add of plan.added) if (add.before === color.id) out.push({ add });
    out.push({ old: color });
  }
  for (const add of plan.added) if (add.before === undefined) out.push({ add });
  return out;
}

const MAPPER_NS = "http://openorienteering.org/apps/mapper/xml/v2";
/** Symbolernas XML läst med kartans läsare (samma tolkning som filen får). */
function parseSymbols(xml: readonly string[]): ReadonlyMap<string, MapSymbol> {
  const doc = `<?xml version="1.0" encoding="UTF-8"?><map xmlns="${MAPPER_NS}" version="9"><colors count="0"></colors>` +
    `<barrier version="6" required="0.6.0"><symbols count="${xml.length}">${xml.join("")}</symbols></barrier></map>`;
  return readOmap(doc).symbols;
}

const symbolsWithCode = (symbols: ReadonlyMap<string, MapSymbol>, code: string) =>
  [...symbols.values()].filter(symbol => symbol.code.text === code && code !== "");
const privateParts = (symbols: ReadonlyMap<string, MapSymbol>, id: string) => [...symbols.keys()].filter(key => key.startsWith(`${id}.`));

function symbolXml(keyIds: ReadonlyMap<string, number>, replacement: SymbolReplacement, symbol: MapSymbol): string {
  return new SymbolWriter(replacement.factor ?? 1, keyIds).symbol({ ...replacement.def, code: symbol.code.text, name: symbol.name }, symbol.id);
}

/** Bara byten av symboler som finns och tillägg av nummer som inte finns (sista per nummer gäller). */
const effective = (symbols: ReadonlyMap<string, MapSymbol>, replacements: readonly SymbolReplacement[]) =>
  [...new Map(replacements.filter(row => (symbolsWithCode(symbols, row.code).length > 0) !== !!row.add).map(row => [row.code, row])).values()];
/**
 * Första id:t för nya symboler: 1 000 över filens största (Mappers id är heltal). Avståndet gör att textsymbolernas kopior
 * (`nextTextSymbolId`, räknas ur filens id) aldrig krockar med normens tillagda symboler.
 */
const firstFreeId = (symbols: ReadonlyMap<string, MapSymbol>) => Math.max(-1, ...[...symbols.keys()].filter(id => /^\d+$/.test(id)).map(Number)) + 1000;
/** De nya symbolerna med sina id, i tilläggens ordning. */
const newSymbols = (symbols: ReadonlyMap<string, MapSymbol>, wanted: readonly SymbolReplacement[]) => {
  let next = firstFreeId(symbols);
  return wanted.filter(row => row.add).map(row => ({ row, id: String(next++) }));
};
const addedXml = (keyIds: ReadonlyMap<string, number>, row: SymbolReplacement, id: string) =>
  new SymbolWriter(row.factor ?? 1, keyIds).symbol({ ...row.def, code: row.code }, id);

/** Modellen med symbolerna utbytta och de nya färgerna (nya id efter filens, rangen mellan grannarna). */
export function withSymbolReplacements(map: Pick<ParsedMap, "colors" | "symbols">, replacements: readonly SymbolReplacement[])
  : { colors: MapColor[]; symbols: Map<string, MapSymbol> } {
  const wanted = effective(map.symbols, replacements);
  if (wanted.length === 0) return { colors: [...map.colors], symbols: new Map(map.symbols) };
  const plan = planColors(map.colors, wanted);
  let next = Math.max(-1, ...map.colors.map(color => color.id)) + 1;
  const keyIds = new Map(plan.existing);
  const order = ordered(map.colors, plan);
  const colors: MapColor[] = [];
  order.forEach((row, rank) => {
    if ("old" in row) { colors.push({ ...row.old, rank }); return; }
    const [c, m, y, k] = row.add.def.cmyk;
    const id = next++;
    keyIds.set(row.add.key, id);
    colors.push({ id, name: row.add.def.name, rank, cmyk: { c, m, y, k }, rgb: { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) }, opacity: 1 });
  });
  const symbols = new Map(map.symbols);
  for (const { row, id } of newSymbols(map.symbols, wanted)) for (const [key, parsed] of parseSymbols([addedXml(keyIds, row, id)])) symbols.set(key, parsed);
  for (const replacement of wanted.filter(row => !row.add)) {
    for (const symbol of symbolsWithCode(map.symbols, replacement.code)) {
      for (const part of privateParts(symbols, symbol.id)) symbols.delete(part);
      for (const [id, parsed] of parseSymbols([symbolXml(keyIds, replacement, symbol)])) symbols.set(id, { ...parsed, hidden: symbol.hidden });
    }
  }
  return { colors, symbols };
}

const COLOR_ATTRIBUTE = /(\s(?:color|inner_color|outer_color)=")(\d+)(")/g;
const fail = (message: string): MapColorsResult => ({ ok: false, message });
const number = (value: number) => String(Math.round(value * 1000) / 1000);
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colorXml(def: ColorDef, priority: number): string {
  const [c, m, y, k] = def.cmyk;
  return `<color priority="${priority}" name="${escapeXml(def.name)}" c="${c}" m="${m}" y="${y}" k="${k}" opacity="1"><cmyk method="custom"/>` +
    `<rgb method="cmyk" r="${number((1 - c) * (1 - k))}" g="${number((1 - m) * (1 - k))}" b="${number((1 - y) * (1 - k))}"/></color>`;
}

export function applyMapSymbolReplacements(original: Uint8Array, replacements: readonly SymbolReplacement[]): MapColorsResult {
  if (replacements.length === 0) return { ok: true, bytes: original, changed: 0 };
  if (original.length >= 2 && original[0] === 0xad && original[1] === 0x0c) {
    return fail("Symbolerna kan inte skrivas om i en OCAD-fil här. Spara kartan i Mapper (.omap) först.");
  }
  const bom = original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? 3 : 0;
  let text: string, before: ParsedMap;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original.subarray(bom));
    before = readOmap(text);
  } catch (error) {
    return fail(error instanceof MapFileError ? error.message : "Mapper-filen är inte giltig UTF-8.");
  }
  const wanted = effective(before.symbols, replacements);
  if (wanted.length === 0) return { ok: true, bytes: original, changed: 0 };
  let plan: ColorPlan;
  try { plan = planColors(before.colors, wanted); } catch (error) { return fail(error instanceof Error ? error.message : "Normens färger saknas."); }
  // Den nya ordningen: prioriteten är platsen i listan.
  const order = ordered(before.colors, plan);
  const remap = new Map<number, number>(), keyIds = new Map(plan.existing), newAt = new Map<NewColor, number>();
  order.forEach((row, priority) => { if ("old" in row) remap.set(row.old.id, priority); else { newAt.set(row.add, priority); keyIds.set(row.add.key, priority); } });
  for (const [key, id] of plan.existing) keyIds.set(key, remap.get(id)!);
  const moved = (value: string) => String(remap.get(Number(value)) ?? Number(value));

  // 1. Färgtabellen: prioriteterna räknas om och de nya färgerna läggs på sina platser.
  const colorsStart = findTag(text, "<colors", 0), colorsEnd = colorsStart < 0 ? -1 : text.indexOf("</colors>", colorsStart);
  if (colorsStart < 0 || colorsEnd < 0) return fail("Mapper-filen har ingen färgtabell.");
  const elements = new Map<number, string>();
  let index = 0;
  for (let open = findTag(text, "<color", colorsStart); open >= 0 && open < colorsEnd; index += 1) {
    const stop = elementEnd(text, open, "color", colorsEnd);
    if (stop < 0) return fail("Mapper-filens färgtabell är avkortad.");
    const element = text.slice(open, stop);
    const id = Number(/\spriority="(-?\d+)"/.exec(element.slice(0, element.indexOf(">")))?.[1] ?? index);
    elements.set(id, element.replace(/(\spriority=")(-?\d+)(")/, (_all, head: string, value: string, tail: string) => `${head}${moved(value)}${tail}`)
      .replace(/(\sspotcolor=")(\d+)(")/g, (_all, head: string, value: string, tail: string) => `${head}${moved(value)}${tail}`));
    open = findTag(text, "<color", stop);
  }
  if (elements.size !== before.colors.length) return fail("Mapper-filens färgtabell stämmer inte med färgerna.");
  const firstColor = findTag(text, "<color", colorsStart);
  const colorsHead = text.slice(colorsStart, text.indexOf(">", colorsStart) + 1).replace(/(\scount=")\d+(")/, `$1${order.length}$2`);
  const colorsXml = colorsHead + order.map(row => "old" in row ? elements.get(row.old.id)! : colorXml(row.add.def, newAt.get(row.add)!)).join("");
  const colorsTail = firstColor >= 0 && firstColor < colorsEnd ? "" : text.slice(text.indexOf(">", colorsStart) + 1, colorsEnd);

  // 2. Symbolerna: färgreferenserna flyttas, de utbytta skrivs om.
  const symbolsStart = findTag(text, "<symbols", colorsEnd), symbolsEnd = symbolsStart < 0 ? -1 : text.indexOf("</symbols>", symbolsStart);
  if (symbolsStart < 0 || symbolsEnd < 0) return fail("Mapper-filen har ingen symboltabell.");
  let symbolsXml = "", at = symbolsStart, done = 0;
  for (let open = findTag(text, "<symbol", symbolsStart + 1); open >= 0 && open < symbolsEnd;) {
    const stop = symbolEnd(text, open, symbolsEnd);
    if (stop < 0) return fail("Mapper-filens symboltabell är avkortad.");
    const tag = text.slice(open, text.indexOf(">", open) + 1);
    const id = /\sid="([^"]*)"/.exec(tag)?.[1] ?? "";
    const symbol = before.symbols.get(id);
    const replacement = symbol ? wanted.find(row => row.code === symbol.code.text) : undefined;
    symbolsXml += text.slice(at, open).replace(COLOR_ATTRIBUTE, (_all, head: string, value: string, tail: string) => `${head}${moved(value)}${tail}`);
    if (symbol && replacement) {
      let xml = symbolXml(keyIds, replacement, symbol);
      // Filens egna flaggor (dold, skyddad) står kvar.
      for (const flag of ["is_hidden", "is_protected", "is_helper_symbol"]) {
        const value = new RegExp(`\\s${flag}="([^"]*)"`).exec(tag)?.[1];
        if (value !== undefined) xml = xml.replace(/^<symbol /, `<symbol ${flag}="${value}" `);
      }
      symbolsXml += xml;
      done += 1;
    } else {
      symbolsXml += text.slice(open, stop).replace(COLOR_ATTRIBUTE, (_all, head: string, value: string, tail: string) => `${head}${moved(value)}${tail}`);
    }
    at = stop;
    open = findTag(text, "<symbol", stop);
  }
  const added = newSymbols(before.symbols, wanted);
  symbolsXml += text.slice(at, symbolsEnd) + added.map(({ row, id }) => addedXml(keyIds, row, id)).join("");
  done += added.length;
  if (added.length) {
    const head = /^<symbols\b[^>]*>/.exec(symbolsXml)?.[0] ?? "";
    const count = Number(/\scount="(\d+)"/.exec(head)?.[1] ?? NaN);
    if (Number.isFinite(count)) symbolsXml = head.replace(/(\scount=")\d+(")/, `$1${count + added.length}$2`) + symbolsXml.slice(head.length);
  }
  const result = text.slice(0, colorsStart) + colorsXml + colorsTail + text.slice(colorsEnd, symbolsStart) + symbolsXml + text.slice(symbolsEnd);

  // Kontrollen: filen läses om och jämförs med det väntade.
  let after: ParsedMap;
  try { after = readOmap(result); } catch { return fail("Kontrollen efter symbolerna: filen går inte att läsa."); }
  const replacedIds = new Set(wanted.flatMap(row => symbolsWithCode(before.symbols, row.code).flatMap(symbol => [symbol.id, ...privateParts(before.symbols, symbol.id)])));
  const remapId = (color: number) => remap.get(color) ?? color;
  const colorsOk = after.colors.length === order.length && order.every((row, priority) => {
    const color = after.colors[priority]!;
    if ("add" in row) return color.name === row.add.def.name && sameCmyk(color, row.add.def);
    return color.id === priority && color.name === row.old.name && JSON.stringify(color.cmyk) === JSON.stringify(row.old.cmyk) && color.opacity === row.old.opacity;
  });
  const othersOk = [...before.symbols].every(([id, symbol]) => replacedIds.has(id)
    || JSON.stringify(after.symbols.get(id)) === JSON.stringify(recolor(symbol, remapId)));
  const replacedOk = wanted.every(row => symbolsWithCode(after.symbols, row.code).length === (row.add ? 1 : symbolsWithCode(before.symbols, row.code).length));
  if (!colorsOk || !othersOk || !replacedOk || after.objects.length !== before.objects.length || after.scale !== before.scale) {
    return fail("Kontrollen efter symbolerna: något annat än de utbytta symbolerna ändrades.");
  }
  const encoded = new TextEncoder().encode(result), bytes = new Uint8Array(bom + encoded.length);
  bytes.set(original.subarray(0, bom));
  bytes.set(encoded, bom);
  return { ok: true, bytes, changed: done };
}

/**
 * Objektens ändringar i en fil där normens nya symboler (`additions`, bara tillägg utan nya färger) först lagts sist i
 * symboltabellen, så att nya objekt kan ha dem; sedan textsymbolerna och objekten som i `applyMapRevisionWithTextSymbols`.
 */
export function applyMapRevisionWithSymbols(original: Uint8Array, changeSet: MapRevisionChangeSet, textSymbols: readonly MapTextSymbolChange[],
  additions: readonly SymbolReplacement[], options: { readonly ocad?: boolean } = {}): MapRevisionApplyResult {
  if (additions.length === 0) return applyMapRevisionWithTextSymbols(original, changeSet, textSymbols, options);
  const refuse = (code: "BASE_MISMATCH" | "VERIFY_FAILED", message: string): MapRevisionApplyResult => ({ ok: false, refusals: [{ code, message }] });
  const baseSha = sha256Hex(original);
  if (baseSha !== changeSet.baseFileSha256) return refuse("BASE_MISMATCH", "Filen är inte grundfilen som ändringarna gjordes på.");
  if (additions.some(row => !row.add)) return refuse("VERIFY_FAILED", "Bara nya symboler läggs in före objekten.");
  let before: ParsedMap;
  try { before = readOmap(new TextDecoder("utf-8").decode(original).replace(/^\uFEFF/, "")); } catch { return refuse("VERIFY_FAILED", "Grundfilen går inte att läsa."); }
  if (planColors(before.colors, effective(before.symbols, additions)).added.length > 0) return refuse("VERIFY_FAILED", "Normens nya symboler kräver färger som kartan saknar.");
  const added = applyMapSymbolReplacements(original, additions);
  if (!added.ok) return refuse("VERIFY_FAILED", added.message);
  if (added.changed === 0) return applyMapRevisionWithTextSymbols(original, changeSet, textSymbols, options);
  const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  const shift = decode(added.bytes).length - decode(original).length;
  const written = applyMapRevisionWithTextSymbols(added.bytes, shiftedChangeSet(changeSet, sha256Hex(added.bytes), shift), textSymbols, options);
  return written.ok ? { ...written, report: { ...written.report, baseFileSha256: baseSha } } : written;
}
