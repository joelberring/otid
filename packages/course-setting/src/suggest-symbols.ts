/**
 * Förslag på kontrollbeskrivning (ADR-0180 beslut 12): kartsymbol → detalj i kolumn D (IOF Control Descriptions 2018).
 *
 * Källor:
 * - Kartsymbolerna: ISOM 2017-2 (IOF, revision 6, januari 2024, avsnitt 3.1–3.6) och ISSprOM 2019-2, kontrollerade mot
 *   omapwiki.orienteering.sport/specifications/isom och /issprom (2026-11-02). Numren och de engelska namnen står i
 *   kommentaren vid varje rad.
 * - Beskrivningssymbolerna: IOF Control Descriptions 2018 (och 2004) med Purple Pens id (`symbols.xml`, BSD), t.ex.
 *   "2.4" sten, "1.10" punkthöjd, "5.13" ruin. Purple Pens id följer IOF:s numrering.
 * - Vilken detalj en kartsymbol motsvarar står inte i någon standard. Tabellen är en egen tolkning av namnen i de två
 *   dokumenten; där en kartsymbol kan betyda flera detaljer står de andra som `alternatives` (visas som alternativ).
 *   Kartsymboler utan motsvarighet (höjdkurvor, sandig mark, odlad mark, kraftledningens yta …) saknas med flit.
 *
 * Ett nummer i filen (OCAD "116.000", "206.001", Mapper "105.1") slås upp på hela numret och sedan på huvudnumret.
 * Kartor med klubbens egna nummer matchas på symbolens namn som reserv (`NAME_FEATURES`), med lägre säkerhet.
 */
import type { DescriptionStandard } from "./types";

/**
 * Hur detaljen beter sig i geometrin, och därmed vilka lägen (kolumn G) som kan föreslås:
 * - OBJECT: litet föremål (sten, träd, torn, röse) – sidan (11.1).
 * - LANDFORM: höjd, punkthöjd – foten (11.14).
 * - HOLE: grop, vattenhål, grotta – kanten (11.2).
 * - STEP: brant, skärning – foten (11.14) eller uppe på (11.11), sidan avgörs av taggarna.
 * - BARRIER: stängsel, mur, häck, rörledning – sidan (11.1), hörnet (11.4/11.5), slutet (11.8).
 * - NETWORK: stig, väg, bäck, dike, fåra, kraftledning – slutet (11.8), korsning och förgrening (kolumn F, 10.1/10.2).
 * - BOUNDARY: beståndsgräns – hörnet och slutet.
 * - GROUND: ytor man står i (sankmark, berg i dagen, belagd yta) – kanten (11.2), hörnet, delen (11.3).
 * - SOLID: ytor man står vid (byggnad, jättesten, sjö) – sidan (11.1) och hörnet.
 * - VEGETATION: öppen mark och tät skog – som GROUND men svagare (sådana ytor finns nästan överallt).
 */
export type FeatureKind = "OBJECT" | "LANDFORM" | "HOLE" | "STEP" | "BARRIER" | "NETWORK" | "BOUNDARY" | "GROUND" | "SOLID" | "VEGETATION";

export interface FeatureRule {
  /** Kolumn D (Purple Pens id, t.ex. "2.4"). */
  readonly d: string;
  /** Kolumn E som symbolen själv säger (t.ex. "8.11" raserad för raserat staket, "8.3" djup för opasserbar sankmark). */
  readonly e?: string | undefined;
  /** Andra detaljer som symbolen kan betyda; visas som alternativ med lägre säkerhet. */
  readonly alternatives?: readonly string[] | undefined;
  /** Vilka objekt i filen regeln gäller (en linje med ett ytnummer matchas inte, utan prövas på namnet). */
  readonly geometry: readonly ("point" | "line" | "area")[];
}

const P = ["point"] as const, L = ["line"] as const, A = ["area"] as const, PA = ["point", "area"] as const, PL = ["point", "line"] as const;
const ALL = ["point", "line", "area"] as const;

/** ISOM 2017-2. Ett huvudnummer gäller alla undernummer som inte står för sig. */
export const ISOM_FEATURES: Readonly<Record<string, FeatureRule>> = {
  // 3.1 Landformer.
  "104": { d: "1.4", geometry: L },                                // Earth bank → Skärning
  "105": { d: "1.6", geometry: L },                                // 105.1 Earth wall, 105.2 Retaining earth wall → Jordvall
  "106": { d: "1.6", e: "8.11", geometry: L },                     // Ruined earth wall → Jordvall, raserad
  "107": { d: "1.7", geometry: L },                                // Erosion gully → Fåra
  "108": { d: "1.8", geometry: L },                                // Small erosion gully → Liten fåra
  "109": { d: "1.10", alternatives: ["1.9"], geometry: P },        // Small knoll → Punkthöjd
  "110": { d: "1.10", alternatives: ["1.9"], geometry: P },        // Small elongated knoll → Punkthöjd
  "111": { d: "1.13", alternatives: ["1.12"], geometry: P },       // Small depression → Liten naturlig grop
  "112": { d: "1.14", geometry: P },                               // Pit → Liten grävd grop
  "113": { d: "1.15", geometry: PA },                              // Broken ground → Småkuperad terräng
  "114": { d: "1.15", geometry: PA },                              // Very broken ground → Småkuperad terräng
  // 3.2 Berg och sten.
  "201": { d: "2.1", geometry: ALL },                              // Impassable cliff → Brant
  "202": { d: "2.1", geometry: PL },                               // Cliff → Brant
  "203": { d: "2.3", alternatives: ["1.14"], geometry: P },        // 203.1 Rocky pit or cave, 203.2 Dangerous pit → Grotta
  "204": { d: "2.4", geometry: P },                                // Boulder → Sten
  "205": { d: "2.4", geometry: P },                                // Large boulder → Sten
  "206": { d: "2.4", alternatives: ["2.2"], geometry: PA },        // Gigantic boulder or rock pillar → Sten (klippa)
  "207": { d: "2.6", geometry: P },                                // Boulder cluster → Stensamling
  "208": { d: "2.5", geometry: PA },                               // Boulder field → Blockterräng
  "209": { d: "2.5", geometry: PA },                               // Dense boulder field → Blockterräng
  "210": { d: "2.7", geometry: PA },                               // Stony ground, slow running → Stenig mark
  "211": { d: "2.7", geometry: PA },                               // Stony ground, walk → Stenig mark
  "212": { d: "2.7", geometry: PA },                               // Stony ground, fight → Stenig mark
  "214": { d: "2.8", geometry: A },                                // Bare rock → Berg i dagen
  "215": { d: "2.10", geometry: L },                               // Trench → Skyttegrav (bara 2018)
  // 3.3 Vatten och sankmark.
  "301": { d: "3.1", alternatives: ["3.2"], geometry: A },         // Uncrossable body of water → Sjö (liten: göl)
  "302": { d: "3.2", geometry: A },                                // Shallow body of water → Göl
  "303": { d: "3.3", geometry: P },                                // Waterhole → Vattenhål
  "304": { d: "3.4", geometry: L },                                // Crossable watercourse → Vattendrag
  "305": { d: "3.4", geometry: L },                                // Small crossable watercourse → Vattendrag
  "306": { d: "3.5", geometry: L },                                // Minor/seasonal water channel → Mindre vattendrag, dike
  "307": { d: "3.7", e: "8.3", geometry: A },                      // Uncrossable marsh → Sankmark, djup
  "308": { d: "3.7", geometry: PA },                               // Marsh → Sankmark
  "309": { d: "3.6", geometry: L },                                // Narrow marsh → Surdrag
  "310": { d: "3.7", geometry: PA },                               // Indistinct marsh → Sankmark
  "311": { d: "3.9", alternatives: ["3.11"], geometry: P },        // Well, fountain or water tank → Brunn
  "312": { d: "3.10", geometry: P },                               // Spring → Källa
  // 3.4 Vegetation.
  "401": { d: "4.1", geometry: A },                                // Open land → Öppen mark
  "402": { d: "4.2", alternatives: ["4.1"], geometry: A },         // Open land with scattered trees → Halvöppen mark
  "403": { d: "4.1", alternatives: ["4.2"], geometry: A },         // Rough open land → Öppen mark
  "404": { d: "4.2", alternatives: ["4.1"], geometry: A },         // Rough open land with scattered trees → Halvöppen mark
  "406": { d: "4.5", geometry: A },                                // Vegetation: slow running → Tät skog
  "407": { d: "4.5", geometry: A },                                // Vegetation: slow running, good visibility → Tät skog
  "408": { d: "4.5", geometry: A },                                // Vegetation: walk → Tät skog
  "409": { d: "4.5", geometry: A },                                // Vegetation: walk, good visibility → Tät skog
  "410": { d: "4.5", geometry: A },                                // Vegetation: fight → Tät skog
  "415": { d: "4.7", geometry: L },                                // Distinct cultivation boundary → Beståndsgräns
  "416": { d: "4.7", geometry: L },                                // Distinct vegetation boundary → Beståndsgräns
  "417": { d: "4.9", geometry: P },                                // Prominent large tree → Särpräglat träd
  "418": { d: "4.9", geometry: P },                                // Prominent bush or tree → Särpräglat träd
  "419": { d: "6.1", alternatives: ["4.10"], geometry: P },        // Prominent vegetation feature (grönt x) → Speciellt föremål (x)
  // 3.5 Vägar, byggnader och andra anläggningar.
  "501": { d: "5.12", geometry: A },                               // Paved area → Asfalt- eller grusyta
  "502": { d: "5.1", geometry: L },                                // Wide road → Väg
  "503": { d: "5.1", geometry: L },                                // Road → Väg
  "504": { d: "5.1", alternatives: ["5.2"], geometry: L },         // Vehicle track → Väg
  "505": { d: "5.2", geometry: L },                                // Footpath → Stig
  "506": { d: "5.2", geometry: L },                                // Small footpath → Stig
  "507": { d: "5.2", geometry: L },                                // Less distinct small footpath → Stig
  "508": { d: "5.3", geometry: L },                                // Narrow ride or linear trace → Rågång
  "509": { d: "5.26", geometry: L },                               // Railway → Järnväg (bara 2018)
  "510": { d: "5.5", geometry: L },                                // Power line, cableway or skilift → Kraftledning
  "511": { d: "5.5", geometry: L },                                // Major power line → Kraftledning
  "512": { d: "5.4", alternatives: ["5.7"], geometry: PL },        // Bridge / tunnel → Bro (tunnel)
  "513": { d: "5.8", geometry: L },                                // 513.1 Wall, 513.2 Retaining wall → Stenmur
  "514": { d: "5.8", e: "8.11", geometry: L },                     // Ruined wall → Stenmur, raserad
  "515": { d: "5.8", geometry: L },                                // Impassable wall → Stenmur
  "516": { d: "5.9", geometry: L },                                // Fence → Stängsel
  "517": { d: "5.9", e: "8.11", geometry: L },                     // Ruined fence → Stängsel, raserad
  "518": { d: "5.9", geometry: L },                                // Impassable fence → Stängsel
  "519": { d: "5.10", geometry: P },                               // Crossing point → Genomgång
  "520": { d: "5.25", geometry: A },                               // Area that shall not be entered → Förbjudet område (bara 2018)
  "521": { d: "5.11", geometry: PA },                              // Building → Byggnad
  "523": { d: "5.13", geometry: ALL },                             // Ruin → Ruin
  "524": { d: "5.15", geometry: P },                               // High tower → Torn
  "525": { d: "5.16", alternatives: ["5.15"], geometry: P },       // Small tower → Jakttorn
  "526": { d: "5.17", geometry: P },                               // Cairn → Röse
  "527": { d: "5.18", geometry: P },                               // Fodder rack → Foderhäck
  "530": { d: "6.2", geometry: P },                                // Prominent man-made feature – ring → Speciellt föremål (o)
  "531": { d: "6.1", geometry: P },                                // Prominent man-made feature – x → Speciellt föremål (x)
  "532": { d: "5.24", geometry: L }                                // Stairway → Trappa
};

/**
 * ISSprOM 2019-2: det som skiljer sig (läggs ovanpå `ISOM_FEATURES` för sprintkartor). 105.1 Small earth wall,
 * 201 Uncrossable cliff, 202 Passable rock face, 411 Uncrossable vegetation, 501.1/501.2 Step or edge of paved area
 * (linjer, ingen egen detalj: Asfalt- eller grusyta), 509.1 Railway, 509.2 Tramway, 512.1 Bridge or tunnel entrance,
 * 512.2 Underpass or tunnel, 513.1 Passable wall, 516 Passable fence or railing, 522.1 Pillar, 526 Cairn, memorial,
 * sculpture, small monument or boundary stone.
 */
export const ISSPROM_FEATURES: Readonly<Record<string, FeatureRule>> = {
  "411": { d: "4.5", alternatives: ["4.6"], geometry: ["area", "line"] }, // Uncrossable vegetation → Tät skog (häck)
  "501.1": { d: "5.12", geometry: L },
  "501.2": { d: "5.12", geometry: L },
  "509.1": { d: "5.26", geometry: L },
  "509.2": { d: "5.26", geometry: L },
  "512.1": { d: "5.4", alternatives: ["5.7"], geometry: ["point", "line", "area"] },
  "512.2": { d: "5.7", alternatives: ["5.23"], geometry: ["point", "line", "area"] },
  "526": { d: "5.17", alternatives: ["5.20"], geometry: P }
};

/** Detaljens slag (kolumn D, Purple Pens id) → hur geometrin tolkas. */
export const FEATURE_KIND: Readonly<Record<string, FeatureKind>> = {
  "1.1": "GROUND", "1.2": "LANDFORM", "1.3": "HOLE", "1.4": "STEP", "1.5": "HOLE", "1.6": "BARRIER", "1.7": "NETWORK", "1.8": "NETWORK",
  "1.9": "LANDFORM", "1.10": "LANDFORM", "1.11": "LANDFORM", "1.12": "HOLE", "1.13": "HOLE", "1.14": "HOLE", "1.15": "GROUND",
  "1.16": "OBJECT",
  "2.1": "STEP", "2.2": "OBJECT", "2.3": "HOLE", "2.4": "OBJECT", "2.5": "GROUND", "2.6": "OBJECT", "2.7": "GROUND", "2.8": "GROUND",
  "2.9": "HOLE", "2.10": "NETWORK",
  "3.1": "SOLID", "3.2": "SOLID", "3.3": "HOLE", "3.4": "NETWORK", "3.5": "NETWORK", "3.6": "NETWORK", "3.7": "GROUND", "3.8": "GROUND",
  "3.9": "OBJECT", "3.10": "OBJECT", "3.11": "OBJECT",
  "4.1": "VEGETATION", "4.2": "VEGETATION", "4.3": "VEGETATION", "4.4": "VEGETATION", "4.5": "VEGETATION", "4.6": "BARRIER",
  "4.7": "BOUNDARY", "4.8": "VEGETATION", "4.9": "OBJECT", "4.10": "OBJECT",
  "5.1": "NETWORK", "5.2": "NETWORK", "5.3": "NETWORK", "5.4": "OBJECT", "5.5": "NETWORK", "5.6": "OBJECT", "5.7": "OBJECT",
  "5.8": "BARRIER", "5.9": "BARRIER", "5.10": "OBJECT", "5.11": "SOLID", "5.12": "GROUND", "5.13": "SOLID", "5.14": "BARRIER",
  "5.15": "OBJECT", "5.16": "OBJECT", "5.17": "OBJECT", "5.18": "OBJECT", "5.19": "GROUND", "5.20": "OBJECT", "5.23": "OBJECT",
  "5.24": "NETWORK", "5.25": "GROUND", "5.26": "NETWORK", "6.1": "OBJECT", "6.2": "OBJECT"
};

/**
 * Reserv för kartor med egna nummer: symbolens namn (svenska SOFT-namn och ISOM:s engelska), första träffen gäller.
 * Längre och mer bestämda namn står först ("stenmur" före "sten", "drivningsväg" före "väg"). Namn på höjdkurvor,
 * lutningsstreck och text matchas aldrig.
 */
export const NAME_FEATURES: readonly (readonly [RegExp, FeatureRule])[] = [
  [/höjdkurva|stödkurva|hjälpkurva|lutningsstreck|contour|form line|slope line|nordlinje|north line|text|ram|frame/i, { d: "", geometry: [] }],
  [/stenmur|\bmur\b|\bwall\b/i, { d: "5.8", geometry: L }],
  [/jordvall|earth wall/i, { d: "1.6", geometry: L }],
  [/skärning|earth bank/i, { d: "1.4", geometry: L }],
  [/stengrupp|grupp av stenar|stensamling|boulder cluster/i, { d: "2.6", geometry: P }],
  [/blockterräng|boulder field/i, { d: "2.5", geometry: PA }],
  [/stenig|stony/i, { d: "2.7", geometry: PA }],
  [/berg i dagen|hällmark|bare rock/i, { d: "2.8", geometry: A }],
  [/\bsten\b|stenblock|boulder/i, { d: "2.4", geometry: PA }],
  [/brant|cliff|rock face/i, { d: "2.1", geometry: PL }],
  [/grotta|\bcave\b/i, { d: "2.3", geometry: P }],
  [/punkthöjd|knoll/i, { d: "1.10", geometry: P }],
  [/grävd grop|\bpit\b/i, { d: "1.14", geometry: P }],
  [/\bgrop\b|depression/i, { d: "1.13", geometry: P }],
  [/kolbotten|charcoal/i, { d: "5.19", geometry: PA }],
  [/myrstack|ant hill/i, { d: "1.16", geometry: P }],
  [/fåra|ränna|gully/i, { d: "1.7", geometry: L }],
  [/surdrag|narrow marsh/i, { d: "3.6", geometry: L }],
  [/sankmark|\bmyr\b|kärr|marsh/i, { d: "3.7", geometry: PA }],
  [/källa|\bspring\b/i, { d: "3.10", geometry: P }],
  [/brunn|\bwell\b/i, { d: "3.9", geometry: P }],
  [/vattenhål|waterhole/i, { d: "3.3", geometry: P }],
  [/vattentank|water tank/i, { d: "3.11", geometry: P }],
  [/\bdike\b|ditch|water channel/i, { d: "3.5", geometry: L }],
  [/bäck|\bå\b|vattendrag|stream|watercourse/i, { d: "3.4", geometry: L }],
  [/\bgöl\b|\bpond\b/i, { d: "3.2", geometry: A }],
  [/\bsjö\b|\blake\b/i, { d: "3.1", geometry: A }],
  [/rågång|drivningsväg|\bride\b/i, { d: "5.3", geometry: L }],
  [/\bstig\b|path|track/i, { d: "5.2", geometry: L }],
  [/\bväg\b|\broad\b/i, { d: "5.1", geometry: L }],
  [/järnväg|railway|spårväg|tramway/i, { d: "5.26", geometry: L }],
  [/kraftledning|power line/i, { d: "5.5", geometry: L }],
  [/rörledning|pipeline/i, { d: "5.14", geometry: L }],
  [/staket|stängsel|fence|railing/i, { d: "5.9", geometry: L }],
  [/grind|genomgång|crossing point|\bgate\b/i, { d: "5.10", geometry: P }],
  [/\bbro\b|spång|bridge/i, { d: "5.4", geometry: PL }],
  [/tunnel|undergång|underpass/i, { d: "5.7", geometry: PL }],
  [/trappa|stair/i, { d: "5.24", geometry: L }],
  [/byggnad|building/i, { d: "5.11", geometry: PA }],
  [/ruin/i, { d: "5.13", geometry: ALL }],
  [/jakttorn|shooting platform/i, { d: "5.16", geometry: P }],
  [/\btorn\b|tower/i, { d: "5.15", geometry: P }],
  [/röse|gränssten|cairn|boundary stone/i, { d: "5.17", geometry: P }],
  [/minnessten|monument|staty|statue|sculpture/i, { d: "5.20", geometry: P }],
  [/foderhäck|fodder rack/i, { d: "5.18", geometry: P }],
  [/rotvälta|stubbe|root stock|stump/i, { d: "4.10", geometry: P }],
  [/\bhäck\b|hedge/i, { d: "4.6", geometry: L }],
  [/beståndsgräns|begränsningslinje|vegetation boundary|cultivation boundary/i, { d: "4.7", geometry: L }],
  [/\bträd\b|\bbuske\b|\btree\b|\bbush\b/i, { d: "4.9", geometry: P }],
  [/förbjudet|out-of-bounds|out of bounds|rabatt|flower bed|shall not be entered/i, { d: "5.25", geometry: A }],
  [/belagd yta|asfalt|grusyta|paved/i, { d: "5.12", geometry: A }],
  [/glänta|clearing/i, { d: "4.4", geometry: A }],
  [/dunge|copse/i, { d: "4.8", geometry: A }],
  [/tät skog|svårframkomlig|thicket|fight/i, { d: "4.5", geometry: A }],
  [/öppen mark|open land/i, { d: "4.1", geometry: A }]
];

/** Detaljer som bara finns i en av standarderna (Purple Pens `standard` på symbolen). */
export const ONLY_IN: Readonly<Record<string, DescriptionStandard>> = { "2.10": "2018", "5.25": "2018", "5.26": "2018" };

export interface FeatureLookup { readonly rule: FeatureRule; readonly by: "NUMBER" | "NAME" }

/**
 * Mönstren med ordgräns som förstår å, ä och ö (JavaScripts `\b` räknar dem som skiljetecken, så "\bå\b" skulle träffa
 * "minimimått").
 */
const UNICODE_NAME_FEATURES = NAME_FEATURES.map(([pattern, rule]) =>
  [new RegExp(pattern.source.replaceAll("\\b", "(?:(?<!\\p{L})(?=\\p{L})|(?<=\\p{L})(?!\\p{L}))"), "iu"), rule] as const);

/** Namnets regel (första träffen), eller undefined; höjdkurvor, nordlinjer och text ger ingen. */
function byName(name: string): FeatureRule | undefined {
  for (const [pattern, rule] of UNICODE_NAME_FEATURES) if (pattern.test(name)) return rule.d ? rule : undefined;
  return undefined;
}

/** "104.0" → "104", "105.100" → "105.1" (OCAD lagrar tre decimaler), "206.1" orört. */
export function normalizedCode(text: string): string {
  return text.trim().replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/**
 * Regeln för en kartsymbol och objektets geometri: numret först (sprinttabellen före ISOM när kartan är sprint; hela
 * numret före huvudnumret), sedan namnet. Ett nummer vars regel inte gäller geometrin (t.ex. en linje "410.2 Häck" i en
 * karta där 410 är en yta) prövas på namnet i stället. Säger namnet en av numrets alternativa detaljer (t.ex. "Tunnel" på
 * 512 Bro/tunnel) blir den förstahandsvalet.
 */
export function featureRuleFor(code: { readonly text: string; readonly main: number; readonly sub: number }, name: string,
  geometry: "point" | "line" | "area", sprint: boolean): FeatureLookup | undefined {
  // Höjdkurvorna och deras lutningsstreck (101–103) och nordlinjerna (601) är aldrig en detalj, oavsett namnet.
  if ((code.main >= 101 && code.main <= 103) || code.main === 601) return undefined;
  const text = normalizedCode(code.text);
  const keys = [text, `${code.main}.${code.sub}`, String(code.main)];
  const tables = sprint ? [ISSPROM_FEATURES, ISOM_FEATURES] : [ISOM_FEATURES];
  for (const table of tables) {
    for (const key of keys) {
      const rule = table[key];
      if (!rule || !rule.geometry.includes(geometry)) continue;
      const named = rule.alternatives ? byName(name) : undefined;
      if (named && rule.alternatives?.includes(named.d)) {
        return { rule: { ...rule, d: named.d, alternatives: [rule.d, ...rule.alternatives.filter(d => d !== named.d)] }, by: "NUMBER" };
      }
      return { rule, by: "NUMBER" };
    }
  }
  const named = byName(name);
  return named && named.geometry.includes(geometry) ? { rule: named, by: "NAME" } : undefined;
}
