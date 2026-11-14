import type { ProjectedPoint } from "./georef";

/**
 * Ägaren 2026-11-14 («hur lägger man till meridianer?»): nordlinjer (601) över ett område. Linjerna är raka och parallella,
 * `degrees` medurs från koordinatnätets norr, med `spacing` meter emellan (ISOM 2017-2: 300 m; ISSprOM 2019-2: 30 mm på
 * kartan), och en av dem går genom `through`. Varje linje klipps mot områdets fyrhörning (kartans ram i nätets koordinater,
 * hörnen i ordning). Ren räkning utan I/O.
 */
export function northLineSegments(corners: readonly ProjectedPoint[], degrees: number, spacing: number, through: ProjectedPoint): [ProjectedPoint, ProjectedPoint][] {
  if (corners.length < 3 || !(spacing > 0) || !Number.isFinite(degrees)) return [];
  const angle = degrees * Math.PI / 180, along = [Math.sin(angle), Math.cos(angle)] as const, across = [Math.cos(angle), -Math.sin(angle)] as const;
  // Hörnen i linjernas egna axlar: u tvärs linjerna, v längs dem.
  const local = corners.map(corner => {
    const dx = corner.easting - through.easting, dy = corner.northing - through.northing;
    return { u: dx * across[0] + dy * across[1], v: dx * along[0] + dy * along[1] };
  });
  const first = Math.ceil(Math.min(...local.map(point => point.u)) / spacing), last = Math.floor(Math.max(...local.map(point => point.u)) / spacing);
  const out: [ProjectedPoint, ProjectedPoint][] = [];
  for (let index = first; index <= last; index += 1) {
    const u = index * spacing, crossings: number[] = [];
    for (let i = 0; i < local.length; i += 1) {
      const a = local[i]!, b = local[(i + 1) % local.length]!;
      if ((a.u <= u) === (b.u <= u)) continue;
      crossings.push(a.v + (b.v - a.v) * (u - a.u) / (b.u - a.u));
    }
    if (crossings.length < 2) continue;
    const from = Math.min(...crossings), to = Math.max(...crossings);
    if (to - from < 1) continue;
    const at = (v: number): ProjectedPoint => ({ easting: through.easting + u * across[0] + v * along[0], northing: through.northing + u * across[1] + v * along[1] });
    out.push([at(from), at(to)]);
  }
  return out;
}

/** Avståndet mellan nordlinjerna i terrängen (m): 300 m på en skogskarta, 30 mm på kartan på en sprintkarta (skala under 1:7 500). */
export const northLineSpacing = (scale: number): number => scale < 7500 ? Math.round(scale * 0.03) : 300;
