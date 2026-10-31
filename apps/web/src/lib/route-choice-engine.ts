import * as routeChoice from "@o-tid/route-choice";
import type { Point } from "@o-tid/map-file";
import type { CostModel } from "@o-tid/route-choice";
import type { SpeedFactors } from "./route-choice-worker-protocol";

/**
 * Steg 60: kalibreringen i motorn (`calibrateSpeeds` i `@o-tid/route-choice`). Slås upp vid anropet, så att Workern ger ett
 * begripligt fel i stället för att krascha om motorn saknar den.
 */
export type CalibrateSpeeds = (model: CostModel, samples: readonly { readonly points: readonly Point[]; readonly seconds: number }[],
  settings?: routeChoice.RouteChoiceSettings | null) => { readonly speedByClass: SpeedFactors; readonly samples: number };

export function calibrateSpeeds(): CalibrateSpeeds | undefined {
  const candidate = (routeChoice as unknown as { calibrateSpeeds?: unknown }).calibrateSpeeds;
  return typeof candidate === "function" ? candidate as CalibrateSpeeds : undefined;
}
