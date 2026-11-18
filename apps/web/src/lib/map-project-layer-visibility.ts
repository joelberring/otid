/**
 * Vilka underlag som visas, och i vilken ordning bilderna hämtas.
 *
 * - Ägaren 2026-11-19: alla underlag är släckta när kartan öppnas, tills man själv tänder dem. Tända underlag lade sig över
 *   kartan, kostade bandbredd och fick mobilen att hänga sig. (Tidigare, 2026-11-14: bara reglagens mätbilder var släckta.)
 * - Det man själv tänt eller släckt sparas i webbläsaren per projekt och gäller nästa gång.
 * - Bara de tända bilderna hämtas när kartan öppnas. De släckta hämtas först när de behövs: när man tänder dem, eller när
 *   fliken Grundkarta öppnas, där reglagen läser fuktdjupet, vegetationsklasserna, bergbilden och ortofotot ur dem.
 * - Bilderna som visas hämtas först, och bara några åt gången, så att kartans objekt inte får vänta.
 */

/** Underlaget är släckt tills man tänder det (alla underlag, ägaren 2026-11-19). */
export const hiddenByDefault = (): boolean => true;

/** Egna val: `true` = tänt, `false` = släckt; underlag utan val följer förvalet. */
export type LayerChoices = Readonly<Record<string, boolean>>;

export function hiddenLayers(layers: readonly { readonly layerId: string; readonly name: string }[], choices: LayerChoices): Set<string> {
  return new Set(layers.filter(layer => !(choices[layer.layerId] ?? !hiddenByDefault())).map(layer => layer.layerId));
}

/** Valen med några underlag tända eller släckta; val för underlag som inte finns kvar tas bort. */
export function withChoices(choices: LayerChoices, layerIds: readonly string[], shown: boolean, existing: readonly string[]): LayerChoices {
  const keep = new Set(existing);
  return { ...Object.fromEntries(Object.entries(choices).filter(([layerId]) => keep.has(layerId))), ...Object.fromEntries(layerIds.map(layerId => [layerId, shown])) };
}

/**
 * Ordningen bilderna hämtas i: de som visas först (det översta först), sedan de släckta – men de släckta bara när
 * `withHidden` är satt (fliken Grundkarta är öppen).
 */
export function loadOrder<T extends { readonly layerId: string; readonly sort: number }>(layers: readonly T[], hidden: ReadonlySet<string>, withHidden = true): T[] {
  const top = [...layers].sort((a, b) => b.sort - a.sort);
  return [...top.filter(layer => !hidden.has(layer.layerId)), ...(withHidden ? top.filter(layer => hidden.has(layer.layerId)) : [])];
}

/** Så många bilder hämtas samtidigt. */
export const LAYER_FETCHES = 3;

const key = (projectId: string) => `otid-map-layer-choices:${projectId}`;
export function savedLayerChoices(projectId: string): LayerChoices {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(projectId)) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch { return {}; }
}
export function saveLayerChoices(projectId: string, choices: LayerChoices): void {
  // Utan lagring (privat läge) gäller valen bara så länge sidan är öppen.
  try { localStorage.setItem(key(projectId), JSON.stringify(choices)); } catch { /* Se ovan. */ }
}
