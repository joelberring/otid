import { describe, expect, it } from "vitest";
import { inRaceDay, nextRaceDate, parseRaceClock, parseRaceClockNear, raceDayWindow } from "../src/race-clock";
import { cardPunchList } from "../src/card-punch-list";
import { evaluateCardReadout } from "../src/evaluate-card-readout";
import { relayClassLegStarts, type RelayLegRule, type RelayTeamChangeovers } from "../src/index";
import type { RaceSnapshot } from "../src/types";

/**
 * Steg 58 (ADR-0178): tävlingar som börjar på kvällen och går över midnatt. Tävlingsdagen är 2026-10-27 i Stockholm (CET,
 * UTC+1): 22:00 lokal tid = 21:00Z, 00:30 natten efter = 23:30Z.
 */
const ZONE = "Europe/Stockholm";
const DATE = "2026-10-27";
const local = (date: string, clock: string) => parseRaceClock(date, clock, ZONE)!;
const evening = (clock: string) => local(DATE, clock);
const night = (clock: string) => local(nextRaceDate(DATE), clock);

describe("klockslag efter midnatt", () => {
  it("ett klockslag nära masstarten kl 22 blir natten efter, inte morgonen före", () => {
    const massStart = evening("22:00");
    expect(parseRaceClockNear(DATE, "00:30", ZONE, massStart)).toBe(night("00:30"));
    expect(parseRaceClockNear(DATE, "23:15", ZONE, massStart)).toBe(evening("23:15"));
    expect(parseRaceClockNear(DATE, "21:30", ZONE, massStart)).toBe(evening("21:30"));
    // Jukola: start kl 23, omstart kl 9 morgonen efter.
    expect(parseRaceClockNear(DATE, "09:00", ZONE, evening("23:00"))).toBe(night("09:00"));
    // En dagtävling påverkas inte, och utan referens gäller tävlingsdagen.
    expect(parseRaceClockNear(DATE, "13:00", ZONE, evening("10:00"))).toBe(evening("13:00"));
    expect(parseRaceClockNear(DATE, "00:30", ZONE)).toBe(evening("00:30"));
    expect(parseRaceClockNear(DATE, "25:00", ZONE, massStart)).toBeNull();
  });

  it("tävlingsdygnet: från midnatt på tävlingsdagen till kl 12 dagen efter", () => {
    expect(raceDayWindow(DATE, ZONE)).toEqual({ startMs: Date.parse(evening("00:00")), endMs: Date.parse(night("12:00")) });
    expect(inRaceDay(new Date(night("00:30")), DATE, ZONE)).toBe(true);
    expect(inRaceDay(new Date(night("11:59")), DATE, ZONE)).toBe(true);
    expect(inRaceDay(new Date(night("12:00")), DATE, ZONE)).toBe(false);
    expect(inRaceDay(new Date(local("2026-10-26", "23:59")), DATE, ZONE)).toBe(false);
  });
});

const version = (id: string, codes: number[]) => ({ id, courseId: `course-${id}`, version: 1, createdAt: evening("08:00"),
  controls: codes.map((code, index) => ({ id: `${id}-${code}`, courseVersionId: id, controlId: `c${code}`, sequence: index + 1, controlCode: code })) });

function individual(start: string): RaceSnapshot {
  return {
    race: { id: "race", eventId: "event", name: "Natt-KM", raceDate: DATE, snapshotVersion: 1 },
    classes: [{ id: "class", raceId: "race", name: "H21", courseVersionId: "a", startRule: "FIXED" }],
    courses: [{ id: "course-a", raceId: "race", name: "Natt", versions: [version("a", [31, 32, 33])] }],
    entries: [{ id: "eva", raceId: "race", classId: "class", givenName: "Eva", familyName: "Sjö", fixedStartTime: start }],
    cardAssignments: [{ id: "card", raceId: "race", entryId: "eva", cardNumber: "500", active: true }]
  };
}

describe("individuell klass över midnatt", () => {
  // Start 23:50, kontroller före och efter midnatt, mål 00:12 och avläsning 00:15.
  const readout = { cardNumber: "500", finishPunchedAt: night("00:12"), readAt: night("00:15"), punches: [
    { code: 31, punchedAt: evening("23:56") }, { code: 32, punchedAt: night("00:03") }, { code: 33, punchedAt: night("00:09") }] };

  it("stämplingar efter 00:00 räknas till tävlingen och tiden går över midnatt", () => {
    expect(evaluateCardReadout(readout, individual(evening("23:50")))).toMatchObject({ status: "OK", elapsedMs: 22 * 60_000,
      finishTime: night("00:12") });
  });

  it("\"annan dag\" bara utanför tävlingsdygnet", () => {
    const list = cardPunchList(readout, individual(evening("23:50")), "eva", ZONE);
    expect(list.punches.map(punch => punch.placement)).toEqual(["ON_COURSE", "ON_COURSE", "ON_COURSE"]);
    expect(list.otherDates).toEqual([]);
    expect(list.allOtherDay).toBe(false);
    // En stämpling från en träning kvällen före är fortfarande från en annan dag.
    const old = cardPunchList({ ...readout, punches: [{ code: 45, punchedAt: local("2026-10-26", "20:00") }, ...readout.punches] },
      individual(evening("23:50")), "eva", ZONE);
    expect(old.punches[0]!.placement).toBe("OTHER_DAY");
    expect(old.otherDates).toEqual(["2026-10-26"]);
  });
});

describe("stafett med omstart efter midnatt", () => {
  const team = (key: string, changeovers: Record<number, string>): RelayTeamChangeovers =>
    ({ key, changeovers: new Map(Object.entries(changeovers).map(([leg, time]) => [Number(leg), time])) });
  const massStart = evening("22:00");
  // Omstarten skrivs som klockslag i formuläret: 00:30 hör till natten efter masstarten.
  const restart = parseRaceClockNear(DATE, "00:30", ZONE, massStart)!;
  const rules: RelayLegRule[] = [{ leg: 1, startMethod: "MASS_START", startTime: massStart }, { leg: 2, startMethod: "CHANGEOVER" },
    { leg: 3, startMethod: "RESTART", startTime: restart }];

  it("laget som växlar efter omstarten startar i den; laget före växlar som vanligt", () => {
    const starts = relayClassLegStarts(rules, [team("tidig", { 1: evening("23:00"), 2: night("00:20") }),
      team("sen", { 1: evening("23:10"), 2: night("00:45") })]);
    expect(restart).toBe(night("00:30"));
    expect(starts.teams.get("tidig")!.get(3)).toEqual({ start: night("00:20"), restarted: false });
    expect(starts.teams.get("sen")!.get(3)).toEqual({ start: night("00:30"), restarted: true });
  });
});
