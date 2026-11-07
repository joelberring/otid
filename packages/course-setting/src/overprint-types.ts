import type { Point } from "@o-tid/map-file";
import type { DescriptionLayout } from "./description-types";
import type { MapRect } from "./document-types";
import type { OverprintTraining } from "./training-types";

/** Banpåtrycket som figurer (`layoutOverprint`) och valen för det. */

/**
 * Färg i banpåtrycket (färgroll; dekorfärg och övertryck i steg 65). COURSE = banans övre lila; COURSE_LOWER = undre lila
 * (passager, gränser, första hjälpen, vatten: under kartans svarta hos Purple Pen); WHITE = vit bakgrund och kant; BLACK =
 * svart text och beskrivning; CUSTOM = egen CMYK (`cmyk`, andelar 0–1) på text, linje, rektangel eller ellips.
 */
export type OverprintColor = "COURSE" | "COURSE_LOWER" | "WHITE" | "BLACK" | "CUSTOM";

export type OverprintRole =
  | "START" | "CONTROL" | "FINISH" | "CROSSING_POINT" | "MAP_EXCHANGE" | "LEG" | "NUMBER" | "FLAGGING" | "SPECIAL"
  /** Träningsläget (ADR-0192): sista säkra, markeringar vid avsnitten, linjen i linjeorientering. */
  | "TRAINING"
  /** Kartbyten (ADR-0203): grannens sträckor och kontroller närmast kartbytet, tonade och utan nummer. */
  | "OVERLAP";

type Cmyk = readonly [number, number, number, number];
interface Paint { readonly role: OverprintRole; readonly color: OverprintColor; readonly cmyk?: Cmyk | undefined; readonly ref?: string | undefined;
  /** Tonad (0–1): andelen av färgen, t.ex. överlappet vid ett kartbyte (ADR-0203, 0,35). */
  readonly fade?: number | undefined }

/**
 * Banpåtrycket som enkla figurer i kartans mm, samma för skärm (canvas) och tryck (PDF, steg 65). Storlekarna följer
 * standarden vid utskriftsskalan: en figur som ska vara 5 mm på papperet är 5 · printScale / mapScale mm i kartan
 * (med händelsens `course-appearance scale-sizes` som Purple Pen: "RelativeTo15000" ger 5 · 15000 / mapScale,
 * "RelativeToMap" 5 mm). Cirklarnas `diameter` och linjerna räknas till linjens mitt; ringavbrotten i grader moturs.
 * Linjer har platta ändar om inte `cap: "round"`. Ytor fylls jämn–udda; `tint` (0–1) = rastrerad färg (50 % lila).
 * Texten: `heightMm` är em-höjden (font-size); `at.y` är mitten av em-rutan (canvas "middle"); `align` "center" = `at.x` i
 * mitten, "left" = vänsterkant. `ref` är banans kontroll-id för kontroller och nummer (kontrollens id i "ALL_CONTROLS"),
 * sträckans nyckel `${från}-${till}` (kontrollernas id) för sträckor och specialobjektets id för role SPECIAL.
 * `image`: bilden (base64) fyller rektangeln, ingen färgroll. `description`: kontrollbeskrivningen (`layoutDescription` i
 * kartans mm, y NEDÅT från `topLeft`), med vit bakgrund som egen WHITE-yta.
 * `layoutOverprint` ger figurerna i målningsordning: WHITE, bilder, CUSTOM, BLACK, COURSE_LOWER, COURSE (Purple Pens
 * färgordning i CourseLayout.RenderToMap), annars i den ordning de räknats.
 */
export type OverprintPrimitive =
  | (Paint & { readonly kind: "circle"; readonly center: Point; readonly diameter: number; readonly lineWidth: number; readonly gaps?: readonly { readonly startDegrees: number; readonly endDegrees: number }[] | undefined })
  | (Paint & { readonly kind: "polyline"; readonly points: readonly Point[]; readonly width: number; readonly dash?: readonly number[] | undefined; readonly closed?: boolean | undefined; readonly cap?: "round" | undefined })
  | (Paint & { readonly kind: "polygon"; readonly rings: readonly (readonly Point[])[]; readonly tint?: number | undefined })
  | (Paint & { readonly kind: "text"; readonly at: Point; readonly text: string; readonly heightMm: number; readonly align: "center" | "left";
      readonly font?: { readonly family: string; readonly bold: boolean; readonly italic: boolean } | undefined })
  | { readonly kind: "image"; readonly role: "SPECIAL"; readonly color?: undefined; readonly rect: MapRect; readonly mediaType: string; readonly data: string; readonly ref?: string | undefined }
  | (Paint & { readonly kind: "description"; readonly topLeft: Point; readonly layout: DescriptionLayout });

/** Kartans hinder för en kontrolls nummer (se `number-obstacles.ts`). */
export interface NumberObstaclesData {
  readonly areas: readonly (readonly Point[])[];
  readonly lines: readonly (readonly [Point, Point])[];
}

export interface OverprintOptions {
  /** Banans id, eller "ALL_CONTROLS" för alla kontroller. */
  readonly course: string;
  /** Variantkod för gafflad bana; saknas = alla grenar. */
  readonly variant?: string | undefined;
  /** Saknas = banans utskriftsskala, annars kartans. */
  readonly printScale?: number | undefined;
  /**
   * Detaljgapen per ring (`detailCircleGaps` över `detailCircleCenters`, nyckel `detailGapKey(kontroll, radie)`; en nyckel
   * som bara är kontrollens id gäller alla storlekar). Används bara när händelsens `circleCutting.details` är på; inte där
   * en sträcka på kartbilden går ut ur ringen.
   */
  readonly detailGaps?: Readonly<Record<string, readonly { readonly startDegrees: number; readonly endDegrees: number }[]>> | undefined;
  /** Träningsläget (ADR-0192 beslut 7): vy, kepsens karta och avsnitt. */
  readonly training?: OverprintTraining | undefined;
  /**
   * Kartans hinder för numren per kontroll (`computeNumberObstacles`, ADR-0211 beslut 4): den automatiska placeringen
   * undviker hus, mörka ytor och svarta linjer. Banläggarens egna lägen ändras inte.
   */
  readonly numberObstacles?: Readonly<Record<string, NumberObstaclesData>> | undefined;
  /** Kartbyten (ADR-0203): en del av banan (0, 1 …); saknas = hela banan. */
  readonly part?: number | undefined;
  /** Delens överlapp mot föregående del: ingen, sista sträckan (förval) eller hela föregående del. */
  readonly overlap?: PartOverlap | undefined;
}

/** "Visa överlapp" vid kartbyten (ADR-0203). */
export type PartOverlap = "NONE" | "LAST_LEG" | "PREVIOUS_PART";
