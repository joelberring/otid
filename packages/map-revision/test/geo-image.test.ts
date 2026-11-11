import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ägaren 2026-11-11: geo-avbildningen kopierar geo-arbetarens filer en och en (deploy/geo.Dockerfile). En ny fil som inte står
 * där gör att arbetaren inte startar på geo-servern (hände med geo-points.ts). Alla filer som geo-worker.ts läser in, direkt
 * eller via andra, ska stå i avbildningens lista.
 */
const root = join(import.meta.dirname, "../../..");
describe("geo-avbildningen", () => {
  it("kopierar alla filer som geo-arbetaren läser in", () => {
    const seen = new Set<string>(), queue = ["geo-worker.ts"];
    while (queue.length) {
      const name = queue.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      for (const match of readFileSync(join(root, "scripts", name), "utf8").matchAll(/from "\.\/([a-z0-9-]+\.ts)"/g)) queue.push(match[1]!);
    }
    const dockerfile = readFileSync(join(root, "deploy/geo.Dockerfile"), "utf8");
    expect([...seen].filter(name => !dockerfile.includes(`scripts/${name}`))).toEqual([]);
    expect(seen.size).toBeGreaterThan(5);
  });
});
