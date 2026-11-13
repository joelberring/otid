/**
 * ADR-0219 K6b (ägaren 2026-11-08, planen för baskartor): Stockholms stads baskarta och parkkarta som DWG/DXF har lagernamn
 * efter en grammatik: grupp + objekttyp + geometri + karta + status (`MarkanlaggningStenmurglBOdefin…`, `gy` yta, `gl` linje,
 * `gb` blandat, `glh` höjdkurva, `s` symbol, `t` text; status Befintlig, Odefinierad eller Skymd), och parkkartans `Park` +
 * grupp + objekttyp. Namnet tolkas till en symbol enligt utkastet i planen (ISSprOM, ska prövas på riktiga sprintkartor) eller
 * till "hoppa över" för överskottet (fastighetsgränser, text, snöröjning, parkmöbler, skymt under broar).
 */
export interface LayerRule { readonly line?: readonly string[]; readonly area?: readonly string[]; readonly point?: readonly string[] }
export type StockholmLayer = { readonly kind: "skip" } | { readonly kind: "symbol"; readonly rule: LayerRule };

const GEOMETRY = /^[A-Z][a-z]+[A-Z][A-Za-z_]*?(glh|gy|gl|gb|s|t)B(?:[A-Z0-9]|$)/;
const normalized = (name: string) => name.toLowerCase().replace(/[åä]/g, "a").replace(/ö/g, "o");

/** Är namnet Stockholms baskartas eller parkkartans? */
export function isStockholmLayer(name: string): boolean {
  return /^Park[A-Z]/.test(name) || GEOMETRY.test(name);
}

const SKIP = /enhetsomrade|registerenhet|granslinje|tomt|snorojning|markutrustning|va_?anlaggning|elanlaggning|ledstang|graskant|slant|hojdkurva|bergkant|text/;
/** Objekttyp i namnet → symbol; första träffen gäller (de mer bestämda först). */
const RULES: readonly (readonly [RegExp, LayerRule])[] = [
  [/skarmtak/, { area: ["522"], line: ["522"] }],
  [/byggnad/, { area: ["521"] }],
  [/trappa/, { line: ["532"], area: ["532"] }],
  [/bullerskydd|stodmur|stenmur|bruksmur|kallmur/, { line: ["513"] }],
  [/staket|natstang|trastaket|plank/, { line: ["516", "518"] }],
  [/hogspanning/, { line: ["511", "510"] }],
  [/normalspar|sparnat/, { line: ["509"] }],
  [/trafikanlaggningbro|bro(?:gl|gy|$)/, { area: ["512.1", "512"], line: ["512.1", "512"] }],
  [/dike/, { line: ["306", "305"] }],
  [/back/, { line: ["305"] }],
  [/bassang|plaskdamm/, { area: ["301", "302"] }],
  [/naturmarktradbevuxen/, { area: ["405"] }],
  [/oppennaturmark|grasyta/, { area: ["401"] }],
  [/slatter/, { area: ["403", "401"] }],
  [/buskage|klippthack/, { area: ["408"] }],
  [/belaggning|asfalt|plattor|gatsten|grus/, { area: ["501"] }],
  [/vagutbredning|infart|refug|parkvag/, { area: ["501"] }],
  [/trad/, {}]
];

/**
 * Överskottet i Stockholms lager, som aldrig blir kartobjekt vilken norm kartan än har: text, höjdkurvor, det skymda,
 * fastighetsgränser och liknande, och byggnadernas linjer (`gl`), som ligger bredvid ytorna (`gy`) med samma namn.
 */
export function stockholmOverflow(name: string): boolean {
  if (!isStockholmLayer(name)) return false;
  const geometry = GEOMETRY.exec(name)?.[1];
  const text = normalized(name);
  return geometry === "t" || geometry === "glh" || /skymd/.test(text) || SKIP.test(text)
    || (/byggnad/.test(text) && !/skarmtak/.test(text) && geometry === "gl");
}

/** Tolkningen av ett av Stockholms lagernamn, eller inget om namnet inte följer grammatiken. */
export function stockholmLayer(name: string): StockholmLayer | undefined {
  if (!isStockholmLayer(name)) return undefined;
  if (stockholmOverflow(name)) return { kind: "skip" };
  const text = normalized(name);
  const found = RULES.find(([pattern]) => pattern.test(text));
  if (!found || Object.keys(found[1]).length === 0) return { kind: "skip" };
  return { kind: "symbol", rule: found[1] };
}
