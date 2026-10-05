import type { StartCheckinOperation } from "@o-tid/contracts";

/** Avprickningar görs bara online i arbetsytan: av administratören eller en funktionär (ADR-0172 beslut 3). */
export type OnlineStartCheckinCapability = "MANAGE_RACE" | "RACE_FUNCTIONARY";

export function isOnlineStartCheckinSource(capability: string): capability is OnlineStartCheckinCapability {
  return capability === "MANAGE_RACE" || capability === "RACE_FUNCTIONARY";
}

/**
 * Vilka åtgärder en källa får ha gjort. Används både när en ny avprickning sparas och när journalen läses;
 * journalen kan ha äldre rader från de borttagna personalmobilerna (START_CHECKIN/FINISH_FOREST_WATCH).
 */
export function allowsStartCheckinSourceAction(capability: string, action: StartCheckinOperation["action"]): boolean {
  if (capability === "START_CHECKIN") return action.kind === "MARK_START";
  if (capability === "FINISH_FOREST_WATCH") return action.kind === "FINISH_CORRECTION";
  return isOnlineStartCheckinSource(capability) && (action.kind === "MARK_START" ||
    (action.kind === "FINISH_CORRECTION" &&
      (action.manualReturnRegistered === true || action.manualReturnRegistered === false)));
}
