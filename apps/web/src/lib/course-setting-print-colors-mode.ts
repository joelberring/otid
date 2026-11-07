import {
  BUILT_IN_PRINT_PROFILES, MAP_OWN_PRINT_PROFILE_ID, pressOrder, referenceRow, referenceSide, SUPERSEDED_PRINT_PROFILES, type PressNorm, type PrintProfile,
  type ReferenceColor
} from "@o-tid/course-setting";
import type { ColorUsage, MapColor } from "@o-tid/map-file";
import { proposalState, type ProposalRow, type ProposalState } from "./course-setting-bl-proposal";
import type { PressLayers } from "./course-setting-press-layers";

/**
 * ADR-0215: färgerna för tryck i tre lägen. Förvalet är kartans egna färger i normens ordning (inget att ställa in),
 * "Tryck hos BL" visar bara de tveksamma färgerna, och allt annat (en egen profil, en ändrad tabell, kontorsskrivaren, en
 * äldre BL-version) är "Egna inställningar" under Avancerat. Rent, utan React.
 */
export type ColorMode = "MAP_OWN" | "BL" | "CUSTOM";

/** Läget för en profil: den färdiga "Kartans egna färger", en BL-tabell utan egna rader, annars egna inställningar. */
export function colorModeOf(profile: PrintProfile): ColorMode {
  if (profile.id === MAP_OWN_PRINT_PROFILE_ID) return "MAP_OWN";
  if (profile.reference && profile.mapColors.length === 0) return "BL";
  return "CUSTOM";
}

/** Den färdiga BL-profilen (senaste tabellen) för kartans norm: skog eller sprint. */
export function blProfileIdFor(norm: PressNorm, builtIn: readonly PrintProfile[] = BUILT_IN_PRINT_PROFILES): string {
  const kind = norm === "ISSPROM" ? "SPRINT" : "FOREST";
  const found = builtIn.find(item => item.reference?.kind === kind && !SUPERSEDED_PRINT_PROFILES[item.id]);
  if (!found) throw new Error(`Ingen BL-profil för ${norm}`);
  return found.id;
}

/** Varför en färg är tveksam hos BL: ingen säker rad i tabellen, eller tabellen lägger den på andra sidan banan än normen. */
export type DoubtReason = "MATCH" | "SIDE";
export interface DoubtfulRow { readonly row: ProposalRow; readonly reasons: readonly DoubtReason[] }

/**
 * De tveksamma raderna i BL-förslaget (ADR-0215 beslut 2): färger som inte har en säker rad i BL:s tabell (Bekräfta,
 * Tvetydig, ingen rad eller en rad utan CMYK, se `proposeColorMatches`) och, med normens färgordning, färger där tabellens rad ligger på andra sidan
 * banan än normen lägger färgen. Raderna står kvar när de är beslutade, så att beslutet syns och kan ångras.
 */
export function doubtfulRows(state: ProposalState, norm: PressNorm, ordered: boolean): DoubtfulRow[] {
  const over = ordered ? pressOrder(state.colors, norm).over : undefined;
  return state.rows.flatMap(row => {
    const reasons: DoubtReason[] = [];
    if (row.proposal.confidence !== "SAFE") reasons.push("MATCH");
    // Förslagets rad och den som gäller nu (ett eget val): raden står kvar i listan när man väljer.
    const rows = [row.proposal.row ? referenceRow(state.table, row.proposal.row) : undefined, row.row ?? undefined];
    const wrongSide = (item: ReferenceColor | undefined) => {
      const side = item ? referenceSide(state.table, item) : "COURSE";
      return over !== undefined && side !== "COURSE" && (side === "OVER") !== over.has(row.proposal.color.ocadId);
    };
    if (rows.some(wrongSide)) reasons.push("SIDE");
    return reasons.length > 0 ? [{ row, reasons }] : [];
  });
}

/** Statusraden överst i "Färger för tryck". */
export type ColorSummary =
  | { readonly mode: "MAP_OWN"; readonly total: number; readonly over: number }
  | { readonly mode: "BL"; readonly family: "FOREST" | "SPRINT"; readonly pending: number; readonly doubtful: number; readonly total: number }
  | { readonly mode: "CUSTOM"; readonly name: string };

/** Kartans färger som trycks: de som används i kartan (alla, så länge användningen inte är känd). */
export function usedColors(colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>): MapColor[] {
  return usage.size === 0 ? [...colors] : colors.filter(color => (usage.get(color.id)?.objects ?? 0) > 0);
}

export function colorSummary(profile: PrintProfile, colors: readonly MapColor[], usage: ReadonlyMap<number, ColorUsage>, layers: PressLayers | undefined,
  norm: PressNorm): ColorSummary {
  const mode = colorModeOf(profile);
  if (mode === "CUSTOM") return { mode, name: profile.name };
  if (mode === "MAP_OWN") {
    const used = usedColors(colors, usage);
    const over = new Set(layers?.over ?? []);
    return { mode, total: used.length, over: used.filter(color => over.has(color.id)).length };
  }
  const state = colors.length > 0 ? proposalState(profile, colors, usage) : undefined;
  return { mode, family: profile.reference!.kind === "SPRINT" ? "SPRINT" : "FOREST", pending: state?.counts.pending ?? 0, total: state?.rows.length ?? 0,
    doubtful: state ? doubtfulRows(state, norm, profile.courseLayer === "REFERENCE").length : 0 };
}
