import { describe, expect, it } from "vitest";
import {
  drawStartTimes, seededPositions, type StartDrawClass, type StartDrawInput, type StartDrawResult, type StartDrawRunner
} from "../src";

/** PLAN.md steg 26: avancerad lottning. */
const MINUTE = 60_000;
const first = Date.parse("2026-10-08T08:00:00Z");
const runners = (prefix: string, count: number, seeds: Record<number, number> = {}): StartDrawRunner[] =>
  Array.from({ length: count }, (_, index) => ({ entryId: `${prefix}-${String(index).padStart(3, "0")}`, club: `Klubb ${index}`,
    seedRank: seeds[index] ?? null }));
const raceClass = (classId: string, controls: number[][], overrides: Partial<StartDrawClass> = {}): StartDrawClass => ({
  classId, name: classId, startControls: controls, method: "MINUTE", intervalMinutes: 2,
  vacancies: { kind: "COUNT", value: 0 }, runners: runners(classId, 4), ...overrides
});
const input = (classes: StartDrawClass[], overrides: Partial<StartDrawInput> = {}): StartDrawInput =>
  ({ seed: 4_711, firstStartMs: first, clubSeparation: true, classes, ...overrides });
const minutes = (result: StartDrawResult, classId: string) =>
  result.classes.find(row => row.classId === classId)!.slots.map(slot => (slot.startMs - first) / MINUTE);
const overlap = (a: readonly number[], b: readonly number[]) => a.filter(minute => b.includes(minute));
function perMinute(result: StartDrawResult, classIds = result.classes.map(row => row.classId)) {
  const counts = new Map<number, number>();
  for (const classId of classIds) for (const minute of minutes(result, classId)) counts.set(minute, (counts.get(minute) ?? 0) + 1);
  return counts;
}

describe("startgrupp efter banornas första kontroller", () => {
  const a = raceClass("A", [[31, 32, 33]]), b = raceClass("B", [[31, 34, 35]]), c = raceClass("C", [[31, 32, 36]]);

  it("med en kontroll startar alla med samma första kontroll i olika minuter", () => {
    const result = drawStartTimes(input([a, b, c]));
    expect(overlap(minutes(result, "A"), minutes(result, "B"))).toEqual([]);
    expect(overlap(minutes(result, "A"), minutes(result, "C"))).toEqual([]);
    expect(overlap(minutes(result, "B"), minutes(result, "C"))).toEqual([]);
    expect(result.groups).toEqual([{ controlCodes: [31], classIds: ["A", "B", "C"] }]);
  });

  it("med två kontroller delar bara banor med samma två första kontroller grupp", () => {
    const result = drawStartTimes(input([a, b, c], { rules: { groupControls: 2 } }));
    expect(overlap(minutes(result, "A"), minutes(result, "C"))).toEqual([]);
    // B har en annan andra kontroll och startar från första start, parallellt med A eller C.
    expect(minutes(result, "B")).toEqual([0, 2, 4, 6]);
    expect(result.groups).toEqual([{ controlCodes: [31, 32], classIds: ["A", "C"] }]);
  });

  it("med tre kontroller är alla tre egna grupper", () => {
    const result = drawStartTimes(input([a, b, c], { rules: { groupControls: 3 } }));
    for (const classId of ["A", "B", "C"]) expect(minutes(result, classId)).toEqual([0, 2, 4, 6]);
    expect(result.groups).toEqual([]);
  });

  it("räknar en gafflad klass till gruppen om någon variant delar början, och slår ihop grupper i kedja", () => {
    const forked = raceClass("F", [[31, 32, 40], [50, 51, 41]]);
    const other = raceClass("G", [[50, 51, 42]]);
    const third = raceClass("H", [[31, 32, 43]]);
    const result = drawStartTimes(input([forked, other, third], { rules: { groupControls: 2 } }));
    expect(overlap(minutes(result, "F"), minutes(result, "G"))).toEqual([]);
    expect(overlap(minutes(result, "F"), minutes(result, "H"))).toEqual([]);
    // G och H delar ingen början men hör ihop via F.
    expect(overlap(minutes(result, "G"), minutes(result, "H"))).toEqual([]);
    expect(result.groups).toHaveLength(1);
    expect([...result.groups[0]!.classIds].sort()).toEqual(["F", "G", "H"]);
    // Med tre kontroller skiljer sig alla varianter: tre egna grupper.
    expect(drawStartTimes(input([forked, other, third], { rules: { groupControls: 3 } })).groups).toEqual([]);
  });
});

describe("tak per minut", () => {
  it("håller det totala taket över alla startgrupper", () => {
    const classes = [31, 45, 60].map(code => raceClass(`K${code}`, [[code]], { intervalMinutes: 1 }));
    const free = drawStartTimes(input(classes));
    expect(Math.max(...perMinute(free).values())).toBe(3);
    const capped = drawStartTimes(input(classes, { rules: { maxPerMinute: 2 } }));
    expect(Math.max(...perMinute(capped).values())).toBe(2);
    expect(capped.warnings).toEqual([]);
  });

  it("håller taket per startfålla när fler kontroller avgör startgruppen", () => {
    const classes = [32, 34, 35].map(second => raceClass(`K${second}`, [[31, second]], { intervalMinutes: 1 }));
    const other = raceClass("Annan", [[45, 46]], { intervalMinutes: 1 });
    const free = drawStartTimes(input([...classes, other], { rules: { groupControls: 2 } }));
    expect(Math.max(...perMinute(free, classes.map(row => row.classId)).values())).toBe(3);
    const capped = drawStartTimes(input([...classes, other], { rules: { groupControls: 2, maxPerMinutePerPen: 2 } }));
    expect(Math.max(...perMinute(capped, classes.map(row => row.classId)).values())).toBe(2);
    // En annan fålla påverkas inte av taket.
    expect(minutes(capped, "Annan")).toEqual([0, 1, 2, 3]);
  });

  it("räknar befintliga tider i taket och varnar om de redan går över det", () => {
    const existing = [{ classId: "Gammal", startControls: [[45]], startTimesMs: [0, 0, 1].map(minute => first + minute * MINUTE + minute * 7_000) }];
    const result = drawStartTimes(input([raceClass("Ny", [[60]], { intervalMinutes: 1 })], { existing, rules: { maxPerMinute: 1 } }));
    expect(minutes(result, "Ny")).toEqual([2, 3, 4, 5]);
    expect(result.warnings).toEqual([]);
    const crowded = [{ classId: "X", startControls: [[45]], startTimesMs: [first] }, { classId: "Y", startControls: [[46]], startTimesMs: [first] }];
    const warned = drawStartTimes(input([raceClass("Ny", [[60]])], { existing: crowded, rules: { maxPerMinute: 1 } }));
    expect(warned.warnings).toEqual([{ code: "EXISTING_OVER_LIMIT", scope: "TOTAL", limit: 1, firstMs: first, minuteCount: 1 }]);
  });
});

describe("senare start och startordning", () => {
  it("startar en klass på sitt klockslag eller sin förskjutning och låter de andra fylla runt", () => {
    const later = raceClass("Senare", [[31]], { laterStart: { kind: "OFFSET", minutes: 30 } });
    const clock = raceClass("Klocka", [[45]], { laterStart: { kind: "CLOCK", startMs: first + 45 * MINUTE } });
    const big = raceClass("Stor", [[31]], { runners: runners("Stor", 20) });
    const result = drawStartTimes(input([big, later, clock]));
    expect(minutes(result, "Senare")).toEqual([30, 32, 34, 36]);
    expect(minutes(result, "Klocka")).toEqual([45, 47, 49, 51]);
    expect(overlap(minutes(result, "Stor"), minutes(result, "Senare"))).toEqual([]);
    expect(minutes(result, "Stor")[0]).toBeLessThanOrEqual(1);
    expect(result.warnings).toEqual([]);
  });

  it("flyttar en senare start som krockar till första tillåtna minut och varnar", () => {
    const one = raceClass("Ett", [[31]], { intervalMinutes: 1, laterStart: { kind: "OFFSET", minutes: 10 } });
    const two = raceClass("Två", [[31]], { intervalMinutes: 1, laterStart: { kind: "OFFSET", minutes: 10 } });
    const result = drawStartTimes(input([one, two]));
    expect(minutes(result, "Ett")).toEqual([10, 11, 12, 13]);
    expect(minutes(result, "Två")).toEqual([14, 15, 16, 17]);
    expect(result.warnings).toEqual([{ code: "LATER_START_MOVED", classId: "Två", wantedMs: first + 10 * MINUTE, actualMs: first + 14 * MINUTE }]);
    const early = drawStartTimes(input([raceClass("Tidig", [[31]], { laterStart: { kind: "CLOCK", startMs: first - 5 * MINUTE } })]));
    expect(minutes(early, "Tidig")[0]).toBe(0);
    expect(early.warnings[0]).toMatchObject({ code: "LATER_START_MOVED", wantedMs: first - 5 * MINUTE, actualMs: first });
  });

  it("följer en egen startordning inom startgruppen", () => {
    const big = raceClass("Stor", [[31]], { intervalMinutes: 1, runners: runners("Stor", 6) });
    const small = raceClass("Liten", [[31]], { intervalMinutes: 1, runners: runners("Liten", 2) });
    expect(minutes(drawStartTimes(input([small, big])), "Stor")).toEqual([0, 1, 2, 3, 4, 5]);
    const ordered = drawStartTimes(input([small, big], { rules: { classOrder: ["Liten", "Stor"] } }));
    expect(minutes(ordered, "Liten")).toEqual([0, 1]);
    expect(minutes(ordered, "Stor")).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe("seedning", () => {
  const seeded = (seeding?: "LAST" | "SPREAD", vacancies = 0) => drawStartTimes(input([raceClass("H21", [[31]], {
    runners: runners("H21", 10, { 4: 1, 7: 2, 1: 3 }), vacancies: { kind: "COUNT", value: vacancies } })],
  seeding ? { rules: { seeding } } : {})).classes[0]!.slots.flatMap(slot => slot.entryId ? [slot.entryId] : []);

  it("lottar seedade sist i klassen med bäst rank sist", () => {
    const order = seeded();
    expect(order.slice(-3)).toEqual(["H21-001", "H21-007", "H21-004"]);
    expect(seeded("LAST", 2).slice(-3)).toEqual(["H21-001", "H21-007", "H21-004"]);
    // De oseedade lottas fritt före: ett annat frö ger en annan ordning men samma seedade sist.
    const other = drawStartTimes({ ...input([raceClass("H21", [[31]], { runners: runners("H21", 10, { 4: 1, 7: 2, 1: 3 }) })]), seed: 99 })
      .classes[0]!.slots.map(slot => slot.entryId);
    expect(other.slice(-3)).toEqual(["H21-001", "H21-007", "H21-004"]);
    expect(other.slice(0, 7)).not.toEqual(order.slice(0, 7));
  });

  it("sprider seedade jämnt med bäst rank sist", () => {
    expect(seededPositions(10, 3)).toEqual([2, 5, 9]);
    expect(seededPositions(4, 4)).toEqual([0, 1, 2, 3]);
    const order = seeded("SPREAD");
    expect([order[2], order[5], order[9]]).toEqual(["H21-001", "H21-007", "H21-004"]);
  });
});

describe("delvis lottning och startfönster", () => {
  it("rör inte befintliga tider och lägger nya tider utan krock med dem", () => {
    const existing = [{ classId: "D21", startControls: [[31, 32]], startTimesMs: [0, 2, 4, 6].map(minute => first + minute * MINUTE) }];
    const result = drawStartTimes(input([raceClass("H21", [[31, 40]]), raceClass("H16", [[45]])], { existing }));
    expect(minutes(result, "H21")).toEqual([1, 3, 5, 7]);
    expect(minutes(result, "H16")).toEqual([0, 2, 4, 6]);
    expect(result.classes.map(row => row.classId)).toEqual(["H21", "H16"]);
    expect(result.groups).toEqual([{ controlCodes: [31], classIds: ["H21", "D21"] }]);
    // Två kontroller avgör: H21 och D21 är olika grupper och H21 startar från första start.
    expect(minutes(drawStartTimes(input([raceClass("H21", [[31, 40]])], { existing, rules: { groupControls: 2 } })), "H21")).toEqual([0, 2, 4, 6]);
  });

  it("varnar när befintliga klasser i samma startgrupp redan startar samma minut", () => {
    const existing = [{ classId: "X", startControls: [[31, 32]], startTimesMs: [first, first + 2 * MINUTE] },
      { classId: "Y", startControls: [[31, 33]], startTimesMs: [first, first + 2 * MINUTE] }];
    expect(drawStartTimes(input([raceClass("Ny", [[45]])], { existing, rules: { groupControls: 2 } })).warnings).toEqual([]);
    expect(drawStartTimes(input([raceClass("Ny", [[45]])], { existing })).warnings)
      .toEqual([{ code: "EXISTING_GROUP_CLASH", classIds: ["X", "Y"], firstMs: first, minuteCount: 2 }]);
  });

  it("ger samma lottning för samma underlag och frö, även med regler, seedning och befintliga tider", () => {
    const build = () => input([raceClass("H21", [[31]], { runners: runners("H21", 30, { 3: 1, 9: 2 }) }),
      raceClass("D21", [[31, 34]], { laterStart: { kind: "OFFSET", minutes: 15 } }), raceClass("H16", [[45]], { method: "MASS" })],
    { existing: [{ classId: "Gammal", startControls: [[45]], startTimesMs: [first + 5 * MINUTE] }],
      rules: { groupControls: 2, maxPerMinute: 2, maxPerMinutePerPen: 1, lastStartMs: first + 30 * MINUTE, seeding: "SPREAD" } });
    expect(drawStartTimes(build())).toEqual(drawStartTimes(build()));
    expect(drawStartTimes({ ...build(), seed: 7 }).classes[0]!.slots).not.toEqual(drawStartTimes(build()).classes[0]!.slots);
  });

  it("varnar i stället för att fallera när startfönstret inte räcker och säger vilken sista start som behövs", () => {
    const classes = [raceClass("H21", [[31]], { intervalMinutes: 1, runners: runners("H21", 10) }),
      raceClass("D21", [[31]], { intervalMinutes: 1, runners: runners("D21", 5) }), raceClass("H16", [[45]], { intervalMinutes: 1 })];
    const result = drawStartTimes(input(classes, { rules: { maxPerMinute: 1, lastStartMs: first + 9 * MINUTE } }));
    const last = Math.max(...result.classes.flatMap(row => row.slots.map(slot => slot.startMs)));
    expect(last).toBe(first + 18 * MINUTE);
    expect(Math.max(...perMinute(result).values())).toBe(1);
    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    if (warning?.code !== "AFTER_LAST_START") throw new Error("Varningen saknas");
    expect([...warning.classIds].sort()).toEqual(["D21", "H16"]);
    expect([warning.firstAfterMs, warning.neededLastStartMs]).toEqual([first + 10 * MINUTE, last]);
  });
});
