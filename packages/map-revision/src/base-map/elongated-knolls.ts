import type { SourceFeature } from "../index";

/**
 * Avlånga punkthöjder (ISOM 110, ägaren 2026-11-15: «det borde finnas avlånga punkthöjder där höjden som generaliserats verkar
 * ha en tydlig form/limpa»). En punkthöjd vars höjd i markmodellen är avlång på halva höjden blir en avlång punkthöjd, vriden
 * efter höjdens längd.
 *
 * Mätt mot tre kartritare (Högdalen, Djurgården, Gömmaren, sex block) med höjdsökningens ringar: av deras punkthöjder hade 45
 * avlånga och 70 runda en höjd med form inom 6 m. Från 1,7 gånger så lång som bred blir 20 av de avlånga avlånga och 11 av de
 * runda (två av tre rätt, mot 39 % om alla vore avlånga); 1,6 tar 26 och 17, 2,0 tar 10 och 4.
 */
type Position = readonly [number, number];
export const ELONGATED_RATIO = 1.7;
export const ELONGATED_KNOLL_LAYER = "dotknoll_avlang";
/** Punkthöjder som kan bli avlånga: Karttapullautins och laserns. */
const ROUND_KNOLL = /^dotknoll(_laser)?$/i;
/** En höjds topp så här nära (meter) punkthöjden är samma höjd. */
const SAME_KNOLL_METERS = 6;

/** Längsta och kortaste bredd över ringen (i steg om 5°) och riktningen för den längsta (radianer, moturs från öster). */
export function elongationOf(ring: readonly Position[]): { length: number; width: number; angle: number } {
  let length = 0, width = Infinity, angle = 0;
  for (let degree = 0; degree < 180; degree += 5) {
    const c = Math.cos(degree * Math.PI / 180), s = Math.sin(degree * Math.PI / 180);
    let low = Infinity, high = -Infinity;
    for (const [x, y] of ring) { const along = x * c + y * s; if (along < low) low = along; if (along > high) high = along; }
    const span = high - low;
    if (span > length) { length = span; angle = degree * Math.PI / 180; }
    if (span < width) width = span;
  }
  return { length, width, angle };
}

/** En avlång punkthöjd i `at` med längden längs `angle`: `toward` ger symbolens vinkel (`vector-import.ts`). */
export function elongatedKnoll(at: Position, angle: number): SourceFeature {
  return { layer: ELONGATED_KNOLL_LAYER, geometry: { kind: "point", at: [at[0], at[1]], toward: [at[0] + Math.sin(angle) * 5, at[1] - Math.cos(angle) * 5] } };
}

/** Om ringen är så avlång att höjden ska bli en avlång punkthöjd, och i så fall riktningen. */
export function elongatedAngle(ring: readonly Position[] | undefined): number | undefined {
  if (!ring || ring.length < 4) return undefined;
  const { length, width, angle } = elongationOf(ring);
  return width > 0 && length / width >= ELONGATED_RATIO ? angle : undefined;
}

/**
 * Punkthöjderna med en avlång höjd bakom sig blir avlånga. `hills` är höjderna ur markmodellen med ringen på halva höjden
 * (`findHills`). Ger samma objekt där inget ändras.
 */
export function elongateKnolls(features: readonly SourceFeature[], hills: readonly { readonly at: Position; readonly ring?: readonly Position[] | undefined }[])
  : SourceFeature[] {
  const shaped = hills.filter(hill => hill.ring);
  if (shaped.length === 0) return [...features];
  const reach = SAME_KNOLL_METERS, cells = new Map<string, typeof shaped>();
  for (const hill of shaped) {
    const key = `${Math.floor(hill.at[0] / reach)},${Math.floor(hill.at[1] / reach)}`, row = cells.get(key);
    if (row) row.push(hill); else cells.set(key, [hill]);
  }
  return features.map(feature => {
    if (feature.geometry.kind !== "point" || !ROUND_KNOLL.test(feature.layer)) return feature;
    const [x, y] = feature.geometry.at;
    let best: (typeof shaped)[number] | undefined, distance = reach;
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      for (const hill of cells.get(`${Math.floor(x / reach) + ax},${Math.floor(y / reach) + ay}`) ?? []) {
        const d = Math.hypot(hill.at[0] - x, hill.at[1] - y);
        if (d <= distance) { distance = d; best = hill; }
      }
    }
    const angle = elongatedAngle(best?.ring);
    return angle === undefined ? feature : elongatedKnoll([x, y], angle);
  });
}
