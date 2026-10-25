/**
 * Klockan som brickans tider löses mot (PLAN.md steg 22, steg 45). Stationens klocka används när den finns, eftersom
 * kontrollenheterna normalt är synkade mot samma klocka. Går stationen mer än sex timmar fel mot datorn är det inte en
 * vanlig avvikelse (sommartid, några minuter) utan en klocka som aldrig ställts; då räknas tiderna mot datorns klocka och
 * funktionären får ett tydligt besked. Den uppmätta avvikelsen sparas ändå i avläsningen.
 */
export const STATION_CLOCK_MAX_SKEW_MS = 6 * 3_600_000;

export interface ReadoutClock {
  /** Läggs på datorns klocka för att få tidsreferensen. */
  readonly referenceOffsetMs: number;
  readonly clockSource: "station" | "device";
  /** Stationens klocka minus datorns, när den mättes. */
  readonly clockOffsetMs?: number;
  /** Sant när stationens klocka fanns men gick för fel för att användas. */
  readonly stationIgnored: boolean;
}

export function chooseReadoutClock(input: { readonly stationOffsetMs?: number | undefined;
  readonly exerciseOffsetMs?: number | undefined }): ReadoutClock {
  // Övningsstationens klocka står med flit på tävlingsdagen, hur långt bort den än är.
  if (input.exerciseOffsetMs !== undefined) {
    return { referenceOffsetMs: input.exerciseOffsetMs, clockSource: "station", clockOffsetMs: Math.round(input.exerciseOffsetMs),
      stationIgnored: false };
  }
  const offset = input.stationOffsetMs;
  if (offset === undefined) return { referenceOffsetMs: 0, clockSource: "device", stationIgnored: false };
  if (stationClockUnusable(offset)) {
    return { referenceOffsetMs: 0, clockSource: "device", clockOffsetMs: Math.round(offset), stationIgnored: true };
  }
  return { referenceOffsetMs: offset, clockSource: "station", clockOffsetMs: Math.round(offset), stationIgnored: false };
}

export function stationClockUnusable(offsetMs: number): boolean {
  return Math.abs(offsetMs) > STATION_CLOCK_MAX_SKEW_MS;
}
