import { describe, expect, it } from "vitest";
import type { PublicRelayResults, PublicResultListResponse } from "@o-tid/contracts";
import { classStartRows, filterStartList, groupByStartTime, startListByClub, startListFromPublication, type StartClass } from "./start-list-model";
import { filterResults, resultListFromPublic, resultsByClub, splitGroups } from "./result-list-model";
import { CSV_BOM, csvCell, resultListCsv, startListCsv, toCsv } from "./csv";

const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const entry = (name: string, club: string | null, startTime: string | null, extra: Partial<StartClass["entries"][number]> = {}) =>
  ({ name, club, startTime, variant: null, card: "8001", multipleCards: false, ...extra });

const classes: StartClass[] = [
  { name: "D21", courseName: "Mellan", firstControlCode: 31, mode: { kind: "MINUTE" }, vacancies: [at("08:02")],
    entries: [entry("Ada Ek", "OK Ek", at("08:00")), entry("Bea Al", "IFK Lidingö", at("08:04"))] },
  { name: "H21", courseName: "Lång", firstControlCode: 31, mode: { kind: "MINUTE" }, vacancies: [],
    entries: [entry("Cid Berg", "OK Ek", at("08:01")), entry("Dan Gran", null, null)] },
  { name: "H16", courseName: "Kort", firstControlCode: 45, mode: { kind: "MINUTE" }, vacancies: [],
    entries: [entry("Eli Ås", "Tullinge SK", at("08:00"))] },
  { name: "Öppen", courseName: "Kort", firstControlCode: 45, mode: { kind: "FREE" }, vacancies: [], entries: [entry("Fia Mo", "OK Ek", null)] }
];

describe("startlistan per starttid", () => {
  it("grupperar per startfålla (första kontroll) och minut, med vakanta tider och utan fri start", () => {
    const groups = groupByStartTime(classes);
    expect(groups.places.map(place => place.firstControlCode)).toEqual([31, 45]);
    const lane31 = groups.places[0]!;
    expect(lane31.minutes.map(minute => new Date(minute.minute).toISOString().slice(11, 16))).toEqual(["08:00", "08:01", "08:02", "08:04"]);
    expect(lane31.minutes[2]!.rows).toEqual([{ className: "D21", time: at("08:02"), entry: null }]);
    expect(groups.free.map(row => row.name)).toEqual(["Öppen"]);
    expect(groups.missing.map(row => row.entry.name)).toEqual(["Dan Gran"]);
  });

  it("räknar inte stafettens senare sträckor som saknade tider", () => {
    const relay: StartClass = { name: "Stafett", courseName: "S", firstControlCode: null, mode: { kind: "RELAY", legCount: 2 }, vacancies: [],
      entries: [entry("A", null, at("09:00"), { relay: { teamNumber: 1, teamName: "Ek", teamClub: "OK Ek", leg: 1 } }),
        entry("B", null, null, { relay: { teamNumber: 1, teamName: "Ek", teamClub: "OK Ek", leg: 2 } })] };
    const groups = groupByStartTime([relay]);
    expect(groups.missing).toEqual([]);
    expect(groups.places[0]!.minutes[0]!.rows[0]!.entry!.name).toBe("A");
  });

  it("sorterar vakanta tider in bland löparna i klassen", () => {
    expect(classStartRows(classes[0]!).map(row => row.entry?.name ?? "Vakant")).toEqual(["Ada Ek", "Vakant", "Bea Al"]);
  });
});

describe("startlistan per klubb och sökning", () => {
  it("grupperar per klubb i svensk ordning med lagets klubb som reserv och utan klubb sist", () => {
    const relay: StartClass = { name: "Stafett", courseName: "S", firstControlCode: null, mode: { kind: "RELAY", legCount: 2 }, vacancies: [],
      entries: [entry("Gun Lag", null, null, { relay: { teamNumber: 1, teamName: "Alfa", teamClub: "Alfa OK", leg: 1 } })] };
    const groups = startListByClub([...classes, relay]);
    expect(groups.map(group => group.club)).toEqual(["Alfa OK", "IFK Lidingö", "OK Ek", "Tullinge SK", null]);
    expect(groups.find(group => group.club === "OK Ek")!.rows.map(row => `${row.className} ${row.entry.name}`))
      .toEqual(["D21 Ada Ek", "H21 Cid Berg", "Öppen Fia Mo"]);
  });

  it("söker i namn, klubb och bricka och döljer vakanser vid sökning", () => {
    expect(filterStartList(classes, "ek", "").map(row => [row.name, row.entries.length, row.vacancies.length]))
      .toEqual([["D21", 1, 0], ["H21", 1, 0], ["Öppen", 1, 0]]);
    expect(filterStartList(classes, "", "D21")[0]!.vacancies).toHaveLength(1);
    expect(filterStartList(classes, "8001", "")).toHaveLength(4);
  });

  it("bygger modellen ur den publicerade listan utan bricka och känner igen masstart", () => {
    const model = startListFromPublication({ eventName: "E", raceName: "R", raceDate: "2026-10-08", timeZone: "Europe/Stockholm",
      classes: [{ name: "H21", startRule: "FIXED", drawMethod: "MASS", courseName: "Lång", entries: [
        { displayName: "A B", organisationName: null, fixedStartTime: at("10:00") }] }] });
    expect(model.cards).toBe(false);
    expect(model.classes[0]!.mode).toEqual({ kind: "MASS", time: at("10:00") });
    expect(model.classes[0]!.entries[0]!.card).toBeUndefined();
  });
});

const results: PublicResultListResponse = { formatVersion: 7, results: [
  { className: "H21", publicResultId: "00000000-0000-4000-8000-000000000001", givenName: "Anna", familyName: "Ek", organisationName: "OK Ek",
    revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 600_000, missingControls: [], extraPunches: [], rankingState: "RANKED", position: 1,
    timeBehindMs: 0, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 200_000, legMs: 200_000 }] },
  { className: "H21", publicResultId: "00000000-0000-4000-8000-000000000002", givenName: "Bo", familyName: "Al", organisationName: "IFK; \"Test\"",
    revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 660_000, missingControls: [], extraPunches: [], rankingState: "RANKED", position: 2,
    timeBehindMs: 60_000, splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 180_000, legMs: 180_000 }] },
  { className: "H21", publicResultId: "00000000-0000-4000-8000-000000000003", givenName: "=Cia", familyName: "Mo", organisationName: "OK Ek",
    revision: 1, status: "MP", reason: "MISSING_CONTROL", elapsedMs: 500_000, missingControls: [31], extraPunches: [],
    rankingState: "NOT_RANKABLE_STATUS", splits: [] },
  { className: "H21", publicResultId: "00000000-0000-4000-8000-000000000004", givenName: "Dag", familyName: "Ny", organisationName: null,
    revision: 1, status: "DNS", reason: "DID_NOT_START", missingControls: [], extraPunches: [], rankingState: "NOT_RANKABLE_STATUS", splits: [] }
] };
const relay: PublicRelayResults = { formatVersion: 1, classes: [] } as unknown as PublicRelayResults;

describe("resultatlistorna", () => {
  const model = resultListFromPublic(results, { ...relay, classes: [] });

  it("sammanfattar per klubb: löpare, godkända och pallplatser", () => {
    const clubs = resultsByClub(model);
    expect(clubs.map(club => [club.club, club.summary])).toEqual([
      ["IFK; \"Test\"", { runners: 1, approved: 1, podium: 1 }], ["OK Ek", { runners: 2, approved: 1, podium: 1 }],
      [null, { runners: 1, approved: 0, podium: 0 }]]);
  });

  it("ger sträcktidstabellen med bästa sträcka och utan ej startade", () => {
    const [group] = splitGroups(model.classes[0]!);
    expect(group!.rows.map(row => row.name)).toEqual(["Anna Ek", "Bo Al", "=Cia Mo"]);
    expect(group!.table.rows[1]!.cells[0]).toMatchObject({ place: 1, best: true });
    expect(group!.table.rows[2]!.cells[0]).toBeNull();
  });

  it("söker i namn och klubb", () => {
    expect(filterResults(model, "ifk", "").classes[0]!.rows.map(row => row.name)).toEqual(["Bo Al"]);
    expect(filterResults(model, "", "D21").classes).toEqual([]);
  });

  it("CSV: BOM, semikolon, citering och skydd mot formler", () => {
    const csv = resultListCsv("CLASS", model);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Klass;Placering;Namn;Klubb;Tid;Efter;Status");
    expect(lines[1]).toBe("H21;1;Anna Ek;OK Ek;10:00;0:00;Godkänd");
    expect(lines[2]).toBe("H21;2;Bo Al;\"IFK; \"\"Test\"\"\";11:00;1:00;Godkänd");
    expect(lines[3]).toBe("H21;;'=Cia Mo;OK Ek;8:20;;Felstämplad");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("CSV med sträcktider: en rad per löpare och kontroll inklusive mål", () => {
    const lines = resultListCsv("SPLITS", model).slice(1).split("\r\n");
    expect(lines[1]).toBe("H21;;1;Anna Ek;OK Ek;10:00;Godkänd;31;3:20;2;3:20");
    expect(lines[2]).toBe("H21;;1;Anna Ek;OK Ek;10:00;Godkänd;Mål;6:40;1;10:00");
  });
});

describe("rogaining i resultatlistorna (PLAN.md steg 15)", () => {
  const score = (controlPoints: number, penalty: number, controls: [number, number][]) => ({ controlPoints, penalty,
    total: Math.max(0, controlPoints - penalty), timeLimitMs: 3_600_000, penaltyPointsPerMinute: 2, overtimeMinutes: penalty / 2,
    controls: controls.map(([controlCode, points]) => ({ controlCode, points })) });
  const scored: PublicResultListResponse = { formatVersion: 7, results: [
    { className: "R60", publicResultId: "00000000-0000-4000-8000-000000000011", givenName: "Ada", familyName: "Ek", organisationName: "OK Ek",
      revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 3_000_000, missingControls: [], extraPunches: [], rankingState: "RANKED",
      position: 1, splits: [{ controlCode: 45, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }], rogaining: score(7, 0, [[45, 4], [31, 3]]) },
    { className: "R60", publicResultId: "00000000-0000-4000-8000-000000000012", givenName: "Bo", familyName: "Al", organisationName: null,
      revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 3_661_000, missingControls: [], extraPunches: [], rankingState: "RANKED",
      position: 2, splits: [], rogaining: score(7, 4, [[45, 4], [31, 3]]) }] };
  const model = resultListFromPublic(scored, { ...relay, classes: [] });

  it("märker klassen och bär poäng, straff och summa", () => {
    expect(model.classes[0]!.scored).toBe(true);
    expect(model.classes[0]!.rows.map(row => [row.place, row.score?.total])).toEqual([[1, 7], [2, 3]]);
  });

  it("CSV: poäng, straff och summa efter status; räknade kontroller i stället för sträcktider", () => {
    const lines = resultListCsv("CLASS", model).slice(1).split("\r\n");
    expect(lines[0]).toBe("Klass;Placering;Namn;Klubb;Tid;Efter;Status;Poäng;Straff;Summa");
    expect(lines[2]).toBe("R60;2;Bo Al;;1:01:01;;Godkänd;7;4;3");
    const controls = resultListCsv("SPLITS", model).slice(1).split("\r\n");
    expect(controls[0]).toBe("Klass;Placering;Namn;Klubb;Summa;Tid;Status;Kontroll;Poäng;Totaltid");
    expect(controls[1]).toBe("R60;1;Ada Ek;OK Ek;7;50:00;Godkänd;45;4;10:00");
    expect(controls[2]).toBe("R60;1;Ada Ek;OK Ek;7;50:00;Godkänd;31;3;");
    expect(resultListCsv("CLUB", model).slice(1).split("\r\n")[0]).toBe("Klubb;Namn;Lag;Klass;Placering;Tid;Status;Summa");
  });
});

describe("CSV för startlistor", () => {
  it("tar bara med bricka när listan har bricka och skriver vakanta tider", () => {
    const admin = startListCsv("CLASS", classes.slice(0, 1), "UTC", true).slice(1).split("\r\n");
    expect(admin[0]).toBe("Klass;Bana;Startsätt;Starttid;Namn;Klubb;Bricka;Variant;Lag;Sträcka");
    expect(admin[2]).toBe("D21;Mellan;Minutstart;08:02:00;Vakant;;;;;");
    const publicCsv = startListCsv("TIME", classes.slice(0, 1), "UTC", false).slice(1).split("\r\n");
    expect(publicCsv[0]).toBe("Starttid;Startfålla;Klass;Namn;Klubb");
    expect(publicCsv[1]).toBe("08:00:00;31;D21;Ada Ek;OK Ek");
  });

  it("citerar radbrytningar och lämnar tal orörda", () => {
    expect(csvCell("a\nb")).toBe("\"a\nb\"");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-5")).toBe("'-5");
    expect(toCsv(["A"], [[null]])).toBe(`${CSV_BOM}A\r\n\r\n`);
  });
});

describe("resultatlistan med radiokontroller (ADR-0172 beslut 5)", () => {
  const passage = (givenName: string, place: number | null, finished = false) => ({
    publicResultId: `00000000-0000-4000-8000-0000000000${givenName.length}${place ?? 0}`, givenName, familyName: "Radio",
    organisationName: "OK Radio", className: "D21", controlCode: 50, label: "Radio 1", passedAt: "2026-10-08T16:07:20.000Z",
    elapsedMs: 440_000, place, finished });
  const radio = { formatVersion: 1 as const, raceId: "00000000-0000-4000-8000-000000000099", enabled: true, timeZone: "Europe/Stockholm",
    latest: [], classes: [{ className: "D21", onTheWay: [passage("Ada", 1)],
      controls: [{ controlCode: 50, label: "Radio 1", passages: [passage("Ada", 1), passage("Bea", 2, true)] }] }] };

  it("tar med en klass där ingen läst av men någon passerat radiokontrollen, i bokstavsordning", () => {
    const model = resultListFromPublic(results, { ...relay, classes: [] }, radio);
    expect(model.classes.map(row => [row.name, row.rows.length, row.radio?.onTheWay.length ?? 0])).toEqual([["D21", 0, 1], ["H21", 4, 0]]);
    expect(model.radioTimeZone).toBe("Europe/Stockholm");
    // Avstängd radio: ingenting från radion.
    expect(resultListFromPublic(results, { ...relay, classes: [] }, { ...radio, enabled: false }).classes.map(row => row.name)).toEqual(["H21"]);
  });

  it("söker också bland löparna vid radiokontrollerna", () => {
    const model = resultListFromPublic(results, { ...relay, classes: [] }, radio);
    expect(filterResults(model, "bea", "").classes.map(row => [row.name, row.radio?.onTheWay.length, row.radio?.controls[0]!.passages.length]))
      .toEqual([["D21", 0, 1]]);
    expect(filterResults(model, "ada", "D21").classes[0]!.radio!.onTheWay.map(row => row.givenName)).toEqual(["Ada"]);
    expect(filterResults(model, "finns inte", "").classes).toEqual([]);
  });
});
