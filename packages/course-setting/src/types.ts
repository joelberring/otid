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
import type { Appearance } from "./appearance";
import type { DescriptionEdit, DescriptionLayout } from "./description-types";
import type { LayoutTemplate } from "./layout-template";
import type { CoursePaperLayout } from "./paper-layout";
import type { PrintProfile } from "./print-profile";
import type { OverprintTraining, TrainingPatch, TrainingSettings } from "./training-types";

/**
 * Ett XML-element som O-Tid inte tolkar men skriver tillbaka orört (attribut och innehåll som text). Ett element som
 * bara delvis tolkas (t.ex. `<options>`) sparas utan de tolkade attributen och slås ihop med modellens värden när filen
 * skrivs. Ett element med samma namn som det omgivande (t.ex. `<control …/>` i en kontrolls `raw`) bär de attribut på
 * själva elementet som O-Tid inte tolkar.
 */
export interface RawXml {
  readonly xml: string;
}

/** Banpåtryckets standard: storlekar på ringar, siffror och linjer. */
export type OverprintStandard = "ISOM2017" | "ISSPROM2019";
/** Kontrollbeskrivningarnas standard (IOF 2004 eller 2018). Symbolerna kommer i steg 63. */
export type DescriptionStandard = "2004" | "2018";

export type ControlKind = "START" | "NORMAL" | "FINISH" | "CROSSING_POINT" | "MAP_EXCHANGE" | "MAP_ISSUE";

/**
 * En ruta i kontrollbeskrivningen: symbol (`ref`, t.ex. "2.4" eller "0.1N") eller fri text. Som i Purple Pen har start,
 * kartbyte och vanliga kontroller rutorna "C"–"H" och mål, passage och kartutdelning en ruta "all"; text finns bara i
 * "F" (mått, "2x3", "0.5/3", "2|3") och då ingen symbol där.
 */
export interface DescriptionBox {
  /** "C"–"H", eller "all" för hela raden (mål, passage, kartutdelning). */
  readonly box: string;
  readonly ref?: string | undefined;
  readonly text?: string | undefined;
}

/** Valen för automatiska ringklipp. */
export interface CircleCutting {
  readonly overlap: boolean;
  readonly details: boolean;
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
  /** Textrad före och efter kontrollens rad i beskrivningen, på alla banor (Purple Pens description-text-line). "|" = ny rad. */
  readonly descriptionTextBefore?: string | undefined;
  readonly descriptionTextAfter?: string | undefined;
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

/**
 * En kontroll på en bana. Banan är en länkad lista från `Course.first` via `next`. En gaffling är som i Purple Pen: varje
 * gren börjar med en egen banans kontroll för gaffelkontrollen, alla med samma `split`.
 */
export interface CourseControl {
  readonly id: string;
  readonly control: string;
  readonly next?: string | undefined;
  readonly split?: CourseControlSplit | undefined;
  /** Kontrollnumrets läge (mm) om banläggaren flyttat det; annars räknas det fram. */
  readonly numberAt?: Point | undefined;
  /** Poäng för poängorientering. */
  readonly points?: number | undefined;
  /** Textrad före och efter raden, bara på den här banan (description-text-line på banans kontroll). */
  readonly descriptionTextBefore?: string | undefined;
  readonly descriptionTextAfter?: string | undefined;
  readonly raw?: readonly RawXml[] | undefined;
}

export interface CourseRelayOptions {
  readonly teams: number;
  readonly legs: number;
  /** Fasta grenar per sträcka (Purple Pens `relay-branch`), t.ex. { "2": ["A"] }. */
  readonly fixedBranches?: Readonly<Record<string, readonly string[]>> | undefined;
}

/**
 * ADR-0198: en bortvald variant av en gafflad bana. Koden och kontrollkoderna i ordning måste båda stämma; ändras banan så
 * att varianten får andra kontroller eller en annan kod gäller bortvalet inte längre (varianten kommer tillbaka).
 */
export interface ExcludedVariant {
  readonly code: string;
  readonly controls: readonly string[];
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
  /** Steg 64: tryckytan (Purple Pens `<print-area>` utan `part`); saknas = automatisk. */
  readonly printArea?: PrintArea | undefined;
  /**
   * ADR-0198: varianter som inte används (färre gafflingsvarianter). De förs inte över till tävlingen, skrivs inte i IOF XML
   * och skrivs inte ut. Bara O-Tid; i .ppen i O-Tid:s namnrymd (`<otid:variants>`).
   */
  readonly excludedVariants?: readonly ExcludedVariant[] | undefined;
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
  /** Brytpunkten där snitslingen börjar eller slutar (BEGINNING/END) eller kartutdelningen sitter (MIDDLE). */
  readonly flaggingAt?: Point | undefined;
  readonly raw?: readonly RawXml[] | undefined;
}

/** Purple Pens specialobjekt (EventDB.cs `SpecialKind`); steg 64 tolkar och ritar dem. */
export type SpecialKind =
  | "first-aid" | "water" | "optional-crossing-point" | "forbidden-route" | "registration-mark" | "boundary" | "out-of-bounds"
  | "dangerous-area" | "temporary-construction" | "white-out" | "text" | "descriptions" | "image" | "line" | "rectangle" | "ellipse";

/**
 * Färgen på text, linje, rektangel och ellips (Purple Pens SpecialColor, som i filen): "purple" (övre lila), "lower-purple",
 * "black" eller CMYK "c,m,y,k" med andelar 0–1.
 */
export type SpecialColor = "purple" | "lower-purple" | "black" | (string & {});

/** Linjen för linje, rektangel och ellips (mm i kartan, skalas inte med utskriftsskalan, som i Purple Pen). */
export interface SpecialLine {
  readonly kind: "single" | "double" | "dashed";
  readonly width: number;
  /** Mellanrum mellan strecken (streckad) eller mellan linjerna (dubbel). */
  readonly gapSize: number;
  /** Streckens längd (streckad). */
  readonly dashSize: number;
  /** Rundade hörn (rektangel). */
  readonly cornerRadius?: number | undefined;
}

/** Typsnittet för en text. `height` = siffrans höjd i kartans mm; saknas = texten fyller rutan (Purple Pens äldre sätt). */
export interface SpecialFont {
  readonly name: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly height?: number | undefined;
}

/**
 * Specialobjekt (förbjudet område, text, vit bakgrund …). De tolkade fälten står bredvid `raw` (elementet som det lästes):
 * är fälten desamma som i `raw` skrivs `raw` orört (med nya punkter och banor), annars skrivs elementet om som Purple Pen
 * gör och det som O-Tid inte tolkar följer med. Bildens data finns bara i `raw` (`<image-data>`).
 */
export interface SpecialObject {
  readonly id: string;
  /** Purple Pens `kind`, t.ex. "out-of-bounds", "text", "white-out", "boundary", "descriptions" (`SpecialKind`). */
  readonly kind: string;
  /**
   * Punkt (punktobjekt), linje (gräns, linje), ytans hörn (förbjudet, farligt, vit bakgrund, byggnad) eller två hörn
   * (text, bild, rektangel, ellips). Beskrivningen: övre vänstra hörnet och en punkt en ruta åt höger (rutans sida).
   */
  readonly points: readonly Point[];
  /** Banor objektet syns på; tomt = alla. "0" = Alla kontroller (som i Purple Pen). */
  readonly courses: readonly string[];
  /** Valfri passage: vinkel (grader moturs) och förlängning i mm. */
  readonly orientation?: number | undefined;
  readonly stretch?: number | undefined;
  /** Text: texten (med Purple Pens $(CourseName) m.fl.) och typsnittet. */
  readonly text?: string | undefined;
  readonly font?: SpecialFont | undefined;
  /** Text, linje, rektangel och ellips. */
  readonly color?: SpecialColor | undefined;
  readonly line?: SpecialLine | undefined;
  /** Beskrivningen i flera spalter. */
  readonly columns?: number | undefined;
  /** Bildens format ("png", "jpeg" …). */
  readonly imageFormat?: string | undefined;
  readonly raw: RawXml;
}

/** En rektangel i kartans mm (y uppåt). */
export interface MapRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Tryckytan för en bana eller Alla kontroller (Purple Pens `<print-area>`). `automatic`: ytan räknas fram ur banan och
 * kartan; `restrictToPageSize`: ytan är alltid lika stor som papperet (bara läget ändras). `rect` sparas också när den är
 * automatisk (Purple Pen gör så för äldre versioner). Papperet i 1/100 tum som i Purple Pen (A4 = 827 × 1169).
 */
export interface PrintArea {
  readonly automatic: boolean;
  readonly restrictToPageSize: boolean;
  readonly rect?: MapRect | undefined;
  readonly page?: { readonly width: number; readonly height: number; readonly margins: number; readonly landscape: boolean } | undefined;
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
    /** Kontrollbeskrivningarnas språk (Purple Pens `<descriptions lang>`, t.ex. "sv"); saknas = svenska i O-Tid. */
    readonly descriptionLanguage?: string | undefined;
    /**
     * Automatiska ringklipp (ADR-0180 beslut 10): `overlap` där ringar på samma kartbild går in i varandra, `details` över
     * viktiga kartdetaljer. Bara O-Tid; skrivs inte till .ppen. Saknas = som Purple Pen.
     */
    readonly circleCutting?: CircleCutting | undefined;
    /** Steg 64: Alla kontrollers utskriftsskala (`<all-controls print-scale>`) och tryckyta (`<print-area>` i `<event>`). */
    readonly allControlsPrintScale?: number | undefined;
    readonly printArea?: PrintArea | undefined;
    /**
     * Steg 64 (ADR-0183): tävlingens utskriftsprofiler (färger per kartlager, banans färg) och vald profil, och
     * layoutmallarna. Bara O-Tid; skrivs inte till .ppen och följer med när en ny .ppen läses in.
     */
    readonly printProfiles?: readonly PrintProfile[] | undefined;
    readonly printProfileId?: string | undefined;
    readonly layoutTemplates?: readonly LayoutTemplate[] | undefined;
    /**
     * Papperet per bana (nyckel = banans id eller "ALL_CONTROLS"): kontrollbeskrivningen på kartan och senare andra element
     * på arket (`paper-layout.ts`). Bara O-Tid; en utplacerad beskrivning skrivs till .ppen som Purple Pens `descriptions`.
     */
    readonly paperLayouts?: Readonly<Record<string, CoursePaperLayout>> | undefined;
    /** Resten av `<event>` (utskriftsyta, kortlayout, färg …), orört. */
    readonly raw?: readonly RawXml[] | undefined;
  };
  readonly controls: Readonly<Record<string, ControlPoint>>;
  readonly courseControls: Readonly<Record<string, CourseControl>>;
  readonly courses: readonly Course[];
  /** Nyckel `${from}-${to}` (kontrollernas id). */
  readonly legs: Readonly<Record<string, Leg>>;
  readonly specialObjects: readonly SpecialObject[];
  /** Träningsläget (ADR-0192): bara O-Tid, i .ppen som eget element i O-Tid:s namnrymd. Saknas = ingen träning. */
  readonly training?: TrainingSettings | undefined;
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
  /** Banläggningens UX (ADR-0180 beslut 14): passagens vinkel i grader moturs (bara passager, som Purple Pens Rotate). */
  | { readonly type: "SET_CONTROL_ORIENTATION"; readonly control: string; readonly orientation: number }
  | { readonly type: "ADD_COURSE"; readonly name: string; readonly kind?: "NORMAL" | "SCORE" | undefined }
  /**
   * Ny bana som kopia av `course` (Purple Pens DuplicateCourse): samma kontroller i ordning med gafflingar och slingor,
   * nummerlägen, tryckyta och inställningar, direkt efter originalet; banans specialobjekt syns också på kopian.
   */
  | { readonly type: "DUPLICATE_COURSE"; readonly course: string; readonly name: string }
  /** Banans egenskaper (ADR-0190): `null` tar bort stigning, fast längd, undertitel och utskriftsskala; `order` = plats i listan. */
  | { readonly type: "UPDATE_COURSE"; readonly course: string; readonly changes: CourseChanges }
  /** ADR-0190: poängen för banans kontroll på en poängbana (Purple Pens points); 0 eller null = inga. */
  | { readonly type: "SET_POINTS"; readonly course: string; readonly courseControl: string; readonly points: number | null }
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
  | { readonly type: "SET_EVENT"; readonly changes: Partial<Pick<CourseSettingDocument["event"], "title" | "mapScale" | "overprintStandard" | "descriptionStandard" | "numbering" | "descriptionLanguage" | "circleCutting" | "allControlsPrintScale" | "printProfileId">> }
  /** Banans utseende för hela banläggningen (Purple Pens `<course-appearance>`, ADR-0180 beslut 12). */
  | { readonly type: "SET_APPEARANCE"; readonly changes: Partial<Appearance> }
  /** Steg 63: kontrollbeskrivningen. */
  | DescriptionEdit
  /** Steg 66: sätt (eller ta bort, null) hela objekt per id – ångra och gör om när flera arbetar samtidigt. */
  | PutObjectsEdit
  /** Steg 64: specialobjekt och tryckyta. */
  | SpecialEdit
  /** Träningsläget (ADR-0192 beslut 11): hela delar per id, null = tas bort. */
  | ({ readonly type: "PUT_TRAINING" } & TrainingPatch);

/** Ändringarna i `UPDATE_COURSE`. */
export interface CourseChanges {
  readonly name?: string | undefined;
  readonly kind?: Course["kind"] | undefined;
  readonly labelKind?: Course["labelKind"] | undefined;
  /** Platsen i banlistan (1 = först); de andra banorna numreras om. */
  readonly order?: number | undefined;
  readonly secondaryTitle?: string | null | undefined;
  readonly printScale?: number | null | undefined;
  readonly climbMeters?: number | null | undefined;
  readonly lengthOverrideMeters?: number | null | undefined;
  /** ADR-0198: de bortvalda varianterna (ersätts helt); null eller tom = alla används. */
  readonly excludedVariants?: readonly ExcludedVariant[] | null | undefined;
}

/** Specialobjektets tolkade egenskaper (utom punkter och banor). */
export type SpecialFields = Pick<SpecialObject, "orientation" | "stretch" | "text" | "font" | "color" | "line" | "columns">;

/** Ett nytt specialobjekt. En bild har sin data med (base64, t.ex. PNG). */
export interface SpecialInput extends SpecialFields {
  readonly kind: SpecialKind;
  readonly points: readonly Point[];
  /** Saknas eller tomt = alla banor. */
  readonly courses?: readonly string[] | undefined;
  readonly image?: { readonly format: string; readonly data: string } | undefined;
}

/**
 * Steg 64: skapa, flytta (nya punkter), ändra och ta bort specialobjekt; tryckytan för en bana (`course` = banans id eller
 * "ALL_CONTROLS"), null = automatisk som Purple Pen.
 */
export type SpecialEdit =
  | { readonly type: "ADD_SPECIAL"; readonly special: SpecialInput }
  | { readonly type: "MOVE_SPECIAL"; readonly special: string; readonly points: readonly Point[] }
  | { readonly type: "UPDATE_SPECIAL"; readonly special: string; readonly changes: SpecialFields & { readonly courses?: readonly string[] | undefined } }
  | { readonly type: "DELETE_SPECIAL"; readonly special: string }
  | { readonly type: "SET_PRINT_AREA"; readonly course: string; readonly area: PrintArea | null }
  /** Utskriftsprofil och layoutmall (ADR-0183): lägg till eller ersätt per id, ta bort. */
  | { readonly type: "PUT_PRINT_PROFILE"; readonly profile: PrintProfile }
  | { readonly type: "DELETE_PRINT_PROFILE"; readonly id: string }
  | { readonly type: "PUT_LAYOUT_TEMPLATE"; readonly template: LayoutTemplate }
  | { readonly type: "DELETE_LAYOUT_TEMPLATE"; readonly id: string }
  /** Papperet för en bana (eller "ALL_CONTROLS"): ersätts helt; null = som förval. */
  | { readonly type: "SET_PAPER_LAYOUT"; readonly course: string; readonly layout: CoursePaperLayout | null };

/**
 * Steg 66 (ADR-0181 beslut 4): objekten som de ska vara efter ändringen, per id (null = finns inte). Ångra i en editor där
 * andra också ändrar sätter tillbaka bara de objekt som steget ändrade (`objectPatch`), så att andras ändringar står kvar.
 * Efteråt måste banornas kontroller, banorna och sträckorna peka på det som finns, annars `INVALID`.
 */
export interface PutObjectsEdit {
  readonly type: "PUT_OBJECTS";
  readonly controls?: Readonly<Record<string, ControlPoint | null>> | undefined;
  readonly courseControls?: Readonly<Record<string, CourseControl | null>> | undefined;
  readonly courses?: Readonly<Record<string, Course | null>> | undefined;
  readonly legs?: Readonly<Record<string, Leg | null>> | undefined;
  readonly specialObjects?: Readonly<Record<string, SpecialObject | null>> | undefined;
  /** Hela händelsen (äldre klienter och sparade förslag). */
  readonly event?: CourseSettingDocument["event"] | undefined;
  /**
   * ADR-0190: banornas plats i listan per id. Banor i `courses` som redan finns behåller sin ordning (den ändras bara här),
   * så att ångra av t.ex. ett namnbyte inte flyttar tillbaka en bana som någon annan flyttat. Ordningen numreras om 1, 2, 3 ….
   */
  readonly courseOrder?: Readonly<Record<string, number>> | undefined;
  /** Händelsens fält som ändras (null = tas bort); ångra av en inställning rör bara den (översynen 2026-11-02). */
  readonly eventFields?: Readonly<Record<string, unknown>> | undefined;
  /** Träningens delar (ADR-0192 beslut 11). */
  readonly training?: TrainingPatch | undefined;
}

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
  /** Steg 64: sträckans linje går genom ett förbjudet område (specialobjektet) eller över en gräns eller förbjuden väg. */
  | { readonly kind: "LEG_THROUGH_FORBIDDEN"; readonly course: string; readonly from: string; readonly to: string; readonly special: string }
  | { readonly kind: "COURSE_WITHOUT_START_OR_FINISH"; readonly course: string }
  | { readonly kind: "UNUSED_CONTROL"; readonly control: string }
  | { readonly kind: "MISSING_CODE"; readonly control: string };

/**
 * Färg i banpåtrycket (färgroll; dekorfärg och övertryck i steg 65). COURSE = banans övre lila; COURSE_LOWER = undre lila
 * (passager, gränser, första hjälpen, vatten: under kartans svarta hos Purple Pen); WHITE = vit bakgrund och kant; BLACK =
 * svart text och beskrivning; CUSTOM = egen CMYK (`cmyk`, andelar 0–1) på text, linje, rektangel eller ellips.
 */
export type OverprintColor = "COURSE" | "COURSE_LOWER" | "WHITE" | "BLACK" | "CUSTOM";

export type OverprintRole =
  | "START" | "CONTROL" | "FINISH" | "CROSSING_POINT" | "MAP_EXCHANGE" | "LEG" | "NUMBER" | "FLAGGING" | "SPECIAL"
  /** Träningsläget (ADR-0192): sista säkra, markeringar vid avsnitten, linjen i linjeorientering. */
  | "TRAINING";

type Cmyk = readonly [number, number, number, number];
interface Paint { readonly role: OverprintRole; readonly color: OverprintColor; readonly cmyk?: Cmyk | undefined; readonly ref?: string | undefined }

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
}
