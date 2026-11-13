import { codeParts, type MapNorm } from "./map-norm";
import { stockholmOverflow } from "./stockholm-layers";

/**
 * Grundkartans regler lager → symbol för sprintkartor (ägaren 2026-11-13: «utmaningen med sprint är att få till bebyggelse,
 * gator, avgränsningar för ytor»). Skogskartans regler (`KEYWORDS` i `vector-import.ts`) gäller fortfarande för det som är
 * lika i normerna (kurvor, branter, vatten, öppen mark, grönt); här finns det som skiljer: bebyggelsen, belagda ytor och deras
 * kanter, staket, murar, häckar, trappor, tomtmark och träd.
 *
 * Reglerna matchar nyckelord i lagrets namn (versaler utan å, ä och ö), eftersom en kommunal grundkarta som DWG/DXF har
 * lagernamn i många former: Stockholms grammatik (`MarkanlaggningStaketglB…`), klartext (`STAKET`, `Vägkant`) och CAD-
 * förkortningar (`STK`, `KS`, `VK`). Symbolen väljs sedan efter roll i kartans egen uppsättning, via nummer OCH namn:
 * OCAD-uppsättningar numrerar underkoderna olika (kant belagd yta är 501.1 i O-Tids mall och 501.100 i OCAD:s ISSprOM, där
 * 501.1 är en yta; passerbar mur är 513 eller 513.100), och den äldre sprintnormen (ISSOM 2007) har andra nummer.
 *
 * Förvalen följer mätningen mot en riktig sprintkarta (learn-data/sprint/proto/RESULTAT.md) och Bandhagen–Hagsätra som
 * förebild: byggnaderna stämmer bäst; kant belagd yta tas ur vägkant, infart och refug; staketens höjd och öppningar avgörs
 * på plats, så staket och mur föreslås som passerbara och bara det som namnet säger är högt blir opasserbart.
 */
export type SprintNorm = Exclude<MapNorm, "ISOM">;
type Kind = "point" | "line" | "area";
export interface SprintSymbol { readonly id: string; readonly code: string; readonly kind: string; readonly name?: string | undefined }

/** En önskad symbol: numret, och namnet som går före numret när kartans uppsättning har flera med samma huvudnummer. */
interface Want { readonly code: string; readonly name?: RegExp; readonly avoid?: RegExp }

/** Rollerna i en sprintkarta och var de finns i de två sprintnormerna, det bästa först. */
const ROLES = {
  building: { ISSPROM: [{ code: "521" }], ISSOM: [{ code: "526.1" }, { code: "526" }] },
  canopy: { ISSPROM: [{ code: "522" }], ISSOM: [{ code: "526.2" }] },
  fence: { ISSPROM: [{ code: "516" }], ISSOM: [{ code: "522" }] },
  highFence: { ISSPROM: [{ code: "518" }], ISSOM: [{ code: "524" }] },
  wall: { ISSPROM: [{ code: "513", avoid: /retain|st[öo]dmur/i }, { code: "513" }], ISSOM: [{ code: "519.1" }, { code: "519" }] },
  retainingWall: { ISSPROM: [{ code: "513", name: /retain|st[öo]dmur/i }], ISSOM: [{ code: "519.1" }, { code: "519" }] },
  highWall: { ISSPROM: [{ code: "515" }], ISSOM: [{ code: "521.1" }, { code: "521" }] },
  stairs: { ISSPROM: [{ code: "532" }], ISSOM: [{ code: "529.2", name: /trapp|stair/i, avoid: /kontur|kant|edge/i }] },
  // Häcken som linje: opasserbar vegetation (411, i ISSOM 421) först, som 246 av 320 häcklinjer i förebilden; annars den
  // tätaste gröna linjen som kartan har (410, 408, 406).
  hedge: { ISSPROM: [{ code: "411" }, { code: "410" }, { code: "408" }, { code: "406" }], ISSOM: [{ code: "421" }, { code: "410" }, { code: "408" }, { code: "406" }] },
  // Kant belagd yta: linjen som heter kant eller «step or edge of paved area» bland 501-linjerna (inte «paved footpath»),
  // annars underkoden .1 (i OCAD .100).
  pavedEdge: { ISSPROM: [{ code: "501.1", name: /edge|kant|kontur/i, avoid: /l[äa]gre|lower|multilevel/i }, { code: "501.1" }],
    ISSOM: [{ code: "529.1" }] },
  paved: { ISSPROM: [{ code: "501" }], ISSOM: [{ code: "529" }] },
  forbidden: { ISSPROM: [{ code: "520" }], ISSOM: [{ code: "527.1" }, { code: "528.1" }, { code: "527" }, { code: "528" }] },
  largeTree: { ISSPROM: [{ code: "417" }, { code: "418" }], ISSOM: [{ code: "418" }, { code: "419" }] },
  smallTree: { ISSPROM: [{ code: "418" }, { code: "417" }], ISSOM: [{ code: "419" }, { code: "418" }] },
  path: { ISSPROM: [{ code: "505" }], ISSOM: [{ code: "506.1" }, { code: "507" }] },
  smallPath: { ISSPROM: [{ code: "506" }, { code: "505" }], ISSOM: [{ code: "507" }, { code: "506.1" }] },
  bridge: { ISSPROM: [{ code: "512.1" }, { code: "512" }], ISSOM: [{ code: "512.1" }, { code: "512" }] },
  water: { ISSPROM: [{ code: "301" }, { code: "302" }], ISSOM: [{ code: "304.1" }, { code: "305.1" }] }
} as const satisfies Record<string, Record<SprintNorm, readonly Want[]>>;
type Role = keyof typeof ROLES;

interface SprintRule {
  readonly words: RegExp;
  readonly line?: readonly Role[]; readonly area?: readonly Role[]; readonly point?: readonly Role[];
  /** Regeln gäller bara lager som mest består av punkter (träd); andra lager går vidare till skogskartans regler. */
  readonly pointsOnly?: true;
  /** Bara lagrets främsta form prövas: en häck som linje ska inte bli en yta när kartan saknar häcklinje. */
  readonly firstKindOnly?: true;
}

/** En förkortning som eget ord (inte mitt i ett annat ord). */
const word = (text: string) => `(?<![A-Z])(?:${text})(?![A-Z])`;

/**
 * Lagrets namn → roll, första träffen gäller (de mer bestämda först). En regel utan roll betyder «ingen symbol»: lagret
 * lämnas åt kartritaren.
 */
const SPRINT_RULES: readonly SprintRule[] = [
  // Marktäckets bebyggelseyta får inget förslag (som på skogskartan).
  { words: /BEBYGGELSE/ },
  // Tomtmark (laserjobbets tomter och OpenStreetMaps bostadsområden): område som inte får beträdas.
  { words: /TOMTMARK|TOMTYTA|OUT_?OF_?BOUNDS/, area: ["forbidden"] },
  // Kanten på en belagd yta som vi själva räknat ur OpenStreetMaps vägar, före ytan med nästan samma namn.
  { words: /KANT BELAGD YTA/, line: ["pavedEdge"] },
  // Trappa och terrängtrappa, före byggnad («ByggnadsanlaggningTrappa»).
  { words: /TRAPP|STAIR|STEPS/, line: ["stairs"] },
  // Skärmtak, tak och carport, före byggnad och staket («TAK» som eget ord, inte i «STAKET»).
  { words: new RegExp(`SKARMTAK|CARPORT|CANOPY|ROOF|${word("TAK")}`), area: ["canopy"] },
  // Altan: ingen symbol. Den hör till huset eller tomten (520) och syns inte som eget föremål på en sprintkarta.
  { words: /ALTAN|VERANDA|UTEPLATS/ },
  // Bassäng och plaskdamm: vatten som inte får passeras (301), annars passerbart (302).
  { words: /BASSANG|PLASKDAMM|POOL/, area: ["water"] },
  // Perrong: en belagd yta med kant; om den får beträdas (spårområdet är 520) avgörs på plats.
  { words: /PERRONG|PLATFORM/, area: ["paved"], line: ["pavedEdge"] },
  // Byggnadsanläggning utan känd undertyp: ingen symbol (det är inte ett hus).
  { words: /BYGGNADSANLAGGNING/ },
  { words: new RegExp(`HUS|BYGG|FASAD|BUILDING|${word("BYG")}`), area: ["building"] },
  // Opasserbart: det som namnet säger är högt, och bullerskydd och plank, som alltid är det.
  { words: /BULLER|PLANK|HIGH_?FENCE|IMPASSABLE_?FENCE|(?=.*(STAKET|STANGSEL))(?=.*(OPASSERBAR|(?<![A-Z])HOGT?(?![A-Z])))/, line: ["highFence"] },
  // Staket, stängsel och räcke: passerbart som förval, höjden avgörs på plats.
  { words: new RegExp(`STAKET|STANGSEL|RACKE|FENCE|RAILING|${word("STK")}`), line: ["fence"] },
  { words: /HIGH_?WALL|IMPASSABLE_?WALL|CITY_?WALL|(?=.*MUR)(?=.*(OPASSERBAR|(?<![A-Z])HOGT?(?![A-Z])))/, line: ["highWall"] },
  // Mur, stödmur och stenmur: passerbar som förval.
  { words: /STODMUR|RETAINING/, line: ["retainingWall", "wall"] },
  { words: /MUR|WALL/, line: ["wall"] },
  // Häck, plantering och buskage: som linje häcksymbolen, som yta opasserbar vegetation (i ISSOM 421), annars det tätaste
  // gröna. Har kartan ingen grön linjesymbol (O-Tids mall) får häcklinjen inget förslag: ingen annan linje ligger nära.
  { words: /HACK|HEDGE|PLANTERING|BUSKAGE|RABATT/, line: ["hedge"], area: ["hedge"], firstKindOnly: true },
  // Kanter: vägkant, kantsten, infart och refug är linjer, aldrig ytor (en sluten kantlinje runt ett kvarter ska inte fyllas).
  { words: new RegExp(`KANTST|CURB|KERB|VAGKANT|INFART|REFUG|BELAGGNINGSKANT|ASFALTKANT|KORBANEKANT|GANGBANEKANT|TROTTOARKANT|GC_?KANT|${word("VK|KS|KST")}`),
    line: ["pavedEdge"] },
  // Belagda ytor: som yta 501, och deras linjer är kanten på ytan.
  { words: /VAGUTBREDNING|PARKVAG|VAGYTA|GANGYTA|GANGBANA|CYKELBANA|KORBANA|TROTTOAR|TORG|PARKERING|PARKING|ASFALT|PAVED|BELAGD YTA|BELAGGNING/,
    area: ["paved"], line: ["pavedEdge"] },
  // Bro: brons kantlinjer (512.1, annars 512); ingen yta.
  { words: new RegExp(`ANLAGGNINGBRO|GANGBRO|BRIDGE|${word("BRO")}`), line: ["bridge"] },
  // Slänt: ingen symbol. Släntens linjer gör ingen nytta för ytorna (mätningen), och jordbranten (104) behöver veta vad som
  // är krön och fot.
  { words: /SLANT/ },
  // Obelagda vägar och stigar förblir linjer: traktorväg och obelagd väg 505, stig 506.
  { words: /TRAKTORVAG|OBELAGD|GRUSVAG|\(TRACK\)/, line: ["path"] },
  { words: new RegExp(`OSM STIG|${word("STIG|PATH")}`), line: ["smallPath"] },
  // Träd som punkter: stort träd 417 när namnet säger det, annars 418 (buske eller litet träd).
  { words: /(STOR\w*[_ ]?TRAD|TRAD\w*[_ (]*STOR|LARGE_?TREE|BIG_?TREE)/, point: ["largeTree"], pointsOnly: true },
  { words: /TRAD(?!BEVUX|GARD|RAD)|(?<![A-Z])TREE(?!_?ROW)/, point: ["smallTree"], pointsOnly: true }
];

/**
 * Skogskartans nummer (ISOM 2017-2, som skogsreglerna föreslår) i den äldre sprintnormen ISSOM 2007. Nummer som saknas här
 * får inget förslag: samma nummer betyder ofta något annat där (516 är kraftledning, 509 rågång, 204 stenbrott).
 */
const ISSOM_CODES: Readonly<Record<string, readonly string[]>> = {
  "101": ["101"], "102": ["102"], "103": ["103"], "101.1": ["104"], "104": ["106"], "109": ["112"], "111": ["115"],
  "201": ["201"], "202": ["203"], "202.1": ["203"], "204": ["206"], "205": ["207"], "214": ["212"],
  "301": ["304.1"], "301.1": ["304.3"], "302": ["305.1"], "305": ["306"], "306": ["307"], "308": ["310"], "309": ["308"], "310": ["311"],
  "401": ["401"], "402": ["402"], "403": ["403"], "404": ["404"], "405": ["405"], "406": ["406"], "407": ["407"], "408": ["408"],
  "409": ["409"], "410": ["410"], "411": ["421"], "412": ["415"], "413": ["412"], "416": ["416"], "417": ["418"], "418": ["419"],
  "501": ["529"], "501.1": ["529.1"], "505": ["506.1", "507"], "506": ["507"], "507": ["508"], "509": ["515.1"], "510": ["516"], "511": ["517"],
  "512": ["512.1"], "512.1": ["512.1"], "513": ["519.1", "519"], "515": ["521.1"], "516": ["522"], "518": ["524"],
  "520": ["527.1", "528.1"], "521": ["526.1", "526"], "522": ["526.2"], "532": ["529.2"]
};

const lowestSub = (symbols: readonly SprintSymbol[]) => [...symbols].sort((a, b) => codeParts(a.code).sub - codeParts(b.code).sub
  || (a.name?.length ?? 0) - (b.name?.length ?? 0))[0];

/**
 * Symbolen i kartans uppsättning för ett önskat nummer och en form. Först namnet (bland symbolerna med samma huvudnummer),
 * sedan numret exakt; en underkod .1 finns i OCAD som .100. Ett helt nummer («513») som saknas ger den lägsta underkoden med
 * samma huvudnummer och form («513.100 Passable wall»).
 */
function findSymbol(symbols: readonly SprintSymbol[], kind: Kind, want: Want): SprintSymbol | undefined {
  const { main, sub } = codeParts(want.code);
  const same = symbols.filter(symbol => symbol.kind === kind && codeParts(symbol.code).main === main
    && !(want.avoid && symbol.name && want.avoid.test(symbol.name)));
  if (want.name) {
    const named = same.filter(symbol => symbol.name && want.name!.test(symbol.name));
    if (named.length) return lowestSub(named);
    if (sub === 0) return undefined;
  }
  for (const wanted of sub === 0 ? [0] : [sub, sub * 100]) {
    const hit = same.filter(symbol => codeParts(symbol.code).sub === wanted);
    if (hit.length) return lowestSub(hit);
  }
  return sub === 0 ? lowestSub(same) : undefined;
}

/** Symbolen för ett av skogsreglernas nummer på en sprintkarta (i den äldre normen översatt till dess nummer). */
export function sprintSymbolForCode(symbols: readonly SprintSymbol[], kind: Kind, code: string, norm: SprintNorm): string | undefined {
  const codes = norm === "ISSOM" ? ISSOM_CODES[code.replace(/\.0+$/, "")] ?? [] : [code];
  for (const wanted of codes) {
    const found = findSymbol(symbols, kind, { code: wanted });
    if (found) return found.id;
  }
  return undefined;
}

const normalized = (name: string) => name.toUpperCase().replace(/[ÅÄ]/g, "A").replace(/Ö/g, "O");
/** Stockholms anläggningar vid hus (trappa, skärmtak) har linjer som ska med, fast byggnadernas linjer annars är överskott. */
const STOCKHOLM_KEPT = /ANLAGGNING(TRAPPA|SKARMTAK)/;

/**
 * Sprintreglernas förslag för ett lager. `{ symbol }` när en regel gäller (symbolen saknas när regeln säger «ingen symbol»
 * eller kartan inte har någon passande); `undefined` när ingen sprintregel gäller och skogskartans regler ska prövas.
 * `wanted` är formerna i den ordning lagrets objekt talar för.
 */
export function sprintLayerSymbol(layerName: string, wanted: readonly Kind[], symbols: readonly SprintSymbol[], norm: SprintNorm)
  : { readonly symbol: string | undefined } | undefined {
  const name = normalized(layerName);
  if (stockholmOverflow(layerName) && !STOCKHOLM_KEPT.test(name)) return { symbol: undefined };
  const rule = SPRINT_RULES.find(row => row.words.test(name) && (!row.pointsOnly || wanted[0] === "point"));
  if (!rule) return undefined;
  for (const kind of rule.firstKindOnly ? wanted.slice(0, 1) : wanted) {
    for (const role of rule[kind] ?? []) {
      for (const want of ROLES[role][norm]) {
        const found = findSymbol(symbols, kind, want);
        if (found) return { symbol: found.id };
      }
    }
  }
  return { symbol: undefined };
}
