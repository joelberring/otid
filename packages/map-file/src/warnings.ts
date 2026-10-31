import type { MapFileWarning } from "./model";

/** Kända varningar med svensk text till arrangören. `{n}` byts mot antalet. */
const TEXTS = {
  UNKNOWN_SYMBOL_TYPE: "{n} symboler har en typ som O-Tid inte känner till och hoppades över.",
  UNKNOWN_OBJECT_TYPE: "{n} objekt har en typ som O-Tid inte känner till och hoppades över.",
  UNKNOWN_SYMBOL: "{n} objekt hänvisar till en symbol som saknas i filen och hoppades över.",
  OBJECT_WITHOUT_SYMBOL: "{n} objekt saknar symbol (grafik, bilder eller odefinierade objekt) och ritas inte.",
  BROKEN_OBJECT: "{n} objekt har trasiga koordinater och hoppades över.",
  BROKEN_SYMBOL: "{n} symboler har trasiga ritdata och ritas förenklat.",
  LINE_TEXT: "{n} texter längs linje visas som vanlig text vid linjens början.",
  SCALE_MISSING: "Kartans skala saknas i filen. O-Tid räknar med 1:10 000.",
  CRS_UNKNOWN: "Kartans koordinatsystem stöds inte. Georeferera kartan med tre punkter."
} as const;

export type WarningCode = keyof typeof TEXTS;

export class WarningCollector {
  private readonly counts = new Map<WarningCode, number>();

  add(code: WarningCode, count = 1): void {
    if (count <= 0) return;
    this.counts.set(code, (this.counts.get(code) ?? 0) + count);
  }

  list(): MapFileWarning[] {
    return [...this.counts].map(([code, count]) => ({ code, count, text: TEXTS[code].replace("{n}", count.toLocaleString("sv-SE")) }));
  }
}
