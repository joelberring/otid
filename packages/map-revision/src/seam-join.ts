import type { SourceFeature } from "./vector-parse";

/**
 * Grundkartan G3 & G5: laserrutor och etapper bryter terränglinjer vid skarvar.
 * Linjer i samma lager (och på samma höjd när höjd finns) vars ändar möts inom `tolerance` (i källans enheter) fogas ihop
 * till en linje, och en kedja vars ändar möts blir sluten. Linjer utan höjd fogas bara med andra utan höjd i samma lager.
 *
 * Riktningskänsliga linjer (branter 201/202, jordbranter 104/105, stödmurar 513.2) där linjens orientering styr åt vilket
 * håll taggarna pekar vänds ALDRIG: de fogas bara huvud-mot-svans (`slut_A ≈ start_B`).
 */
type Position = readonly [number, number];
type Open = { feature: SourceFeature; points: Position[]; used: boolean };

/** Terränglinjer som fogas över skarvar: kurvor/formlinjer, branter (201/202), diken (306), bäckar/fuktstråk (305) och stigar/spår (505–507). */
const DEFAULT_SEAM_LAYERS =
  /contour|formline|kurv|formlin|^depression(?:_index)?$|brant|stup|cliff|slope_line|jordbrant|jordvall|dike|ditch|fuktstr[aå]k|vattendrag|stream|(?:^|[^a-zåäö])b[aä]ck(?:ar|en)?(?:$|[^a-zåäö])|(?:^|[^a-zåäö])sp[aå]r(?:$|[^a-zåäö])|stig|traktorv[aä]g|g[aå]ngv[aä]g|footway|path|track|(?:^|\D)(?:201|202|305|306|505|506|507)(?:\.\d+)?(?=$|\D)/i;

/** Riktningskänsliga linjer (taggar/halvcirklar pekar åt höger i ritriktningen) som aldrig får vändas. */
const DIRECTIONAL_SEAM_LAYERS =
  /brant|stup|cliff|slope_line|jordbrant|jordvall|st[oö]dmur|(?:^|\D)(?:104|105|201|202|513\.2)(?:\.\d+)?(?=$|\D)/i;

export function joinSeams(
  features: readonly SourceFeature[],
  tolerance = 0.5,
  layers: RegExp = DEFAULT_SEAM_LAYERS,
  directional: RegExp = DIRECTIONAL_SEAM_LAYERS
): SourceFeature[] {
  const keep: SourceFeature[] = [];
  const groups = new Map<string, { layer: string; elevation: number | undefined; lines: Open[] }>();
  for (const feature of features) {
    if (feature.geometry.kind !== "line" || feature.geometry.closed || feature.geometry.points.length < 2 || !layers.test(feature.layer)) {
      keep.push(feature);
      continue;
    }
    const key = `${feature.layer}\u0000${feature.elevation ?? ""}`;
    const group = groups.get(key) ?? { layer: feature.layer, elevation: feature.elevation, lines: [] };
    group.lines.push({ feature, points: [...feature.geometry.points], used: false });
    groups.set(key, group);
  }
  const step = Math.max(tolerance, 1e-9);
  const close = (a: Position, b: Position) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
  const cellOf = (point: Position) => `${Math.floor(point[0] / step)},${Math.floor(point[1] / step)}`;
  for (const group of groups.values()) {
    const directed = directional.test(group.layer);
    // Ändpunkterna i ett rutnät med rutans sida `step`, så att en granne letas i de nio närmaste rutorna.
    const ends = new Map<string, { line: Open; start: boolean }[]>();
    for (const line of group.lines) for (const start of [true, false]) {
      const cell = cellOf(start ? line.points[0]! : line.points.at(-1)!);
      const bucket = ends.get(cell);
      if (bucket) bucket.push({ line, start });
      else ends.set(cell, [{ line, start }]);
    }
    const neighbour = (point: Position, self: Open, requiredStart?: boolean) => {
      const [cx, cy] = [Math.floor(point[0] / step), Math.floor(point[1] / step)];
      let best: { line: Open; start: boolean } | undefined;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        for (const end of ends.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (end.line === self || end.line.used) continue;
          if (requiredStart !== undefined && end.start !== requiredStart) continue;
          const other = end.start ? end.line.points[0]! : end.line.points.at(-1)!;
          if (!close(other, point)) continue;
          const ox = other[0] - point[0], oy = other[1] - point[1], distSq = ox * ox + oy * oy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            best = end;
            if (distSq === 0) return best;
          }
        }
      }
      return best;
    };
    const appendPoints = (chain: Position[], pts: readonly Position[], fromStart: boolean) => {
      if (fromStart) {
        for (let i = 1; i < pts.length; i += 1) chain.push(pts[i]!);
      } else {
        for (let i = pts.length - 2; i >= 0; i -= 1) chain.push(pts[i]!);
      }
    };
    for (const line of group.lines) {
      if (line.used) continue;
      line.used = true;
      const chain = line.points.slice();
      let joinedAny = false;
      // Framåt från slutet med .push(); för riktade linjer krävs att grannens start möter vårt slut (aldrig vändning).
      for (;;) {
        const next = neighbour(chain[chain.length - 1]!, line, directed ? true : undefined);
        if (!next) break;
        next.line.used = true;
        joinedAny = true;
        appendPoints(chain, next.line.points, next.start);
      }
      // Bakåt från början (vänd en gång vid första träffen och återställ sist); för riktade linjer krävs att grannens slut möter vår start.
      let reversed = false;
      for (;;) {
        const tip = reversed ? chain[chain.length - 1]! : chain[0]!;
        const next = neighbour(tip, line, directed ? false : undefined);
        if (!next) break;
        if (!reversed) { chain.reverse(); reversed = true; }
        next.line.used = true;
        joinedAny = true;
        appendPoints(chain, next.line.points, next.start);
      }
      if (reversed) chain.reverse();
      const closed = chain.length >= 4 && close(chain[0]!, chain.at(-1)!);
      if (!joinedAny && !closed) { keep.push(line.feature); continue; }
      keep.push({
        ...(line.feature.properties ? { properties: line.feature.properties } : {}),
        layer: group.layer,
        ...(group.elevation !== undefined ? { elevation: group.elevation } : {}),
        geometry: { kind: "line", points: closed ? chain.slice(0, -1) : chain, closed }
      });
    }
  }
  return keep;
}
