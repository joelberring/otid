import { foldForSearch } from "./search-fold";
import { RAW_SWEDEN_COUNTIES, RAW_SWEDEN_MUNICIPALITIES } from "./sweden-municipalities-data";

export interface Wgs84Bounds {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

export interface SwedenCounty {
  readonly code: string;
  readonly name: string;
  readonly bounds: Wgs84Bounds;
}

export interface SwedenMunicipality {
  readonly code: string;
  readonly name: string;
  readonly countyCode: string;
  readonly countyName: string;
  readonly bounds: Wgs84Bounds;
}

const countyNameByCode = new Map<string, string>(RAW_SWEDEN_COUNTIES);

export const SWEDEN_MUNICIPALITIES: readonly SwedenMunicipality[] = RAW_SWEDEN_MUNICIPALITIES.map(
  ([code, name, minLon, minLat, maxLon, maxLat]) => {
    const countyCode = code.slice(0, 2);
    return {
      code,
      name,
      countyCode,
      countyName: countyNameByCode.get(countyCode) ?? "",
      bounds: { minLon, minLat, maxLon, maxLat }
    };
  }
);

export const SWEDEN_COUNTIES: readonly SwedenCounty[] = RAW_SWEDEN_COUNTIES.map(([code, name]) => {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const m of SWEDEN_MUNICIPALITIES) {
    if (m.countyCode !== code) continue;
    if (m.bounds.minLon < minLon) minLon = m.bounds.minLon;
    if (m.bounds.minLat < minLat) minLat = m.bounds.minLat;
    if (m.bounds.maxLon > maxLon) maxLon = m.bounds.maxLon;
    if (m.bounds.maxLat > maxLat) maxLat = m.bounds.maxLat;
  }
  return { code, name, bounds: { minLon, minLat, maxLon, maxLat } };
});

const municipalityMap = new Map<string, SwedenMunicipality>(
  SWEDEN_MUNICIPALITIES.map((m) => [m.code, m])
);

const countyMap = new Map<string, SwedenCounty>(
  SWEDEN_COUNTIES.map((c) => [c.code, c])
);

interface IndexedMunicipality {
  readonly item: SwedenMunicipality;
  readonly foldedName: string;
  readonly foldedCounty: string;
}

const searchIndex: readonly IndexedMunicipality[] = SWEDEN_MUNICIPALITIES.map((item) => ({
  item,
  foldedName: foldForSearch(item.name),
  foldedCounty: foldForSearch(item.countyName)
}));

/** Slår upp en svensk kommun med 4-siffrig SCB-kod (t.ex. "0180"). */
export function municipalityByCode(code: string): SwedenMunicipality | undefined {
  return municipalityMap.get(code.trim());
}

/** Slår upp ett svenskt län med 2-siffrig SCB-kod (t.ex. "01"). */
export function countyByCode(code: string): SwedenCounty | undefined {
  return countyMap.get(code.trim());
}

/** Härleder unika sorterade länskoder från en lista kommunkoder. */
export function countiesForMunicipalities(codes: readonly string[]): string[] {
  const counties = new Set<string>();
  for (const code of codes) {
    const m = municipalityMap.get(code);
    if (m) counties.add(m.countyCode);
  }
  return [...counties].sort();
}

/**
 * Returnerar SCB-kommunkoder vars begränsningsruta överlappar `bbox`, sorterade efter
 * överlappningsarea fallande (med avstånd till kommunens mittpunkt och mindre kommunarea som
 * utslagsgivare vid lika överlappning). Avgränsas till högst `max` (förval 5).
 */
export function municipalitiesForBounds(
  bbox: Wgs84Bounds,
  options?: { readonly max?: number }
): string[] {
  const max = Math.max(1, options?.max ?? 5);
  const minLon = Math.min(bbox.minLon, bbox.maxLon);
  const maxLon = Math.max(bbox.minLon, bbox.maxLon);
  const minLat = Math.min(bbox.minLat, bbox.maxLat);
  const maxLat = Math.max(bbox.minLat, bbox.maxLat);
  if (!Number.isFinite(minLon) || !Number.isFinite(maxLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
    return [];
  }

  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const isDegenerate = maxLon - minLon === 0 || maxLat - minLat === 0;

  const matches: { code: string; overlapArea: number; centerDistSq: number; muniArea: number }[] = [];

  for (const m of SWEDEN_MUNICIPALITIES) {
    const b = m.bounds;
    if (b.maxLon < minLon || b.minLon > maxLon || b.maxLat < minLat || b.minLat > maxLat) continue;

    const overlapLon = Math.min(maxLon, b.maxLon) - Math.max(minLon, b.minLon);
    const overlapLat = Math.min(maxLat, b.maxLat) - Math.max(minLat, b.minLat);
    if (!isDegenerate && (overlapLon <= 0 || overlapLat <= 0)) continue;

    const overlapArea = Math.max(0, overlapLon) * cosLat * Math.max(0, overlapLat);
    const mCenterLon = (b.minLon + b.maxLon) / 2;
    const mCenterLat = (b.minLat + b.maxLat) / 2;
    const dLon = (mCenterLon - centerLon) * cosLat;
    const dLat = mCenterLat - centerLat;
    const centerDistSq = dLon * dLon + dLat * dLat;
    const muniArea = (b.maxLon - b.minLon) * cosLat * (b.maxLat - b.minLat);

    matches.push({ code: m.code, overlapArea, centerDistSq, muniArea });
  }

  matches.sort((a, b) => {
    const areaDiff = b.overlapArea - a.overlapArea;
    if (Math.abs(areaDiff) > 1e-12) return areaDiff;
    const distDiff = a.centerDistSq - b.centerDistSq;
    if (Math.abs(distDiff) > 1e-12) return distDiff;
    return a.muniArea - b.muniArea;
  });

  return matches.slice(0, max).map((m) => m.code);
}

/**
 * Söker bland Sveriges 290 kommuner (skiftläges- och diakritokänsligt via `foldForSearch`).
 * Exakt kod- eller namnträff först, därefter prefixträff på kommunnamn, delsträng i kommunnamn
 * och sist delsträng i länsnamn.
 */
export function searchMunicipalities(query: string, limit = 20): SwedenMunicipality[] {
  const folded = foldForSearch(query);
  if (!folded) return SWEDEN_MUNICIPALITIES.slice(0, limit);

  const exact: SwedenMunicipality[] = [];
  const prefix: SwedenMunicipality[] = [];
  const substring: SwedenMunicipality[] = [];
  const countyMatch: SwedenMunicipality[] = [];

  for (const entry of searchIndex) {
    if (entry.item.code === folded || entry.foldedName === folded) {
      exact.push(entry.item);
    } else if (entry.foldedName.startsWith(folded)) {
      prefix.push(entry.item);
    } else if (entry.foldedName.includes(folded)) {
      substring.push(entry.item);
    } else if (entry.foldedCounty.includes(folded)) {
      countyMatch.push(entry.item);
    }
  }

  return [...exact, ...prefix, ...substring, ...countyMatch].slice(0, Math.max(1, limit));
}
