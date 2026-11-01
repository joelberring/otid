import type { MapColor } from "./model";
import { SWOP_STEPS, SWOP_TABLE_BASE64 } from "./swop-table";

let swopTable: Uint8Array | undefined;

function table(): Uint8Array {
  if (!swopTable) {
    const binary = atob(SWOP_TABLE_BASE64);
    swopTable = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) swopTable[i] = binary.charCodeAt(i);
  }
  return swopTable;
}

/**
 * Skärmfärg för en CMYK-färg, som Purple Pen och OCAD visar kartan: tryckprofilen SWOP (tabell 11⁴, interpolerad
 * fyrlinjärt). Den naiva omräkningen (1 − c)(1 − k) ger för mättade färger, t.ex. neongrönt (61, 255, 23) för grön 100 %
 * (C76 Y91) där tryckt färg är (32, 180, 87). Svart 100 % blir rent svart och ingen färg rent vitt, som i Purple Pen.
 */
export function rgbFromCmyk(cmyk: MapColor["cmyk"]): MapColor["rgb"] {
  const c = clamp01(cmyk.c), m = clamp01(cmyk.m), y = clamp01(cmyk.y), k = clamp01(cmyk.k);
  if (k >= 0.999) return { r: 0, g: 0, b: 0 };
  if (c === 0 && m === 0 && y === 0 && k === 0) return { r: 1, g: 1, b: 1 };
  const data = table();
  const n = SWOP_STEPS;
  const axes = [c, m, y, k].map(value => {
    const position = value * (n - 1);
    const lower = Math.min(Math.floor(position), n - 2);
    return { lower, fraction: position - lower };
  });
  let r = 0, g = 0, b = 0;
  for (let corner = 0; corner < 16; corner++) {
    let weight = 1, index = 0;
    for (let axis = 0; axis < 4; axis++) {
      const { lower, fraction } = axes[axis]!;
      const upper = (corner >> (3 - axis)) & 1;
      weight *= upper ? fraction : 1 - fraction;
      index = index * n + lower + upper;
    }
    if (weight === 0) continue;
    r += data[index * 3]! * weight;
    g += data[index * 3 + 1]! * weight;
    b += data[index * 3 + 2]! * weight;
  }
  const channel = (value: number) => Math.round(value) / 255;
  return { r: channel(r), g: channel(g), b: channel(b) };
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Dekorfärgens namn ur separationerna, t.ex. "Purple" eller "PMS361_Green 60 %". Separationer med 0 % tas bara med
 * när inga andra finns (vit som slår ut en dekorfärg, "Purple 0 %").
 */
export function spotName(separations: readonly { readonly name: string; readonly factor: number }[]): string | undefined {
  const named = separations.filter(part => part.name !== "");
  const used = named.some(part => part.factor > 0) ? named.filter(part => part.factor > 0) : named;
  if (used.length === 0) return undefined;
  return used.map(part => (part.factor >= 0.9995 ? part.name : `${part.name} ${Math.round(part.factor * 100)} %`)).join(" + ");
}
