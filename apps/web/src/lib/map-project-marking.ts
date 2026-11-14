import { MARKING_CODES, MARKING_LOGO_SIZE, MARKING_TEXT_SIZE, SYMBOL_SETS, type MapObject } from "@o-tid/map-file";
import { mapMarking, type MarkingBox } from "@o-tid/map-revision/base-map";
import type { mapMarkingSv, MarkingFacts } from "../i18n/map-marking-sv";
import type { Bounds } from "./course-setting-viewport";
import type { CatalogSymbol } from "./map-project-protocol";

/** Laserjobbet som grundkartan kom ur: skanningsdatumet och inställningarna (till märkningens ruta). */
export interface BaseMapOrigin { readonly scannedAt: string | null; readonly settings: Readonly<Record<string, number>> }

const normal = (code: string) => code.replace(/\.0+$/, "").trim();
/** Symbolsetets förstoring vid skalan (ISOM 1:10 000 ritas 1,5 gånger större); 1 för okända skalor. */
const factorAt = (scale: number) => Object.values(SYMBOL_SETS).flatMap(set => set.scales).find(row => row.scale === scale)?.factor ?? 1;

function extend(box: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number) {
  if (x < box.minX) box.minX = x; if (x > box.maxX) box.maxX = x; if (y < box.minY) box.minY = y; if (y > box.maxY) box.maxY = y;
}
/** En punkt som står för objektet (första punkten), och alla dess punkter till utbredningen. */
function pointsOf(object: MapObject): { x: number; y: number }[] {
  if (object.kind === "point" || object.kind === "text") return [object.at];
  const path = object.kind === "line" ? object.path : object.rings[0] ?? [];
  return path.map(command => ({ x: command.x, y: command.y }));
}

/**
 * Ägaren 2026-11-14 («bara på kartor som görs nya i O-Tid … ramen läggs alltid in men kan tas bort»): märkningen som läggs
 * in tillsammans med grundkartan. Inget när kartan saknar märkningens symboler (en karta som inte är gjord i O-Tid, eller
 * gjord före 2026-11-14) eller redan har en ram.
 */
export function baseMapMarking(input: { symbols: ReadonlyMap<string, CatalogSymbol>; objects: readonly MapObject[]; bounds: Bounds | undefined; scale: number;
  text: typeof mapMarkingSv; facts: MarkingFacts }): { objects: MapObject[]; paper: string } | undefined {
  const find = (code: string, kind: CatalogSymbol["kind"]) => [...input.symbols.values()].find(symbol => symbol.kind === kind && normal(symbol.code) === code);
  const frame = find(MARKING_CODES.frame, "line"), logo = find(MARKING_CODES.logo, "point"), text = find(MARKING_CODES.text, "text"), heading = find(MARKING_CODES.heading, "text");
  if (!frame || !logo || !text || !heading || frame.count > 0) return undefined;
  const box = input.bounds ? { ...input.bounds } : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const anchors: { x: number; y: number }[] = [];
  for (const object of input.objects) {
    const points = pointsOf(object);
    for (const point of points) extend(box, point.x, point.y);
    if (points[0]) anchors.push(points[0]);
  }
  if (!(box.maxX > box.minX && box.maxY > box.minY)) return undefined;
  const factor = factorAt(input.scale);
  const marking = mapMarking({ bounds: box, symbols: { frame: frame.id, logo: logo.id, text: text.id, heading: heading.id }, textSize: MARKING_TEXT_SIZE * factor,
    logoSize: MARKING_LOGO_SIZE * factor, heading: input.text.heading, paragraphs: input.text.paragraphs(input.facts),
    occupied: (corner: MarkingBox) => anchors.reduce((sum, at) => sum + (at.x >= corner.minX && at.x <= corner.maxX && at.y >= corner.minY && at.y <= corner.maxY ? 1 : 0), 0) });
  return { objects: marking.objects, paper: marking.paper ? input.text.paper(marking.paper.size, marking.paper.landscape) : input.text.noPaper };
}
