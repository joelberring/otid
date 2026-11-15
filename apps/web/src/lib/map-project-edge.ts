import type { MapObject } from "@o-tid/map-file";
import { fillOrBorder } from "./map-project-shape-tools";

interface EdgeSymbol { readonly id: string; readonly code: string; readonly kind: string; readonly fileHidden?: boolean | undefined }

const mainOf = (code: string) => code.split(".")[0]!;
const subOf = (code: string) => Number(code.split(".")[1] ?? 0);

/**
 * Kantlinjens symbol för en yta (ägaren 2026-11-15: «markera något och säga lägg på kantlinje»): linjesymbolen med samma
 * nummer som ytan i kartans symboler (501 → 501.1, 301 → 301.1), den med lägst undernummer. Finns ingen används den valda
 * symbolen om den är en linje.
 */
export function edgeSymbolFor(area: EdgeSymbol | undefined, catalog: readonly EdgeSymbol[], chosen: EdgeSymbol | undefined): EdgeSymbol | undefined {
  const own = area && catalog.filter(symbol => symbol.kind === "line" && !symbol.fileHidden && mainOf(symbol.code) === mainOf(area.code))
    .sort((a, b) => subOf(a.code) - subOf(b.code))[0];
  return own ?? (chosen?.kind === "line" ? chosen : undefined);
}

export interface EdgePlan {
  /** Kantlinjerna som skulle läggas till (en per ring, också hålen). */
  readonly made: MapObject[];
  /** Antalet ytor som får en kant, och kantsymbolernas nummer. */
  readonly areas: number; readonly codes: string[];
}

/** Kantlinjer för de markerade ytorna; ytor utan kantsymbol och annat än ytor hoppas över. */
export function edgePlan(objects: readonly MapObject[], symbols: ReadonlyMap<string, EdgeSymbol>, catalog: readonly EdgeSymbol[],
  chosen: EdgeSymbol | undefined): EdgePlan {
  const made: MapObject[] = [], codes = new Set<string>();
  let areas = 0;
  for (const object of objects) {
    if (object.kind !== "area") continue;
    const edge = edgeSymbolFor(symbols.get(object.symbol), catalog, chosen), lines = edge && fillOrBorder(object, edge);
    if (!edge || !lines?.length) continue;
    made.push(...lines); codes.add(edge.code); areas += 1;
  }
  return { made, areas, codes: [...codes].sort() };
}
