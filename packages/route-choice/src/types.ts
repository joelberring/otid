/**
 * Steg 60 (ADR-0179 beslut 7–13): kontraktet för vägvalsanalysen. Ren TypeScript utan I/O; körs i arrangörens
 * webbläsare (Worker). Koordinater är kartfilens mm med y uppåt (som `@o-tid/map-file` och IOF `MapPosition`).
 * Analysen använder bara det som står på kartan (inga höjdmodeller).
 */
import type { ParsedMap, Point } from "@o-tid/map-file";

/** Löpbarhetsklass för en symbol. */
export type SpeedClass = "FAST" | "NORMAL" | "SLOW" | "VERY_SLOW" | "FIGHT" | "IMPASSABLE" | "IGNORE";

/** Tävlingens inställningar (sparas som jsonb). Allt utom `version` får saknas och ersätts då av standardvärden. */
export interface RouteChoiceSettings {
  readonly version: 1;
  /** Klass per symbolnummer som text ("406", "406.0", "105.100"); ett huvudnummer ("406") gäller alla undernummer. */
  readonly classBySymbol?: Readonly<Record<string, SpeedClass>>;
  /** Fart relativt normal skog (1,0) per klass. */
  readonly speedByClass?: Readonly<Partial<Record<Exclude<SpeedClass, "IMPASSABLE" | "IGNORE">, number>>>;
  /** Ekvidistans i meter (standard 5). */
  readonly contourIntervalMeters?: number;
  /** Meter plan väg per meter stigning (standard 8). */
  readonly climbFactor?: number;
  /** Fart i normal skog för uppskattad tid, sekunder per km (standard 360 = 6:00/km). */
  readonly referencePaceSecondsPerKm?: number;
}

/** Kostnadsmodellen för en karta med inställningarna, byggd en gång och återanvänd för alla sträckor. */
export interface CostModel {
  readonly map: ParsedMap;
  /** Symboler som används på kartan men saknas i tabellen; räknas som vanlig skog. */
  readonly unknownSymbols: readonly { readonly code: string; readonly name: string; readonly objects: number }[];
}

export interface LegInput {
  /** T.ex. "S-31.1", "31.1-32.1" (samma nyckel som sträcktidstabellen, `packages/domain/src/route-legs.ts`). */
  readonly key: string;
  readonly from: Point;
  readonly to: Point;
  /** Andra kontroller på banan (för varningen om att bästa vägen går genom en annan kontrolls ring). */
  readonly otherControls?: readonly { readonly code: string; readonly at: Point }[];
}

export interface RouteLine {
  /** Vägen i kartans mm. */
  readonly points: readonly Point[];
  readonly meters: number;
  /** Stigning ur höjdkurvorna (meter). */
  readonly climbMeters: number;
  /** Uppskattad tid i sekunder med referensfarten. */
  readonly seconds: number;
}

export type LegWarning =
  | { readonly kind: "THROUGH_OTHER_CONTROL"; readonly code: string }
  | { readonly kind: "CONTROL_IN_IMPASSABLE"; readonly end: "from" | "to" }
  | { readonly kind: "NO_ROUTE" };

export interface LegAnalysis {
  readonly key: string;
  readonly straightMeters: number;
  /** Saknas när ingen väg finns (varningen NO_ROUTE). */
  readonly best?: RouteLine | undefined;
  /** Upp till tre tydligt skilda vägval utöver det bästa (högst 15 % sämre, under hälften gemensamt). */
  readonly alternatives: readonly (RouteLine & { readonly timeRatio: number })[];
  /** Stråket med vägar högst 5 % sämre än bästa: ett rutnät som kan ritas som tonad yta. */
  readonly corridor?: {
    readonly origin: Point;
    readonly cellMm: number;
    readonly width: number;
    readonly height: number;
    /** 1 = inom stråket. Rad för rad, första raden överst (största y). */
    readonly mask: Uint8Array;
  } | undefined;
  /** ROUTE_CHOICE: skilda vägval finns; NO_CHOICE: ett tydligt bästa; ABOUT_EQUAL: bästa byter plats vid farter ±15 %. */
  readonly verdict: "ROUTE_CHOICE" | "NO_CHOICE" | "ABOUT_EQUAL";
  readonly warnings: readonly LegWarning[];
  readonly milliseconds: number;
}

/** Ett GPS-spår för kalibreringen: en löpares väg (t.ex. en sträcka) i kartans mm med tid i ms. */
export interface CalibrationSample {
  readonly key?: string | undefined;
  /**
   * Löparen (t.ex. deltagarens id). Varje löpare får en egen faktor för sin form; utan id delar alla prov en faktor.
   * En faktor per sträcka går inte, eftersom den skulle svälja skillnaden mellan klasserna.
   */
  readonly runner?: string | undefined;
  readonly points: readonly { readonly x: number; readonly y: number; readonly ms: number }[];
}

export type CalibratedClass = Exclude<SpeedClass, "IMPASSABLE" | "IGNORE">;

export interface CalibrationResult {
  /** Föreslagna farter (relativt normal skog); klasser med för lite data behåller sitt värde. */
  readonly speedByClass: Readonly<Record<CalibratedClass, number>>;
  readonly perClass: Readonly<Record<CalibratedClass, {
    /** Segment som räknats in (klassen utgör minst en del av segmentet). */
    readonly segments: number;
    /** Meter i klassen i de inräknade segmenten. */
    readonly meters: number;
    /** Farten är skattad ur rutterna (annars behållen). */
    readonly estimated: boolean;
  }>>;
  /** NONE: inget ändrat; LOW/MEDIUM/HIGH efter mängden data. */
  readonly reliability: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  readonly samplesUsed: number;
  readonly segmentsUsed: number;
  /** Segment som räknats bort (orimlig fart, GPS-hopp, genom ej passerbart, avvikare). */
  readonly segmentsRejected: number;
}
