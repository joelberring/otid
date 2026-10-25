import type { DecisionReview } from "@o-tid/contracts";
import { decisionReviewSv as text } from "../i18n/decision-review-sv";
import { formatDuration } from "./clock-time";
import type { StatusChoice } from "./participant-status-choices";

/** "Avläsningen ger Godkänd 45:12 men beslutet Brutit gäller." */
export function decisionReviewText(review: DecisionReview): string {
  const readout = `${text.statuses[review.status]}${review.elapsedMs !== undefined ? ` ${formatDuration(review.elapsedMs)}` : ""}`;
  return text.message(readout, text.decisions[review.decision]);
}

/** Valet i "Ändra status" som tar bort beslutet. */
export function withdrawChoiceFor(decision: DecisionReview["decision"]): StatusChoice {
  switch (decision) {
    case "DSQ": return "DSQ_WITHDRAWAL";
    case "APPROVAL": return "APPROVAL_WITHDRAWAL";
    case "DNF": return "DNF_WITHDRAWAL";
    case "OOC": return "OOC_WITHDRAWAL";
    case "NT": return "NT_WITHDRAWAL";
    case "FINISH_TIME": case "START_TIME": case "MANUAL_TIME": return "MANUAL_TIME_WITHDRAWAL";
    case "CONTROL_APPROVAL": return "CONTROL_APPROVAL_WITHDRAWAL";
    case "MP_CONFIRMED": return "CONFIRM_MP_WITHDRAWAL";
  }
}
