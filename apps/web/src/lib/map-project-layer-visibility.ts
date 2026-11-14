/**
 * Ägaren 2026-11-14 («upplever det lite långsamt att läsa in»): vilka underlag som visas, och i vilken ordning bilderna hämtas.
 *
 * - Laserkörningens bilder för reglagen (fuktdjupet, vegetationsklasserna och bergbilden) är mätvärden och inget att titta på;
 *   de är släckta tills man tänder dem. Reglagen läser dem ändå.
 * - Det man själv tänt eller släckt sparas i webbläsaren per projekt och gäller nästa gång.
 * - Bilderna som visas hämtas först, de släckta efteråt, och bara några åt gången, så att kartans objekt inte får vänta.
 */
const DATA_LAYER = / – (fuktdjup|vegetationsklasser|berg)$/;

/** Underlaget är släckt tills man tänder det. */
export const hiddenByDefault = (name: string) => DATA_LAYER.test(name);

/** Egna val: `true` = tänt, `false` = släckt; underlag utan val följer förvalet. */
export type LayerChoices = Readonly<Record<string, boolean>>;

export function hiddenLayers(layers: readonly { readonly layerId: string; readonly name: string }[], choices: LayerChoices): Set<string> {
  return new Set(layers.filter(layer => !(choices[layer.layerId] ?? !hiddenByDefault(layer.name))).map(layer => layer.layerId));
}

/** Valen med några underlag tända eller släckta; val för underlag som inte finns kvar tas bort. */
export function withChoices(choices: LayerChoices, layerIds: readonly string[], shown: boolean, existing: readonly string[]): LayerChoices {
  const keep = new Set(existing);
  return { ...Object.fromEntries(Object.entries(choices).filter(([layerId]) => keep.has(layerId))), ...Object.fromEntries(layerIds.map(layerId => [layerId, shown])) };
}

/** Ordningen bilderna hämtas i: de som visas först (det översta först), sedan de släckta. */
export function loadOrder<T extends { readonly layerId: string; readonly sort: number }>(layers: readonly T[], hidden: ReadonlySet<string>): T[] {
  const top = [...layers].sort((a, b) => b.sort - a.sort);
  return [...top.filter(layer => !hidden.has(layer.layerId)), ...top.filter(layer => hidden.has(layer.layerId))];
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
