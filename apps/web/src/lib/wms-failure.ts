import { failure, problem } from "./club-route-handlers";
import { privateJson } from "./security-policy";

/** Svaret för ett fel vid hämtning från en WMS-tjänst (kodernas texter finns i `i18n/map-wms-sv.ts`). */
export function wmsFailure(result: { status: string; code?: string }): Response {
  if (result.status === "throttled") return problem("SOURCE_THROTTLED");
  if (result.status !== "wms") return failure(result.status);
  // Tjänsten som inte svarar eller svarar fel är ett 502; allt annat är något användaren kan ändra (422).
  if (result.code === "UNREACHABLE" || result.code === "NOT_IMAGE") return privateJson({ formatVersion: 1, error: `WMS_${result.code}` }, 502);
  return problem(`WMS_${result.code}`);
}
