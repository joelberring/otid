import { describe, expect, it } from "vitest";
import { cardPunchSummary, formatPunchDate, punchTimeText } from "./card-punches-sv";

const base = { raceDate: "2026-10-19", punches: [], missingControls: [], otherDates: [], allOtherDay: false, noStartPunch: false,
  noFinishPunch: false };

describe("brickans stämplingar i ord (PLAN.md steg 27)", () => {
  it("datum som veckodag, dag och månad utan punkt", () => {
    expect(formatPunchDate("2026-10-14")).toBe("ons 14 okt");
    expect(punchTimeText({ punchedAt: "2026-10-14T16:05:00Z", localDate: "2026-10-14" }, "2026-10-19", "Europe/Stockholm"))
      .toBe("ons 14 okt 18:05:00");
    expect(punchTimeText({ punchedAt: "2026-10-19T16:05:00Z", localDate: "2026-10-19" }, "2026-10-19", "Europe/Stockholm")).toBe("18:05:00");
  });

  it("sammanfattningen säger annan dag, ingen start och saknade kontroller", () => {
    expect(cardPunchSummary({ ...base, otherDates: ["2026-10-14"], allOtherDay: true, noStartPunch: true, missingControls: [31] })).toEqual([
      "Stämplingarna är från ons 14 okt, inte från tävlingsdagen (mån 19 okt).",
      "Brickan har troligen inte tömts före loppet.",
      "Brickan har ingen startstämpling."]);
    expect(cardPunchSummary({ ...base, otherDates: ["2026-10-14", "2026-10-17"], missingControls: [31, 32] })).toEqual([
      "Några stämplingar är från ons 14 okt och lör 17 okt, inte från tävlingsdagen (mån 19 okt).",
      "Saknade kontroller: 31, 32."]);
    expect(cardPunchSummary(base)).toEqual([]);
  });
});
