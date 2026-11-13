import { geodeticToGrid, gridToGeodetic, transverseMercatorFor } from "@o-tid/map-file";
import { isSprintNorm, joinSeams, type MapBox, type MapNorm, type SourceData, type SourceFeature } from "../index";
import { sprintOsm } from "./sprint-osm";
import { withoutCutVegetation, type clearCutFeatures } from "./clear-cuts";
import { smallRingsToPoints } from "./small-rings";
import { yardsOf } from "./yards";
import { marshOutsideManaged, singleMarsh, undergrowthOutsideGreen } from "./marsh-merge";
import { linesOutsideWater } from "./water-clip";

/**
 * Grundkartan G2 och G8 (ägaren 2026-11-10: «ungefär som en halvfärdig karta», utan grundkartefil: lasern, Lantmäteriets
 * marktäcke, OpenStreetMap). Här avgörs vilka av jobbets resultatfiler som tillsammans är grundkartan och hur de slås ihop
 * med OpenStreetMap, så att samma sak inte kommer två gånger:
 *
 * - branterna som linjer går före Karttapullautins korta streck,
 * - med Lantmäteriets marktäcke byter laserns «öppen mark» (allt utan växtlighet, också hällmark) namn till
 *   `oppen_mark_laser` och föreslås som ödemark (403); marktäckets sankmark och den uträknade fuktigheten kommer båda med,
 * - en opasserbar brant som är för kort för två taggar blir en brant (ägaren 2026-11-11: «det ska alltid vara minst två
 *   taggar på taggbranter»),
 * - kurvorna och formlinjerna fogas över laserrutornas skarvar (`joinSeams`),
 * - laserns små kullar (`dotknoll_laser`) ersätter Karttapullautins knollar när de finns,
 * - slutna kurvor under ISOM:s minsta mått blir små kullar eller gropar (`smallRingsToPoints`),
 * - Skogsstyrelsens hyggen efter ålder och deras kanter (`clearCutFeatures`), utan laserns vegetation i nyare hyggen,
 * - tomterna: OpenStreetMaps bostadsområden (`tomtmark_osm`), marktäckets låga bebyggelse (`tomtmark_marktacke`) och
 *   rektanglar kring hus utanför dem (`tomtmark_hus`, `yardsOf`), i var sitt lager så att kandidatraden kan välja,
 * - ur OpenStreetMap tas vägar, stigar, hus, ledningar, staket och liknande; vatten, sankmark, branter och markslag finns
 *   redan ur lasern och marktäcket, och husen tas inte med när Lantmäteriets byggnader finns.
 */
const BASE_MAP = ["kurvor.dxf", "formlinjer.dxf", "brantlinjer.dxf", "knollar.dxf", "vatten.geojson", "marktacke.geojson", "byggnader.geojson", "fukt.dxf", "diken.dxf", "berg.dxf", "vegetation.dxf"];

export function baseMapOutputs(names: readonly string[]): string[] {
  const has = new Set(names);
  // Ägaren 2026-11-11 («inga kärr kom med»): den uträknade fuktigheten följer med också när marktäcket finns; marktäckets
  // sankmark är grov och missar de små kärren i dalbottnarna.
  return [...BASE_MAP.filter(name => has.has(name)),
    ...(has.has("brantlinjer.dxf") ? [] : ["branter.dxf", "stup.dxf"].filter(name => has.has(name)))];
}

const SWEREF99TM = 3006;
/** OpenStreetMaps lager som grundkartan redan har ur lasern och marktäcket. */
const OSM_SKIPPED = /^OSM (vatten|vattendrag|sankmark|brant|natur|markanvändning|fritid)/;
/** Ägaren 2026-11-11: OpenStreetMaps grå bostadsområden är en första tomtmark (flerbostadshusens rättas efteråt). */
const OSM_RESIDENTIAL = "OSM markanvändning (residential)";
const OSM_BUILDING = /^OSM (byggnad|skärmtak)/;

/** Rutan (SWEREF 99 TM) som latitud och longitud, för hämtningen från OpenStreetMap. */
export function clipWgs84(clip: MapBox): { south: number; west: number; north: number; east: number } | undefined {
  const projection = transverseMercatorFor(SWEREF99TM);
  if (!projection) return undefined;
  const corners = [[clip.minX, clip.minY], [clip.maxX, clip.minY], [clip.maxX, clip.maxY], [clip.minX, clip.maxY]].map(([x, y]) => gridToGeodetic(projection, x!, y!));
  return { south: Math.min(...corners.map(c => c.latitude)), north: Math.max(...corners.map(c => c.latitude)),
    west: Math.min(...corners.map(c => c.longitude)), east: Math.max(...corners.map(c => c.longitude)) };
}

/** OpenStreetMaps objekt (longitud, latitud) i SWEREF 99 TM, utan lagren som grundkartan redan har. */
const osmInSweref = (features: readonly SourceFeature[]): SourceFeature[] => {
  const projection = transverseMercatorFor(SWEREF99TM);
  if (!projection) return [];
  const at = ([lon, lat]: readonly [number, number]): [number, number] => { const point = geodeticToGrid(projection, lat, lon); return [point.easting, point.northing]; };
  return features.map(({ layer, geometry }) => ({ layer,
    geometry: geometry.kind === "point" ? { kind: "point" as const, at: at(geometry.at) }
      : geometry.kind === "line" ? { kind: "line" as const, points: geometry.points.map(at), closed: geometry.closed } : { kind: "area" as const, rings: geometry.rings.map(ring => ring.map(at)) } }));
};
export function osmForBaseMap(osm: SourceData, hasBuildings: boolean): SourceFeature[] {
  return osmInSweref(osm.features.filter(feature => feature.layer === OSM_RESIDENTIAL || (!OSM_SKIPPED.test(feature.layer) && !(hasBuildings && OSM_BUILDING.test(feature.layer)))))
    .map(feature => feature.layer === OSM_RESIDENTIAL ? { ...feature, layer: "tomtmark_osm" } : feature);
}
/** OpenStreetMaps skötta mark (gräsytor, parker, idrottsplatser, odlingar): inga kärr där (`marshOutsideManaged`). */
const OSM_MANAGED = /^OSM (markanvändning \((farmland|grass|recreation_ground|village_green|allotments|orchard|cemetery|farmyard)\)|fritid \((park|pitch|golf_course|garden|playground|sports_centre|stadium|track)\))$/;
export const osmManaged = (osm: SourceData): SourceFeature[] => osmInSweref(osm.features.filter(feature => OSM_MANAGED.test(feature.layer) && feature.geometry.kind !== "point"));

/** Normens kortaste brant (201, 202) i mm på kartan. */
export const MIN_CLIFF_MM = 0.6;
/**
 * Kortaste opasserbara brant (meter i terrängen) som får två taggar: med taggarna 0,5 mm isär och en halv i varje ände
 * (mallens 201 och `spacedDistances` i ritningen) behövs 0,75 mm på kartan.
 */
export const twoTagMeters = (scale: number) => 0.75 * scale / 1000;
const lineLength = (points: readonly (readonly [number, number])[]) => points.reduce((sum, point, i) =>
  i === 0 ? 0 : sum + Math.hypot(point[0] - points[i - 1]![0], point[1] - points[i - 1]![1]), 0);

/**
 * Strandlinjen runt vattnet: normens 301 är blå med en svart kantlinje (0,18 mm) som säger att vattnet inte går att korsa.
 * Varje ring i en vattenyta (stranden och öarna) blir en sluten linje i lagret `strandlinje` (301.1).
 */
export function shoreLines(features: readonly SourceFeature[]): SourceFeature[] {
  // Körningens kant är inte en strand: där vattnet är avskuret längs rutans kant (allt underlags yttersta ruta) ritas ingen
  // linje, och ringen delas i öppna linjer.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const see = ([x, y]: readonly [number, number]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  for (const { geometry } of features) {
    if (geometry.kind === "point") see(geometry.at);
    else if (geometry.kind === "line") geometry.points.forEach(see);
    else if (geometry.kind === "area") geometry.rings.forEach(ring => ring.forEach(see));
  }
  const EDGE_M = 1.5;
  const edges = ([x, y]: readonly number[]) => (Math.abs(x! - minX) <= EDGE_M ? 1 : 0) | (Math.abs(x! - maxX) <= EDGE_M ? 2 : 0)
    | (Math.abs(y! - minY) <= EDGE_M ? 4 : 0) | (Math.abs(y! - maxY) <= EDGE_M ? 8 : 0);
  // Minst 5 m längs samma kant: en naturlig strand nuddar kanten bara i en punkt.
  const onEdge = (a: readonly number[], b: readonly number[]) => (edges(a) & edges(b)) !== 0 && Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) >= 5;
  return features.flatMap(feature => {
    if (feature.layer !== "vatten") return [];
    const rings = feature.geometry.kind === "area" ? feature.geometry.rings : feature.geometry.kind === "line" && feature.geometry.closed ? [feature.geometry.points] : [];
    return rings.filter(ring => ring.length >= 3).flatMap((ring): SourceFeature[] => {
      const points = ring.map(([x, y]) => [x, y] as [number, number]);
      const closedTwice = points.length > 3 && points[0]![0] === points[points.length - 1]![0] && points[0]![1] === points[points.length - 1]![1];
      const open = closedTwice ? points.slice(0, -1) : points, n = open.length;
      const cut = open.map((point, i) => onEdge(point, open[(i + 1) % n]!));
      if (!cut.some(Boolean)) return [{ layer: "strandlinje", geometry: { kind: "line", closed: true, points } }];
      // Börja efter ett avskuret segment och samla sträckorna mellan de avskurna.
      const start = cut.findIndex(Boolean) + 1, lines: SourceFeature[] = [];
      let run: [number, number][] = [];
      for (let k = 0; k < n; k += 1) {
        const i = (start + k) % n;
        run.push(open[i]!);
        if (cut[i]) { if (run.length >= 2) lines.push({ layer: "strandlinje", geometry: { kind: "line", closed: false, points: run } }); run = []; }
      }
      return lines;
    });
  });
}

/** Lutningsstrecket för en sluten sänkkurva: mitt på den längsta sträckan, pekande mot kurvans mitt. */
export function depressionTick(feature: SourceFeature): SourceFeature[] {
  const geometry = feature.geometry;
  if (geometry.kind !== "line" || !/^depression(_index)?$/i.test(feature.layer) || geometry.points.length < 4) return [];
  const points = geometry.points, first = points[0]!, last = points[points.length - 1]!;
  if (!geometry.closed && Math.hypot(first[0] - last[0], first[1] - last[1]) > 1) return [];
  const center: [number, number] = [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
  let best = 0, longest = -1;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length]!, span = Math.hypot(next[0] - points[i]![0], next[1] - points[i]![1]);
    if (span > longest) { longest = span; best = i; }
  }
  const a = points[best]!, b = points[(best + 1) % points.length]!;
  return [{ layer: "lutningsstreck", geometry: { kind: "point", at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], toward: center } }];
}

/**
 * Jobbets filer (i `baseMapOutputs` ordning) och OpenStreetMap som en inläsning i SWEREF 99 TM; `scale` är kartans skala.
 * På en sprintkarta (`norm`) blir OpenStreetMaps belagda vägar ytor med antagen bredd (`sprintOsm`).
 */
export function mergeBaseMap(parts: readonly { readonly name: string; readonly data: SourceData }[], rawOsm?: SourceData, scale?: number,
  cuts?: Pick<ReturnType<typeof clearCutFeatures>, "features" | "afterScan">, norm: MapNorm = "ISOM"): SourceData {
  const osm = rawOsm && isSprintNorm(norm) ? sprintOsm(rawOsm) : rawOsm;
  const names = new Set(parts.map(part => part.name)), landCover = names.has("marktacke.geojson");
  const shortest = scale ? twoTagMeters(scale) : 0;
  const minCliff = scale ? MIN_CLIFF_MM * scale / 1000 : 0;
  // G3: kurvorna och formlinjerna fogas över laserrutornas skarvar.
  // Ägaren 2026-11-12: kurvorna och formlinjerna klipps mot vattnet (lasern har ingen mark där och drar dem rakt över).
  const contours = new Set<SourceFeature>();
  const joined = parts.map(part => {
    if (!/^(kurvor|formlinjer)\.dxf$/.test(part.name)) return part;
    const list = joinSeams(part.data.features);
    for (const feature of list) contours.add(feature);
    return { ...part, data: { ...part.data, features: list } };
  });
  // Sänkornas kurvor (Karttapullautins lager «depression») får ett lutningsstreck inåt, annars läses de som höjder.
  const ticks = joined.flatMap(part => part.data.features).flatMap(depressionTick);
  const dry = linesOutsideWater(joined.flatMap(part => part.data.features), feature => contours.has(feature)).features;
  const partOf = new Map(joined.flatMap(part => part.data.features.map(feature => [feature, part.name] as const)));
  const features = dry.map(feature => {
    const part = { name: partOf.get(feature) ?? "kurvor.dxf" };
    if (part.name === "vegetation.dxf" && landCover && feature.layer === "oppen_mark") return { ...feature, layer: "oppen_mark_laser" };
    if (feature.layer === "bebyggelse_lag") return { ...feature, layer: "tomtmark_marktacke" };
    // Ägaren 2026-11-12 («konstig brant i ingenting»): normens kortaste brant är 0,6 mm på kartan (9 m i 1:15 000). Av laserns
    // branter under 9 m ligger 40 % vid en ritad brant på lärkartorna, mot 65–80 % av de längre; de kortaste tas inte med.
    if (/^brant_/.test(feature.layer) && feature.geometry.kind === "line" && lineLength(feature.geometry.points) < minCliff) return undefined;
    if (feature.layer === "brant_opasserbar" && feature.geometry.kind === "line" && lineLength(feature.geometry.points) < shortest) return { ...feature, layer: "brant_passerbar" };
    return feature;
  }).filter((feature): feature is SourceFeature => !!feature);
  // Ägaren 2026-11-11 (Högdalen som facit: 282 punkthöjder mot kartritarens 153, många i sluttningar): finns laserns egna
  // små kullar (berg.dxf, prövade mot markmodellen) ersätter de Karttapullautins knollar; groparna behålls.
  const laserKnolls = features.some(feature => feature.layer === "dotknoll_laser");
  const knolls = laserKnolls ? features.filter(feature => !(feature.layer === "dotknoll" && feature.geometry.kind === "point")) : features;
  // Skogsstyrelsens hyggen efter ålder; laserns vegetation i ett hygge som är yngre än skanningen tas bort.
  const all = [...ticks, ...withoutCutVegetation(scale ? smallRingsToPoints(knolls, scale) : knolls, cuts?.afterScan ?? []), ...(cuts?.features ?? []), ...(osm ? osmForBaseMap(osm, names.has("byggnader.geojson")) : [])];
  // Ägaren 2026-11-12: en sankmark per plats (blött, fuktigt och marktäckets låg på varandra).
  const single = undergrowthOutsideGreen(singleMarsh(marshOutsideManaged(all, osm ? osmManaged(osm) : [])).features).features;
  return { features: [...single, ...shoreLines(single), ...yardsOf(single)], skipped: parts.reduce((sum, part) => sum + part.data.skipped, 0) + (osm?.skipped ?? 0),
    crs: SWEREF99TM };
}
