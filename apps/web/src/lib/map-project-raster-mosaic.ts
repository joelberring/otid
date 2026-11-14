import type { Affine } from "./map-project-layers";
import { groupLayers } from "./map-project-layer-groups";

/**
 * Ägaren 2026-11-14 («när man sen finjusterar tex branter i en delen så försvinner de helt i andra … det vore bra om kartdelarna
 * slogs ihop även för finjusteringen så det kan göras på hela kartan»): en laserkörning som servern delat i etapper ger en bild
 * per etapp. Bilderna läggs ihop till en, så att reglagen räknar hela kartan på en gång och inte ersätter en etapps ytor med en
 * annans.
 */
export interface MosaicPart { readonly width: number; readonly height: number; readonly toMap: Affine }
export interface Mosaic {
  readonly width: number; readonly height: number;
  /** Från den sammanlagda bildens bildpunkter till kartan. */
  readonly toMap: Affine;
  /** Var varje del ritas i den sammanlagda bilden (bildpunkter, i delarnas ordning). */
  readonly offsets: readonly (readonly [number, number])[];
}

/** Största sammanlagda bild (bildpunkter): ungefär 6 × 6 km med 1 m celler. */
export const MAX_MOSAIC_PIXELS = 36_000_000;

/**
 * Hur delarna läggs ihop. Alla måste ha samma skala och vridning (samma laserkörning); förskjutningen avrundas till hela
 * bildpunkter. Ger inget om delarna inte passar ihop eller om bilden blir för stor.
 */
export function stageMosaic(parts: readonly MosaicPart[]): Mosaic | undefined {
  const first = parts[0];
  if (!first) return undefined;
  const { a, b, d, e } = first.toMap, det = a * e - b * d, scale = Math.hypot(a, d) + Math.hypot(b, e);
  if (Math.abs(det) < 1e-12) return undefined;
  const same = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * scale;
  if (parts.some(part => !same(part.toMap.a, a) || !same(part.toMap.b, b) || !same(part.toMap.d, d) || !same(part.toMap.e, e))) return undefined;
  // Delens origo i den första delens bildpunkter: inversen av den linjära delen gånger skillnaden i förskjutning.
  const raw = parts.map(part => {
    const dx = part.toMap.c - first.toMap.c, dy = part.toMap.f - first.toMap.f;
    return [Math.round((e * dx - b * dy) / det), Math.round((-d * dx + a * dy) / det)] as const;
  });
  const minColumn = Math.min(...raw.map(([column]) => column)), minRow = Math.min(...raw.map(([, row]) => row));
  const width = Math.max(...parts.map((part, i) => raw[i]![0] + part.width)) - minColumn;
  const height = Math.max(...parts.map((part, i) => raw[i]![1] + part.height)) - minRow;
  if (width * height > MAX_MOSAIC_PIXELS) return undefined;
  return {
    width, height, offsets: raw.map(([column, row]) => [column - minColumn, row - minRow] as const),
    toMap: { a, b, d, e, c: first.toMap.c + a * minColumn + b * minRow, f: first.toMap.f + d * minColumn + e * minRow },
  };
}

export interface RasterChoice<T> {
  /** `etapper:` och namnet för en sammanlagd grupp, annars underlagets id. */
  readonly id: string;
  /** Namnet utan etapp för en grupp. */
  readonly name: string;
  readonly members: readonly T[];
}

/** Valen i en panel: varje grupp av etapper som en helhet först, sedan underlagen ett och ett. */
export function rasterChoices<T extends { readonly name: string; readonly layerId: string }>(rows: readonly T[]): RasterChoice<T>[] {
  const groups = groupLayers(rows).filter(group => group.members.length > 1)
    .map(group => ({ id: `etapper:${group.name}`, name: group.name, members: group.members }));
  return [...groups, ...rows.map(row => ({ id: row.layerId, name: row.name, members: [row] }))];
}

/** Bildpunkterna i ett val: en bild som den är, flera lagda ihop. Ger inget om delarna inte passar ihop eller canvas saknas. */
export function choicePixels(parts: readonly { readonly image: CanvasImageSource & { readonly width: number; readonly height: number }; readonly toMap: Affine }[])
  : { data: ImageData; toMap: Affine } | undefined {
  const mosaic = parts.length === 1 ? { width: parts[0]!.image.width, height: parts[0]!.image.height, toMap: parts[0]!.toMap, offsets: [[0, 0] as const] }
    : stageMosaic(parts.map(part => ({ width: part.image.width, height: part.image.height, toMap: part.toMap })));
  if (!mosaic) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = mosaic.width; canvas.height = mosaic.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  // Där etapperna går omlott ritas den senare över; genomskinliga bildpunkter (utan data) täcker inget.
  parts.forEach((part, i) => context.drawImage(part.image, mosaic.offsets[i]![0], mosaic.offsets[i]![1]));
  return { data: context.getImageData(0, 0, mosaic.width, mosaic.height), toMap: mosaic.toMap };
}
