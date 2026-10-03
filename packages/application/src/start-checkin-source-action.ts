import type { StartCheckinOperation } from "@o-tid/contracts";
export function allowsStartCheckinSourceAction(capability: string, action: StartCheckinOperation["action"]): boolean {
  if (capability === "START_CHECKIN") return action.kind === "MARK_START";
  if (capability === "FINISH_FOREST_WATCH") return action.kind === "FINISH_CORRECTION";
  return capability === "MANAGE_RACE" && (action.kind === "MARK_START" ||
    (action.kind === "FINISH_CORRECTION" &&
      (action.manualReturnRegistered === true || action.manualReturnRegistered === false)));
}
