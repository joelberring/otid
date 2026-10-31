import type { MapColor } from "./model";

export function rgbFromCmyk(cmyk: MapColor["cmyk"]): MapColor["rgb"] {
  return { r: (1 - cmyk.c) * (1 - cmyk.k), g: (1 - cmyk.m) * (1 - cmyk.k), b: (1 - cmyk.y) * (1 - cmyk.k) };
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
