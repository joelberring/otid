import * as routeChoice from "@o-tid/route-choice";
import type { ParsedMap, Point } from "@o-tid/map-file";
import type { CostModel, LegAnalysis, LegInput, RouteChoiceSettings } from "@o-tid/route-choice";
import type { SpeedFactors } from "./route-choice-worker-protocol";

/**
 * Steg 60: det Workern behöver av motorn i `@o-tid/route-choice` (byggs parallellt på grenen steg60-motor). Samlat här så
 * att Workern och testerna har ett ställe att byta mot när motorn är klar; saknas en funktion ger `engine()` undefined
 * och Workern svarar med ett fel i stället för att krascha.
 */
export interface RouteChoiceEngine {
  buildCostModel(map: ParsedMap, settings?: RouteChoiceSettings): CostModel;
  analyseLeg(model: CostModel, leg: LegInput): LegAnalysis;
  resolveSettings(settings?: RouteChoiceSettings | null): { readonly speedByClass: Required<SpeedFactors> };
  calibrateSpeeds(model: CostModel, samples: readonly { readonly points: readonly Point[]; readonly seconds: number }[])
    : { readonly speedByClass: SpeedFactors; readonly samples: number };
}

export function engine(): RouteChoiceEngine | undefined {
  const candidate = routeChoice as unknown as Partial<RouteChoiceEngine>;
  return typeof candidate.buildCostModel === "function" && typeof candidate.analyseLeg === "function" &&
    typeof candidate.resolveSettings === "function" ? candidate as RouteChoiceEngine : undefined;
}
