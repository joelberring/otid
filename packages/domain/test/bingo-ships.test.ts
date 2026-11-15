import { describe, expect, it } from "vitest";
import {
  bingoGroupSeed, chooseShotFix, shotPoints, SHIP_POINTS, defaultShipSplit, placeGroupShips, shipSplitFor, shotCellCounts, defaultShips, judgeShots, mergeShots, placeShips, rankShips, scoreShots, bingoCellPosition, type BingoCellArea, type Shot
} from "../src";

// 1:10 000, rutor om 100 m (10 mm): 6 × 5 rutor, A1 uppe till vänster.
const M = 10;
const grid = (columns: number, rows: number): BingoCellArea[] => Array.from({ length: rows * columns }, (_, i) => {
  const column = i % columns, row = Math.floor(i / columns);
  return { name: `${String.fromCharCode(65 + column)}${row + 1}`, rect: { minX: column * 10, maxX: column * 10 + 10, minY: -(row + 1) * 10, maxY: -row * 10 } };
});
const cells = grid(6, 5);
const names = cells.map(cell => cell.name);
const center = (name: string) => { const r = cells.find(cell => cell.name === name)!.rect; return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }; };
const shot = (cell: string, at: number, where = cell, accuracyM = 8): Shot => ({ cell, at, ...center(where), accuracyM });

describe("sänka skepp: skeppen", () => {
  it("förvalen efter rutnätets storlek", () => {
    expect(defaultShips(16)).toEqual([2, 2, 1]);
    expect(defaultShips(30)).toEqual([3, 2, 2]);
    expect(defaultShips(80)).toEqual([4, 3, 3, 2, 2]);
  });

  it("samma frö ger samma skepp; raka, på rutor som finns och inte intill varandra", () => {
    for (const seed of [1, 42, 123456789, 4_000_000_000]) {
      const ships = placeShips(names, [4, 3, 3, 2, 2].slice(0, 4), seed);
      expect(placeShips(names, [4, 3, 3, 2], seed)).toEqual(ships);
      expect(ships.map(ship => ship.cells.length)).toEqual([4, 3, 3, 2]);
      const taken = new Map<string, number>();
      ships.forEach((ship, index) => {
        const at = ship.cells.map(name => bingoCellPosition(name)!);
        const straight = at.every(p => p.column === at[0]!.column) || at.every(p => p.row === at[0]!.row);
        expect(straight).toBe(true);
        for (const p of at) {
          expect(names).toContain(`${String.fromCharCode(65 + p.column)}${p.row + 1}`);
          for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
            const other = taken.get(`${p.column + dc},${p.row + dr}`);
            expect(other === undefined || other === index).toBe(true);
          }
        }
        at.forEach(p => taken.set(`${p.column},${p.row}`, index));
      });
    }
    expect(placeShips(names, [2, 2, 1], 7)).not.toEqual(placeShips(names, [2, 2, 1], 8));
  });

  it("för många skepp för rutnätet: de minsta tas bort", () => {
    const small = grid(3, 3).map(cell => cell.name);
    const ships = placeShips(small, [3, 3, 3], 5);
    expect(ships.length).toBeGreaterThan(0);
    expect(ships.length).toBeLessThan(3);
  });
});

describe("sänka skepp: skotten och poängen", () => {
  const ships = [{ cells: ["A1", "B1"] }, { cells: ["D3"] }];
  it("träff, sänkt, vatten och fel ruta; en ruta skjuts en gång; fel ruta tar inte rutan", () => {
    const judged = judgeShots([shot("A1", 1), shot("C2", 2, "C3"), shot("C2", 3), shot("A1", 4), shot("B1", 5), shot("D3", 6)], cells, ships, M);
    expect(judged.map(item => [item.cell, item.result])).toEqual([["A1", "HIT"], ["C2", "WRONG"], ["C2", "WATER"], ["B1", "SUNK"], ["D3", "SUNK"]]);
    expect(scoreShots(judged)).toEqual({ points: 3 * 3 + 2 * 3 + 1 - 2, hits: 3, sunk: 2, wrong: 1, water: 1, sharedSunk: 0, lastShotAt: 6 });
  });

  it("marginalen utanför kanten: noggrannheten, minst 10 m, högst 25 m", () => {
    const edge = (dx: number, accuracyM: number): Shot => ({ cell: "A1", at: 1, x: 10 + dx, y: -5, accuracyM });
    expect(judgeShots([edge(0.9, 5)], cells, ships, M)[0]!.result).toBe("HIT");
    expect(judgeShots([edge(1.1, 5)], cells, ships, M)[0]!.result).toBe("WRONG");
    expect(judgeShots([edge(1.9, 20)], cells, ships, M)[0]!.result).toBe("HIT");
    // Sämre än 20 m räknas inte som skott alls (telefonen väntar på bättre).
    expect(judgeShots([edge(0, 21)], cells, ships, M)).toEqual([]);
  });

  it("serverns och telefonens skott ihop, och topplistan", () => {
    expect(mergeShots([shot("A1", 1)], [shot("A1", 1), shot("B1", 2)]).map(item => item.cell)).toEqual(["A1", "B1"]);
    const row = (name: string, points: number, sunk: number, status: "RUNNING" | "FINISHED" | "ABANDONED" = "RUNNING") =>
      ({ name, points, sunk, hits: points, wrong: 0, water: 0, sharedSunk: 0, lastShotAt: 1, status });
    expect(rankShips([row("Bo", 3, 0), row("Ali", 5, 1), row("Cia", 9, 2, "ABANDONED"), row("Dan", 5, 2)]).map(item => item.name))
      .toEqual(["Dan", "Ali", "Bo", "Cia"]);
  });
});

describe("sänka skepp: gemensamma och egna skepp", () => {
  it("förval efter rutnätets storlek och fälten som de står", () => {
    expect(defaultShipSplit(16)).toEqual({ shared: [2], own: [1, 1] });
    expect(defaultShipSplit(80)).toEqual({ shared: [4, 3], own: [2, 2] });
    expect(shipSplitFor(80, undefined, undefined)).toEqual({ shared: [4, 3], own: [2, 2] });
    // Det äldre fältet «Skepp» är bara egna.
    expect(shipSplitFor(80, undefined, [3, 2])).toEqual({ shared: [], own: [3, 2] });
    expect(shipSplitFor(80, [4], undefined)).toEqual({ shared: [4], own: [] });
  });

  it("gemensamma lika för alla i gruppen, egna olika och aldrig på eller intill de gemensamma", () => {
    const big = grid(10, 8).map(cell => cell.name);
    const seed = bingoGroupSeed("10000000-0000-4000-8000-000000000001", "3");
    expect(seed).toBe(bingoGroupSeed("10000000-0000-4000-8000-000000000001", "3"));
    expect(seed).not.toBe(bingoGroupSeed("10000000-0000-4000-8000-000000000001", "4"));
    const split = { shared: [4, 3], own: [2, 2] };
    const a = placeGroupShips(big, split, seed, 11), b = placeGroupShips(big, split, seed, 12);
    const shared = (ships: typeof a) => ships.filter(ship => ship.shared).map(ship => ship.cells);
    expect(shared(a)).toEqual(shared(b));
    expect(shared(a).map(cells => cells.length)).toEqual([4, 3]);
    expect(a.filter(ship => !ship.shared).map(ship => ship.cells)).not.toEqual(b.filter(ship => !ship.shared).map(ship => ship.cells));
    for (const ships of [a, b]) {
      const near = new Set(shared(ships).flat().flatMap(name => { const p = bingoCellPosition(name)!;
        return [-1, 0, 1].flatMap(dc => [-1, 0, 1].map(dr => `${p.column + dc},${p.row + dr}`)); }));
      for (const name of ships.filter(ship => !ship.shared).flatMap(ship => ship.cells)) {
        const p = bingoCellPosition(name)!;
        expect(near.has(`${p.column},${p.row}`)).toBe(false);
      }
    }
  });

  it("sänkta gemensamma räknas för sig; prickarna räknar löpare som stått i rutan, inte fel ruta", () => {
    const ships = [{ cells: ["A1", "B1"], shared: true as const }, { cells: ["D3"] }];
    const judged = judgeShots([shot("A1", 1), shot("B1", 2), shot("D3", 3)], cells, ships, M);
    expect(scoreShots(judged)).toMatchObject({ sunk: 2, sharedSunk: 1 });
    const other = judgeShots([shot("A1", 1), shot("C2", 2, "C3"), shot("E5", 3)], cells, ships, M);
    expect(shotCellCounts([judged, other])).toEqual({ A1: 2, B1: 1, D3: 1, E5: 1 });
  });
});

describe("sänka skepp: poängskalan och skottets position", () => {
  it("vatten +1, träff +3, sänkt +3 till, fel −2", () => {
    expect(SHIP_POINTS).toEqual({ water: 1, hit: 3, sunkBonus: 3, wrong: -2 });
    expect(["WATER", "HIT", "SUNK", "WRONG"].map(result => shotPoints(result as "WATER"))).toEqual([1, 3, 6, -2]);
  });

  it("färsk, noggrann och inte för tidigt efter uppvärmningen; den senaste av två bra", () => {
    const fix = (accuracyM: number, receivedAt: number) => ({ accuracyM, receivedAt });
    // För tidig: kom 1 s efter att uppvärmningen började.
    expect(chooseShotFix([fix(5, 1000)], 1500, 0)).toBeUndefined();
    // Gammal: 3 s sedan.
    expect(chooseShotFix([fix(5, 4000)], 7000, 0)).toBeUndefined();
    // Onoggrann senast, men en bra strax före inom 2 s.
    expect(chooseShotFix([fix(8, 5000), fix(30, 5500)], 6000, 0)).toEqual(fix(8, 5000));
    // Två bra i rad: den senaste.
    expect(chooseShotFix([fix(8, 5000), fix(12, 5800)], 6000, 0)).toEqual(fix(12, 5800));
    expect(chooseShotFix([], 6000, 0)).toBeUndefined();
  });
});
