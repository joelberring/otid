import { describe, expect, it } from "vitest";
import {
  drawStartTimes, placeLateEntry, separateClubs, StartDrawError, vacancyCount, vacancyPositions, withProposedStartTimes,
  type RaceSnapshot, type StartDrawClass, type StartDrawInput, type StartDrawRunner
} from "../src";

const MINUTE = 60_000;
const first = Date.parse("2026-10-08T08:00:00Z");
const runners = (prefix: string, clubs: readonly (string | null)[]): StartDrawRunner[] =>
  clubs.map((club, index) => ({ entryId: `${prefix}-${String(index).padStart(3, "0")}`, club }));
const raceClass = (classId: string, overrides: Partial<StartDrawClass> = {}): StartDrawClass => ({
  classId, name: classId, firstControlCode: null, method: "MINUTE", intervalMinutes: 2,
  vacancies: { kind: "COUNT", value: 0 }, runners: runners(classId, ["OK Ek", "IFK", "OK Ek", "Tullinge"]), ...overrides
});
const input = (classes: StartDrawClass[], overrides: Partial<StartDrawInput> = {}): StartDrawInput =>
  ({ seed: 12_345, firstStartMs: first, clubSeparation: true, classes, ...overrides });

function adjacentSameClub(order: readonly (string | null)[], clubOf: Map<string, string | null>) {
  const ranked = order.filter((id): id is string => id !== null);
  let count = 0;
  for (let index = 1; index < ranked.length; index += 1) {
    const a = clubOf.get(ranked[index - 1]!), b = clubOf.get(ranked[index]!);
    if (a && b && a === b) count += 1;
  }
  return count;
}

describe("lottning av starttider", () => {
  it("ger samma tider för samma underlag och frö, och andra tider med ett annat frö", () => {
    const classes = [raceClass("H21", { runners: runners("H21", Array.from({ length: 30 }, (_, i) => `Klubb ${i % 5}`)) })];
    const a = drawStartTimes(input(classes));
    expect(drawStartTimes(input(classes))).toEqual(a);
    expect(drawStartTimes(input([...classes].reverse()))).toEqual(a);
    expect(drawStartTimes(input(classes, { seed: 999 })).classes[0]!.slots).not.toEqual(a.classes[0]!.slots);
  });

  it("ger tider från första start med klassens intervall och varje löpare exakt en gång", () => {
    const result = drawStartTimes(input([raceClass("H21", { intervalMinutes: 3 })]));
    const slots = result.classes[0]!.slots;
    expect(slots.map(slot => slot.startMs)).toEqual([0, 3, 6, 9].map(minute => first + minute * MINUTE));
    expect(slots.map(slot => slot.entryId).sort()).toEqual(["H21-000", "H21-001", "H21-002", "H21-003"]);
  });

  it("separerar klubbar när det går att undvika", () => {
    const clubs = ["A", "A", "A", "B", "B", "C", "A", "C", "B", "D"];
    const classes = [raceClass("H21", { runners: runners("H21", clubs) })];
    const clubOf = new Map(classes[0]!.runners.map(runner => [runner.entryId, runner.club]));
    for (const seed of [1, 2, 3, 42, 4_294_967_295]) {
      const order = drawStartTimes(input(classes, { seed })).classes[0]!.slots.map(slot => slot.entryId);
      expect(adjacentSameClub(order, clubOf)).toBe(0);
    }
    // Utan klubbseparering finns krockar för något frö (blandningen bryr sig inte om klubb).
    const plain = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => drawStartTimes(input(classes, { seed, clubSeparation: false })).classes[0]!.slots);
    expect(plain.some(slots => adjacentSameClub(slots.map(slot => slot.entryId), clubOf) > 0)).toBe(true);
  });

  it("klarar den trånga fallet där en klubb har precis hälften plus en", () => {
    const clubs = ["A", "A", "A", "A", "B", "C", "D"];
    const ordered = separateClubs(runners("x", clubs));
    expect(ordered.map(runner => runner.club)).toEqual(["A", expect.any(String), "A", expect.any(String), "A", expect.any(String), "A"]);
  });

  it("lägger alla från samma klubb i följd när det inte går att undvika, och behandlar klubbnamn utan skiftlägeskänslighet", () => {
    const result = drawStartTimes(input([raceClass("H21", { runners: runners("H21", ["OK Ek", "ok ek ", "OK EK"]) })]));
    expect(result.classes[0]!.slots).toHaveLength(3);
    const mixed = separateClubs(runners("y", ["OK Ek", "ok ek", "IFK"]));
    expect(mixed.map(runner => runner.club)).toEqual(["OK Ek", "IFK", "ok ek"]);
  });

  it("sprider vakanser i klassen i stället för att lägga dem sist", () => {
    expect(vacancyPositions(5, 1)).toEqual([2]);
    expect(vacancyPositions(12, 2)).toEqual([3, 9]);
    expect(vacancyPositions(3, 3)).toEqual([0, 1, 2]);
    const result = drawStartTimes(input([raceClass("H21", { runners: runners("H21", Array.from({ length: 10 }, (_, i) => `K${i}`)),
      vacancies: { kind: "COUNT", value: 2 } })]));
    const slots = result.classes[0]!.slots;
    expect(slots).toHaveLength(12);
    const vacant = slots.flatMap((slot, index) => slot.entryId === null ? [index] : []);
    expect(vacant).toEqual([3, 9]);
    expect(result.classes[0]!.vacancyCount).toBe(2);
  });

  it("räknar vakanser i procent uppåt", () => {
    expect(vacancyCount(4, { kind: "PERCENT", value: 10 })).toBe(1);
    expect(vacancyCount(40, { kind: "PERCENT", value: 10 })).toBe(4);
    expect(vacancyCount(40, { kind: "PERCENT", value: 0 })).toBe(0);
    expect(vacancyCount(4, { kind: "COUNT", value: 3 })).toBe(3);
  });

  it("låter aldrig två klasser i samma startfålla starta samma minut och packar dem tätt", () => {
    const h21 = raceClass("H21", { firstControlCode: 31, vacancies: { kind: "COUNT", value: 1 } });
    const d21 = raceClass("D21", { firstControlCode: 31, vacancies: { kind: "COUNT", value: 1 } });
    const h16 = raceClass("H16", { firstControlCode: 45 });
    const result = drawStartTimes(input([h21, d21, h16]));
    const minutes = (classId: string) => result.classes.find(row => row.classId === classId)!.slots.map(slot => (slot.startMs - first) / MINUTE);
    expect(new Set([...minutes("H21"), ...minutes("D21")]).size).toBe(minutes("H21").length + minutes("D21").length);
    // Lika stora klasser med intervall 2: den ena startar jämna, den andra udda minuter, båda från första start.
    expect([minutes("H21")[0], minutes("D21")[0]].sort()).toEqual([0, 1]);
    expect(Math.max(...minutes("H21"), ...minutes("D21"))).toBe(9);
    // Annan första kontroll: startar parallellt från första start.
    expect(minutes("H16")).toEqual([0, 2, 4, 6]);
    expect(result.groups).toEqual([{ firstControlCode: 31, classIds: ["H21", "D21"] }]);
  });

  it("lägger största klassen först och fyller luckor med mindre klasser", () => {
    const big = raceClass("H21", { firstControlCode: 31, intervalMinutes: 1, runners: runners("H21", Array.from({ length: 6 }, (_, i) => `K${i}`)) });
    const small = raceClass("D21", { firstControlCode: 31, intervalMinutes: 2, runners: runners("D21", ["A", "B"]) });
    const result = drawStartTimes(input([small, big]));
    const minutes = (classId: string) => result.classes.find(row => row.classId === classId)!.slots.map(slot => (slot.startMs - first) / MINUTE);
    expect(minutes("H21")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(minutes("D21")).toEqual([6, 8]);
  });

  it("undviker minuter som andra klasser i samma startfålla redan använder", () => {
    const result = drawStartTimes(input([raceClass("H21", { firstControlCode: 31 })], {
      occupied: [0, 2, 4].map(minute => ({ classId: "D21", firstControlCode: 31, startMs: first + minute * MINUTE }))
    }));
    expect(result.classes[0]!.slots.map(slot => (slot.startMs - first) / MINUTE)).toEqual([1, 3, 5, 7]);
    expect(result.groups).toEqual([{ firstControlCode: 31, classIds: ["H21", "D21"] }]);
  });

  it("ger alla i en masstartsklass samma tid och inga vakanser", () => {
    const result = drawStartTimes(input([raceClass("Öppen", { method: "MASS", vacancies: { kind: "COUNT", value: 3 } })]));
    const mass = result.classes[0]!;
    expect(mass.slots).toHaveLength(4);
    expect(new Set(mass.slots.map(slot => slot.startMs))).toEqual(new Set([first]));
    expect(mass.vacancyCount).toBe(0);
  });

  it("lägger masstarten först i fållan och minutstartsklassen efter", () => {
    const result = drawStartTimes(input([raceClass("H21", { firstControlCode: 31 }),
      raceClass("Öppen", { firstControlCode: 31, method: "MASS" })]));
    const byId = new Map(result.classes.map(row => [row.classId, row]));
    expect(byId.get("Öppen")!.firstStartMs).toBe(first);
    expect(byId.get("H21")!.slots.map(slot => (slot.startMs - first) / MINUTE)).toEqual([1, 3, 5, 7]);
  });

  it("hanterar en löpare och tomma klasser", () => {
    const one = drawStartTimes(input([raceClass("H21", { runners: runners("H21", ["OK Ek"]) })]));
    expect(one.classes[0]!.slots).toEqual([{ entryId: "H21-000", startMs: first }]);
    const empty = drawStartTimes(input([raceClass("H21", { runners: [], firstControlCode: 31 }),
      raceClass("D21", { firstControlCode: 31 })]));
    const byId = new Map(empty.classes.map(row => [row.classId, row]));
    expect(byId.get("H21")!.slots).toEqual([]);
    expect(byId.get("D21")!.firstStartMs).toBe(first);
    const vacantOnly = drawStartTimes(input([raceClass("H21", { runners: [], vacancies: { kind: "COUNT", value: 2 } })]));
    expect(vacantOnly.classes[0]!.slots).toEqual([{ entryId: null, startMs: first }, { entryId: null, startMs: first + 2 * MINUTE }]);
  });

  it("avvisar ogiltigt underlag", () => {
    expect(() => drawStartTimes(input([raceClass("H21")], { seed: 0 }))).toThrow(StartDrawError);
    expect(() => drawStartTimes(input([raceClass("H21")], { firstStartMs: first + 1_000 }))).toThrow(StartDrawError);
    expect(() => drawStartTimes(input([raceClass("H21", { intervalMinutes: 0 })]))).toThrow(StartDrawError);
    expect(() => drawStartTimes(input([raceClass("H21"), raceClass("H21")]))).toThrow(StartDrawError);
    expect(() => drawStartTimes(input([raceClass("H21", { vacancies: { kind: "PERCENT", value: 101 } })]))).toThrow(StartDrawError);
  });
});

describe("efteranmäld i lottad klass", () => {
  const base = { method: "MINUTE" as const, firstStartMs: first, intervalMinutes: 2,
    slotTimesMs: [0, 2, 4, 6].map(minute => first + minute * MINUTE), groupTimesMs: [], nowMs: first - MINUTE };

  it("får första lediga vakanta tid efter nu", () => {
    expect(placeLateEntry({ ...base, classTimesMs: [0, 2, 6].map(minute => first + minute * MINUTE) })).toBe(first + 4 * MINUTE);
    expect(placeLateEntry({ ...base, classTimesMs: [2, 6].map(minute => first + minute * MINUTE), nowMs: first + MINUTE })).toBe(first + 4 * MINUTE);
  });

  it("får första lediga minut efter klassens sista start som ingen i fållan använder när vakanserna är slut", () => {
    const full = [0, 2, 4, 6].map(minute => first + minute * MINUTE);
    expect(placeLateEntry({ ...base, classTimesMs: full })).toBe(first + 8 * MINUTE);
    expect(placeLateEntry({ ...base, classTimesMs: full, groupTimesMs: [first + 8 * MINUTE + 30_000] })).toBe(first + 10 * MINUTE);
    expect(placeLateEntry({ ...base, classTimesMs: full, nowMs: first + 15 * MINUTE })).toBe(first + 16 * MINUTE);
  });

  it("får masstartens tid", () => {
    expect(placeLateEntry({ ...base, method: "MASS", slotTimesMs: [], classTimesMs: [first] })).toBe(first);
  });

  it("i en tom lottad klass får första start", () => {
    expect(placeLateEntry({ ...base, slotTimesMs: [], classTimesMs: [] })).toBe(first);
  });
});

describe("föreslagna starttider för omprövning", () => {
  it("byter startsätt och starttider utan att röra andra klasser", () => {
    const snapshot = {
      race: { id: "r", eventId: "e", name: "Lopp", raceDate: "2026-10-08", snapshotVersion: 1 },
      classes: [{ id: "c1", raceId: "r", name: "H21", courseVersionId: "v", startRule: "PUNCH" },
        { id: "c2", raceId: "r", name: "D21", courseVersionId: "v", startRule: "FIXED" }],
      courses: [], cardAssignments: [], classControlNeutralizations: [],
      entries: [{ id: "a", raceId: "r", classId: "c1", givenName: "A", familyName: "A" },
        { id: "b", raceId: "r", classId: "c2", givenName: "B", familyName: "B", fixedStartTime: "2026-10-08T08:00:00.000Z" }]
    } as unknown as RaceSnapshot;
    const proposed = withProposedStartTimes(snapshot, { classes: [{ classId: "c1", startRule: "FIXED" }],
      entryTimes: new Map([["a", "2026-10-08T08:02:00.000Z"]]) });
    expect(proposed.classes.map(row => row.startRule)).toEqual(["FIXED", "FIXED"]);
    expect(proposed.entries.map(row => row.fixedStartTime)).toEqual(["2026-10-08T08:02:00.000Z", "2026-10-08T08:00:00.000Z"]);
    const cleared = withProposedStartTimes(snapshot, { classes: [{ classId: "c2", startRule: "PUNCH" }], entryTimes: new Map([["b", null]]) });
    expect(cleared.entries[1]).not.toHaveProperty("fixedStartTime");
  });
});
