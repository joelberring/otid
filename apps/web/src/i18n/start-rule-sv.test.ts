import { describe, expect, it } from "vitest";
import { startRuleSv } from "./start-rule-sv";
import { startDrawSv } from "./start-draw-sv";
import { classTableSv } from "./class-table-sv";
import { listsSv } from "./lists-sv";
import { relaySv } from "./relay-sv";
import { raceAdministratorSv } from "./race-administrator-sv";
import { raceWorkflowDetailSv } from "./race-workflow-detail-sv";
import { forestWatchSv } from "./forest-watch-sv";

/** PLAN.md steg 24: ett ordval för startsätt i formulär, tabeller, lottning, listor och deltagarkortet. */
describe("startsättens ord", () => {
  it("tre ord för klasser och tre för stafettsträckor", () => {
    expect(startRuleSv.methods).toEqual({ FREE: "Fri start", MINUTE: "Minutstart", MASS: "Masstart" });
    expect(startRuleSv.rules).toEqual({ PUNCH: "Fri start", FIXED: "Minutstart" });
    expect(startRuleSv.relay).toEqual({ MASS_START: "Masstart", CHANGEOVER: "Växling", RESTART: "Omstart" });
  });

  it("alla vyer använder samma ord", () => {
    expect(startDrawSv.methods).toBe(startRuleSv.methods);
    expect(startDrawSv.method).toBe(startRuleSv.label);
    expect([classTableSv.free, classTableSv.fixed, classTableSv.startRule]).toEqual(["Fri start", "Minutstart", "Startsätt"]);
    expect([listsSv.start.freeStart, listsSv.start.minuteStart, listsSv.start.massStart(null)]).toEqual(["Fri start", "Minutstart", "Masstart"]);
    expect([listsSv.csv.free, listsSv.csv.minute, listsSv.csv.mass]).toEqual(["Fri start", "Minutstart", "Masstart"]);
    expect(relaySv.methods).toBe(startRuleSv.relay);
    expect([raceAdministratorSv.courseStartRule, raceAdministratorSv.courseFreeStart, raceAdministratorSv.courseFixedStart,
      raceAdministratorSv.rosterFreeStart, raceAdministratorSv.rosterFixedStart, raceAdministratorSv.fixed, raceAdministratorSv.punch])
      .toEqual(["Startsätt", "Fri start", "Minutstart", "Fri start", "Minutstart", "Minutstart", "Fri start"]);
    expect(raceWorkflowDetailSv.free).toBe("Fri start");
    expect(forestWatchSv.punch).toBe("Fri start");
  });

  it("de gamla orden finns inte kvar i texterna", () => {
    const all = JSON.stringify([startDrawSv, classTableSv, listsSv.start, raceAdministratorSv, raceWorkflowDetailSv, relaySv.methods]);
    for (const old of ["Startupplägg", "Lottad minutstart", "Fri start / startstämpling", "Fri start · startstämpling", "Målklassens startregel"]) {
      expect(all).not.toContain(old);
    }
  });
});
