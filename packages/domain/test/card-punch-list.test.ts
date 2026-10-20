import { describe, expect, it } from "vitest";
import { cardPunchList, evaluateCardReadout, type RaceSnapshot } from "../src";

const ids = { race: "r", class: "c", course: "co", version: "v", entry: "e" };

function snapshot(codes: number[] = [31, 32, 33]): RaceSnapshot {
  return {
    race: { id: ids.race, eventId: "event", name: "Lopp", raceDate: "2026-10-19", snapshotVersion: 1 },
    classes: [{ id: ids.class, raceId: ids.race, name: "H21", courseVersionId: ids.version, startRule: "PUNCH" }],
    courses: [{ id: ids.course, raceId: ids.race, name: "Bana 1", versions: [{ id: ids.version, courseId: ids.course, version: 1,
      createdAt: "2026-10-01T08:00:00Z", controls: codes.map((code, index) => ({ id: `cc-${index}`, courseVersionId: ids.version,
        controlId: `control-${code}`, sequence: index + 1, controlCode: code })) }] }],
    entries: [{ id: ids.entry, raceId: ids.race, classId: ids.class, givenName: "Ada", familyName: "Löpare" }],
    cardAssignments: [{ id: "card", raceId: ids.race, entryId: ids.entry, cardNumber: "1234567", active: true }]
  };
}

describe("cardPunchList", () => {
  it("märker stämplingar på banan, extra och saknade kontroller på tävlingsdagen", () => {
    const list = cardPunchList({ startPunchedAt: "2026-10-19T16:00:00Z", finishPunchedAt: "2026-10-19T16:40:00Z",
      punches: [{ code: 31, punchedAt: "2026-10-19T16:10:00Z" }, { code: 99, punchedAt: "2026-10-19T16:15:00Z" },
        { code: 33, punchedAt: "2026-10-19T16:30:00Z" }] }, snapshot(), ids.entry, "Europe/Stockholm");
    expect(list.punches.map((row) => [row.order, row.code, row.placement])).toEqual([[1, 31, "ON_COURSE"], [2, 99, "EXTRA"], [3, 33, "ON_COURSE"]]);
    expect(list.missingControls).toEqual([32]);
    expect(list.otherDates).toEqual([]);
    expect(list.allOtherDay).toBe(false);
    expect(list.start).toEqual({ punchedAt: "2026-10-19T16:00:00Z", localDate: "2026-10-19" });
  });

  it("en bricka från ett lopp en vecka tidigare utan start: alla stämplingar syns, märkta som annan dag", () => {
    const old = { checkPunchedAt: "2026-10-14T15:55:00Z", finishPunchedAt: "2026-10-14T16:50:00Z",
      punches: [{ code: 31, punchedAt: "2026-10-14T16:05:00Z" }, { code: 45, punchedAt: "2026-10-14T16:20:00Z" }] };
    // Bedömningen stannar vid "Start saknas" och redovisar inga kontroller; listan visar ändå brickan.
    expect(evaluateCardReadout({ cardNumber: "1234567", ...old }, snapshot())).toMatchObject({ status: "MP", reason: "MISSING_START",
      missingControls: [], extraPunches: [] });
    const list = cardPunchList(old, snapshot(), ids.entry, "Europe/Stockholm");
    expect(list.punches.map((row) => [row.code, row.localDate, row.placement])).toEqual([[31, "2026-10-14", "OTHER_DAY"],
      [45, "2026-10-14", "OTHER_DAY"]]);
    expect(list.start).toBeUndefined();
    expect(list.check?.localDate).toBe("2026-10-14");
    expect(list.otherDates).toEqual(["2026-10-14"]);
    expect(list.allOtherDay).toBe(true);
    expect(list.missingControls).toEqual([32, 33]);
    expect(list).toMatchObject({ noStartPunch: true, noFinishPunch: false });
  });

  it("datumet räknas i tävlingens tidszon (strax efter midnatt lokal tid är tävlingsdagen)", () => {
    const list = cardPunchList({ punches: [{ code: 31, punchedAt: "2026-10-18T22:30:00Z" }] }, snapshot(), ids.entry, "Europe/Stockholm");
    expect(list.punches[0]).toMatchObject({ localDate: "2026-10-19", placement: "ON_COURSE" });
  });

  it("lottad start: en saknad startstämpling räknas inte, men en saknad målstämpling gör det", () => {
    const fixed = snapshot();
    const withStart: RaceSnapshot = { ...fixed, classes: fixed.classes.map((row) => ({ ...row, startRule: "FIXED" as const })),
      entries: fixed.entries.map((row) => ({ ...row, fixedStartTime: "2026-10-19T16:00:00Z" })) };
    const list = cardPunchList({ punches: [{ code: 31, punchedAt: "2026-10-19T16:10:00Z" }] }, withStart, ids.entry, "Europe/Stockholm");
    expect(list).toMatchObject({ noStartPunch: false, noFinishPunch: true });
    const unknown = cardPunchList({ punches: [] }, withStart, undefined, "Europe/Stockholm");
    expect(unknown).toMatchObject({ noStartPunch: true, noFinishPunch: true, allOtherDay: false, punches: [] });
  });

  it("okänd bricka: ingen bana att jämföra med", () => {
    const list = cardPunchList({ punches: [{ code: 31, punchedAt: "2026-10-19T16:10:00Z" }] }, snapshot(), undefined, "Europe/Stockholm");
    expect(list.punches[0]?.placement).toBe("NO_COURSE");
    expect(list.missingControls).toEqual([]);
  });
});
