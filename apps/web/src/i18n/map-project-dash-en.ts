import type { Texts } from "../lib/language";
import type { mapProjectDashSv } from "./map-project-dash-sv";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const mapProjectDashEn: Texts<typeof mapProjectDashSv> = {
  heading: "Dash points",
  help: "Places dash points on dashed lines (form lines, paths) so dashes land cleanly on sharp bends, slope tags and junctions.",
  scopeLabel: "Scope",
  scopes: {
    selected: "Selected lines",
    view: "Current view",
    map: "Whole map"
  },
  rules: {
    bends: "Sharp bends (form lines & paths)",
    slopeTags: "Slope tags",
    junctions: "Path junctions & crossings",
    keepExisting: "Keep existing dash points"
  },
  preview: "Preview",
  computing: "Calculating dash points …",
  apply: "Apply dash points",
  clear: "Clear",
  adjustManual: "Adjust manually",
  adjustManualHint: "Select a dashed line on the map and click Adjust dash points to fine-tune.",
  toggleVertex: "Dash point",
  toggleVertexHelp: "Toggle dash point on the selected vertex so the dash pattern aligns here.",
  modeButton: "Adjust dash points",
  modeHelp: "Click along the line to add or remove dash points, or drag a diamond.",
  autoButton: "Auto dash points",
  autoHelp: "Automatically place dash points on the selected dashed lines.",
  modeHint: "Dash points: click the line to add/remove a dash point, drag a diamond to adjust, Esc to finish.",
  noSelection: "Select at least one dashed line first.",
  noView: "The map is not ready yet.",
  noneFound: "No new dash points were needed.",
  previewSummary: (objects: number, added: number, bends: number, slopeTags: number, junctions: number) =>
    `${count(objects, "object", "objects")}, ${count(added, "dash point", "dash points")}: ${bends} bends, ${slopeTags} slope tags, ${junctions} junctions.`,
  appliedSummary: (added: number, bends: number, slopeTags: number, junctions: number) =>
    added === 0
      ? "No new dash points were needed."
      : `${count(added, "dash point", "dash points")} placed (${bends} bends, ${slopeTags} slope tags, ${junctions} junctions).`,
  vertexAdded: "Dash point added.",
  vertexRemoved: "Dash point removed."
};
