import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GroundGrid } from "../../../scripts/geo-cliffs";
import { knolls } from "../../../scripts/geo-rock";
import { maskOf, pointCap, runStep, StepSkipped, STEPS } from "../../../scripts/geo-steps";

const file = fileURLToPath(new URL("../../../scripts/geo-steps.ts", import.meta.url));

/** Mark med kullar i ett rutnät: en kulle var 30:e meter. */
function hilly(size: number): GroundGrid {
  const z = new Float32Array(size * size);
  for (let x = 0; x < size; x += 1) for (let y = 0; y < size; y += 1) {
    const dx = (x % 30) - 15, dy = (y % 30) - 15;
    z[x * size + y] = 20 + Math.max(0, 1.6 - Math.hypot(dx, dy) / 4 * 1.6);
  }
  return { minX: 1000, minY: 2000, cell: 1, width: size, height: size, z };
}

/** Bebyggelse i full kartstorlek: gator som sänkor var 25:e meter, kvarter med ojämna tak och tomter. */
function town(size: number): GroundGrid {
  const z = new Float32Array(size * size);
  let seed = 11;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let x = 0; x < size; x += 1) for (let y = 0; y < size; y += 1) {
    const street = x % 25 < 3 || y % 25 < 3;
    z[x * size + y] = 30 + x * 0.01 + (street ? -0.6 : random() < 0.3 ? random() * 1.5 : 0);
  }
  return { minX: 0, minY: 0, cell: 1, width: size, height: size, z };
}

describe("geo-arbetarens steg i egna trådar", () => {
  it("ger samma kullar i tråden som direkt", async () => {
    const ground = hilly(120), direct = knolls(ground, []);
    const threaded = await runStep("knolls", { ground }, undefined, 60_000, file);
    expect(direct.length).toBeGreaterThan(5);
    expect(threaded.knolls).toEqual(direct);
    expect(threaded.capped).toBe(0);
  });
  it("hoppar över ett steg som går över tiden i stället för att fälla jobbet", async () => {
    await expect(runStep("ditches", { ground: town(1500) }, undefined, 5, file)).rejects.toBeInstanceOf(StepSkipped);
  });
  it("avbryter mitt i ett steg när jobbet avbryts", async () => {
    const control = new AbortController();
    const running = runStep("ditches", { ground: town(1500) }, control.signal, 60_000, file);
    control.abort();
    await expect(running).rejects.not.toBeInstanceOf(StepSkipped);
  });
  it("masken svarar som funktionen i cellernas mitt", () => {
    const ground = hilly(40), at = (x: number, y: number) => (Math.floor(x / 7) + Math.floor(y / 5)) % 2 === 0;
    const mask = maskOf(ground, at);
    for (const [x, y] of [[3, 9], [17, 22], [39, 0]] as const) {
      expect(mask[x * ground.height + y] === 1).toBe(at(ground.minX + x + 0.5, ground.minY + y + 0.5));
    }
  });
  it("har ett tak för antalet punkter per km²", () => {
    expect(pointCap(hilly(1000))).toBe(400);
    expect(pointCap(hilly(100))).toBe(50);
  });
  // Regeln mot nästa steg som växer för fort (Djurgården och Nåttarö 2026-11-11): alla stegen på bebyggelse i kartstorlek.
  it("klarar bebyggelse på 2,5 × 2,5 km inom rimlig tid", () => {
    const ground = town(2500), started = Date.now();
    const open = maskOf(ground, (x, y) => (Math.floor(x / 60) + Math.floor(y / 60)) % 2 === 0);
    const ditches = STEPS.ditches({ ground, wet: open });
    const stones = STEPS.stones({ ground });
    const rock = STEPS.rock({ ground, open });
    const hills = STEPS.knolls({ ground, stones: stones.stones });
    expect(stones.stones.length).toBeLessThanOrEqual(pointCap(ground));
    expect(hills.knolls.length).toBeLessThanOrEqual(pointCap(ground));
    expect(ditches.lines.length + rock.rock.length).toBeGreaterThanOrEqual(0);
    expect(Date.now() - started).toBeLessThan(120_000);
  }, 180_000);
});
