/**
 * Träningsläget (ADR-0192): träningsformer per avsnitt av en bana, symbolfilter för kartan, ritade områden och sista säkra.
 * Bara O-Tid; banorna, kontrollerna och avläsningen läser aldrig detta. I .ppen skrivs det som ett eget element i O-Tid:s
 * namnrymd (`training-ppen.ts`). Koordinater i kartans mm (y uppåt), mått i terrängen i meter.
 */
import type { Point } from "@o-tid/map-file";

/** Symbolgrupperna efter ISOM 2017-2 och ISSprOM 2019-2 (huvudnumret), se `training-symbols.ts`. */
export type SymbolGroup = "LANDFORM" | "ROCK" | "WATER" | "VEGETATION" | "PATHS" | "MANMADE" | "FORBIDDEN" | "TECHNICAL" | "OTHER";

export type FilterPreset = "ALL" | "CONTOURS" | "CONTOURS_WATER_ROCK" | "NO_VEGETATION" | "NO_PATHS" | "PATHS_ROADS" | "CUSTOM";

/** Vad som syns av kartan: grupperna, och undantag per symbolnummer (som i filen, t.ex. "101.0" eller "101"). */
export interface SymbolFilter {
  readonly preset: FilterPreset;
  readonly groups: readonly SymbolGroup[];
  readonly hide: readonly string[];
  readonly show: readonly string[];
}

/** Kartan där inget avsnitt visar den: hela, vit, tonad (andel mot vitt 0–1) eller med ett filter. */
export type TrainingOutside =
  | { readonly kind: "FULL" }
  | { readonly kind: "WHITE" }
  | { readonly kind: "TINT"; readonly lighten: number }
  | { readonly kind: "FILTER"; readonly filter: SymbolFilter };

export type SectionForm = "CORRIDOR" | "WINDOW" | "BAND" | "NO_MAP";

export interface CorridorOptions {
  readonly shape: "ANGULAR" | "SMOOTH";
  /** Hela korridorens bredd i meter. */
  readonly widthMeters: number;
  /** Mjuk: hur mycket linjen rundas före bufferten (0–1). */
  readonly smoothing: number;
  /** Bredd per sträcka (nyckel `${från}-${till}`, kontrollernas id). */
  readonly legWidths?: Readonly<Record<string, number>> | undefined;
}

export interface WindowOptions {
  readonly shape: "CIRCLE" | "SQUARE";
  readonly radiusMeters: number;
}

export interface SectionMarker {
  readonly kind: "NONE" | "TEXT" | "BAR";
  /** Texten; saknas = formens namn och "→". */
  readonly text?: string | undefined;
}

/** En träningsform för en del av banan: från banans kontroll `from` till `to` (null = start respektive mål). */
export interface TrainingSection {
  readonly id: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly form: SectionForm;
  readonly corridor?: CorridorOptions | undefined;
  readonly window?: WindowOptions | undefined;
  /** BAND och NO_MAP: bältets hela bredd i meter. */
  readonly bandMeters?: number | undefined;
  /** Det som syns inne i formen. */
  readonly filter: SymbolFilter;
  readonly marker: SectionMarker;
}

export interface StarTraining {
  /** Den centrala kontrollen (kontrollens id). */
  readonly center: string;
  readonly print: "ALL" | "PER_CONTROL";
}

export interface LineTraining {
  readonly points: readonly Point[];
}

/** Kepsorientering: par av banans kontroller (banans kontroll-id), i ordning; det första i paret är a. */
export interface PairTraining {
  readonly pairs: readonly (readonly [string, string])[];
  /** Visa banans sträckor på kartan (förval nej). */
  readonly legs: boolean;
  /** Förval en gemensam karta; SEPARATE = en karta för löpare A och en för B. */
  readonly print: "COMMON" | "SEPARATE";
}

/** Minnes- och pusselorientering: en liten kartbit per sträcka. */
export interface PieceTraining {
  /** Bitens sida på papperet i mm. */
  readonly sizeMm: number;
  /** Utskriftsskala; saknas = banans. */
  readonly scale?: number | undefined;
  /** Marginal runt sträckan i meter. */
  readonly marginMeters: number;
  readonly order: "COURSE" | "SHUFFLED";
}

export interface CourseTraining {
  /** Grundfiltret för hela kartan på banan; saknas = hela kartan. */
  readonly filter?: SymbolFilter | undefined;
  readonly outside: TrainingOutside;
  /** I banans ordning; där ytor överlappar gäller det tidigare. */
  readonly sections: readonly TrainingSection[];
  readonly star?: StarTraining | undefined;
  readonly line?: LineTraining | undefined;
  readonly pairs?: PairTraining | undefined;
  readonly pieces?: PieceTraining | undefined;
  /** Spegelorientering: kartan och banan spegelvända i utskriften (texterna vänds inte). Editorn ritar kartan som vanligt. */
  readonly mirror?: boolean | undefined;
}

/** Ett ritat område med eget filter (t.ex. bara kurvbild här). */
export interface TrainingArea {
  readonly id: string;
  readonly name?: string | undefined;
  readonly polygon: readonly Point[];
  readonly filter: SymbolFilter;
  /** Banorna det gäller; tomt = alla. */
  readonly courses: readonly string[];
}

/** Sista säkra (attackpunkt) på sträckan från–till (kontrollernas id). Inte en kontroll. */
export interface AttackPoint {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly at: Point;
}

export interface AttackStyle {
  /** Ringens diameter som andel av kontrollringens (0,4–0,9). */
  readonly sizeRatio: number;
  readonly style: "SOLID" | "DASHED" | "THIN";
}

export interface TrainingSettings {
  readonly schemaVersion: 1;
  readonly courses: Readonly<Record<string, CourseTraining>>;
  readonly areas: Readonly<Record<string, TrainingArea>>;
  readonly attackPoints: Readonly<Record<string, AttackPoint>>;
  readonly attackStyle?: AttackStyle | undefined;
}

/**
 * Ändringen: hela delar per id (null = tas bort). Samma form i `PUT_OBJECTS.training` för ångra och gör om (ADR-0192
 * beslut 11).
 */
export interface TrainingPatch {
  readonly courses?: Readonly<Record<string, CourseTraining | null>> | undefined;
  readonly areas?: Readonly<Record<string, TrainingArea | null>> | undefined;
  readonly attackPoints?: Readonly<Record<string, AttackPoint | null>> | undefined;
  readonly attackStyle?: AttackStyle | null | undefined;
}

/** Hur banpåtrycket ritas för träningen (ADR-0192 beslut 7). */
export interface OverprintTraining {
  /** Linjeorientering: löparens karta (förval) eller kontrollantens. */
  readonly view?: "RUNNER" | "CONTROLLER" | undefined;
  /** Kepsorientering: gemensam karta (förval) eller löpare A respektive B. */
  readonly pairMap?: "COMMON" | "A" | "B" | undefined;
  /** Bara positionerna `from`–`to` (0-baserat, inklusive) i variantens kontrollföljd. */
  readonly section?: { readonly from: number; readonly to: number } | undefined;
  /** Utan träningen (före/efter i editorn). */
  readonly off?: boolean | undefined;
}

/**
 * Ett pass när kartan ritas (ADR-0192 beslut 3): rita bara inom alla ytor i `within` och utanför alla ytor i `without` (en
 * yta är ringar som fylls jämn–udda), med alla `filters` (en symbol syns bara om alla visar den), eller inte alls (`white`).
 */
export interface TrainingMapPass {
  readonly within: readonly (readonly (readonly Point[])[])[];
  readonly without: readonly (readonly (readonly Point[])[])[];
  readonly filters: readonly SymbolFilter[];
  readonly white?: boolean | undefined;
  /** Alla kartans färger ljusare (0–1 mot vitt). */
  readonly lighten?: number | undefined;
}
