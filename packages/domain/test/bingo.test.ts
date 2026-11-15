import { describe, expect, it } from "vitest";
import {
  bingoSeconds, bingoStep, EMPTY_BINGO_RUN, mergeBingoProgress, rankBingo, type BingoCellArea, type BingoFix, type BingoProgress, type BingoRunState
} from "../src";

// 1:10 000: 10 m per mm, rutor om 100 m (10 mm). A1 uppe till vänster, B1 till höger om den.
const M = 10;
const cells: BingoCellArea[] = [
  { name: "A1", rect: { minX: 0, minY: 10, maxX: 10, maxY: 20 } },
  { name: "B1", rect: { minX: 10, minY: 10, maxX: 20, maxY: 20 } },
  { name: "A2", rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }
];
const fix = (x: number, y: number, t: number, accuracyM = 5): BingoFix => ({ x, y, t: t * 1000, accuracyM });
function run(fixes: readonly BingoFix[], from: BingoRunState = EMPTY_BINGO_RUN) {
  let state = from;
  const taken: string[] = [];
  for (const item of fixes) { const step = bingoStep(state, item, cells, M); state = step.state; taken.push(...step.newlyTaken); }
  return { state, taken };
}

describe("bingo: när en ruta är tagen", () => {
  it("en noggrann position minst 10 m in i rutan tar den, en gång", () => {
    const { state, taken } = run([fix(5, 15, 0), fix(5.5, 15, 5)]);
    expect(taken).toEqual(["A1"]);
    expect(state.taken).toEqual([{ cell: "A1", at: 0 }]);
  });

  it("nära kanten krävs två positioner i rad i rutan", () => {
    // 0,5 mm = 5 m från kanten mellan A1 och B1.
    expect(run([fix(9.5, 15, 0)]).taken).toEqual([]);
    expect(run([fix(9.5, 15, 0), fix(9.6, 15.5, 3)]).taken).toEqual(["A1"]);
    // Två i rad men i olika rutor: ingen.
    expect(run([fix(9.5, 15, 0), fix(10.5, 15, 3)]).taken).toEqual([]);
  });

  it("en position med sämre noggrannhet än 25 m tar ingen ruta", () => {
    expect(run([fix(5, 15, 0, 30), fix(5, 15, 5, 26)]).taken).toEqual([]);
    expect(run([fix(5, 15, 0, 25)]).taken).toEqual(["A1"]);
  });

  it("utanför rutnätet händer inget", () => {
    expect(run([fix(50, 50, 0)]).taken).toEqual([]);
  });
});

describe("bingo: sträckan", () => {
  it("summan av avstånden mellan positionerna", () => {
    // 3 + 4 mm = 30 m + 40 m på 20 s.
    const { state } = run([fix(0, 0, 0), fix(3, 0, 10), fix(3, 4, 20)]);
    expect(state.distanceM).toBeCloseTo(70);
    expect(state.track).toHaveLength(3);
  });

  it("dålig noggrannhet och hopp (över 8 m/s) räknas inte", () => {
    const { state } = run([fix(0, 0, 0), fix(30, 0, 5, 50), fix(10, 0, 6), fix(1, 0, 10)]);
    // 30 mm på 5 s med 50 m noggrannhet: bort. 100 m på 6 s (16 m/s): hopp. 10 m på 10 s: räknas.
    expect(state.distanceM).toBeCloseTo(10);
  });

  it("små rörelser när man står still räknas inte", () => {
    const { state } = run([fix(0, 0, 0), fix(0.2, 0, 2), fix(0, 0.2, 4), fix(0.2, 0.2, 6)]);
    expect(state.distanceM).toBe(0);
  });

  it("efter ett glapp på mer än 30 s räknas ingen sträcka rakt över det, och glappet sparas", () => {
    const { state } = run([fix(0, 0, 0), fix(1, 0, 5), fix(20, 0, 60), fix(21, 0, 65)]);
    expect(state.distanceM).toBeCloseTo(20);
    expect(state.gaps).toEqual([[5000, 60000]]);
  });
});

const progress = (overrides: Partial<BingoProgress>): BingoProgress =>
  ({ status: "RUNNING", startedAt: 0, finishedAt: null, distanceM: 0, taken: [], track: [], gaps: [], ...overrides });

describe("bingo: serverns kopia", () => {
  const names = new Set(["A1", "B1", "A2"]);
  it("rutorna som union med den tidigaste tiden, okända bort; längsta sträckan", () => {
    const merged = mergeBingoProgress(progress({ taken: [{ cell: "A1", at: 50 }], distanceM: 300 }),
      progress({ taken: [{ cell: "A1", at: 40 }, { cell: "B1", at: 60 }, { cell: "Z9", at: 70 }], distanceM: 200 }), names);
    expect(merged.taken).toEqual([{ cell: "A1", at: 40 }, { cell: "B1", at: 60 }]);
    expect(merged.distanceM).toBe(300);
  });

  it("mål står kvar när ett äldre läge kommer fram senare", () => {
    const finished = progress({ status: "FINISHED", finishedAt: 900 });
    expect(mergeBingoProgress(finished, progress({}), names)).toMatchObject({ status: "FINISHED", finishedAt: 900 });
    expect(mergeBingoProgress(progress({}), finished, names)).toMatchObject({ status: "FINISHED", finishedAt: 900 });
  });
});

describe("bingo: topplistan", () => {
  it("flest rutor, sedan kortast tid; avbrutna sist", () => {
    const rows = [
      { name: "Cia", cells: 5, status: "FINISHED" as const, seconds: 1800, distanceM: 3000 },
      { name: "Bo", cells: 7, status: "RUNNING" as const, seconds: 2000, distanceM: 3500 },
      { name: "Ali", cells: 5, status: "FINISHED" as const, seconds: 1500, distanceM: 2800 },
      { name: "Dan", cells: 9, status: "ABANDONED" as const, seconds: 900, distanceM: 1000 }
    ];
    expect(rankBingo(rows).map(row => row.name)).toEqual(["Bo", "Ali", "Cia", "Dan"]);
  });

  it("tiden är till mål, annars till senast tagna rutan", () => {
    expect(bingoSeconds({ startedAt: 1000, finishedAt: 61_000, taken: [] })).toBe(60);
    expect(bingoSeconds({ startedAt: 1000, finishedAt: null, taken: [{ cell: "A1", at: 31_000 }] })).toBe(30);
  });
});
