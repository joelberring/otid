/**
 * Ägaren 2026-11-13 («om kartan är delad i flera delar pga storlek blir det väldigt många rutor att släcka. kan man göra så att
 * samma lager sätts ihop»): en laserkörning som servern delat i etapper ger ett underlag per etapp och bild, med namn som
 * «Karttapullautin hela kartan – etapp 3 av 3 – relief». Underlagen med samma namn utom etappen visas som en rad.
 */
const STAGE = / – etapp (\d+) av (\d+)/;

export interface LayerGroup<T> {
  /** Namnet utan etappen; för ett ensamt underlag dess eget namn. */
  readonly name: string;
  /** Underlagen i listans ordning (etapp 1 först i en grupp). */
  readonly members: readonly T[];
}

/**
 * Underlagen grupperade i listans ordning: en grupp står där dess första underlag står. Bara underlag med etapp i namnet slås
 * ihop, och bara när det finns fler än ett med samma namn utom etappen.
 */
export function groupLayers<T extends { readonly name: string }>(layers: readonly T[]): LayerGroup<T>[] {
  const keyOf = (layer: T) => STAGE.test(layer.name) ? layer.name.replace(STAGE, "") : undefined;
  const counts = new Map<string, number>();
  for (const layer of layers) { const key = keyOf(layer); if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1); }
  const groups: { name: string; members: T[] }[] = [], byKey = new Map<string, { name: string; members: T[] }>();
  for (const layer of layers) {
    const key = keyOf(layer);
    if (key === undefined || counts.get(key)! < 2) { groups.push({ name: layer.name, members: [layer] }); continue; }
    let group = byKey.get(key);
    if (!group) { group = { name: key, members: [] }; byKey.set(key, group); groups.push(group); }
    group.members.push(layer);
  }
  const stage = (layer: T) => Number(STAGE.exec(layer.name)?.[1] ?? 0);
  return groups.map(group => group.members.length > 1 ? { name: group.name, members: [...group.members].sort((a, b) => stage(a) - stage(b)) } : group);
}
