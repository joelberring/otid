import { planColors, SYMBOL_SETS, withSymbolReplacements, type MapColor, type MapSymbol, type StrokeStyle, type SymbolDef, type SymbolReplacement } from "@o-tid/map-file";
import { ISSPROM_SYMBOLS } from "./issprom-symbols";
import { codeParts } from "./map-norm";

/**
 * Symbolerna mot ISSprOM 2019-2 (ägaren 2026-11-23: «husen blev helt svarta fast de ska bli grå med svart kant … trappa är fel
 * liksom många andra symboler som inte följer sprintnorm»). Kontrollen jämför kartans symboldefinitioner (inte objekten) med
 * normens färger, linjebredder och kanter för de symboler kartan använder, och säger vad som avviker. Normkontrollens minimimått
 * finns i `norm-check.ts`.
 *
 * Tabellen nedan är hämtad ur IOF:s O-Map Wiki (ISSprOM 2019-2 med rättelserna, sidorna `omapwiki.orienteering.sport/symbols/
 * <nr>-<namn>-2/`, lästa 2026-11-23). Wikin anger symbolernas färg som andel av normens grundfärger och några mått; den anger
 * inte de flesta linjebredderna (de står bara i normens bilder), och de jämförs därför inte. Inte i tabellen, med skäl:
 * - 520 Område som inte får beträdas: «yellow 100%, green 50%» (en blandfärg; tryckets dekorfärger gör den svår att jämföra i CMYK).
 * - 521:s kantlinje: «black (outline)», bredden anges inte; bara att kanten finns kontrolleras.
 * - 532 Trappa: «Steps of a stairway shall be represented in a generalized manner», svart, minst 0,4 mm bred och tre grafiska
 *   steg; stegens bredd och avstånd anges inte i texten. Kontrollen säger bara att trappan ska vara steg utan löpande linje
 *   (O-Tids mall: steg 0,1 mm var 0,4 mm, `issprom-2019-2.ts`).
 * - 401, 405, 505–507, 513–518 m.fl.: färgen eller bredden står inte i wikins text (inte verifierat, inte med).
 * Skogskartor (ISOM 2017-2) har ingen tabell här än.
 */
export type NormBase = "black" | "brown" | "yellow" | "green" | "blue";
export interface SymbolNormSpec {
  /** Normens nummer («521», «501.1»). */
  readonly code: string;
  readonly name: string;
  readonly kind: "area" | "line";
  /** Ytans färg: grundfärgen och de tillåtna andelarna (0–1). */
  readonly fill?: { readonly base: NormBase; readonly tints: readonly number[] } | undefined;
  /** Svart kantlinje runt ytan: i symbolen eller som egen kantsymbol (t.ex. 521.1, 301.1) som används i kartan. */
  readonly outline?: true | undefined;
  /** Linjens färg och bredd (mm i kartan; utan bredd jämförs bara färgen). */
  readonly line?: { readonly base: NormBase; readonly width?: number | undefined } | undefined;
  /** Trappa: steg tvärs linjen, ingen löpande linje. */
  readonly steps?: true | undefined;
  /** Sidan i O-Map Wiki och vad den säger (citat), med ändringsdatum. */
  readonly source: string;
}

const WIKI = "https://omapwiki.orienteering.sport/symbols/";
export const ISSPROM_SYMBOL_NORM: readonly SymbolNormSpec[] = [
  { code: "214", name: "Kal berghäll", kind: "area", fill: { base: "black", tints: [0.35] },
    source: `${WIKI}214-bare-rock-2/ «Colour: black 35%» (ändrat 2024-02-01 från 30 %)` },
  { code: "301", name: "Sjö, oöverkomlig", kind: "area", fill: { base: "blue", tints: [1, 0.7] }, outline: true,
    source: `${WIKI}301-uncrossable-body-of-water-2/ «Colour: black (outline), blue 100% or 70% for dominant areas»` },
  { code: "403", name: "Ödemark", kind: "area", fill: { base: "yellow", tints: [0.5] }, source: `${WIKI}403-rough-open-land-2/ «Colour: yellow 50%»` },
  { code: "404", name: "Ödemark med spridda träd", kind: "area", fill: { base: "yellow", tints: [0.5] },
    source: `${WIKI}404-rough-open-land-with-scattered-trees-2/ «Colour: yellow 50% with holes of white or green 60%» (hålen jämförs inte)` },
  { code: "406", name: "Vegetation, löphindrande", kind: "area", fill: { base: "green", tints: [0.3] },
    source: `${WIKI}406-vegetation-slow-running-2/ «Colour: green 30%»` },
  { code: "408", name: "Vegetation, svårlöpt", kind: "area", fill: { base: "green", tints: [0.6] }, source: `${WIKI}408-vegetation-walk-2/ «Colour: green 60%»` },
  { code: "410", name: "Vegetation, mycket svårlöpt", kind: "area", fill: { base: "green", tints: [1, 0.6, 0.3] },
    source: `${WIKI}410-vegetation-fight-2/ «Colour: green / green 60% / green 30%» (60 % och 30 % tillagda 2024-02-01)` },
  { code: "501", name: "Belagd yta", kind: "area", fill: { base: "brown", tints: [0.3, 0.5] },
    source: `${WIKI}501-paved-area-2/ «brown 30% for light traffic …, 50% for heavy traffic»` },
  { code: "501.1", name: "Kant, belagd yta", kind: "line", line: { base: "black", width: 0.18 },
    source: `${WIKI}501-1-step-or-edge-of-paved-area-2/ «Colour: black», «Change of line width: 0.12 –> 0.18 mm» (2023-02-01)` },
  { code: "521", name: "Byggnad", kind: "area", fill: { base: "black", tints: [0.5] }, outline: true,
    source: `${WIKI}521-building-2/ «Colour: black (outline), black 50%» (ändrat 2022-01-02 från 60 %); gränser mellan hus som rör varandra ritas inte` },
  { code: "532", name: "Trappa", kind: "line", steps: true, line: { base: "black" },
    source: `${WIKI}532-stairway-2/ «Steps of a stairway shall be represented in a generalized manner», svart, minst 0,4 mm bred, minst tre steg` }
];

/** Normens grundfärger (CMYK 0–1, som O-Tids mallar). En andel är grundfärgen gånger andelen. */
const BASE: Readonly<Record<NormBase, readonly [number, number, number, number]>> = {
  black: [0, 0, 0, 1], brown: [0, 0.56, 1, 0.18], yellow: [0, 0.27, 0.79, 0], green: [0.76, 0, 0.91, 0], blue: [1, 0, 0, 0]
};
const TOLERANCE = 0.06;

export type SymbolNormProblem =
  | { readonly kind: "FILL"; readonly base: NormBase; readonly tints: readonly number[]; readonly found: { readonly base?: NormBase | undefined; readonly tint?: number | undefined } | null }
  | { readonly kind: "OUTLINE" }
  | { readonly kind: "LINE_COLOR"; readonly base: NormBase }
  | { readonly kind: "LINE_WIDTH"; readonly width: number; readonly found: number }
  | { readonly kind: "STEPS" };

export interface SymbolNormIssue {
  /** Symbolens id och nummer i kartan. */
  readonly symbolId: string;
  readonly code: string;
  readonly name: string;
  readonly spec: SymbolNormSpec;
  readonly problems: readonly SymbolNormProblem[];
  /** Normens symbol ur O-Tids mall rättar avvikelsen (`symbolNormReplacements`); kanten räknas inte när `outlines` gäller. */
  readonly fixable: boolean;
  /** Kanten saknas men kartan har en kantsymbol: «Lägg kant runt husen» ritar den. */
  readonly outlines: boolean;
}

export interface SymbolNormInput {
  readonly colors: readonly MapColor[];
  readonly symbols: ReadonlyMap<string, MapSymbol>;
  /** Objekt per symbol-id; bara symboler som används kontrolleras. */
  readonly counts: ReadonlyMap<string, number>;
}

const matches = (code: string, spec: string) => {
  const a = codeParts(code), b = codeParts(spec);
  return a.main === b.main && a.sub === b.sub;
};

/** Grundfärgen och andelen som färgen är (inom toleransen), eller inget. */
export function tintOf(color: MapColor | undefined): { base: NormBase; tint: number } | undefined {
  if (!color) return undefined;
  const cmyk = [color.cmyk.c, color.cmyk.m, color.cmyk.y, color.cmyk.k];
  for (const base of Object.keys(BASE) as NormBase[]) {
    const ref = BASE[base];
    const strongest = ref.indexOf(Math.max(...ref));
    const tint = cmyk[strongest]! / ref[strongest]!;
    if (tint > 0.05 && tint <= 1.05 && cmyk.every((value, i) => Math.abs(value - ref[i]! * tint) <= TOLERANCE)) return { base, tint: Math.round(tint * 100) / 100 };
  }
  return undefined;
}

const parts = (symbols: ReadonlyMap<string, MapSymbol>, symbol: MapSymbol): MapSymbol[] =>
  symbol.kind === "COMBINED" ? symbol.parts.map(id => symbols.get(id)).filter((part): part is MapSymbol => !!part) : [symbol];
const fillOf = (symbols: ReadonlyMap<string, MapSymbol>, symbol: MapSymbol) =>
  parts(symbols, symbol).find(part => part.kind === "AREA" && part.fill !== undefined) as Extract<MapSymbol, { kind: "AREA" }> | undefined;
/** Symbolens egen kant: ytans kantlinje eller en linjedel i en kombinerad symbol. */
const ownOutline = (symbols: ReadonlyMap<string, MapSymbol>, symbol: MapSymbol): StrokeStyle | undefined => {
  for (const part of parts(symbols, symbol)) {
    if (part.kind === "AREA" && part.border?.length) return part.border[0];
    if (part.kind === "LINE" && part.strokes.length) return part.strokes[0];
  }
  return undefined;
};

/**
 * Kantsymbolen till en yta: en linjesymbol med samma huvudnummer och undernummer 1 (521.1, 301.1), eller som heter något med
 * byggnad och kant (t.ex. «Kant, byggnad», «Building outline»).
 */
export function edgeSymbolFor(symbols: ReadonlyMap<string, MapSymbol>, code: string): MapSymbol | undefined {
  const main = codeParts(code).main;
  const lines = [...symbols.values()].filter(symbol => symbol.kind === "LINE" && !symbol.id.includes("."));
  return lines.find(symbol => symbol.code.main === main && symbol.code.sub === 1)
    ?? (main === 521 ? lines.find(symbol => /(kant|kontur).*byggnad|byggnad.*(kant|kontur)|building.*(outline|edge)/i.test(symbol.name)) : undefined);
}

function problemsOf(input: SymbolNormInput, symbol: MapSymbol, spec: SymbolNormSpec): SymbolNormProblem[] {
  const out: SymbolNormProblem[] = [];
  const color = (id: number | undefined) => id === undefined ? undefined : input.colors.find(row => row.id === id);
  if (spec.fill) {
    const found = tintOf(color(fillOf(input.symbols, symbol)?.fill));
    if (!found || found.base !== spec.fill.base || !spec.fill.tints.some(tint => Math.abs(tint - found.tint) <= 0.04)) {
      out.push({ kind: "FILL", base: spec.fill.base, tints: spec.fill.tints, found: found ? { base: found.base, tint: found.tint } : null });
    }
  }
  if (spec.outline && !ownOutline(input.symbols, symbol)) {
    const edge = edgeSymbolFor(input.symbols, spec.code);
    if (!edge || !(input.counts.get(edge.id) ?? 0)) out.push({ kind: "OUTLINE" });
  }
  if (spec.line) {
    const strokes = parts(input.symbols, symbol).flatMap(part => part.kind === "LINE" ? part.strokes : []);
    const main = [...strokes].sort((a, b) => b.width - a.width)[0];
    const elements = parts(input.symbols, symbol).flatMap(part => part.kind === "LINE" ? part.repeated?.elements ?? [] : []);
    const lineColor = main?.color ?? elements[0]?.color;
    const found = tintOf(color(lineColor));
    if (lineColor !== undefined && (!found || found.base !== spec.line.base || found.tint < 0.95)) out.push({ kind: "LINE_COLOR", base: spec.line.base });
    if (spec.line.width !== undefined && main && Math.abs(main.width - spec.line.width) > 0.005) out.push({ kind: "LINE_WIDTH", width: spec.line.width, found: main.width });
    if (spec.steps && (strokes.some(stroke => stroke.width > 0) || elements.length === 0)) out.push({ kind: "STEPS" });
  }
  return out;
}

/** Kontrollen: varje använd symbol med en rad i tabellen och det som avviker. Sprintkartor; skogskartor ger en tom lista. */
export function checkSymbolNorm(input: SymbolNormInput, sprint: boolean): SymbolNormIssue[] {
  if (!sprint) return [];
  const out: SymbolNormIssue[] = [];
  for (const symbol of input.symbols.values()) {
    if (symbol.id.includes(".") || !(input.counts.get(symbol.id) ?? 0)) continue;
    const spec = ISSPROM_SYMBOL_NORM.find(row => matches(symbol.code.text, row.code));
    if (!spec) continue;
    const problems = problemsOf(input, symbol, spec);
    if (problems.length === 0) continue;
    const replacement = replacementFor(input.symbols, symbol.code.text);
    const outlines = problems.some(problem => problem.kind === "OUTLINE") && !!edgeSymbolFor(input.symbols, spec.code);
    let fixable = false;
    if (replacement && problems.some(problem => problem.kind !== "OUTLINE" || !outlines)) {
      const fixed = withSymbolReplacements(input, [replacement]);
      fixable = problemsOf({ ...input, ...fixed }, fixed.symbols.get(symbol.id) ?? symbol, spec).every(problem => outlines && problem.kind === "OUTLINE");
    }
    out.push({ symbolId: symbol.id, code: symbol.code.text, name: symbol.name, spec, problems, fixable, outlines });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, "sv", { numeric: true }));
}

const SPRINT = SYMBOL_SETS["ISSPROM2019-2"];

/**
 * Normens symbol ur O-Tids sprintmall för numret i kartan. Byggnaden (521) blir bara den grå ytan när kartan har en egen
 * kantsymbol (521.1): kanten ritas då som linjer runt sammanhängande hus (`building-outlines.ts`), så att gränser mellan hus
 * som rör varandra inte ritas (normen). Annars ytan med kant i samma symbol, som i mallen.
 */
function replacementFor(symbols: ReadonlyMap<string, MapSymbol>, code: string): SymbolReplacement | undefined {
  const spec = ISSPROM_SYMBOL_NORM.find(row => matches(code, row.code));
  const template = spec && SPRINT.symbols.find(symbol => symbol.code === spec.code);
  if (!spec || !template) return undefined;
  let def: SymbolDef = template;
  if (template.kind === "area" && template.border && edgeSymbolFor(symbols, spec.code)) {
    def = { code: template.code, name: template.name, kind: "area", ...(template.fill ? { fill: template.fill } : {}) };
  }
  return { code, def, palette: SPRINT.colors };
}

/**
 * Normens symboler som kartan saknar, med namnet i O-Tids mall. Ett nummer X.1 räknas som befintligt när kartan har X och
 * normen inte har X (skogsnormens 509 Järnväg, 513 Mur är sprintnormens 509.1 och 513.1).
 */
export function missingNormSymbols(symbols: ReadonlyMap<string, MapSymbol>): { code: string; name: string }[] {
  const own = [...symbols.values()].filter(symbol => !symbol.id.includes("."));
  const has = (code: string) => own.some(symbol => matches(symbol.code.text, code));
  const listed = new Set(ISSPROM_SYMBOLS.map(entry => entry.code));
  return ISSPROM_SYMBOLS.flatMap(entry => {
    const { main, sub } = codeParts(entry.code);
    if (has(entry.code) || (sub === 1 && !listed.has(String(main)) && has(String(main)))) return [];
    const template = SPRINT.symbols.find(symbol => symbol.code === entry.code);
    return template ? [{ code: entry.code, name: template.name }] : [];
  });
}

/**
 * Kartprojektets rättningar (sparas i projektet, `norm_symbols`): numren vars symbol byts mot normens och normens nummer som
 * läggs till. Ett nummer som redan finns läggs aldrig till; ett som tabellen eller mallen inte har hoppas över.
 */
export interface NormSymbolSetting { readonly replace: readonly string[]; readonly add: readonly string[] }

/** Bytena (sist, efter färgerna: de kan lägga in färger). */
export function normSymbolFixes(symbols: ReadonlyMap<string, MapSymbol>, setting: Pick<NormSymbolSetting, "replace">): SymbolReplacement[] {
  return [...new Set(setting.replace)].flatMap(code => replacementFor(symbols, code) ?? []);
}

/**
 * Tilläggen (först, före objekten, så att nya objekt kan ha dem): bara nummer som saknas och vars färger kartan redan har
 * (ett tillägg flyttar aldrig färgerna; textsymbolernas och färgernas ändringar pekar på färgernas id).
 */
export function normSymbolAdditions(map: { readonly colors: readonly MapColor[]; readonly symbols: ReadonlyMap<string, MapSymbol> },
  add: readonly string[]): SymbolReplacement[] {
  const missing = new Set(missingNormSymbols(map.symbols).map(row => row.code));
  return [...new Set(add)].filter(code => missing.has(code)).flatMap((code): SymbolReplacement[] => {
    const row: SymbolReplacement = { code, def: SPRINT.symbols.find(symbol => symbol.code === code)!, palette: SPRINT.colors, add: true };
    return planColors(map.colors, [row]).added.length === 0 ? [row] : [];
  });
}

/** Symbolraden som importen och ritläget ser den: `outlined` = ytan har egen kant (kantlinje eller kombinerad med linje). */
export interface EdgeCatalogRow { readonly id: string; readonly code: string; readonly kind: string; readonly name?: string | undefined; readonly outlined?: boolean | undefined }

/**
 * Kantsymbolen som husen ska få automatiskt (ägaren 2026-11-23: «om det bara finns en hatch borde programmet göra en kant runt
 * när det lägger in»): kartans byggnad (521) är en yta utan egen kant och kartan har en kantsymbol (521.1 eller ett namn med
 * byggnad och kant). Annars inget.
 */
export function autoBuildingEdgeOf(rows: readonly EdgeCatalogRow[]): string | undefined {
  const building = rows.find(row => row.kind === "area" && codeParts(row.code).main === 521 && codeParts(row.code).sub === 0);
  if (!building || building.outlined) return undefined;
  const lines = rows.filter(row => row.kind === "line");
  return (lines.find(row => codeParts(row.code).main === 521 && codeParts(row.code).sub === 1)
    ?? lines.find(row => !!row.name && /(kant|kontur).*byggnad|byggnad.*(kant|kontur)|building.*(outline|edge)/i.test(row.name)))?.id;
}

/** Har ytsymbolen en egen kant? */
export const hasOwnOutline = (symbols: ReadonlyMap<string, MapSymbol>, symbol: MapSymbol): boolean => !!ownOutline(symbols, symbol);

/** Samma sak ur kartans symboler (servern, AI-kopplingens grundkarta). */
export function autoBuildingEdge(symbols: ReadonlyMap<string, MapSymbol>): string | undefined {
  return autoBuildingEdgeOf([...symbols.values()].filter(symbol => !symbol.id.includes(".") && !symbol.hidden).map(symbol => ({ id: symbol.id, code: symbol.code.text,
    kind: symbol.kind === "LINE" ? "line" : symbol.kind === "AREA" || (symbol.kind === "COMBINED" && parts(symbols, symbol).some(part => part.kind === "AREA")) ? "area" : "other",
    name: symbol.name, outlined: hasOwnOutline(symbols, symbol) })));
}
