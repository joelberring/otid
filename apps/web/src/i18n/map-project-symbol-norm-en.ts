import type { Texts } from "../lib/language";
import type { mapProjectSymbolNormSv } from "./map-project-symbol-norm-sv";

type Base = "black" | "brown" | "yellow" | "green" | "blue";
const pct = (tint: number) => `${Math.round(tint * 100)}%`;
const mm = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} mm`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The symbols against ISSprOM 2019-2 (colours, widths, outlines), missing norm symbols and the outline around buildings. */
export const mapProjectSymbolNormEn: Texts<typeof mapProjectSymbolNormSv> = {
  repairHeading: "Fix after the sprint norm",
  repairHelp: "An existing map is fixed here without importing anything again: the symbols, the outline around buildings, the stairways and the yards, in that order. Each step can be undone (Ctrl+Z) except the symbols, which are removed with «Remove the fixes».",
  survey: "Go through the map",
  surveying: "Going through the map …",
  step: (index: number, title: string) => `${index}. ${title}`,
  stepSymbols: "The symbols",
  stepOutlines: "Outline around buildings",
  stepStairs: "Simplify stairways",
  stepYards: "Yards around apartment buildings",
  outlinesCount: (added: number, removed: number) => added + removed === 0 ? "The outline is already right." : `${count(added, "outline", "outlines")} to add${removed ? `, ${count(removed, "old one", "old ones")} to replace` : ""}.`,
  outlinesNone: "The map's building has its own outline, or the map has no outline symbol (521.1): nothing to do.",
  stairsCount: (stairs: number, steps: number) => stairs === 0 ? "No steps drawn as separate lines (the stairways are already centre lines)." : `${count(stairs, "stairway", "stairways")} from ${count(steps, "step", "steps")} drawn as separate lines.`,
  stairsRun: (n: number) => `Simplify stairways (${n})`,
  stairsDone: (n: number) => `${count(n, "stairway", "stairways")} simplified.`,
  yardsCount: (n: number) => n === 0 ? "No 520 area around apartment buildings." : `${count(n, "area", "areas")} 520 (shall not be entered) with buildings over 400 m²: yards that are normally open.`,
  yardsMark: "Mark on the map",
  yardsRemove: (n: number) => `Remove (${n})`,
  yardsDone: (n: number) => `${count(n, "area", "areas")} removed.`,
  stepWater: "Marshes and streams in built-up land",
  waterHelp: "Marsh (307–310), ditches and small streams (305, 306) within the distance from buildings, paved areas, edge lines and private land. A marsh is removed when at least half of it is there; a ditch is clipped.",
  waterMetres: "Built-up within",
  waterCount: (n: number) => n === 0 ? "No marshes or streams in built-up land." : `${count(n, "object", "objects")} in built-up land.`,
  waterRemove: (n: number) => `Remove marshes and streams in built-up land (${n})`,
  stepPaths: "Paths in roads",
  pathsHelp: "Paths (505–507) inside paved areas, along an edge within 3 m or in the middle of a street between two edges; paths crossing the road are kept up to the edge.",
  pathsCount: (n: number) => n === 0 ? "No paths in roads." : `${count(n, "path", "paths")} in roads.`,
  pathsRemove: (n: number) => `Remove paths in roads (${n})`,
  stepRings: "Small edge rings",
  ringsHelp: "Closed edge lines (501.1) too small or narrow to show as an island: traffic islands and pole bases from the base map that become «D» shapes along footways.",
  ringsCount: (n: number) => n === 0 ? "No small edge rings." : `${count(n, "edge ring", "edge rings")}.`,
  ringsRemove: (n: number) => `Remove small edge rings (${n})`,
  cleanDone: (n: number) => `${count(n, "object", "objects")} changed. Undo brings them back.`,
  help: "The map's symbols (colour, line width, outline) against the norm, for the symbols the map uses, and the norm's symbols missing from the map. The values come from IOF's O-Map Wiki; where the wiki gives no dimension it is not compared.",
  forest: "The check exists for sprint maps (ISSprOM 2019-2). Forest maps (ISOM 2017-2) have no table yet.",
  none: "The symbols the map uses follow the norm's table.",
  count: (n: number) => `${count(n, "symbol differs", "symbols differ")} from the norm.`,
  problem: (problem: { kind: string; base?: Base; tints?: readonly number[]; found?: { base?: Base | undefined; tint?: number | undefined } | null | number; width?: number }) => {
    switch (problem.kind) {
      case "FILL": {
        const found = typeof problem.found === "object" && problem.found ? problem.found : undefined;
        const now = found?.base ? `${found.base} ${pct(found.tint ?? 0)}` : "another colour";
        return `${now}, the norm says ${problem.base} ${(problem.tints ?? []).map(pct).join(" or ")}`;
      }
      case "OUTLINE": return "has no black outline";
      case "LINE_COLOR": return `the line should be ${problem.base}`;
      case "LINE_WIDTH": return `line ${mm(typeof problem.found === "number" ? problem.found : 0)}, the norm says ${mm(problem.width ?? 0)}`;
      case "STEPS": return "has no steps across the line";
      case "STAIR_BAND": return "has no stairway band in brown 30% (as in Mapper's ISSprOM 2019-2)";
      case "STAIR_SIDES": return "has no black side lines (as in Mapper's ISSprOM 2019-2)";
      default: return problem.kind;
    }
  },
  fix: "Fix",
  fixAll: (n: number) => `Fix the symbols after the norm (${n})`,
  fixed: "Fixed in the project (shown in drawing mode and in the next map version).",
  outlinesHint: "The outline is drawn as lines around connected buildings: Add outline around buildings.",
  cannotFix: "O-Tid's template does not fix this; change the symbol in Mapper.",
  onlyOwner: "Only the project's owners can fix the symbols.",
  ocad: "Symbols are not written to OCAD files here. Save the map in Mapper (.omap) to fix them.",
  failed: "Could not save. Try again.",
  source: "Source",
  missing: (n: number) => `${count(n, "symbol", "symbols")} from the norm missing in the map:`,
  addMissing: (n: number) => `Add missing norm symbols (${n})`,
  added: "Added to the project's palette (in the symbol panel and the import's choices).",
  undone: "Remove the fixes",
  outlines: "Add outline around buildings",
  outlinesHelp: "A black outline around all buildings (521) in the map's outline symbol (521.1). Touching buildings get a shared outline without the wall between them. Can be undone.",
  outlinesBusy: "Computing the outline …",
  outlinesDone: (added: number, removed: number, houses: number) => added + removed === 0
    ? `The outline around ${count(houses, "building", "buildings")} is already right.`
    : `${count(added, "outline", "outlines")} around ${count(houses, "building", "buildings")}${removed ? `, ${count(removed, "old one", "old ones")} replaced` : ""}.`
};
