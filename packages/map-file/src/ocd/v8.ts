/**
 * OCAD 8: färgtabellen ligger i ett symbolhuvud direkt efter filhuvudet och skalan och georeferensen i inställningsposten
 * (version 9 och senare har dem som strängparametrar). Egen kod efter OCAD:s formatbeskrivning för version 6–8,
 * kontrollerad mot klubbarkivets OCAD 8-filer (ADR-0196).
 *
 * Färgpost (72 byte): nummer (16 bit), reserverat, CMYK som fyra byte 0–200 (halva procent), namnet som Pascalsträng om
 * 32 byte och andelen per dekorfärg (32 byte, 0–200). Dekorfärgen (24 byte): namnet som Pascalsträng om 16 byte och CMYK.
 */
import { clamp01, rgbFromCmyk, spotName } from "../color";
import { crsFromEpsg } from "../georef";
import type { MapColor, MapGeoreference } from "../model";
import type { WarningCollector } from "../warnings";
import type { Bytes } from "./bytes";
import { V8 } from "./layout";

const half = (value: number) => clamp01(value / 200);

export function readV8Colors(bytes: Bytes): MapColor[] {
  const count = Math.min(Math.max(bytes.i16(V8.colorCount), 0), V8.maxColors);
  const separationCount = Math.min(Math.max(bytes.i16(V8.separationCount), 0), V8.maxSeparations);
  const separations = Array.from({ length: separationCount }, (_, index) => {
    const at = V8.separations + index * V8.separationSize;
    return {
      name: bytes.pascal(at, 15),
      cmyk: { c: half(bytes.u8(at + 16)), m: half(bytes.u8(at + 17)), y: half(bytes.u8(at + 18)), k: half(bytes.u8(at + 19)) }
    };
  });
  const colors: MapColor[] = [];
  const usedIds = new Set<number>();
  for (let index = 0; index < count; index++) {
    const at = V8.colors + index * V8.colorSize;
    let id = bytes.i16(at);
    if (id < 0 || usedIds.has(id)) id = Math.max(-1, ...usedIds) + 1;
    usedIds.add(id);
    const cmyk = { c: half(bytes.u8(at + 4)), m: half(bytes.u8(at + 5)), y: half(bytes.u8(at + 6)), k: half(bytes.u8(at + 7)) };
    const parts = separations
      .map((separation, k) => ({ name: separation.name, factor: half(bytes.u8(at + 40 + k)), cmyk: separation.cmyk }))
      .filter(part => part.name !== "");
    const name = spotName(parts);
    colors.push({
      id,
      name: bytes.pascal(at + 8, 31),
      rank: colors.length,
      cmyk,
      rgb: rgbFromCmyk(cmyk),
      opacity: 1,
      spot: name ? { name, overprint: false, separations: parts } : undefined
    });
  }
  return colors;
}

/** Skala och georeferens ur inställningsposten. OCAD 8 anger inget koordinatsystem. */
export function readV8Georeference(bytes: Bytes, warnings: WarningCollector): { scale: number; georeference: MapGeoreference | null } {
  const position = bytes.i32(V8.setupPosition);
  const size = bytes.i32(V8.setupSize);
  const setup = V8.setup;
  if (position <= 0 || size < setup.realWorldAngle + 8 || !bytes.has(position, setup.realWorldAngle + 8)) {
    warnings.add("SCALE_MISSING");
    return { scale: 10000, georeference: null };
  }
  const view = new DataView(bytes.bytes.buffer, bytes.bytes.byteOffset + position, setup.realWorldAngle + 8);
  const double = (offset: number) => { const value = view.getFloat64(offset, true); return Number.isFinite(value) ? value : 0; };
  const fileScale = double(setup.scale);
  const scale = fileScale >= 100 && fileScale <= 1_000_000 ? fileScale : 10000;
  if (scale !== fileScale) warnings.add("SCALE_MISSING");
  const easting = double(setup.realWorldX);
  const northing = double(setup.realWorldY);
  if (easting === 0 && northing === 0) return { scale, georeference: null };
  warnings.add("CRS_UNKNOWN");
  return {
    scale,
    georeference: {
      scale,
      crs: crsFromEpsg(null, "OCAD 8 (inget koordinatsystem i filen)"),
      refPoint: { easting, northing },
      mapRefPoint: { x: 0, y: 0 },
      grivationDegrees: double(setup.realWorldAngle),
      combinedScaleFactor: 1
    }
  };
}
