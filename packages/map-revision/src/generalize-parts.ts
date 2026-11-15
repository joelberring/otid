import { objectBox } from "./hit";
import { generalize, type GeneralizeOptions, type GeneralizeResult } from "./generalize";
import type { NormObject } from "./norm-check";
import type { ObjectKey } from "./state";

/**
 * Ägaren 2026-11-15 («den verkar hänga sig … går den att dela upp i delar»): generaliseringen räknas ruta för ruta, så att
 * Workern kan visa hur långt den kommit, svara på annat (kartbilden) mellan rutorna och avbryta när en ny räkning begärs.
 *
 * Varje ruta räknas på objekten vars omslutande ruta når in i rutan med en marginal (så att linjer som fogas ihop och ytor
 * inne i en större yta finns med), och bara ändringar vars plats ligger i rutan tas med. Objekt som fått en ändring i en
 * tidigare ruta hoppas över i de följande, så att inget objekt får två ändringar. Linjerna fogas ihop för hela kartan på en
 * gång först (`generalizeJoins`, snabbt med rutnätet över ändarna), så att en kedja genom flera rutor blir en linje.
 */
export interface GeneralizeBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

/** Rutans sida i kartans mm (240 m i 1:4 000, 600 m i 1:10 000). */
export const GENERALIZE_PART_MM = 60;
/** Marginalen runt rutan för objekten som räknas med (mm). */
export const GENERALIZE_MARGIN_MM = 5;

export interface GeneralizePart { readonly box: GeneralizeBox; readonly rows: readonly NormObject[] }

/** Rutorna över objekten (eller över `options.within`), med objekten som når in i varje ruta. Tomma rutor tas inte med. */
export function generalizeParts(objects: readonly NormObject[], options: Pick<GeneralizeOptions, "within">, side = GENERALIZE_PART_MM,
  margin = GENERALIZE_MARGIN_MM): GeneralizePart[] {
  const boxes = objects.map(row => objectBox(row.object));
  let area = options.within;
  if (!area) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const box of boxes) {
      if (!Number.isFinite(box.minX)) continue;
      minX = Math.min(minX, box.minX); minY = Math.min(minY, box.minY); maxX = Math.max(maxX, box.maxX); maxY = Math.max(maxY, box.maxY);
    }
    if (!Number.isFinite(minX)) return [];
    area = { minX, minY, maxX, maxY };
  }
  const columns = Math.max(1, Math.ceil((area.maxX - area.minX) / side)), rows = Math.max(1, Math.ceil((area.maxY - area.minY) / side));
  const cells: { box: GeneralizeBox; rows: NormObject[] }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const minX = area.minX + column * side, minY = area.minY + row * side;
      cells.push({ box: { minX, minY, maxX: Math.min(area.maxX, minX + side), maxY: Math.min(area.maxY, minY + side) }, rows: [] });
    }
  }
  // Varje objekt läggs i rutorna som dess omslutande ruta (plus marginalen) når in i.
  objects.forEach((object, index) => {
    const box = boxes[index]!;
    if (!Number.isFinite(box.minX)) return;
    const c0 = Math.max(0, Math.floor((box.minX - margin - area.minX) / side)), c1 = Math.min(columns - 1, Math.floor((box.maxX + margin - area.minX) / side));
    const r0 = Math.max(0, Math.floor((box.minY - margin - area.minY) / side)), r1 = Math.min(rows - 1, Math.floor((box.maxY + margin - area.minY) / side));
    for (let row = r0; row <= r1; row += 1) for (let column = c0; column <= c1; column += 1) cells[row * columns + column]!.rows.push(object);
  });
  return cells.filter(cell => cell.rows.length > 0);
}

/** Steg ett: linjerna som fogas ihop, för hela kartan (eller `within`); `taken` fylls på. */
export function generalizeJoins(objects: readonly NormObject[], scale: number, options: GeneralizeOptions, taken: Set<ObjectKey>): GeneralizeResult {
  const result = generalize(objects, scale, { simplifyMm: 0, removeSmall: false, joinLines: options.joinLines === true, removeInside: false,
    within: options.within, skip: taken });
  for (const change of result.changes) taken.add(change.key);
  return result;
}

/** Generaliseringen för en ruta (utan att foga ihop linjer, det görs för hela kartan i `generalizeJoins`); `taken` är objekten som redan fått en ändring i en tidigare ruta och fylls på. */
export function generalizePart(part: GeneralizePart, scale: number, options: GeneralizeOptions, taken: Set<ObjectKey>): GeneralizeResult {
  const result = generalize(part.rows, scale, { ...options, joinLines: false, within: part.box, skip: taken });
  for (const change of result.changes) taken.add(change.key);
  return result;
}

/** Rutornas resultat som ett. */
export function combineGeneralize(results: readonly GeneralizeResult[]): GeneralizeResult {
  const sum = (pick: (result: GeneralizeResult) => number | undefined) => results.reduce((total, result) => total + (pick(result) ?? 0), 0);
  const any = (pick: (result: GeneralizeResult) => unknown) => results.some(result => pick(result) !== undefined);
  return {
    changes: results.flatMap(result => result.changes),
    simplified: sum(result => result.simplified), pointsBefore: sum(result => result.pointsBefore), pointsAfter: sum(result => result.pointsAfter),
    removed: { SMALL_AREA: sum(result => result.removed.SMALL_AREA), SHORT_LINE: sum(result => result.removed.SHORT_LINE),
      SMALL_CLOSED: sum(result => result.removed.SMALL_CLOSED) },
    ...(any(result => result.joined) ? { joined: { lines: sum(result => result.joined?.lines), absorbed: sum(result => result.joined?.absorbed) } } : {}),
    ...(any(result => result.inside) ? { inside: sum(result => result.inside) } : {}),
    ...(any(result => result.smoothed) ? { smoothed: sum(result => result.smoothed) } : {})
  };
}
