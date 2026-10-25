import type { EvaluationReadout, Punch, RaceSnapshot, UUID } from "./types";

/**
 * Rättningar för hela tävlingen (PLAN.md steg 31). Stationen som en tidsjustering gäller: start- eller målenheten,
 * en kontroll med en viss kod, eller (steg 45) alla enheter: start, mål och alla kontroller, till exempel när enheterna
 * ställdes på sommartid och tävlingen går på vintertid. En justering för alla läggs ihop med en för en enskild enhet.
 */
export type CorrectionStation = "START" | "FINISH" | "CONTROL" | "ALL";

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
  readonly station: Exclude<CorrectionStation, "ALL">;
  readonly controlCode?: number | undefined;
  readonly offsetMs: number;
  /** Hur många tider på brickan som justerades (start och mål räknas som en). */
  readonly punches: number;
}

export interface PreparedReadout {
  /** Avläsningen som bedömningen använder. Samma objekt som indata när inget ändrats. */
  readonly readout: EvaluationReadout;
  readonly adjustments: readonly AppliedStationAdjustment[];
  /** Gamla stämplingar på en oröjd bricka som inte räknades (kontroller, start och mål). */
  readonly ignoredPunches: number;
  /** Index i brickans stämplingslista för de kontrollstämplingar som räknades, i ordning. */
  readonly keptPunchIndexes: readonly number[];
}

/** Stämplingar mer än så långt före avläsningen är från en annan dag eller ett annat lopp (PLAN.md steg 31). */
export const OLD_PUNCH_MAX_AGE_MS = 12 * 3_600_000;
/** Marginal före clear- eller checkstämplingen: stämplingar dessförinnan är från ett tidigare varv på brickan. */
export const CLEAR_CHECK_MARGIN_MS = 10 * 60_000;

function shifted(instant: string, offsetMs: number): string {
  const ms = Date.parse(instant);
  return Number.isFinite(ms) ? new Date(ms + offsetMs).toISOString() : instant;
}

/**
 * Den aktiva justeringen för en enhet (högst en per station; flera läggs ihop för säkerhets skull). Steg 45: en justering
 * för alla enheter (ALL) gäller också.
 */
function offsetFor(adjustments: readonly StationTimeAdjustment[], station: Exclude<CorrectionStation, "ALL">, controlCode?: number): number {
  return adjustments.filter((adjustment) => adjustment.station === "ALL" || (adjustment.station === station &&
    (station !== "CONTROL" || adjustment.controlCode === controlCode)))
    .reduce((sum, adjustment) => sum + adjustment.offsetMs, 0);
}

/**
 * Det enda stället i kedjan där brickans tider förbereds innan resultatmotorn bedömer dem (PLAN.md steg 31): först
 * tävlingens tidsjusteringar per station, sedan bortfaller gamla stämplingar på en oröjd bricka (`withoutOldPunches`).
 * Utan rättningar och gamla stämplingar returneras avläsningen oförändrad (samma objekt), så vanliga avläsningar bedöms
 * exakt som förut.
 */
export function prepareReadoutForEvaluation(readout: EvaluationReadout, snapshot: RaceSnapshot): PreparedReadout {
  const adjusted = adjustStationTimes(readout, snapshot);
  const old = withoutOldPunches(adjusted.readout);
  return { readout: old.readout, adjustments: adjusted.adjustments, ignoredPunches: old.ignoredPunches,
    keptPunchIndexes: old.keptPunchIndexes };
}

function finite(instant: string | undefined): number | undefined {
  if (!instant) return undefined;
  const ms = Date.parse(instant);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Oröjd bricka (PLAN.md steg 31): en bricka som inte tömts har kvar stämplingar från ett tidigare lopp, och ett gammalt
 * varv på samma kontroller kunde ge godkänt fast dagens varv saknade en kontroll. Två regler, valda så att en löpare
 * som gjort rätt i kväll aldrig blir felstämplad av dem:
 *
 * 1. En stämpling mer än 12 timmar före avläsningen räknas inte (annan dag). Gäller kontroller, start och mål.
 * 2. Har brickan en clear- eller checkstämpling från i kväll (högst 12 timmar före avläsningen, och inte efter
 *    startstämplingen) räknas inte kontrollstämplingar mer än 10 minuter före den.
 *
 * Kontrollstämplingarna ligger i brickans minne i den ordning de gjordes; bara den inledande följden av gamla
 * stämplingar tas bort. En enstaka kontroll med fel klocka mitt bland kvällens stämplingar räknas alltså som förut.
 */
function withoutOldPunches(readout: EvaluationReadout): { readout: EvaluationReadout; ignoredPunches: number;
  keptPunchIndexes: readonly number[] } {
  const all = readout.punches.map((_punch, index) => index);
  const readAt = finite(readout.readAt);
  if (readAt === undefined) return { readout, ignoredPunches: 0, keptPunchIndexes: all };
  const oldest = readAt - OLD_PUNCH_MAX_AGE_MS;
  const start = finite(readout.startPunchedAt);
  const references = [finite(readout.clearPunchedAt), finite(readout.checkPunchedAt)]
    .filter((value): value is number => value !== undefined && value >= oldest && value <= readAt && (start === undefined || value <= start));
  const threshold = references.length > 0 ? Math.max(...references) - CLEAR_CHECK_MARGIN_MS : undefined;
  const isOld = (instant: string, useThreshold: boolean) => {
    const ms = finite(instant);
    return ms !== undefined && (ms < oldest || (useThreshold && threshold !== undefined && ms < threshold));
  };
  let leading = 0;
  while (leading < readout.punches.length && isOld(readout.punches[leading]!.punchedAt, true)) leading += 1;
  const dropStart = readout.startPunchedAt !== undefined && isOld(readout.startPunchedAt, false);
  const dropFinish = readout.finishPunchedAt !== undefined && isOld(readout.finishPunchedAt, false);
  const ignoredPunches = leading + (dropStart ? 1 : 0) + (dropFinish ? 1 : 0);
  if (ignoredPunches === 0) return { readout, ignoredPunches: 0, keptPunchIndexes: all };
  const { startPunchedAt, finishPunchedAt, ...rest } = readout;
  return {
    readout: { ...rest, ...(startPunchedAt && !dropStart ? { startPunchedAt } : {}), ...(finishPunchedAt && !dropFinish ? { finishPunchedAt } : {}),
      punches: readout.punches.slice(leading) },
    ignoredPunches,
    keptPunchIndexes: all.slice(leading)
  };
}

/** Tävlingens tidsjusteringar per station på brickans tider (steg 31 A1). */
function adjustStationTimes(readout: EvaluationReadout, snapshot: RaceSnapshot):
  { readout: EvaluationReadout; adjustments: readonly AppliedStationAdjustment[] } {
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
