import type { Texts } from "../lib/language";
import type { mapProjectSymbolNormSv } from "./map-project-symbol-norm-sv";

type Base = "black" | "brown" | "yellow" | "green" | "blue";
const pct = (tint: number) => `${Math.round(tint * 100)}%`;
const mm = (value: number) => `${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })} mm`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The symbols against ISSprOM 2019-2 (colours, widths, outlines), missing norm symbols and the outline around buildings. */
export const mapProjectSymbolNormEn: Texts<typeof mapProjectSymbolNormSv> = {
  heading: "Symbols against ISSprOM 2019-2",
  help: "The map's symbols (colour, line width, outline) against the norm, for the symbols the map uses, and the norm's symbols missing from the map. The values come from IOF's O-Map Wiki; where the wiki gives no dimension it is not compared.",
  check: "Check the symbols",
  checking: "Checking …",
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
      case "STEPS": return "drawn as a continuous line, the norm says generalised steps";
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
