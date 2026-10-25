import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { EvaluationReadout, NormalizedCardReadout } from "@o-tid/domain";
import { normalizedReadout } from "./result-revisions";
import type { DbExecutor } from "./snapshot";

/**
 * Steg 31 (B4): samma bricka hos två löpare. Ett resultat hänger på avläsningen och deltagaren. Kommer en avläsning
 * för en bricka vars deltagare redan har ett resultat från en annan avläsning av samma bricka, och brickan har använts
 * i ett nytt lopp efter det (en start- eller kontrollstämpling efter förra avläsningens mål), skrivs den förstes resultat
 * inte över: avläsningen blir okänd ("lånad bricka?") tills någon väljer vem den hör till. En exakt likadan avläsning
 * (samma bricka läst igen, eller på en annan dator) ger som förut samma resultat, och en avläsning av samma lopp med
 * ändrade uppgifter räknas som förut för samma löpare.
 */
type Readout = typeof schema.cardReadouts.$inferSelect;

function instant(value: string | undefined): number | null {
  return value === undefined ? null : Date.parse(value);
}

/** Samma bricka, start, mål och stämplingar (tider jämförs som ögonblick). */
export function sameReadoutContent(left: EvaluationReadout, right: EvaluationReadout): boolean {
  return left.cardNumber === right.cardNumber && instant(left.startPunchedAt) === instant(right.startPunchedAt) &&
    instant(left.finishPunchedAt) === instant(right.finishPunchedAt) && left.punches.length === right.punches.length &&
    left.punches.every((punch, index) => punch.code === right.punches[index]!.code &&
      Date.parse(punch.punchedAt) === Date.parse(right.punches[index]!.punchedAt));
}

/** Har brickan använts i ett nytt lopp efter den förra avläsningens mål (eller avläsning, när målet saknas)? */
export function laterRun(previous: NormalizedCardReadout, next: EvaluationReadout): boolean {
  const end = Date.parse(previous.finishPunchedAt ?? previous.readAt);
  if (!Number.isFinite(end)) return false;
  return (next.startPunchedAt !== undefined && Date.parse(next.startPunchedAt) > end) ||
    next.punches.some((punch) => Date.parse(punch.punchedAt) > end);
}

/** Deltagarens senaste avläsning med resultat (avläsningen som resultatet bygger på), eller undefined. */
export async function latestResultReadout(tx: DbExecutor, entryId: string): Promise<Readout | undefined> {
  const [row] = await tx.select({ readout: schema.cardReadouts }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(eq(schema.resultRevisions.entryId, entryId)).orderBy(desc(schema.resultRevisions.revision)).limit(1);
  return row?.readout;
}

/** Senaste avläsning med resultat per deltagare (för omräkning: resultatet följer avläsningen, inte brickan). */
export async function latestResultReadouts(tx: DbExecutor, raceId: string, entryIds: readonly string[]): Promise<Map<string, Readout>> {
  if (entryIds.length === 0) return new Map();
  const rows = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    readout: schema.cardReadouts }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, [...entryIds]),
      isNotNull(schema.resultRevisions.readoutId)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  return new Map(rows.map((row) => [row.entryId, row.readout]));
}

/**
 * Avläsningen som en omräkning utgår från: alltid deltagarens egen (den som resultatet bygger på). Steg 45: tidigare
 * föll omräkningen tillbaka på brickans senaste avläsning när deltagaren saknade eget resultat eller hade bytt bricka, och
 * då kunde en deltagare få någon annans avläsning (lånad bricka). En avläsning blir deltagarens först när den kopplas:
 * vid avläsningen, via "Okända brickor" eller via direktanmälan.
 */
export function recalculationReadout<T>(own: T | undefined): T | undefined {
  return own;
}

/**
 * Deltagaren som brickan är kopplad till, när den redan har ett resultat från en annan avläsning av samma bricka och
 * brickan sedan använts i ett nytt lopp. Annars undefined (ingen deltagare, inget resultat, samma lopp eller annan bricka).
 */
export async function cardAlreadyReadOutBy(tx: DbExecutor, ownerEntryId: string | undefined,
  readout: NormalizedCardReadout): Promise<string | undefined> {
  if (!ownerEntryId) return undefined;
  const latest = await latestResultReadout(tx, ownerEntryId);
  if (!latest || latest.id === readout.id || latest.cardNumber !== readout.cardNumber) return undefined;
  const previous = normalizedReadout(latest);
  return !sameReadoutContent(previous, readout) && laterRun(previous, readout) ? ownerEntryId : undefined;
}
