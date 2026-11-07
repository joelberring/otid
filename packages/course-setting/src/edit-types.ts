import type { Point } from "@o-tid/map-file";
import type { Appearance } from "./appearance";
import type { DescriptionEdit } from "./description-types";
import type { SheetLayout } from "./sheet-layout";
import type { CoursePaperLayout, PaperTemplate } from "./paper-items";
import type { PrintProfile } from "./print-profile";
import type { LayoutEdit } from "./print-layout-edit";
import type { TrainingPatch } from "./training-types";
import type { CourseLevel } from "./level-types";
import type {
  AcceptedCheck, CircleGap, ControlKind, ControlPoint, Course, CourseControl, CourseSettingDocument, ExcludedVariant, Leg, PrintArea,
  RunnerBackLayout, SpecialKind, SpecialObject
} from "./document-types";

/** Ändringarna i banläggningens dokument (`applyEdit`) och felet när en ändring inte går att göra. */

/** Ändringar i editorn. Varje ändring ger ett nytt dokument (ångra = föregående dokument). */
export type CourseSettingEdit =
  | { readonly type: "ADD_CONTROL"; readonly kind: ControlKind; readonly at: Point; readonly code?: string | undefined }
  | { readonly type: "MOVE_CONTROL"; readonly control: string; readonly at: Point }
  /**
   * Flytta en delad kontroll bara i en bana (som Purple Pens fråga när en kontroll flyttas långt): en ny vanlig kontroll vid
   * `at` med `code` (upptagen eller saknas: nästa lediga) ersätter `control` i banans kontroller `courseControls`; de andra
   * banorna behåller den gamla. Beskrivningen kopieras inte och numret får sitt förvalda läge.
   */
  | { readonly type: "NEW_CONTROL_IN_COURSE"; readonly course: string; readonly control: string; readonly at: Point;
      readonly courseControls: readonly string[]; readonly code?: string | undefined }
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
  /** ADR-0217: med `printLayout` (inte huvudlayouten) ett justerat nummer på arket; null = som banläggningen. */
  | { readonly type: "MOVE_NUMBER"; readonly course: string; readonly courseControl: string; readonly at: Point | null; readonly printLayout?: string | undefined }
  | { readonly type: "SET_LEG_BENDS"; readonly from: string; readonly to: string; readonly bends: readonly Point[] }
  | { readonly type: "SET_LEG_GAPS"; readonly from: string; readonly to: string; readonly gaps: Leg["gaps"] }
  | { readonly type: "SET_CIRCLE_GAPS"; readonly control: string; readonly gaps: readonly CircleGap[] }
  | { readonly type: "SET_EVENT"; readonly changes: Partial<Pick<CourseSettingDocument["event"], "title" | "mapScale" | "overprintStandard" | "descriptionStandard" | "numbering" | "descriptionLanguage" | "circleCutting" | "legCircleGapMm" | "allControlsPrintScale" | "printProfileId" | "paperValues" | "levelNotices">> }
  /** Banans utseende för hela banläggningen (Purple Pens `<course-appearance>`, ADR-0180 beslut 12). */
  | { readonly type: "SET_APPEARANCE"; readonly changes: Partial<Appearance> }
  /** Steg 63: kontrollbeskrivningen. */
  | DescriptionEdit
  /** Steg 66: sätt (eller ta bort, null) hela objekt per id – ångra och gör om när flera arbetar samtidigt. */
  | PutObjectsEdit
  /** Steg 64: specialobjekt och tryckyta. */
  | SpecialEdit
  /** Träningsläget (ADR-0192 beslut 11): hela delar per id, null = tas bort. */
  | ({ readonly type: "PUT_TRAINING" } & TrainingPatch)
  /** ADR-0217: layouter, ark, justeringar, klassernas layout och sparade lägen. */
  | LayoutEdit
  /** ADR-0199: godta (värdet) eller ångra (null) varningar per nyckel; övriga godtagna står kvar. */
  | { readonly type: "SET_ACCEPTED_CHECKS"; readonly checks: Readonly<Record<string, AcceptedCheck | null>> };

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
  /** ADR-0212: målnivån; null tar bort den. */
  readonly level?: CourseLevel | null | undefined;
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
  /** ADR-0217: med `printLayout` (inte huvudlayouten) arkets utsnitt i den layouten (papperet är layoutens). */
  | { readonly type: "SET_PRINT_AREA"; readonly course: string; readonly area: PrintArea | null; readonly part?: number | undefined; readonly printLayout?: string | undefined }
  /**
   * Utskriftsprofil och "Kartor per ark" (ADR-0183, `SheetLayout`): lägg till eller ersätt per id, ta bort. Åtgärdernas namn
   * (`…_LAYOUT_TEMPLATE`) står kvar eftersom de lagras i banläggningens historik.
   */
  | { readonly type: "PUT_PRINT_PROFILE"; readonly profile: PrintProfile }
  | { readonly type: "DELETE_PRINT_PROFILE"; readonly id: string }
  | { readonly type: "PUT_LAYOUT_TEMPLATE"; readonly template: SheetLayout }
  | { readonly type: "DELETE_LAYOUT_TEMPLATE"; readonly id: string }
  /** Papperet för en bana (eller "ALL_CONTROLS"): ersätts helt; null = som förval. */
  | { readonly type: "SET_PAPER_LAYOUT"; readonly course: string; readonly layout: CoursePaperLayout | null; readonly part?: number | undefined;
      /** ADR-0217: arket i en annan layout än huvudlayouten (namnet `layout` är redan papperet). */
      readonly printLayout?: string | undefined }
  /** ADR-0213: baksidan per löpare; null = förvalet igen. */
  | { readonly type: "SET_RUNNER_BACK"; readonly back: RunnerBackLayout | null }
  /** Papperets mall (ADR-0197): lägg till eller ersätt per id, ta bort (banorna som ärver av den står kvar utan mall). */
  | { readonly type: "PUT_PAPER_TEMPLATE"; readonly template: PaperTemplate }
  | { readonly type: "DELETE_PAPER_TEMPLATE"; readonly id: string };

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
