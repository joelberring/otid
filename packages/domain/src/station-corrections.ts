import type { EvaluationReadout, Punch, RaceSnapshot, UUID } from "./types";

/**
 * Rättningar för hela tävlingen (PLAN.md steg 31). Stationen som en tidsjustering gäller: start- eller målenheten,
 * eller en kontroll med en viss kod.
 */
export type CorrectionStation = "START" | "FINISH" | "CONTROL";

/**
 * En tidsjustering för en station, till exempel en kontroll vars klocka gick en timme fel. Justeringen läggs på
 * stämplingstiderna från stationen innan bedömningen (`prepareReadoutForEvaluation`), så att totaltid, sträcktider,
 * mål före start och maxtid räknas med den rättade tiden. Den lagrade avläsningen ändras aldrig.
 */
export interface StationTimeAdjustment {
  readonly id: UUID;
  readonly station: CorrectionStation;
  /** Bara för `CONTROL`. */
  readonly controlCode?: number | undefined;
  /** Läggs till stämplingstiden; negativt drar ifrån. */
  readonly offsetMs: number;
}

/**
 * En kontroll ur funktion för hela tävlingen: koden krävs inte på någon bana (även gafflade), en stämpling där ger ingen
 * sträcktid, och sträckan räknas från kontrollen före till kontrollen efter.
 */
export interface ControlOutOfOrder {
  readonly id: UUID;
  readonly controlCode: number;
}

/** Koderna som är ur funktion i tävlingen. */
export function controlCodesOutOfOrder(snapshot: RaceSnapshot): ReadonlySet<number> {
  return new Set((snapshot.controlsOutOfOrder ?? []).map((control) => control.controlCode));
}

/** En justering som faktiskt ändrade någon av brickans tider. */
export interface AppliedStationAdjustment {
  readonly station: CorrectionStation;
  readonly controlCode?: number | undefined;
  readonly offsetMs: number;
  /** Hur många tider på brickan som justerades (start och mål räknas som en). */
  readonly punches: number;
}

export interface PreparedReadout {
  /** Avläsningen som bedömningen använder. Samma objekt som indata när inget ändrats. */
  readonly readout: EvaluationReadout;
  readonly adjustments: readonly AppliedStationAdjustment[];
}

function shifted(instant: string, offsetMs: number): string {
  const ms = Date.parse(instant);
  return Number.isFinite(ms) ? new Date(ms + offsetMs).toISOString() : instant;
}

/** Den aktiva justeringen för en station (högst en per station; flera läggs ihop för säkerhets skull). */
function offsetFor(adjustments: readonly StationTimeAdjustment[], station: CorrectionStation, controlCode?: number): number {
  return adjustments.filter((adjustment) => adjustment.station === station &&
    (station !== "CONTROL" || adjustment.controlCode === controlCode))
    .reduce((sum, adjustment) => sum + adjustment.offsetMs, 0);
}

/**
 * Det enda stället i kedjan där tävlingens rättningar läggs på brickans tider innan resultatmotorn bedömer dem. Utan
 * rättningar returneras avläsningen oförändrad (samma objekt), så vanliga avläsningar bedöms exakt som förut.
 */
export function prepareReadoutForEvaluation(readout: EvaluationReadout, snapshot: RaceSnapshot): PreparedReadout {
  const adjustments = snapshot.stationTimeAdjustments ?? [];
  if (adjustments.length === 0) return { readout, adjustments: [] };
  const applied: AppliedStationAdjustment[] = [];
  const startOffset = readout.startPunchedAt ? offsetFor(adjustments, "START") : 0;
  const finishOffset = readout.finishPunchedAt ? offsetFor(adjustments, "FINISH") : 0;
  if (startOffset !== 0) applied.push({ station: "START", offsetMs: startOffset, punches: 1 });
  if (finishOffset !== 0) applied.push({ station: "FINISH", offsetMs: finishOffset, punches: 1 });
  const counts = new Map<number, number>();
  const punches: Punch[] = readout.punches.map((punch) => {
    const offset = offsetFor(adjustments, "CONTROL", punch.code);
    if (offset === 0) return punch;
    counts.set(punch.code, (counts.get(punch.code) ?? 0) + 1);
    return { code: punch.code, punchedAt: shifted(punch.punchedAt, offset) };
  });
  for (const [code, count] of [...counts].sort(([left], [right]) => left - right)) {
    applied.push({ station: "CONTROL", controlCode: code, offsetMs: offsetFor(adjustments, "CONTROL", code), punches: count });
  }
  if (applied.length === 0) return { readout, adjustments: [] };
  return {
    readout: {
      ...readout,
      ...(readout.startPunchedAt ? { startPunchedAt: startOffset ? shifted(readout.startPunchedAt, startOffset) : readout.startPunchedAt } : {}),
      ...(readout.finishPunchedAt ? { finishPunchedAt: finishOffset ? shifted(readout.finishPunchedAt, finishOffset) : readout.finishPunchedAt } : {}),
      punches
    },
    adjustments: applied
  };
}
