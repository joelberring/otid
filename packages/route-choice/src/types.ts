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
  /** Meter plan väg per meter stigning uppför (standard 8, Naismith). */
  readonly climbFactor?: number;
  /**
   * Meter plan väg per meter nedför (standard 3, Langmuir för brant nedför). Riktningen syns inte på kartan, så varje
   * kurvpassage kostar ekvidistans × (climbFactor + descentFactor) / 2 (se `defaults.ts`).
   */
  readonly descentFactor?: number;
  /** Lutningsfaktorns styrka i brant terräng utan stig, åt alla håll (standard 0,2; 0 = av). Se `defaults.ts`. */
  readonly slopeFactor?: number;
  /** Meter plan väg per passage av linjeobjekt som går att passera (202 brant, 104 jordbrant …), per symbolnummer. */
  readonly crossingMetersBySymbol?: Readonly<Record<string, number>>;
  /** Fart i normal skog för uppskattad tid, sekunder per km (standard 360 = 6:00/km). */
  readonly referencePaceSecondsPerKm?: number;
}

/** Kostnadsmodellen för en karta med inställningarna, byggd en gång och återanvänd för alla sträckor. */
export interface CostModel {
  readonly map: ParsedMap;
  /** Symboler som används på kartan men saknas i tabellen; räknas som vanlig skog. */
  readonly unknownSymbols: readonly { readonly code: string; readonly name: string; readonly objects: number }[];
}

/**
 * Spärrar och öppningar som inte finns i kartfilen (steg 64: banläggningens specialobjekt, t.ex. förbjudet område och
 * passager), i kartans mm. Ytor och linjer blir ej passerbara (som 709/520 på kartan), öppningarna öppnar spärrar
 * (som 710 passage och 519 genomgång). Linjernas och öppningarnas `widthMm` är hela bredden.
 */
export interface RouteBarriers {
  readonly areas?: readonly (readonly Point[])[] | undefined;
  readonly lines?: readonly { readonly points: readonly Point[]; readonly widthMm: number }[] | undefined;
  readonly openings?: readonly { readonly points: readonly Point[]; readonly widthMm: number }[] | undefined;
}

export interface LegInput {
  /** T.ex. "S-31.1", "31.1-32.1" (samma nyckel som sträcktidstabellen, `packages/domain/src/route-legs.ts`). */
  readonly key: string;
  readonly from: Point;
  readonly to: Point;
  /** Andra kontroller på banan (för varningen om att bästa vägen går genom en annan kontrolls ring). */
  readonly otherControls?: readonly { readonly code: string; readonly at: Point }[];
  /** Steg 64: banläggningens spärrar och öppningar för sträckan (saknas = bara kartan). */
  readonly barriers?: RouteBarriers | undefined;
}

export interface RouteLine {
  /** Vägen i kartans mm. */
  readonly points: readonly Point[];
  readonly meters: number;
  /**
   * Stigning uppför ur höjdkurvorna (meter): hälften av de passerade höjdmetrarna, eftersom kartan inte visar vilket håll
   * som är upp (exakt när vägen börjar och slutar på samma höjd).
   */
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
  /** Upp till fyra tydligt skilda vägval utöver det bästa (högst 25 % sämre, under hälften gemensamt), bäst först. */
  readonly alternatives: readonly (RouteLine & { readonly timeRatio: number })[];
  /** Stråket med vägar högst 5 % sämre än bästa: ett rutnät som kan ritas som tonad yta. */
  readonly corridor?: {
    /** Nedre vänstra hörnet i mm (y uppåt); masken börjar ändå med översta raden. */
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
  /**
   * Föreslagen stigning och lutningsfaktor. `climbFactor` skattas ur kostnaden per kurvpassage med `descentFactor`
   * fast: utan höjder syns inte vilka passager som var uppför, så bara summan upp + ned går att skatta.
   */
  readonly terrain: {
    readonly climbFactor: number;
    readonly climbEstimated: boolean;
    readonly slopeFactor: number;
    readonly slopeEstimated: boolean;
  };
}
