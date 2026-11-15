import { describe, expect, it } from "vitest";
import {
  defaultShips, judgeShots, mergeShots, placeShips, rankShips, scoreShots, bingoCellPosition, type BingoCellArea, type Shot
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
    expect(scoreShots(judged)).toEqual({ points: 3 + 4 - 1, hits: 3, sunk: 2, wrong: 1, water: 1, lastShotAt: 6 });
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
      ({ name, points, sunk, hits: points, wrong: 0, water: 0, lastShotAt: 1, status });
    expect(rankShips([row("Bo", 3, 0), row("Ali", 5, 1), row("Cia", 9, 2, "ABANDONED"), row("Dan", 5, 2)]).map(item => item.name))
      .toEqual(["Dan", "Ali", "Bo", "Cia"]);
  });
});
