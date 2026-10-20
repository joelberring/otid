import { evaluateCardReadout } from "./evaluate-card-readout";
import { prepareReadoutForEvaluation } from "./station-corrections";
import type { EvaluationReadout, EvaluationResult, RaceSnapshot } from "./types";

/**
 * Steg 31: ögonblicksbilden där just denna deltagare har avläsningens bricka. Resultatet hänger på avläsningen och
 * deltagaren, inte på vem brickan är kopplad till just nu (lånad bricka, samma bricka hos två löpare).
 */
export function snapshotForEntryCard(snapshot: RaceSnapshot, entryId: string, cardNumber: string): RaceSnapshot {
  const others = snapshot.cardAssignments.filter((assignment) => assignment.cardNumber !== cardNumber && assignment.entryId !== entryId);
  return { ...snapshot, cardAssignments: [...others, { id: `${entryId}:${cardNumber}`, raceId: snapshot.race.id, entryId,
    cardNumber, active: true }] };
}

/** Avläsningen bedömd för en bestämd deltagare (samma resultatmotor), oavsett brickans nuvarande koppling. */
export function evaluateReadoutForEntry(readout: EvaluationReadout, snapshot: RaceSnapshot, entryId: string): EvaluationResult {
  return evaluateCardReadout(readout, snapshotForEntryCard(snapshot, entryId, readout.cardNumber));
}

/**
 * Avläsningen bedömd med arrangörens start- och måltid (manuell tid): starten är den angivna tiden även vid lottad start,
 * och målet ersätter målstämplingen. Kontroller och sträcktider räknas som vanligt.
 */
export function evaluateReadoutWithTimes(readout: EvaluationReadout, snapshot: RaceSnapshot, entryId: string,
  startTime: string, finishTime: string): EvaluationResult {
  const forEntry = snapshotForEntryCard(snapshot, entryId, readout.cardNumber);
  const entry = forEntry.entries.find((candidate) => candidate.id === entryId);
  // Kontrollernas tider förbereds som vanligt (tidsjustering per station, gamla stämplingar bort). Arrangörens start-
  // och måltid är redan rätta: ingen stationsjustering läggs på dem.
  const prepared = prepareReadoutForEvaluation(readout, forEntry).readout;
  const punchStart: RaceSnapshot = { ...forEntry, stationTimeAdjustments: [],
    classes: forEntry.classes.map((raceClass) => raceClass.id === entry?.classId ? { ...raceClass, startRule: "PUNCH" } : raceClass) };
  return evaluateCardReadout({ cardNumber: readout.cardNumber, punches: prepared.punches, startPunchedAt: startTime,
    finishPunchedAt: finishTime }, punchStart);
}
