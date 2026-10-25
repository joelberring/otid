import type { DecisionReview } from "@o-tid/contracts";

/** Steg 45: beslut som döljer en ny avläsning. */
export const decisionReviewSv = {
  decisions: { DSQ: "Diskvalificerad", APPROVAL: "Godkänd manuellt", DNF: "Brutit", OOC: "Utom tävlan", NT: "Deltog utan tid",
    FINISH_TIME: "Rättad måltid", START_TIME: "Rättad starttid", MANUAL_TIME: "Manuell tid", CONTROL_APPROVAL: "Godkända kontroller",
    MP_CONFIRMED: "Bekräftad felstämpling" } satisfies Record<DecisionReview["decision"], string>,
  statuses: { OK: "Godkänd", MP: "Felstämplad", OVERTIME: "Maxtid överskriden" } satisfies Record<DecisionReview["status"], string>,
  message: (readout: string, decision: string) => `Avläsningen ger ${readout} men beslutet ${decision} gäller.`,
  help: "Ta bort beslutet om avläsningen ska gälla. Annars kan du låta det stå.",
  remove: "Ta bort beslutet",
  listTitle: "Beslut att se över",
  listHelp: "Ett beslut gäller, men en senare avläsning ger något annat. Öppna löparen och ta bort beslutet om avläsningen ska gälla.",
  listEmpty: "Inga beslut att se över.",
  open: "Öppna"
};
