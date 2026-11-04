import type { ControlLevelFeatures, LegLevelFeatures, LevelControlInput } from "@o-tid/course-setting";
import type { CalibrationSample as EngineCalibrationSample, CostModel, LegAnalysis, LegInput, RouteChoiceSettings, SpeedClass }
  from "@o-tid/route-choice";

/**
 * Steg 60 (ADR-0177, ADR-0179 beslut 11): meddelandena mellan arbetsytan och vägvalsanalysens Worker. Kartfilen läses och
 * kostnadsmodellen byggs en gång; sedan räknas banan sträcka för sträcka med svar efter hand. En ny körning (annan bana)
 * avbryter den förra mellan två sträckor.
 */
export type SpeedFactors = Partial<Record<Exclude<SpeedClass, "IMPASSABLE" | "IGNORE">, number>>;

/** En GPS-rutts del för en sträcka i kartfilens mm med tiden i ms, för kalibreringen (motorns `CalibrationSample`). */
export type CalibrationSample = EngineCalibrationSample;

export interface CalibrationResult {
  readonly before: SpeedFactors;
  readonly after: SpeedFactors;
  /** Antal sträckor som räknades. */
  readonly samples: number;
  /** Hur mycket data det fanns: LOW/MEDIUM/HIGH, NONE när inget ändrades. */
  readonly reliability: "NONE" | "LOW" | "MEDIUM" | "HIGH";
}

/** Nivåstödet (ADR-0212): en sträcka att bedöma (vägvalets indata och kontrollernas id). */
export interface LevelLegRequest { readonly input: LegInput; readonly from: string; readonly to: string }

/** Nivåstödets mätning för en bana; `notApplicable` för sprintkartor (ingen färgskala). */
export interface LevelMeasured {
  readonly controls: readonly ControlLevelFeatures[];
  readonly legs: readonly LegLevelFeatures[];
  readonly notApplicable?: "SPRINT" | undefined;
}

export type RouteChoiceWorkerRequest =
  | { readonly type: "load"; readonly bytes: ArrayBuffer; readonly fileName: string; readonly settings: RouteChoiceSettings }
  | { readonly type: "settings"; readonly settings: RouteChoiceSettings }
  | { readonly type: "analyse"; readonly runId: number; readonly legs: readonly LegInput[] }
  | { readonly type: "cancel"; readonly runId: number }
  | { readonly type: "calibrate"; readonly runId: number; readonly samples: readonly CalibrationSample[] }
  /** ADR-0212: nivåstödet för en bana; `sprint` = banläggningen är för sprint (ISSprOM). */
  | { readonly type: "level"; readonly runId: number; readonly legs: readonly LevelLegRequest[]; readonly controls: readonly LevelControlInput[];
      readonly sprint: boolean };

export type RouteChoiceWorkerErrorCode = "NOT_A_MAP_FILE" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "INVALID" | "NO_MODEL" | "FAILED";

export type RouteChoiceWorkerResponse =
  | { readonly type: "model"; readonly unknownSymbols: CostModel["unknownSymbols"]; readonly speeds: SpeedFactors }
  | { readonly type: "leg"; readonly runId: number; readonly index: number; readonly analysis: LegAnalysis }
  | { readonly type: "done"; readonly runId: number }
  | { readonly type: "calibrated"; readonly runId: number; readonly result: CalibrationResult }
  /** ADR-0212: en sträcka är räknad (`best` i meter, för den gemensamma tabellen med vägvalen). */
  | { readonly type: "level-leg"; readonly runId: number; readonly done: number; readonly total: number; readonly key: string;
      readonly best: number | undefined; readonly straight: number }
  | { readonly type: "level"; readonly runId: number; readonly result: LevelMeasured }
  | { readonly type: "error"; readonly code: RouteChoiceWorkerErrorCode; readonly runId?: number | undefined };
