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
 * Avläsningen som en omräkning utgår från: deltagarens egen (den som resultatet bygger på) så länge brickan inte bytts
 * sedan dess. Annars brickans senaste avläsning, men bara om ingen annan deltagares resultat bygger på den (en okänd
 * avläsning som ingen har kopplats till, till exempel när brickan anmäls eller byts efter avläsningen). Steg 45: tidigare
 * togs brickans senaste avläsning även när den var någon annans (lånad bricka), och deltagaren fick den andres resultat.
 * Utan egen och utan ledig avläsning blir det ingen (NO_READOUT).
 */
export function recalculationReadout<T extends { readonly id: string; readonly cardNumber: string }>(entryId: string, own: T | undefined,
  activeCard: string | undefined, latestByCard: T | undefined, claims: ReadonlyMap<string, ReadonlySet<string>>): T | undefined {
  if (own && (activeCard === undefined || own.cardNumber === activeCard)) return own;
  const claimedByOther = latestByCard !== undefined && [...claims.get(latestByCard.id) ?? []].some((owner) => owner !== entryId);
  if (latestByCard && !claimedByOther) return latestByCard;
  return own;
}

/** Vilka deltagares resultatrevisioner som bygger på var och en av avläsningarna. */
export async function readoutClaims(tx: DbExecutor, raceId: string, readoutIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const ids = [...new Set(readoutIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx.selectDistinct({ readoutId: schema.resultRevisions.readoutId, entryId: schema.resultRevisions.entryId })
    .from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.readoutId, ids)));
  const claims = new Map<string, Set<string>>();
  for (const row of rows) if (row.readoutId) claims.set(row.readoutId, new Set([...claims.get(row.readoutId) ?? [], row.entryId]));
  return claims;
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
