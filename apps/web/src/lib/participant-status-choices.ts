import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";

/** Valen i deltagarkortets meny "Ändra status" (ADR-0169 beslut 4). */
export const statusChoices = ["DNS", "DNF", "DSQ", "OOC", "NT", "APPROVAL", "DNS_WITHDRAWAL", "DNF_WITHDRAWAL",
  "DSQ_WITHDRAWAL", "OOC_WITHDRAWAL", "NT_WITHDRAWAL", "APPROVAL_WITHDRAWAL", "RECALCULATION"] as const;
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
  if (result.state === "NO_PUBLISHED_RESULT") return ["DNS"];
  if (result.state === "NO_ACTIVE_RESULT") return ["DNS", "RECALCULATION"];
  switch (result.governingDecision) {
    case "DNS": case "CHECKIN_DNS": return ["DNS_WITHDRAWAL"];
    case "DNF": return ["DNF_WITHDRAWAL", "RECALCULATION"];
    case "DSQ": return ["DSQ_WITHDRAWAL", "RECALCULATION"];
    case "OOC": return ["OOC_WITHDRAWAL", "RECALCULATION"];
    case "NT": return ["NT_WITHDRAWAL", "RECALCULATION"];
    case "APPROVAL": return ["APPROVAL_WITHDRAWAL", "RECALCULATION"];
    case "NONE": return [...(result.result.status === "MP" ? ["APPROVAL" as const] : []), "DNF", "DSQ", "OOC", "NT", "RECALCULATION"];
  }
}
