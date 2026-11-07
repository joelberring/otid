import type { CourseLevel, LevelRank } from "./level-types";
import type { LevelRuleId } from "./level-rules";
import type { OverprintOptions } from "./overprint-types";

/** Banornas varianter och sammanfattning, och kontrollerna av banläggningen (`checkCourseSetting`). */

/** En variant av en gafflad bana (ogafflad bana: en variant med koden ""). Koderna som Purple Pen ("AC", "BDA" …). */
export interface CourseVariant {
  readonly code: string;
  readonly courseControls: readonly string[];
  /** Kodsiffrorna i ordning, utan start och mål. */
  readonly controlCodes: readonly string[];
  readonly lengthMeters: number;
  /** ADR-0198: bortvald (bara i `allCourseVariants`). */
  readonly excluded?: boolean | undefined;
}

/** Sammanfattning av en bana för banlistan och överföringen till tävlingen. */
export interface CourseSummary {
  readonly course: string;
  readonly name: string;
  readonly lengthMeters: number;
  /** Max och min när banan är gafflad. */
  readonly lengthRangeMeters?: { readonly min: number; readonly max: number } | undefined;
  readonly climbMeters?: number | undefined;
  readonly controlCount: number;
  /** De varianter som används (ADR-0198: utan de bortvalda). */
  readonly variants: readonly CourseVariant[];
  /** ADR-0198: antal bortvalda varianter som gäller (0 = alla används). */
  readonly excludedCount: number;
}

/** Gränserna för för nära kontroller (ADR-0180 beslut 9); standardvärdena finns i `CONTROL_DISTANCE_LIMITS`. */
export interface CheckOptions {
  /** Under detta avstånd (m) är två kontroller alltid för nära. */
  readonly minMeters?: number | undefined;
  /** Under detta avstånd (m) ska kontrollerna ha tydligt olika objekt; rapporteras för granskning. */
  readonly similarMeters?: number | undefined;
  /**
   * ADR-0199: vägvalet (räknat med banläggningens spärrar) för en sträcka vars fågelväg korsar ett förbjudet område.
   * `reachable` = en laglig väg finns; undefined = inte räknat.
   */
  readonly legRoute?: ((course: string, from: string, to: string) => { readonly reachable: boolean } | undefined) | undefined;
  /** ADR-0211 beslut 4: kartans hinder för numren; med dem kontrolleras de nummer som banläggaren placerat. */
  readonly numberObstacles?: OverprintOptions["numberObstacles"];
}

export type CourseCheck =
  /**
   * Under `minMeters` alltid; upp till `similarMeters` bara när objekten (kolumn D) är samma slag (`feature` "SAME") eller
   * okända ("UNKNOWN"). Saknas `feature` gäller den undre gränsen.
   */
  | { readonly kind: "CONTROLS_TOO_CLOSE"; readonly controls: readonly [string, string]; readonly meters: number; readonly limitMeters: number; readonly feature?: "SAME" | "UNKNOWN" | undefined }
  | { readonly kind: "DUPLICATE_CODE"; readonly code: string; readonly controls: readonly string[] }
  | { readonly kind: "INVERTIBLE_CODE"; readonly code: string; readonly control: string }
  | { readonly kind: "SAME_CONTROL_TWICE_IN_ROW"; readonly course: string; readonly control: string }
  | { readonly kind: "LEG_THROUGH_CONTROL"; readonly course: string; readonly from: string; readonly to: string; readonly control: string }
  /**
   * Steg 64, ADR-0199: sträckans fågelväg går genom ett förbjudet område (specialobjektet) eller över en gräns eller förbjuden
   * väg. UNKNOWN: vägvalet är inte räknat (en notis); NO_ROUTE: vägvalet runt finns inte – kontrollen går inte att nå lagligt.
   * En per sträcka; `special` = den första och `specials` = alla spärrar som fågelvägen korsar. Går vägvalet runt blir det
   * ingen kontroll alls.
   */
  | { readonly kind: "LEG_THROUGH_FORBIDDEN"; readonly course: string; readonly from: string; readonly to: string; readonly special: string;
      readonly route: "UNKNOWN" | "NO_ROUTE"; readonly specials?: readonly string[] | undefined }
  /** ADR-0199: kontrollen ligger i ett förbjudet område (löparen måste in i det). */
  | { readonly kind: "CONTROL_IN_FORBIDDEN"; readonly course: string; readonly control: string; readonly special: string }
  | { readonly kind: "COURSE_WITHOUT_START_OR_FINISH"; readonly course: string }
  | { readonly kind: "UNUSED_CONTROL"; readonly control: string }
  | { readonly kind: "MISSING_CODE"; readonly control: string }
  /** ADR-0211 beslut 4: ett nummer som banläggaren placerat ligger delvis på ett hus eller en mörk yta (en notis). */
  | { readonly kind: "NUMBER_ON_OBSTACLE"; readonly course: string; readonly control: string; readonly text: string }
  /**
   * ADR-0212: nivåstödet bedömer kontrollen eller sträckan svårare (eller tydligt lättare) än banans målnivå (en notis, bara
   * med "Visa avvikelser mot nivån i Varningar"). `rule` är regeln vars tips gäller, `rank` den uppskattade nivån.
   */
  | { readonly kind: "LEVEL_DEVIATION"; readonly course: string; readonly target: CourseLevel; readonly direction: "HARDER" | "EASIER";
      readonly rule: LevelRuleId; readonly rank: LevelRank; readonly control?: string | undefined; readonly from?: string | undefined;
      readonly to?: string | undefined };
