import { describe, expect, it } from "vitest";
import { raceAdministratorAllowsAction } from "../src/race-administrator-policy";
import type { RaceAdminCapability } from "../src/pairing-admin";

const capabilities = [
  "MANAGE_RACE", "PAIR_STATION", "IMPORT_IOF", "CHANGE_ENTRY_CLASS",
  "CHANGE_ENTRY_START_TIME", "DRAW_CLASS_START_TIMES", "CHANGE_ENTRY_CARD",
  "CHANGE_ENTRY_IDENTITY", "REGISTER_ENTRY", "RECALCULATE_RESULT",
  "VIEW_RACE_OVERVIEW", "VIEW_START_LIST", "VIEW_SPEAKER_BOARD",
  "MANAGE_PM_DOCUMENT", "START_CHECKIN", "FINISH_FOREST_WATCH",
  "PUBLISH_START_LIST", "VIEW_READOUT_RESULT_HISTORY", "EXPORT_IOF_RESULT_LIST",
  "FINALIZE_RESULTS", "DECIDE_DID_NOT_START", "WITHDRAW_DID_NOT_START",
  "DISQUALIFY_RESULT", "WITHDRAW_DISQUALIFICATION", "APPROVE_RESULT",
  "WITHDRAW_RESULT_APPROVAL", "DECIDE_DID_NOT_FINISH", "WITHDRAW_DID_NOT_FINISH",
  "DECIDE_OUT_OF_COMPETITION", "WITHDRAW_OUT_OF_COMPETITION",
  "DECIDE_WITHOUT_TIMING", "WITHDRAW_WITHOUT_TIMING"
] as const satisfies readonly RaceAdminCapability[];

describe("race administrator action policy", () => {
  it("preserves every existing credential's exact capability without escalation", () => {
    for (const credential of capabilities) {
      if (credential === "MANAGE_RACE") continue;
      for (const action of capabilities) {
        expect(raceAdministratorAllowsAction(credential, action), `${credential} -> ${action}`)
          .toBe(credential === action);
      }
    }
  });

  it("grants only explicitly integrated actions and the administrator's own scope", () => {
    const allowed = ["MANAGE_RACE", "VIEW_RACE_OVERVIEW", "VIEW_START_LIST", "CHANGE_ENTRY_CLASS", "CHANGE_ENTRY_CARD", "CHANGE_ENTRY_START_TIME", "RECALCULATE_RESULT", "CHANGE_ENTRY_IDENTITY", "REGISTER_ENTRY", "DECIDE_DID_NOT_START", "WITHDRAW_DID_NOT_START"];
    allowed.push("DECIDE_DID_NOT_FINISH", "WITHDRAW_DID_NOT_FINISH");
    allowed.push("DISQUALIFY_RESULT", "WITHDRAW_DISQUALIFICATION");
    allowed.push("APPROVE_RESULT", "WITHDRAW_RESULT_APPROVAL");
    allowed.push("DECIDE_OUT_OF_COMPETITION", "WITHDRAW_OUT_OF_COMPETITION");
    allowed.push("DECIDE_WITHOUT_TIMING", "WITHDRAW_WITHOUT_TIMING");
    allowed.push("EXPORT_IOF_RESULT_LIST");
    allowed.push("FINALIZE_RESULTS");
    allowed.push("DRAW_CLASS_START_TIMES");
    allowed.push("PUBLISH_START_LIST");
    for (const action of capabilities) {
      expect(raceAdministratorAllowsAction("MANAGE_RACE", action), action).toBe(allowed.includes(action));
    }
  });
});
