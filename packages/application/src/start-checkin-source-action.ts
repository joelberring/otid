import type { StartCheckinOperation } from "@o-tid/contracts";

/** Avprickningar görs bara online i arbetsytan: av administratören eller en funktionär (ADR-0172 beslut 3). */
export type StartCheckinSourceRole = "ADMIN" | "FUNCTIONARY";

/** Vilka åtgärder en källa får ha gjort. Används både när en ny avprickning sparas och när journalen läses. */
export function allowsStartCheckinSourceAction(role: string, action: StartCheckinOperation["action"]): boolean {
  return (role === "ADMIN" || role === "FUNCTIONARY") && (action.kind === "MARK_START" ||
    (action.kind === "FINISH_CORRECTION" &&
      (action.manualReturnRegistered === true || action.manualReturnRegistered === false)));
}
