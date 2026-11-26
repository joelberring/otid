/**
 * Gemensamma typer och varningssamlare för fullkartekonvertering (`.omap` ↔ `.ocd`).
 */
import type { MapFileFormat } from "../../model";

export type MapConversionWarningCode =
  | "PRECISION_ROUNDED"
  | "COMBINED_SPLIT"
  | "COMBINED_UNSUPPORTED"
  | "MULTIPLE_HATCHES_TRUNCATED"
  | "MULTIPLE_PARTS_MERGED"
  | "LINE_TEXT_SIMPLIFIED"
  | "OBJECT_SKIPPED"
  | "COORD_CLAMPED"
  | "MAP_REF_SHIFTED"
  | "AUXILIARY_SCALE_FACTOR"
  | "OCAD_GAPS_DROPPED"
  | "IRREGULAR_PATTERN_REGULARIZED"
  | "SECONDARY_SYMBOL_DROPPED"
  | "CRS_UNKNOWN"
  | "SYMBOL_CODE_REMAPPED";

export interface MapConversionWarning {
  readonly code: MapConversionWarningCode;
  readonly count: number;
  /** Begriplig svensk sammanfattning av formatgapet. */
  readonly message: string;
}

export interface MapConversionReport {
  readonly sourceFormat: MapFileFormat;
  readonly targetFormat: MapFileFormat;
  readonly colors: number;
  readonly symbols: number;
  readonly objects: number;
  readonly skippedObjects: number;
  readonly warnings: readonly MapConversionWarning[];
}

export interface ConvertMapResult {
  readonly bytes: Uint8Array;
  readonly report: MapConversionReport;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function warningMessage(code: MapConversionWarningCode, count: number): string {
  switch (code) {
    case "PRECISION_ROUNDED":
      return `${plural(count, "objekt", "objekt")} avrundades från Mappers 0,001 mm till OCAD:s 0,01 mm-upplösning.`;
    case "COMBINED_SPLIT":
      return `${plural(count, "sammansatt symbol", "sammansatta symboler")} med flera delar delades upp i separata OCAD-objekt per delsymbol.`;
    case "COMBINED_UNSUPPORTED":
      return `${plural(count, "sammansatt symbol", "sammansatta symboler")} saknade konverterbara delar och hoppades över.`;
    case "MULTIPLE_HATCHES_TRUNCATED":
      return `${plural(count, "ytsymbol", "ytsymboler")} hade fler eller olika rasterlinjer än OCAD stöder (högst 2 vinklar i samma färg/bredd/avstånd).`;
    case "MULTIPLE_PARTS_MERGED":
      return `${plural(count, "del", "delar")} (kartdelar eller flerdelslinjer) slogs ihop eller delades till fristående OCAD-objekt.`;
    case "LINE_TEXT_SIMPLIFIED":
      return `${plural(count, "linjetext", "linjetexter")} förenklades till vanlig punktförankrad text.`;
    case "OBJECT_SKIPPED":
      return `${plural(count, "objekt", "objekt")} saknade giltig symbol eller geometri och utelämnades.`;
    case "COORD_CLAMPED":
      return `${plural(count, "koordinat", "koordinater")} låg utanför OCAD:s koordinatgräns (±83 886 mm) och begränsades.`;
    case "MAP_REF_SHIFTED":
      return "Kartans referenspunkt flyttades till (0, 0) för OCAD och alla objektkoordinater försköts motsvarande (samma geografiska läge).";
    case "AUXILIARY_SCALE_FACTOR":
      return "Mappers extra skalfaktor (auxiliary_scale_factor ≠ 1) stöds inte direkt i OCAD:s georeferenssträng.";
    case "OCAD_GAPS_DROPPED":
      return `${plural(count, "objekt", "objekt")} hade OCAD-luckor (gap) i linjer eller ytkanter, som inte har direkt motsvarighet i Mapper.`;
    case "IRREGULAR_PATTERN_REGULARIZED":
      return `${plural(count, "ytsymbol", "ytsymboler")} hade oregelbundet OCAD-mönster och konverterades till regelbundet punktmönster i Mapper.`;
    case "SECONDARY_SYMBOL_DROPPED":
      return `${plural(count, "linjesymbol", "linjesymboler")} hade OCAD:s sekundärsymbol (between), som inte har direkt motsvarighet i Mapper.`;
    case "CRS_UNKNOWN":
      return "Kartans koordinatsystem var okänt och kunde bara bevaras som fritextbeskrivning.";
    case "SYMBOL_CODE_REMAPPED":
      return `${plural(count, "symbol", "symboler")} hade nummer utanför OCAD:s intervall eller dubblettnummer och fick nytt ledigt nummer.`;
  }
}

export class ConversionWarningCollector {
  private readonly counts = new Map<MapConversionWarningCode, number>();

  add(code: MapConversionWarningCode, amount = 1): void {
    if (amount <= 0) return;
    this.counts.set(code, (this.counts.get(code) ?? 0) + amount);
  }

  list(): MapConversionWarning[] {
    const out: MapConversionWarning[] = [];
    for (const [code, count] of this.counts) {
      out.push({ code, count, message: warningMessage(code, count) });
    }
    return out;
  }
}
