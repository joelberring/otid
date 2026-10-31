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

export type RouteChoiceWorkerRequest =
  | { readonly type: "load"; readonly bytes: ArrayBuffer; readonly fileName: string; readonly settings: RouteChoiceSettings }
  | { readonly type: "settings"; readonly settings: RouteChoiceSettings }
  | { readonly type: "analyse"; readonly runId: number; readonly legs: readonly LegInput[] }
  | { readonly type: "cancel"; readonly runId: number }
  | { readonly type: "calibrate"; readonly runId: number; readonly samples: readonly CalibrationSample[] };

export type RouteChoiceWorkerErrorCode = "NOT_A_MAP_FILE" | "UNSUPPORTED_VERSION" | "TRUNCATED" | "INVALID" | "NO_MODEL" | "FAILED";

export type RouteChoiceWorkerResponse =
  | { readonly type: "model"; readonly unknownSymbols: CostModel["unknownSymbols"]; readonly speeds: SpeedFactors }
  | { readonly type: "leg"; readonly runId: number; readonly index: number; readonly analysis: LegAnalysis }
  | { readonly type: "done"; readonly runId: number }
  | { readonly type: "calibrated"; readonly runId: number; readonly result: CalibrationResult }
  | { readonly type: "error"; readonly code: RouteChoiceWorkerErrorCode; readonly runId?: number | undefined };
