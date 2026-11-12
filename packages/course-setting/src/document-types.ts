import type { Point } from "@o-tid/map-file";
import type { SheetLayout } from "./sheet-layout";
import type { CoursePaperLayout, PaperItem, PaperTemplate, PaperValues } from "./paper-items";
import type { PrintProfile } from "./print-profile";
import type { LayoutSheet, MainLayoutSettings, PrintLayout } from "./print-layouts";
import type { LayoutState } from "./print-layout-states";
import type { TrainingSettings } from "./training-types";
import type { CourseLevel } from "./level-types";

/** Banläggningens dokument (se `types.ts`): kontroller, banor, sträckor, specialobjekt och händelsens inställningar. */

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
  /**
   * ADR-0175, tillägg 2026-11-12 (c): grenens bokstav när kontrollen börjar en gren (A, B …). Bara O-Tid; skrivs i .ppen i
   * O-Tid:s namnrymd (`<otid:letters>`). Saknas = bokstäver i Purple Pens ordning (`variantLetters`).
   */
  readonly letter?: string | undefined;
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
  /** Kartbyten (ADR-0203): delarnas tryckytor (Purple Pens `<print-area part="n">`), per del "0", "1" …; saknas = banans. */
  readonly partPrintAreas?: Readonly<Record<string, PrintArea>> | undefined;
  /**
   * ADR-0198: varianter som inte används (färre gafflingsvarianter). De förs inte över till tävlingen, skrivs inte i IOF XML
   * och skrivs inte ut. Bara O-Tid; i .ppen i O-Tid:s namnrymd (`<otid:variants>`).
   */
  readonly excludedVariants?: readonly ExcludedVariant[] | undefined;
  /**
   * ADR-0175, tillägg 2026-11-12 (c): bokstäver som har använts på banans grenar men tagits bort; en ny gren får dem inte så
   * länge andra finns. Bara O-Tid (i .ppen i `<otid:letters>`).
   */
  readonly retiredLetters?: readonly string[] | undefined;
  /**
   * ADR-0212: banans målnivå (Grön … Svart) för nivåstödet. Bara O-Tid; skrivs inte till .ppen och följer med när en ny .ppen
   * läses in (`carryCourseLevels`). Saknas = ingen.
   */
  readonly level?: CourseLevel | undefined;
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

/** ADR-0213: baksidan per löpare (papperets element, förankrade i arket). */
export interface RunnerBackLayout { readonly items: readonly PaperItem[] }

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
    /**
     * Mellanrummet mellan sträckornas ände och ringarna i mm på papperet (ADR-0211 beslut 2, ISOM 2017-2 705). Bara O-Tid;
     * skrivs inte till .ppen. Saknas = `LEG_CIRCLE_GAP_MM`.
     */
    readonly legCircleGapMm?: number | undefined;
    /** Steg 64: Alla kontrollers utskriftsskala (`<all-controls print-scale>`) och tryckyta (`<print-area>` i `<event>`). */
    readonly allControlsPrintScale?: number | undefined;
    readonly printArea?: PrintArea | undefined;
    /**
     * Steg 64 (ADR-0183): tävlingens utskriftsprofiler (färger per kartlager, banans färg) och vald profil, och
     * layoutmallarna. Bara O-Tid; skrivs inte till .ppen och följer med när en ny .ppen läses in.
     */
    readonly printProfiles?: readonly PrintProfile[] | undefined;
    readonly printProfileId?: string | undefined;
    /** "Kartor per ark" i UI, `SheetLayout` i koden; nyckeln heter som förut eftersom den är lagrad (docs/domain-rules.md, Ordlista). */
    readonly layoutTemplates?: readonly SheetLayout[] | undefined;
    /**
     * Papperet per bana (nyckel = banans id eller "ALL_CONTROLS"): kontrollbeskrivningen på kartan och senare andra element
     * på arket (`paper-layout.ts`). Bara O-Tid; en utplacerad beskrivning skrivs till .ppen som Purple Pens `descriptions`.
     */
    readonly paperLayouts?: Readonly<Record<string, CoursePaperLayout>> | undefined;
    /**
     * ADR-0199: varningar som banläggaren godtagit ("Det är meningen"), per nyckel (`checkKey`). Bara O-Tid; skrivs inte till
     * .ppen och följer med när en ny .ppen läses in (de vars kontroller och objekt finns kvar).
     */
    readonly acceptedChecks?: Readonly<Record<string, AcceptedCheck>> | undefined;
    /**
     * Ägaren 2026-11-08: vägvalsanalysens troliga vägar nära kontrollerna (`routeHintKey`), så att kontrollnumren läggs utanför
     * dem både på skärmen och i PDF:en. Bara O-Tid; skrivs inte till .ppen. En väg vars kontroller flyttats används inte.
     */
    readonly routeHints?: Readonly<Record<string, RouteHint>> | undefined;
    /**
     * ADR-0212: nivåstödets avvikelser mot banornas målnivå visas som notiser i Varningar ("Visa avvikelser mot nivån i
     * Varningar"). Bara O-Tid; saknas = av.
     */
    readonly levelNotices?: boolean | undefined;
    /**
     * Ägaren 2026-11-09: kontrollnumren i en variant eller del placeras för den för sig (efter just dess sträckor), i stället
     * för där hela banan har dem. Bara O-Tid; saknas = samma läge i alla varianter.
     */
    readonly numbersPerVariant?: boolean | undefined;
    /**
     * Användartestet 2026-11-12: kartornas rubrik är filens titel (`title`) i stället för tävlingens namn i O-Tid
     * (`printedTitle`). Bara O-Tid; skrivs inte till .ppen och följer med när en ny .ppen läses in. Saknas = tävlingens namn.
     */
    readonly printFileTitle?: boolean | undefined;
    /** Papperets mallar (ADR-0197) som banorna ärver av, och värdena för {datum} och {ekvidistans}. Bara O-Tid. */
    readonly paperTemplates?: readonly PaperTemplate[] | undefined;
    readonly paperValues?: PaperValues | undefined;
    /**
     * ADR-0213: baksidan i en karta per löpare (dubbelsidigt i samma PDF): papperets element med löparens variabler, förankrade
     * i arket. Saknas = förvalet (som Kartor till startens baksida). Bara variablerna sparas, aldrig löparna. Bara O-Tid.
     */
    readonly runnerBack?: RunnerBackLayout | undefined;
    /**
     * ADR-0217: layouterna utom huvudlayouten, deras ark (layout → bana), klassernas layout (klassnamn → layout),
     * huvudlayoutens namn och "Kartor per ark", och de sparade lägena. Bara O-Tid; skrivs inte till .ppen och följer med när
     * en ny .ppen läses in. Saknas = bara huvudlayouten (banans fält).
     */
    readonly layouts?: readonly PrintLayout[] | undefined;
    readonly layoutSheets?: Readonly<Record<string, Readonly<Record<string, LayoutSheet>>>> | undefined;
    readonly classLayouts?: Readonly<Record<string, string>> | undefined;
    readonly mainLayout?: MainLayoutSettings | undefined;
    readonly layoutStates?: readonly LayoutState[] | undefined;
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

/**
 * ADR-0199: en godtagen varning. `at` = lägena (kartans mm) för det varningen gäller när den godtogs: kontroller som
 * "c:<id>", specialobjekt (mittpunkten) som "s:<id>". Flyttas något mer än `ACCEPT_MOVE_METERS` gäller godtagandet inte.
 */
/** En sträckas troliga vägar (bästa och tydliga alternativ) i kartans mm, bara delarna nära start- och slutkontrollen. */
export interface RouteHint {
  readonly from: Point;
  readonly to: Point;
  readonly lines: readonly (readonly Point[])[];
}

export interface AcceptedCheck {
  readonly at: Readonly<Record<string, Point>>;
}
