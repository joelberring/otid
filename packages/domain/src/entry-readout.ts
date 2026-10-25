import { evaluateCardReadout } from "./evaluate-card-readout";
import { controlCodesOutOfOrder, prepareReadoutForEvaluation } from "./station-corrections";
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

/**
 * Steg 45: avläsningens start- och måltid så som bedömningen ser dem, alltså efter tävlingens tidsjusteringar och utan
 * gamla stämplingar (`prepareReadoutForEvaluation`). Besluten (rättad starttid, manuell tid) jämförs mot och utgår från
 * dessa, inte från de råa tiderna; annars stämmer en rättad starttid aldrig med bedömningen när starten har en
 * tidsjustering.
 */
export function preparedReadoutTimes(readout: EvaluationReadout, snapshot: RaceSnapshot):
  { readonly startPunchedAt: string | null; readonly finishPunchedAt: string | null } {
  const prepared = prepareReadoutForEvaluation(readout, snapshot).readout;
  return { startPunchedAt: prepared.startPunchedAt ?? null, finishPunchedAt: prepared.finishPunchedAt ?? null };
}

/**
 * Steg 45: godkänt utan en enda sträcktid fast banan har kontroller, till exempel när stämplingarna ligger före starten
 * eller efter målet (fel klocka, eller en oröjd bricka). Statusen ändras inte; avläsningen visar en varning.
 */
export function okWithoutSplits(result: EvaluationResult, snapshot: RaceSnapshot): boolean {
  if (result.status !== "OK" || result.rogaining || result.splits.length > 0 || !result.courseVersionId) return false;
  const version = snapshot.courses.flatMap((course) => course.versions).find((candidate) => candidate.id === result.courseVersionId);
  if (!version) return false;
  const outOfOrder = controlCodesOutOfOrder(snapshot);
  const codes = [...version.controls.map((control) => control.controlCode),
    ...(version.variants ?? []).flatMap((variant) => variant.controls.map((control) => control.controlCode))];
  return codes.some((code) => !outOfOrder.has(code));
}
