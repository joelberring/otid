import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";

/** Valen i deltagarkortets meny "Ändra status" (ADR-0169 beslut 4). */
export const statusChoices = ["DNS", "DNF", "DSQ", "OOC", "NT", "APPROVAL", "DNS_WITHDRAWAL", "DNF_WITHDRAWAL",
  "DSQ_WITHDRAWAL", "OOC_WITHDRAWAL", "NT_WITHDRAWAL", "APPROVAL_WITHDRAWAL", "MANUAL_TIME_WITHDRAWAL",
  "CONTROL_APPROVAL_WITHDRAWAL", "RECALCULATION"] as const;
export type StatusChoice = typeof statusChoices[number];

export function isStatusChoice(value: string): value is StatusChoice {
  return (statusChoices as readonly string[]).includes(value);
}

/**
 * Vilka val som är meningsfulla för löparens gällande resultat. Ett gällande beslut
 * kan bara tas bort; utan beslut kan ett nytt fattas. Servern prövar alltid valet igen.
 */
export function availableStatusChoices(result: AdministratorEffectiveResultResponse | undefined): StatusChoice[] {
  if (!result) return [];
  // Steg 31: brutit går även utan avläsning (borttappad bricka); manuell tid finns under "Ange tid manuellt".
  if (result.state === "NO_PUBLISHED_RESULT") return ["DNS", "DNF"];
  if (result.state === "NO_ACTIVE_RESULT") return ["DNS", "DNF", "RECALCULATION"];
  switch (result.governingDecision) {
    case "DNS": case "CHECKIN_DNS": return ["DNS_WITHDRAWAL"];
    case "DNF": return ["DNF_WITHDRAWAL", "RECALCULATION"];
    case "DSQ": return ["DSQ_WITHDRAWAL", "RECALCULATION"];
    case "OOC": return ["OOC_WITHDRAWAL", "RECALCULATION"];
    case "NT": return ["NT_WITHDRAWAL", "RECALCULATION"];
    case "APPROVAL": return ["APPROVAL_WITHDRAWAL", "RECALCULATION"];
    case "MANUAL_TIME": return ["MANUAL_TIME_WITHDRAWAL", "RECALCULATION"];
    case "CONTROL_APPROVAL": return ["CONTROL_APPROVAL_WITHDRAWAL", "RECALCULATION"];
    case "NONE": {
      // "Godkänn manuellt" bara när tiden finns; saknas start eller mål är "Ange tid manuellt" vägen (steg 31).
      const timedMispunch = result.result.status === "MP" && (result.result.reason === "MISSING_CONTROL" || result.result.reason === "WRONG_ORDER");
      return [...(timedMispunch ? ["APPROVAL" as const] : []), "DNF", "DSQ", "OOC", "NT", "RECALCULATION"];
    }
  }
}
