import { describe, expect, it } from "vitest";
import {
  relayParallelChangeover, relayParallelLegOutcome, teamSprintChangeoverProblem, teamSprintReadoutPart, type TeamSprintPart
} from "../src/relay-parallel";
import { courseVariantForReadout, evaluateCardReadout } from "../src/evaluate-card-readout";
import { evaluateReadoutWithTimes } from "../src/entry-readout";
import { manualTimeOutcome, partialTiming } from "../src";
import type { EvaluationReadout, RaceSnapshot } from "../src/types";

/** Steg 48: parallella sträckor (båda reglerna) och teamsprint (delad avläsning, felstämplad del, saknad växling). */
const at = (clock: string) => `2026-10-08T${clock}.000Z`;
const minutes = (value: number) => value * 60_000;

describe("parallell sträcka", () => {
  const runners = [{ status: "OK" as const, finishTime: at("17:20:00") }, { status: "MP" as const, finishTime: at("17:18:00") },
    { status: "OK" as const, finishTime: at("17:25:00") }];

  it("växlar när första eller sista löparen är i mål", () => {
    expect(relayParallelChangeover("FIRST", runners)).toBe(at("17:18:00"));
    expect(relayParallelChangeover("LAST", runners)).toBe(at("17:25:00"));
    expect(relayParallelChangeover("LAST", [...runners, {}])).toBeUndefined();
    expect(relayParallelChangeover("FIRST", [{}, { finishTime: at("17:30:00") }])).toBe(at("17:30:00"));
    // Sista i mål: en löpare som brutit utan mål räknas inte, men alla måste ha ett resultat.
    expect(relayParallelChangeover("LAST", [{ status: "DNF" }, { status: "OK", finishTime: at("17:40:00") }])).toBe(at("17:40:00"));
  });

  it("godkänt när alla är godkända: en felstämplad löpare gör sträckan felstämplad", () => {
    expect(relayParallelLegOutcome({ leg: 1, changeover: "FIRST", approval: "ALL", legStart: at("17:00:00"), runners }))
      .toEqual({ leg: 1, status: "MP" });
    const ok = relayParallelLegOutcome({ leg: 1, changeover: "LAST", approval: "ALL", legStart: at("17:00:00"),
      runners: [runners[0]!, runners[2]!] });
    expect(ok).toEqual({ leg: 1, status: "OK", elapsedMs: minutes(25) });
    expect(relayParallelLegOutcome({ leg: 1, changeover: "FIRST", approval: "ALL", legStart: at("17:00:00"),
      runners: [runners[0]!, {}] })).toEqual({ leg: 1 });
  });

  it("godkänt när minst en är godkänd: sträckans tid är tiden till växlingen", () => {
    expect(relayParallelLegOutcome({ leg: 2, changeover: "FIRST", approval: "ANY", legStart: at("17:00:00"), runners }))
      .toEqual({ leg: 2, status: "OK", elapsedMs: minutes(18) });
    expect(relayParallelLegOutcome({ leg: 2, changeover: "FIRST", approval: "ANY", legStart: at("17:00:00"),
      runners: [{ status: "MP", finishTime: at("17:10:00") }, { status: "DNF" }] })).toEqual({ leg: 2, status: "MP" });
    expect(relayParallelLegOutcome({ leg: 2, changeover: "FIRST", approval: "ANY", legStart: at("17:00:00"), restarted: true,
      runners: [{ status: "MP", finishTime: at("17:10:00") }, {}] })).toEqual({ leg: 2, restarted: true });
  });
});

describe("teamsprint", () => {
  // Löpare A springer sträcka 1 och 3 av 4 med en bricka. Växlingskontrollen har kod 100.
  const card: EvaluationReadout = { cardNumber: "500", finishPunchedAt: at("17:40:00"), punches: [
    { code: 31, punchedAt: at("17:02:00") }, { code: 32, punchedAt: at("17:04:00") }, { code: 100, punchedAt: at("17:06:00") },
    { code: 100, punchedAt: at("17:06:20") },
    { code: 41, punchedAt: at("17:15:00") }, { code: 42, punchedAt: at("17:17:00") }, { code: 100, punchedAt: at("17:19:00") }] };
  const partOf = (part: number): TeamSprintPart => ({ part, parts: 2, changeoverCode: 100, endsAtFinish: false });

  it("brickan delas vid växlingsstämplingarna; dubbelstämpling räknas en gång", () => {
    expect(teamSprintReadoutPart(card, partOf(1))).toEqual({ cardNumber: "500", finishPunchedAt: at("17:06:00"),
      punches: [{ code: 31, punchedAt: at("17:02:00") }, { code: 32, punchedAt: at("17:04:00") }] });
    expect(teamSprintReadoutPart(card, partOf(2))).toEqual({ cardNumber: "500", finishPunchedAt: at("17:19:00"),
      punches: [{ code: 41, punchedAt: at("17:15:00") }, { code: 42, punchedAt: at("17:17:00") }] });
    expect(teamSprintChangeoverProblem(card, partOf(2))).toBeUndefined();
  });

  it("lagets sista sträcka slutar vid målstämplingen", () => {
    const last = teamSprintReadoutPart({ ...card, punches: card.punches.slice(0, 6) }, { part: 2, parts: 2, changeoverCode: 100, endsAtFinish: true });
    expect(last.finishPunchedAt).toBe(at("17:40:00"));
    expect(last.punches.map(punch => punch.code)).toEqual([41, 42]);
  });

  it("saknad växlingsstämpling ger tydligt besked och ingen måltid för delen", () => {
    const missing = { ...card, punches: card.punches.filter(punch => punch.code !== 100 || punch.punchedAt === at("17:06:00")) };
    expect(teamSprintChangeoverProblem(missing, partOf(2))).toEqual({ needed: 2, found: 1 });
    expect(teamSprintReadoutPart(missing, partOf(2)).finishPunchedAt).toBeUndefined();
    const none = { ...card, punches: card.punches.filter(punch => punch.code !== 100) };
    expect(teamSprintReadoutPart(none, partOf(1)).finishPunchedAt).toBeUndefined();
    expect(teamSprintReadoutPart(none, partOf(2)).punches).toEqual([]);
  });

  it("varje del bedöms mot löparens sträcka; en felstämplad del gör bara den sträckan felstämplad", () => {
    const version = (id: string, codes: number[]) => ({ id, courseId: `course-${id}`, version: 1, createdAt: at("08:00:00"),
      controls: codes.map((code, index) => ({ id: `${id}-${code}`, courseVersionId: id, controlId: `c${code}`, sequence: index + 1, controlCode: code })) });
    const snapshot = (entry: "leg-1" | "leg-3", part: TeamSprintPart, start: string): RaceSnapshot => ({
      race: { id: "race", eventId: "event", name: "Teamsprint", raceDate: "2026-10-08", snapshotVersion: 1 },
      classes: [{ id: "class", raceId: "race", name: "Teamsprint", courseVersionId: "a", startRule: "FIXED" }],
      courses: [{ id: "course-a", raceId: "race", name: "A", versions: [version("a", [31, 32])] },
        { id: "course-c", raceId: "race", name: "C", versions: [version("c", [41, 43])] }],
      entries: [{ id: entry, raceId: "race", classId: "class", givenName: "Ada", familyName: "Ek", fixedStartTime: start,
        ...(entry === "leg-3" ? { courseVersionId: "c" } : {}), teamSprint: part }],
      cardAssignments: [{ id: "a", raceId: "race", entryId: entry, cardNumber: "500", active: true }]
    });
    const legOne = evaluateCardReadout(card, snapshot("leg-1", partOf(1), at("17:00:00")));
    expect(legOne).toMatchObject({ status: "OK", elapsedMs: minutes(6), finishTime: at("17:06:00") });
    const legThree = evaluateCardReadout(card, snapshot("leg-3", partOf(2), at("17:12:00")));
    expect(legThree).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", missingControls: [43], finishTime: at("17:19:00") });
  });

  it("gafflad sträcka utan tilldelad variant: varianten väljs efter sträckans del av brickan, som i bedömningen", () => {
    const variant = (code: string, sequence: number, codes: number[]) => ({ id: `c-${code}`, courseVersionId: "c", code, sequence,
      controls: codes.map((controlCode, index) => ({ id: `c-${code}-${index}`, courseVariantId: `c-${code}`, controlId: `c${controlCode}`,
        sequence: index + 1, controlCode })) });
    // Hela brickan passar båda varianterna (X först); sträckans del (41, 42) passar bara Y.
    const snapshot: RaceSnapshot = {
      race: { id: "race", eventId: "event", name: "Teamsprint", raceDate: "2026-10-08", snapshotVersion: 1 },
      classes: [{ id: "class", raceId: "race", name: "Teamsprint", courseVersionId: "c", startRule: "FIXED" }],
      courses: [{ id: "course-c", raceId: "race", name: "C", versions: [{ id: "c", courseId: "course-c", version: 1, createdAt: at("08:00:00"),
        controls: [], variants: [variant("X", 1, [31, 32, 41, 42]), variant("Y", 2, [41, 42])] }] }],
      entries: [{ id: "leg-3", raceId: "race", classId: "class", givenName: "Ada", familyName: "Ek", fixedStartTime: at("17:12:00"),
        teamSprint: partOf(2) }],
      cardAssignments: [{ id: "a", raceId: "race", entryId: "leg-3", cardNumber: "500", active: true }]
    };
    expect(evaluateCardReadout(card, snapshot)).toMatchObject({ status: "OK" });
    expect(courseVariantForReadout(card, snapshot)).toEqual({ code: "Y", assigned: false });
  });

  it("manuell tid och brutet bedömer sträckans del av brickan med de angivna tiderna (inte saknad start)", () => {
    const version = (id: string, codes: number[]) => ({ id, courseId: `course-${id}`, version: 1, createdAt: at("08:00:00"),
      controls: codes.map((code, index) => ({ id: `${id}-${code}`, courseVersionId: id, controlId: `c${code}`, sequence: index + 1, controlCode: code })) });
    const snapshot: RaceSnapshot = {
      race: { id: "race", eventId: "event", name: "Teamsprint", raceDate: "2026-10-08", snapshotVersion: 1 },
      classes: [{ id: "class", raceId: "race", name: "Teamsprint", courseVersionId: "c", startRule: "FIXED" }],
      courses: [{ id: "course-c", raceId: "race", name: "C", versions: [version("c", [41, 42])] }],
      entries: [{ id: "leg-3", raceId: "race", classId: "class", givenName: "Ada", familyName: "Ek", fixedStartTime: at("17:12:00"),
        teamSprint: partOf(2) }],
      cardAssignments: [{ id: "a", raceId: "race", entryId: "leg-3", cardNumber: "500", active: true }]
    };
    const withTimes = (readout: EvaluationReadout) => (startTime: string, finishTime: string) =>
      evaluateReadoutWithTimes(readout, snapshot, "leg-3", startTime, finishTime);
    // Manuell måltid ersätter växlingsstämplingen som mål; stämplingarna är sträckans (inte första sträckans 31 och 32).
    const manual = withTimes(card)(at("17:12:00"), at("17:20:00"));
    expect(manual).toMatchObject({ status: "OK", elapsedMs: minutes(8), finishTime: at("17:20:00"), extraPunches: [] });
    expect(manual.splits.map(split => split.controlCode)).toEqual([41, 42]);
    const context = { entryId: "leg-3", classId: "class", courseVersionId: "c", evaluateWithTimes: withTimes(card) };
    expect(manualTimeOutcome({ status: "MP", finishTime: at("17:20:00") }, at("17:12:00"), context)?.splits.map(split => split.controlCode))
      .toEqual([41, 42]);
    // Saknad växlingsstämpling: delen har inget mål; brutet får sträcktiderna fram till sista kontrollen.
    const missing = { ...card, punches: card.punches.filter(punch => punch.code !== 100 || punch.punchedAt === at("17:06:00")) };
    const outcome = evaluateCardReadout(missing, snapshot);
    expect(outcome).toMatchObject({ reason: "MISSING_FINISH", startTime: at("17:12:00") });
    expect(partialTiming(outcome, { evaluateWithTimes: withTimes(missing) }).splits.map(split => split.controlCode)).toEqual([41, 42]);
  });
});
