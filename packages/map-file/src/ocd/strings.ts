/**
 * OCAD:s strängparametrar: en kedja av indexblock med (position, längd, typ, objekt) och strängar på formen
 * "Namn\tkVärde\tkVärde…" där k är en bokstav. Typ 9 = färg, 10 = dekorfärg, 1039 = georeferens.
 */
import { clamp01, rgbFromCmyk, spotName } from "../color";
import { crsFromEpsg } from "../georef";
import type { MapColor, MapGeoreference } from "../model";
import type { WarningCollector } from "../warnings";
import { indexBlocks, type Bytes } from "./bytes";

const STRING_BLOCK_SIZE = 4 + 256 * 16;
const MAX_STRING_BYTES = 1 << 20;

export interface ParameterString { readonly type: number; readonly value: string }

export function readParameterStrings(bytes: Bytes, first: number): ParameterString[] {
  const strings: ParameterString[] = [];
  if (first === 0) return strings;
  for (const block of indexBlocks(bytes, first, STRING_BLOCK_SIZE)) {
    for (let index = 0; index < 256; index++) {
      const entry = block + 4 + index * 16;
      const position = bytes.i32(entry);
      const length = bytes.i32(entry + 4);
      const type = bytes.i32(entry + 8);
      if (position <= 0 || length <= 0) continue;
      // En sträng som går utanför filen betyder att filen är avkortad.
      const size = Math.min(length, MAX_STRING_BYTES);
      bytes.check(position, size, "inställning");
      strings.push({ type, value: bytes.utf8(position, size) });
    }
  }
  return strings;
}

interface Fields { readonly first: string; readonly pairs: readonly (readonly [string, string])[] }

function fields(value: string): Fields {
  const parts = value.split("\t");
  return { first: parts[0] ?? "", pairs: parts.slice(1).filter(part => part.length > 0).map(part => [part[0]!, part.slice(1)] as const) };
}

function numberField(pairs: Fields["pairs"], key: string): number | undefined {
  const pair = pairs.find(([k]) => k === key);
  if (!pair) return undefined;
  const value = Number(pair[1].trim());
  return Number.isFinite(value) ? value : undefined;
}

/** Färgtabellen i filens ordning (rank 0 överst). Dekorfärgerna hämtas ur typ 10 via namnet. */
export function readColors(strings: readonly ParameterString[]): MapColor[] {
  const spotNumbers = new Set<string>();
  for (const entry of strings) if (entry.type === 10) spotNumbers.add(fields(entry.value).first);
  const colors: MapColor[] = [];
  const usedIds = new Set<number>();
  for (const entry of strings) {
    if (entry.type !== 9) continue;
    const { first, pairs } = fields(entry.value);
    let id = numberField(pairs, "n") ?? colors.length;
    if (usedIds.has(id)) id = Math.max(...usedIds) + 1;
    usedIds.add(id);
    const percent = (key: string) => clamp01((numberField(pairs, key) ?? 0) / 100);
    const cmyk = { c: percent("c"), m: percent("m"), y: percent("y"), k: percent("k") };
    // "s" (dekorfärgens namn) följs av "p" (andel i procent); "p" före första "s" saknar betydelse.
    const separations: { name: string; factor: number }[] = [];
    for (const [key, value] of pairs) {
      if (key === "s") separations.push({ name: value, factor: 1 });
      else if (key === "p" && separations.length > 0) {
        const factor = Number(value);
        separations[separations.length - 1]!.factor = Number.isFinite(factor) ? clamp01(factor / 100) : 0;
      }
    }
    const name = spotName(separations.filter(part => part.name !== "" && (spotNumbers.size === 0 || spotNumbers.has(part.name))));
    const opacity = numberField(pairs, "t");
    colors.push({
      id,
      name: first,
      rank: colors.length,
      cmyk,
      rgb: rgbFromCmyk(cmyk),
      opacity: opacity === undefined ? 1 : clamp01(opacity / 100),
      spot: name ? { name, overprint: numberField(pairs, "o") === 1 } : undefined
    });
  }
  return colors;
}

/** OCAD:s egna nummer för koordinatsystem (fältet "i") som O-Tid känner igen, när EPSG-numret ("e") saknas. */
const OCAD_GRIDS: Readonly<Record<number, number>> = { 13002: 3006 };

export function readGeoreference(strings: readonly ParameterString[], warnings: WarningCollector): { scale: number; georeference: MapGeoreference | null } {
  const entry = strings.find(item => item.type === 1039);
  const pairs = entry ? fields(entry.value).pairs : [];
  const fileScale = numberField(pairs, "m") ?? 0;
  const scale = fileScale > 0 ? fileScale : 10000;
  if (fileScale <= 0) warnings.add("SCALE_MISSING");
  const realWorld = numberField(pairs, "r") === 1;
  const easting = numberField(pairs, "x");
  const northing = numberField(pairs, "y");
  if (!entry || !realWorld || easting === undefined || northing === undefined) return { scale, georeference: null };
  const epsg = numberField(pairs, "e");
  const grid = numberField(pairs, "i");
  const code = epsg !== undefined && epsg > 0 ? epsg : grid !== undefined ? (OCAD_GRIDS[grid] ?? null) : null;
  const crs = crsFromEpsg(code, [epsg ? `EPSG:${epsg}` : "", grid !== undefined ? `OCAD-rutnät ${grid}` : ""].filter(Boolean).join(", ") || "okänt");
  if (crs.kind === "UNKNOWN") warnings.add("CRS_UNKNOWN");
  return {
    scale,
    georeference: {
      scale,
      crs,
      refPoint: { easting, northing },
      mapRefPoint: { x: 0, y: 0 },
      grivationDegrees: numberField(pairs, "a") ?? 0,
      combinedScaleFactor: 1
    }
  };
}
