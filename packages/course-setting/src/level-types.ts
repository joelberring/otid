/**
 * Nivåstödet (ADR-0212): Svensk Orienterings färgnivåer och banans målnivå. Ren TypeScript utan I/O.
 *
 * Källa: SOFT, "Klasser, svårighetsnivåer, beräknade segrartider samt banlängder" (2022-03-25), avsnitt 2–4. Blå och
 * Svart har samma tekniska svårighet ("anpassad till de skickligaste"); skillnaden är fysisk (Svart: all typ av terräng).
 * Nivåstödet bedömer bara det tekniska, så Blå och Svart är samma steg (`levelRank`). Sprint har ingen färgskala.
 */
import type { Point } from "@o-tid/map-file";

export const COURSE_LEVELS = ["GRON", "VIT", "GUL", "ORANGE", "VIOLETT", "BLA", "SVART"] as const;
export type CourseLevel = typeof COURSE_LEVELS[number];

/** Teknisk svårighet 0–5: Grön 0, Vit 1, Gul 2, Orange 3, Violett 4, Blå och Svart 5. */
export type LevelRank = 0 | 1 | 2 | 3 | 4 | 5;

export function levelRank(level: CourseLevel): LevelRank {
  return Math.min(5, COURSE_LEVELS.indexOf(level)) as LevelRank;
}

export const isCourseLevel = (value: unknown): value is CourseLevel => typeof value === "string" && (COURSE_LEVELS as readonly string[]).includes(value);

/**
 * Målnivån ur klassernas namn (SOFT 2022, avsnitt 3–4): H/D10 Vit, 12 Gul, 14 Orange, 16 Violett, 18–65 Svart, 70 och
 * äldre Blå; öppna klasser Inskolning Grön, Mycket lätt Vit, Lätt Gul, Medelsvår Orange, Svår Blå (3 km) eller Svart
 * (5 och 7 km). Flera klasser med olika nivå: den svåraste (banan ska passa alla, och den svåraste är oftast den man
 * lägger efter). Inget känt namn: undefined.
 */
export function levelFromClassNames(names: readonly string[]): CourseLevel | undefined {
  let best: CourseLevel | undefined;
  for (const name of names) {
    const level = levelOfClass(name);
    if (level && (!best || COURSE_LEVELS.indexOf(level) > COURSE_LEVELS.indexOf(best))) best = level;
  }
  return best;
}

/** Ordet som helt ord (JavaScripts `\b` räknar å, ä och ö som skiljetecken). */
const word = (text: string) => new RegExp(`(?<!\\p{L})(?:${text})(?!\\p{L})`, "u");
const WORDS: readonly [RegExp, CourseLevel][] = [
  [word("inskolning"), "GRON"], [word("mycket lätt|mycket latt"), "VIT"], [word("medelsvår|medelsvar"), "ORANGE"],
  [word("lätt|latt"), "GUL"], [word("grön"), "GRON"], [word("vit"), "VIT"], [word("gul"), "GUL"], [word("orange"), "ORANGE"],
  [word("violett"), "VIOLETT"], [word("blå"), "BLA"], [word("svart"), "SVART"]
];

function levelOfClass(raw: string): CourseLevel | undefined {
  const name = raw.trim().toLowerCase().replace(/\s+/g, " ");
  // Svår 3 km är Blå, Svår 5 och 7 km Svart (SOFT 2022, avsnitt 4).
  if (word("svår|svar").test(name)) return /(?<![\d,])3(,0)? ?km/.test(name) ? "BLA" : "SVART";
  for (const [pattern, level] of WORDS) if (pattern.test(name)) return level;
  // H21, D16, HD12, DH14, H10K, D70 …
  const age = /^(?:h|d|hd|dh) ?(\d{2})/.exec(name);
  if (!age) return undefined;
  const years = Number(age[1]);
  if (years <= 10) return "VIT";
  if (years <= 12) return "GUL";
  if (years <= 14) return "ORANGE";
  if (years <= 16) return "VIOLETT";
  if (years < 70) return "SVART";
  return "BLA";
}

/** Storleken på kontrollens föremål: LINE = ledstången själv (stig, dike …), UNKNOWN = inget att gå på. */
export type FeatureSize = "BIG" | "MEDIUM" | "SMALL" | "LINE" | "UNKNOWN";
/** Ledstångens slag: STRONG = väg, stig, staket, mur, bäck, kraftledning, öppen marks kant; WEAK = dike, liten stig, beståndsgräns … */
export type HandrailKind = "STRONG" | "WEAK";

/** Det som mäts vid en kontroll (meter i terrängen; `undefined` = inget inom sökavståndet). */
export interface ControlLevelFeatures {
  readonly control: string;
  /** Avståndet till närmaste tydliga ledstång (0 i öppen mark). */
  readonly strongMeters: number | undefined;
  /** Avståndet till närmaste ledstång av något slag (0 i öppen mark). */
  readonly handrailMeters: number | undefined;
  readonly feature: {
    readonly size: FeatureSize;
    /** Kolumn D (Purple Pens id) från beskrivningen, annars kartobjektets tolkning. */
    readonly d?: string | undefined;
    readonly source: "DESCRIPTION" | "MAP" | "NONE";
    /** Kartsymbolens nummer och namn när föremålet kommer från kartan. */
    readonly code?: string | undefined;
    readonly name?: string | undefined;
  };
  /** Närmaste stora och tydliga föremål eller tydliga ledstång (angreppspunkt), utom kontrollens eget föremål. */
  readonly attackMeters: number | undefined;
  /** Närmaste föremål att läsa in sig på (ledstång, stort eller medelstort föremål), utom kontrollens eget. */
  readonly relocationMeters: number | undefined;
  /**
   * Terrängen runt kontrollen inom `LEVEL_LIMITS.control.terrainMeters` (ägaren 2026-11-10: svåra lägen i bergig, detaljrik
   * terräng fick för låg nivå): `detail` = föremål + linjedetaljer + höjdkurvornas längd / `contourMetersPerDetail`;
   * `similar` = föremål av samma slag som kontrollens (utom det egna), som man kan förväxla det med.
   */
  readonly terrain: { readonly detail: number; readonly similar: number };
  /** Förslag på kartan: närmaste stigkorsning, närmaste punkt på en tydlig ledstång, närmaste stora föremål. */
  readonly candidates: { readonly junction?: Point | undefined; readonly handrail?: Point | undefined; readonly bigFeature?: Point | undefined };
}

/** Det som mäts längs en sträckas bästa vägval. */
export interface LegLevelFeatures {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly meters: number;
  /** Andel av vägen längs tydliga ledstänger eller i öppen mark (0–1). */
  readonly strongShare: number;
  /** Andel av vägen längs ledstänger av något slag eller i öppen mark. */
  readonly handrailShare: number;
  /** Längsta biten utan tydlig ledstång respektive utan någon ledstång (m). */
  readonly longestOffStrongMeters: number;
  readonly longestOffMeters: number;
  /** Byten mellan ledstänger längs vägen (vägvalspunkter). */
  readonly decisions: number;
  /** Stigkorsningar som vägen passerar (stignätets täthet). */
  readonly junctions: number;
  /** Skilda vägval inom 10 % av det bästa (verkliga vägval). */
  readonly closeAlternatives: number;
  /** Hur mycket långsammare det är att följa vägar och stigar än att gena (0,15 = 15 %); 0 när det inte lönar sig att gena. */
  readonly shortcutGain: number;
  /** Längsta biten (m) långt från alla ledstänger i detaljrik kurvbild (kurvläsning). */
  readonly detailMeters: number;
  /** Var den längsta biten utan ledstång ligger (för markeringen på kartan). */
  readonly offAt?: Point | undefined;
}
