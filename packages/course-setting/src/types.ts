/**
 * Steg 62–65 (ADR-0180): kontraktet för banläggningen i O-Tid. Ren TypeScript utan I/O; körs i arrangörens webbläsare
 * och i servern (överföring till tävlingen, senare PDF). Koordinater är kartfilens mm med y uppåt, samma som
 * `@o-tid/map-file`, IOF `MapPosition` och Purple Pens `location`.
 *
 * Modellen följer Purple Pens händelsefil (.ppen) nära, så att en fil kan läsas in, ändras och skrivas tillbaka utan
 * att något tappas: kontroller (`controls`), banornas kontroller som en länkad lista med gafflingar (`courseControls`),
 * banor, sträckor och specialobjekt. Det som O-Tid inte förstår ännu sparas orört i `raw` och skrivs tillbaka.
 * Purple Pen är BSD-licensierad (Peter Golde); se `NOTICE.md` i paketet för det som bygger på dess format och kod.
 */
import type { Point } from "@o-tid/map-file";

/** Ett XML-element som O-Tid inte tolkar men skriver tillbaka orört (attribut och innehåll som text). */
export interface RawXml {
  readonly xml: string;
}

/** Banpåtryckets standard: storlekar på ringar, siffror och linjer. */
export type OverprintStandard = "ISOM2017" | "ISSPROM2019";
/** Kontrollbeskrivningarnas standard (IOF 2004 eller 2018). Symbolerna kommer i steg 63. */
export type DescriptionStandard = "2004" | "2018";

export type ControlKind = "START" | "NORMAL" | "FINISH" | "CROSSING_POINT" | "MAP_EXCHANGE" | "MAP_ISSUE";

/** En ruta i kontrollbeskrivningen: symbol (`ref`, t.ex. "2.4" eller "0.1N") eller fri text. Tolkas i steg 63. */
export interface DescriptionBox {
  /** "A"–"H", eller "all" för hela raden (start, mål, passage). */
  readonly box: string;
  readonly ref?: string | undefined;
  readonly text?: string | undefined;
}

/** Ett avbrott i en kontrollring, i grader moturs från x-axeln. `scale` null = alla utskriftsskalor. */
export interface CircleGap {
  readonly scale: number | null;
  readonly startDegrees: number;
  readonly endDegrees: number;
}

export interface ControlPoint {
  readonly id: string;
  readonly kind: ControlKind;
  /** Kodsiffran ("31") för vanliga kontroller; saknas för start, mål och passager. */
  readonly code?: string | undefined;
  readonly at: Point;
  /** Vinkel för passage och starttriangel, grader moturs. */
  readonly orientation?: number | undefined;
  readonly circleGaps?: readonly CircleGap[] | undefined;
  readonly descriptions: readonly DescriptionBox[];
  /** Det som filen har mer om kontrollen (punch-pattern, description-text …). */
  readonly raw?: readonly RawXml[] | undefined;
}

/** Var en gaffling eller slinga börjar: alla grenar (inklusive denna) och var de går ihop. */
export interface CourseControlSplit {
  readonly kind: "FORK" | "LOOP";
  /** Banornas kontroller som börjar varje gren, i ordning (A, B, C …). Samma lista på alla grenar. */
  readonly branches: readonly string[];
  /** Kontrollen där grenarna möts (för en slinga: gaffelkontrollen själv). */
  readonly end: string;
}

/** En kontroll på en bana. Banan är en länkad lista från `Course.first` via `next`. */
export interface CourseControl {
  readonly id: string;
  readonly control: string;
  readonly next?: string | undefined;
  readonly split?: CourseControlSplit | undefined;
  /** Kontrollnumrets läge (mm) om banläggaren flyttat det; annars räknas det fram. */
  readonly numberAt?: Point | undefined;
  /** Poäng för poängorientering. */
  readonly points?: number | undefined;
  readonly raw?: readonly RawXml[] | undefined;
}

export interface CourseRelayOptions {
  readonly teams: number;
  readonly legs: number;
  /** Fasta grenar per sträcka (Purple Pens `relay-branch`), t.ex. { "2": ["A"] }. */
  readonly fixedBranches?: Readonly<Record<string, readonly string[]>> | undefined;
}

export interface Course {
  readonly id: string;
  readonly name: string;
  readonly kind: "NORMAL" | "SCORE";
  /** Ordningen i banlistan. */
  readonly order: number;
  readonly first?: string | undefined;
  readonly secondaryTitle?: string | undefined;
  /** Utskriftsskala (t.ex. 10000 för en 1:15 000-karta tryckt i 1:10 000); saknas = kartans skala. */
  readonly printScale?: number | undefined;
  /** Stigning i meter som banläggaren angett. */
  readonly climbMeters?: number | undefined;
  /** Längd som banläggaren skrivit in i stället för den uträknade. */
  readonly lengthOverrideMeters?: number | undefined;
  readonly labelKind: "SEQUENCE" | "CODE" | "SEQUENCE_AND_CODE" | "SCORE" | "CODE_AND_SCORE" | "SEQUENCE_AND_SCORE";
  readonly relay?: CourseRelayOptions | undefined;
  readonly raw?: readonly RawXml[] | undefined;
}

/** En sträcka mellan två kontroller (gäller alla banor där de följer på varandra). */
export interface Leg {
  readonly from: string;
  readonly to: string;
  /** Brytpunkter i mm. */
  readonly bends: readonly Point[];
  /** Avbrott längs linjen, i mm från början. */
  readonly gaps: readonly { readonly start: number; readonly length: number }[];
  /** Snitslat: hela sträckan eller en del (början, slutet eller mitten mellan brytpunkterna). */
  readonly flagging?: "NONE" | "ALL" | "BEGINNING" | "END" | "MIDDLE" | undefined;
  readonly raw?: readonly RawXml[] | undefined;
}

/** Specialobjekt (förbjudet område, text, vit bakgrund …). Detaljerna kommer i steg 64; här läses och skrivs de orörda. */
export interface SpecialObject {
  readonly id: string;
  /** Purple Pens `kind`, t.ex. "out-of-bounds", "text", "white-out", "boundary", "descriptions". */
  readonly kind: string;
  readonly points: readonly Point[];
  /** Banor objektet syns på; tomt = alla. */
  readonly courses: readonly string[];
  readonly raw: RawXml;
}

export interface CourseSettingDocument {
  readonly version: 1;
  readonly event: {
    readonly title: string;
    /** Kartans skala. */
    readonly mapScale: number;
    readonly overprintStandard: OverprintStandard;
    readonly descriptionStandard: DescriptionStandard;
    /** Första kodsiffran och om omvändbara koder (66/99, 68/89 …) ska undvikas. */
    readonly numbering: { readonly start: number; readonly disallowInvertible: boolean };
    /** Resten av `<event>` (utskriftsyta, kortlayout, färg …), orört. */
    readonly raw?: readonly RawXml[] | undefined;
  };
  readonly controls: Readonly<Record<string, ControlPoint>>;
  readonly courseControls: Readonly<Record<string, CourseControl>>;
  readonly courses: readonly Course[];
  /** Nyckel `${from}-${to}` (kontrollernas id). */
  readonly legs: Readonly<Record<string, Leg>>;
  readonly specialObjects: readonly SpecialObject[];
  /** Element på toppnivå som O-Tid inte tolkar. */
  readonly raw: readonly RawXml[];
}

export interface PpenReadWarning {
  readonly code: string;
  readonly count: number;
  /** Kort text på svenska. */
  readonly text: string;
}

/** Ändringar i editorn. Varje ändring ger ett nytt dokument (ångra = föregående dokument). */
export type CourseSettingEdit =
  | { readonly type: "ADD_CONTROL"; readonly kind: ControlKind; readonly at: Point; readonly code?: string | undefined }
  | { readonly type: "MOVE_CONTROL"; readonly control: string; readonly at: Point }
  | { readonly type: "DELETE_CONTROL"; readonly control: string }
  | { readonly type: "SET_CONTROL_CODE"; readonly control: string; readonly code: string }
  | { readonly type: "ADD_COURSE"; readonly name: string; readonly kind?: "NORMAL" | "SCORE" | undefined }
  | { readonly type: "UPDATE_COURSE"; readonly course: string; readonly changes: Partial<Pick<Course, "name" | "secondaryTitle" | "printScale" | "climbMeters" | "lengthOverrideMeters" | "labelKind" | "order">> }
  | { readonly type: "DELETE_COURSE"; readonly course: string }
  /** Lägg in kontrollen på banan efter `after` (banans kontroll-id); null = först. Utan `after` läggs den före målet. */
  | { readonly type: "INSERT_COURSE_CONTROL"; readonly course: string; readonly control: string; readonly after?: string | null | undefined }
  | { readonly type: "REMOVE_COURSE_CONTROL"; readonly course: string; readonly courseControl: string }
  /** Gör en gaffling (2–N grenar) eller slinga vid banans kontroll; grenarna fylls sedan med INSERT_COURSE_CONTROL. */
  | { readonly type: "ADD_SPLIT"; readonly course: string; readonly at: string; readonly kind: "FORK" | "LOOP"; readonly branches: number }
  | { readonly type: "REMOVE_SPLIT"; readonly course: string; readonly at: string }
  | { readonly type: "MOVE_NUMBER"; readonly course: string; readonly courseControl: string; readonly at: Point | null }
  | { readonly type: "SET_LEG_BENDS"; readonly from: string; readonly to: string; readonly bends: readonly Point[] }
  | { readonly type: "SET_LEG_GAPS"; readonly from: string; readonly to: string; readonly gaps: Leg["gaps"] }
  | { readonly type: "SET_CIRCLE_GAPS"; readonly control: string; readonly gaps: readonly CircleGap[] }
  | { readonly type: "SET_EVENT"; readonly changes: Partial<Pick<CourseSettingDocument["event"], "title" | "mapScale" | "overprintStandard" | "descriptionStandard" | "numbering">> };

export interface EditResult {
  readonly document: CourseSettingDocument;
  /** Id för det som skapades (kontroll, bana, banans kontroll). */
  readonly created?: string | undefined;
}

/** Ett ändrat dokument gick inte att göra (t.ex. ta bort en kontroll som är start på en gaffling). */
export class CourseSettingEditError extends Error {
  constructor(readonly code: "NOT_FOUND" | "INVALID" | "IN_USE", message: string) {
    super(message);
    this.name = "CourseSettingEditError";
  }
}

/** En variant av en gafflad bana (ogafflad bana: en variant med koden ""). Koderna som Purple Pen ("AC", "BDA" …). */
export interface CourseVariant {
  readonly code: string;
  readonly courseControls: readonly string[];
  /** Kodsiffrorna i ordning, utan start och mål. */
  readonly controlCodes: readonly string[];
  readonly lengthMeters: number;
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
  readonly variants: readonly CourseVariant[];
}

export type CourseCheck =
  | { readonly kind: "CONTROLS_TOO_CLOSE"; readonly controls: readonly [string, string]; readonly meters: number; readonly limitMeters: number }
  | { readonly kind: "DUPLICATE_CODE"; readonly code: string; readonly controls: readonly string[] }
  | { readonly kind: "INVERTIBLE_CODE"; readonly code: string; readonly control: string }
  | { readonly kind: "SAME_CONTROL_TWICE_IN_ROW"; readonly course: string; readonly control: string }
  | { readonly kind: "LEG_THROUGH_CONTROL"; readonly course: string; readonly from: string; readonly to: string; readonly control: string }
  | { readonly kind: "COURSE_WITHOUT_START_OR_FINISH"; readonly course: string }
  | { readonly kind: "UNUSED_CONTROL"; readonly control: string }
  | { readonly kind: "MISSING_CODE"; readonly control: string };

/** Färg i banpåtrycket. COURSE = banans lila (dekorfärg vid tryck, steg 65); WHITE = vit bakgrund/kant. */
export type OverprintColor = "COURSE" | "WHITE";

export type OverprintRole =
  | "START" | "CONTROL" | "FINISH" | "CROSSING_POINT" | "MAP_EXCHANGE" | "LEG" | "NUMBER" | "FLAGGING" | "SPECIAL";

/**
 * Banpåtrycket som enkla figurer i kartans mm, samma för skärm (canvas) och tryck (PDF, steg 65). Storlekarna följer
 * standarden vid utskriftsskalan: en figur som ska vara 5 mm på papperet är 5 · printScale / mapScale mm i kartan.
 */
export type OverprintPrimitive =
  | { readonly kind: "circle"; readonly role: OverprintRole; readonly color: OverprintColor; readonly center: Point; readonly diameter: number; readonly lineWidth: number; readonly gaps?: readonly { readonly startDegrees: number; readonly endDegrees: number }[] | undefined; readonly ref?: string | undefined }
  | { readonly kind: "polyline"; readonly role: OverprintRole; readonly color: OverprintColor; readonly points: readonly Point[]; readonly width: number; readonly dash?: readonly number[] | undefined; readonly closed?: boolean | undefined; readonly ref?: string | undefined }
  | { readonly kind: "polygon"; readonly role: OverprintRole; readonly color: OverprintColor; readonly rings: readonly (readonly Point[])[]; readonly ref?: string | undefined }
  | { readonly kind: "text"; readonly role: OverprintRole; readonly color: OverprintColor; readonly at: Point; readonly text: string; readonly heightMm: number; readonly align: "center"; readonly ref?: string | undefined };

export interface OverprintOptions {
  /** Banans id, eller "ALL_CONTROLS" för alla kontroller. */
  readonly course: string;
  /** Variantkod för gafflad bana; saknas = alla grenar. */
  readonly variant?: string | undefined;
  /** Saknas = banans utskriftsskala, annars kartans. */
  readonly printScale?: number | undefined;
}
