import { isLikelyRobot } from "@o-tid/application";

/**
 * Besöksstatistiken (ägaren 2026-11-22): om en sidvisning ska räknas. Inte robotar och tom webbläsare (`isLikelyRobot`), och
 * inte när Next eller webbläsaren hämtar sidan i förväg (länkar som syns på skärmen förhämtas, utan att någon klickat).
 */
export function visitWorthCounting(headers: Pick<Headers, "get">): boolean {
  if (headers.get("next-router-prefetch") !== null) return false;
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""} ${headers.get("x-purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("preview")) return false;
  return !isLikelyRobot(headers.get("user-agent"));
}
