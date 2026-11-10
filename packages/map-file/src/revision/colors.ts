/**
 * Ägaren 2026-11-10 («ställa in färger i kartan … färgtabell»): kartprojektets ändrade färger. Färgtabellens CMYK-värden kan
 * ändras; ordningen och namnen står kvar (symbolerna pekar ut färgerna med ordningstalet i Mapper). Skärmfärgen räknas om ur
 * CMYK som för alla andra färger.
 *
 * `applyMapColors` skriver ändringarna i en Mapper-fil som ett eget steg efter objektens ändringar: bara `<color>`-elementens
 * c, m, y, k och deras `<cmyk>` och `<rgb>` byts, och filen läses om och jämförs (alla andra färger, symbolerna och antalet
 * objekt ska vara som förut). OCAD-filer skrivs inte här än.
 */
import { clamp01, rgbFromCmyk } from "../color";
import { MapFileError, type MapColor, type ParsedMap } from "../model";
import { findTag, readOmap } from "../omap/read";
import { elementEnd } from "./omap-scan";

export interface MapColorChange { readonly id: number; readonly cmyk: MapColor["cmyk"] }
export type MapColorsResult = { readonly ok: true; readonly bytes: Uint8Array; readonly changed: number } | { readonly ok: false; readonly message: string };

const close = (a: number, b: number) => Math.abs(a - b) < 0.0006;
const sameCmyk = (a: MapColor["cmyk"], b: MapColor["cmyk"]) => close(a.c, b.c) && close(a.m, b.m) && close(a.y, b.y) && close(a.k, b.k);
const tidy = (cmyk: MapColor["cmyk"]): MapColor["cmyk"] => ({ c: clamp01(cmyk.c), m: clamp01(cmyk.m), y: clamp01(cmyk.y), k: clamp01(cmyk.k) });

/** Ändringarna som gäller för tabellen: okända färger, dekorfärger och värden som är som filens hoppas över. */
export function effectiveColorChanges(colors: readonly MapColor[], changes: readonly MapColorChange[]): MapColorChange[] {
  const out = new Map<number, MapColorChange>();
  for (const change of changes) {
    const color = colors.find(row => row.id === change.id);
    if (!color || color.spot || sameCmyk(color.cmyk, tidy(change.cmyk))) continue;
    out.set(change.id, { id: change.id, cmyk: tidy(change.cmyk) });
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}

/** Färgtabellen med ändringarna: CMYK byts och skärmfärgen räknas om. */
export function withColorChanges(colors: readonly MapColor[], changes: readonly MapColorChange[]): MapColor[] {
  const byId = new Map(effectiveColorChanges(colors, changes).map(change => [change.id, change.cmyk]));
  return colors.map(color => { const cmyk = byId.get(color.id); return cmyk ? { ...color, cmyk, rgb: rgbFromCmyk(cmyk) } : color; });
}

const number = (value: number) => String(Math.round(value * 1000) / 1000);
const isOcd = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0xad && bytes[1] === 0x0c;
const fail = (message: string): MapColorsResult => ({ ok: false, message });

/** Det som inte får ändras av färgbytet: symbolerna och objektens antal. */
const fingerprint = (map: ParsedMap) => JSON.stringify([[...map.symbols.values()], map.objects.length, map.scale]);

export function applyMapColors(original: Uint8Array, changes: readonly MapColorChange[]): MapColorsResult {
  if (changes.length === 0) return { ok: true, bytes: original, changed: 0 };
  if (isOcd(original)) return fail("Färgerna kan inte skrivas i en OCAD-fil här än. Spara kartan i Mapper (.omap) först.");
  const bom = original.length >= 3 && original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf ? 3 : 0;
  let text: string, before: ParsedMap;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original.subarray(bom));
    before = readOmap(text);
  } catch (error) {
    return fail(error instanceof MapFileError ? error.message : "Mapper-filen är inte giltig UTF-8.");
  }
  const wanted = effectiveColorChanges(before.colors, changes);
  if (wanted.length === 0) return { ok: true, bytes: original, changed: 0 };
  const start = findTag(text, "<colors", 0), end = start < 0 ? -1 : text.indexOf("</colors>", start);
  if (start < 0 || end < 0) return fail("Mapper-filen har ingen färgtabell.");
  const byId = new Map(wanted.map(change => [change.id, change.cmyk]));
  let out = "", at = 0, index = 0, done = 0;
  for (let open = findTag(text, "<color", start); open >= 0 && open < end; index += 1) {
    const stop = elementEnd(text, open, "color", end);
    if (stop < 0) return fail("Mapper-filens färgtabell är avkortad.");
    const tagEnd = text.indexOf(">", open) + 1;
    let tag = text.slice(open, tagEnd), body = text.slice(tagEnd, stop);
    const cmyk = byId.get(Number(/\spriority="(-?\d+)"/.exec(tag)?.[1] ?? index));
    if (cmyk) {
      for (const [name, value] of [["c", cmyk.c], ["m", cmyk.m], ["y", cmyk.y], ["k", cmyk.k]] as const) {
        const pattern = new RegExp(`(\\s${name}=")[^"]*(")`);
        if (!pattern.test(tag)) return fail(`Färgen ${index} saknar värdet ${name} i filen.`);
        tag = tag.replace(pattern, `$1${number(value)}$2`);
      }
      // Mapper räknar skärmfärgen ur CMYK när den står som method="cmyk"; en handsatt skärmfärg ersätts av den uträknade.
      const naive = { r: (1 - cmyk.c) * (1 - cmyk.k), g: (1 - cmyk.m) * (1 - cmyk.k), b: (1 - cmyk.y) * (1 - cmyk.k) };
      body = body.replace(/<cmyk\b[^>]*\/>/, `<cmyk method="custom"/>`)
        .replace(/<rgb\b[^>]*\/>/, `<rgb method="cmyk" r="${number(naive.r)}" g="${number(naive.g)}" b="${number(naive.b)}"/>`);
      out += text.slice(at, open) + tag + body;
      at = stop;
      done += 1;
    }
    open = findTag(text, "<color", stop);
  }
  if (done !== wanted.length) return fail("Alla ändrade färger hittades inte i filens färgtabell.");
  const result = out + text.slice(at);
  // Kontrollen: filen läses om. De ändrade färgerna har sina nya värden, allt annat är som förut.
  let after: ParsedMap;
  try { after = readOmap(result); } catch { return fail("Kontrollen efter färgbytet: filen går inte att läsa."); }
  const expected = withColorChanges(before.colors, wanted);
  const same = after.colors.length === expected.length && after.colors.every((color, i) => {
    const want = expected[i]!;
    return color.id === want.id && color.name === want.name && color.opacity === want.opacity && sameCmyk(color.cmyk, want.cmyk)
      && (byId.has(color.id) || JSON.stringify(color) === JSON.stringify(want));
  });
  if (!same || fingerprint(after) !== fingerprint(before)) return fail("Kontrollen efter färgbytet: något annat än färgerna ändrades.");
  const encoded = new TextEncoder().encode(result), bytes = new Uint8Array(bom + encoded.length);
  bytes.set(original.subarray(0, bom));
  bytes.set(encoded, bom);
  return { ok: true, bytes, changed: done };
}
