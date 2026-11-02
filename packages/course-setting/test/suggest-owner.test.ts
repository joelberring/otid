/**
 * Förslag på kontrollbeskrivning mot ägarens riktiga karta (ADR-0180 beslut 13). Filerna är klubbens och committas inte;
 * testet körs bara när `OTID_REAL_MAP` (kartfilen) och `OTID_REAL_MAP_PPEN` (banor på den kartan) pekar på dem, och hoppas
 * över i CI. Med `OTID_REAL_MAP_FACIT` (JSON: kontrollkod → godtagna D, t.ex. { "41": ["2.4"] }) mäts träffsäkerheten för
 * D; facit ligger utanför repot eftersom banorna är hemliga före tävlingen.
 */
import { existsSync, readFileSync } from "node:fs";
import { readMapFile } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { readPpen, suggestForDocument } from "../src";

const mapPath = process.env.OTID_REAL_MAP;
const ppenPath = process.env.OTID_REAL_MAP_PPEN;
const facitPath = process.env.OTID_REAL_MAP_FACIT;
const hasMap = mapPath !== undefined && existsSync(mapPath) && ppenPath !== undefined && existsSync(ppenPath);

describe.skipIf(!hasMap)("förslag på ägarens karta (OTID_REAL_MAP, OTID_REAL_MAP_PPEN)", () => {
  it("ger högst tre förslag per kontroll, med förklaring, och räknar alla kontroller på under en sekund", () => {
    const map = readMapFile(new Uint8Array(readFileSync(mapPath!)), mapPath);
    const { document } = readPpen(readFileSync(ppenPath!, "utf8"));
    suggestForDocument(map, document);
    const start = performance.now();
    const result = suggestForDocument(map, document);
    expect(performance.now() - start).toBeLessThan(1000);
    const controls = Object.values(document.controls).filter(control => control.kind === "NORMAL");
    expect(Object.keys(result).length).toBe(controls.length);
    let suggested = 0;
    for (const list of Object.values(result)) {
      expect(list.length).toBeLessThanOrEqual(3);
      if (list.length > 0) suggested++;
      for (const suggestion of list) {
        expect(suggestion.reason).not.toBe("");
        expect(suggestion.boxes.some(box => box.box === "D")).toBe(true);
        expect(suggestion.boxes.every(box => box.box !== "F" || box.ref?.startsWith("10."))).toBe(true);
      }
    }
    expect(suggested / controls.length).toBeGreaterThan(0.8);
    if (!facitPath || !existsSync(facitPath)) return;
    const facit = JSON.parse(readFileSync(facitPath, "utf8")) as Record<string, readonly string[]>;
    let hits = 0, total = 0;
    for (const control of controls) {
      const accepted = facit[control.code ?? ""];
      if (!accepted) continue;
      total++;
      const d = result[control.id]?.[0]?.boxes.find(box => box.box === "D")?.ref;
      if (d && accepted.includes(d)) hits++;
      else console.info(`Kontroll ${control.code}: föreslog ${d ?? "inget"}, facit ${accepted.join("/")}`);
    }
    console.info(`D stämmer i ${hits} av ${total}`);
    expect(hits / total).toBeGreaterThanOrEqual(0.85);
  });
});
