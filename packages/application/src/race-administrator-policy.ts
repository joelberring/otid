import type { RaceAdminCapability } from "./pairing-admin";

// ADR-0069: only integrated work areas share the administrator session.
// Adding a capability elsewhere must never implicitly grant it to this role.
const administratorActions: ReadonlySet<RaceAdminCapability> = new Set([
  "VIEW_RACE_OVERVIEW",
  "VIEW_START_LIST",
  "CHANGE_ENTRY_CLASS",
  "CHANGE_ENTRY_CARD",
  "CHANGE_ENTRY_START_TIME",
  "RECALCULATE_RESULT",
  "CHANGE_ENTRY_IDENTITY",
  "REGISTER_ENTRY",
  "DECIDE_DID_NOT_START",
  "WITHDRAW_DID_NOT_START",
  "DECIDE_DID_NOT_FINISH",
  "WITHDRAW_DID_NOT_FINISH",
  "DISQUALIFY_RESULT",
  "WITHDRAW_DISQUALIFICATION",
  "APPROVE_RESULT",
  "WITHDRAW_RESULT_APPROVAL",
  "DECIDE_OUT_OF_COMPETITION",
  "WITHDRAW_OUT_OF_COMPETITION",
  "DECIDE_WITHOUT_TIMING",
  "WITHDRAW_WITHOUT_TIMING",
  "EXPORT_IOF_RESULT_LIST",
  "FINALIZE_RESULTS",
  "DRAW_CLASS_START_TIMES",
  "PUBLISH_START_LIST"
]);

export function raceAdministratorAllowsAction(
  credentialCapability: RaceAdminCapability,
  requestedCapability: RaceAdminCapability
): boolean {
  return credentialCapability === requestedCapability ||
    (credentialCapability === "MANAGE_RACE" && administratorActions.has(requestedCapability));
}
