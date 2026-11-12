import { and, desc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { evaluateAndStore, normalizedReadout } from "./result-revisions";
import { latestResultReadAt, latestUnresolvedReadout } from "./readout-lookup";
import { useFittingVariant } from "./readout-link-variant";

/**
 * Regler för brickkopplingar (översynen 2026-11-02). Samlade här så att Byt bricka, Ny deltagare, direktanmälan vid
 * avläsningen, filimporten och synken från Eventor/banfilen gör likadant:
 *
 * 1. En bricka är aktiv hos högst en deltagare (databasens unika index). Är den aktiv hos någon annan avvisas kopplingen
 *    (`CardInUseError`) – utom när två löpare byter brickor med varandra (`swapCards`).
 * 2. En inaktiv koppling är historik. Den hindrar aldrig att brickan ges till en annan deltagare: två löpare som bytt
 *    brickor, eller en hyrbricka som lämnats tillbaka, ska gå att rätta.
 * 3. Deltagarens tidigare aktiva koppling släpps (blir inaktiv historik). Har deltagaren haft samma bricka förut återanvänds
 *    den kopplingen.
 * 4. Har servern redan en avläsning av brickan som togs emot som okänd (och ännu inte gett något resultat) kopplas den
 *    till deltagaren och bedöms, om den är nyare än deltagarens senaste resultat (`linkUnresolvedReadout`).
 */
export class CardInUseError extends Error {
  constructor(readonly holder: CardHolder) { super("Brickan är aktiv hos en annan deltagare"); }
}

export interface CardHolder { readonly assignmentId: string; readonly entryId: string; readonly cardNumber: string }

/** Deltagaren som brickan är aktiv hos, eller undefined. */
export async function activeCardHolder(tx: DbExecutor, raceId: string, cardNumber: string): Promise<CardHolder | undefined> {
  const [row] = await tx.select({ assignmentId: schema.cardAssignments.id, entryId: schema.cardAssignments.entryId,
    cardNumber: schema.cardAssignments.cardNumber }).from(schema.cardAssignments)
    .where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, cardNumber),
      eq(schema.cardAssignments.active, true))).limit(1);
  return row;
}

export interface AssignedCard {
  readonly assignmentId: string;
  /** Kopplingar som släpptes (deltagarens tidigare aktiva bricka). */
  readonly released: readonly { readonly id: string; readonly cardNumber: string }[];
  /** Brickan var redan aktiv hos deltagaren; inget ändrades. */
  readonly unchanged: boolean;
}

/**
 * Ger brickan till deltagaren enligt reglerna ovan. `releaseCurrent: false` när anroparen redan släppt de brickor som byts
 * (synken släpper alla först så att två löpare kan byta med varandra).
 */
export async function assignCard(tx: DbExecutor, input: { raceId: string; entryId: string; cardNumber: string; releaseCurrent?: boolean }):
  Promise<AssignedCard> {
  const holder = await activeCardHolder(tx, input.raceId, input.cardNumber);
  if (holder && holder.entryId !== input.entryId) throw new CardInUseError(holder);
  if (holder) return { assignmentId: holder.assignmentId, released: [], unchanged: true };
  const released = input.releaseCurrent === false ? [] : await tx.update(schema.cardAssignments).set({ active: false })
    .where(and(eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.entryId, input.entryId),
      eq(schema.cardAssignments.active, true)))
    .returning({ id: schema.cardAssignments.id, cardNumber: schema.cardAssignments.cardNumber });
  const [own] = await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments)
    .where(and(eq(schema.cardAssignments.raceId, input.raceId), eq(schema.cardAssignments.entryId, input.entryId),
      eq(schema.cardAssignments.cardNumber, input.cardNumber)))
    .orderBy(desc(schema.cardAssignments.createdAt), desc(schema.cardAssignments.id)).limit(1);
  if (own) {
    await tx.update(schema.cardAssignments).set({ active: true }).where(eq(schema.cardAssignments.id, own.id));
    return { assignmentId: own.id, released, unchanged: false };
  }
  const [created] = await tx.insert(schema.cardAssignments).values({ raceId: input.raceId, entryId: input.entryId,
    cardNumber: input.cardNumber }).returning({ id: schema.cardAssignments.id });
  if (!created) throw new Error("Brickkopplingen kunde inte sparas");
  return { assignmentId: created.id, released, unchanged: false };
}

export interface LinkedReadout {
  readonly entryId: string;
  readonly readoutId: string;
  readonly cardNumber: string;
  readonly readAt: string;
  readonly status: "OK" | "OVERTIME" | "MP";
  readonly revision: number;
}

/**
 * Regel 4: kopplar brickans okända avläsning till deltagaren och räknar fram resultatet (ny revision, orsak
 * UNKNOWN_READOUT_RESOLUTION). Gäller bara när brickan nu är aktiv hos deltagaren och avläsningen är nyare än deltagarens
 * senaste resultat (`force` hoppar över tidskravet). `detectVariant`: deltagaren är ny i en gafflad klass och får varianten
 * som stämplingarna passar. Stafettlöpare hoppas över (stafetten har egen koppling). Ger null om inget kopplades.
 */
export async function linkUnresolvedReadout(tx: DbExecutor, input: { raceId: string; entryId: string; cardNumber: string;
  actorAccountId: string | null; detectVariant?: boolean; force?: boolean }): Promise<LinkedReadout | null> {
  const readout = await latestUnresolvedReadout(tx, input.raceId, input.cardNumber);
  if (!readout) return null;
  const [entry] = await tx.select({ teamId: schema.entries.teamId }).from(schema.entries)
    .where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId)));
  if (!entry || entry.teamId !== null) return null;
  const holder = await activeCardHolder(tx, input.raceId, input.cardNumber);
  if (holder?.entryId !== input.entryId) return null;
  const latestReadAt = await latestResultReadAt(tx, input.entryId);
  if (!input.force && latestReadAt !== null && latestReadAt >= readout.readAt) return null;
  const loaded = await loadRaceSnapshot(tx, input.raceId);
  const normalized = normalizedReadout(readout);
  // Ny deltagare i en gafflad klass som redan har sprungit: den får varianten som stämplingarna passar, även om anmälan
  // redan gav den minst använda varianten.
  const snapshot = input.detectVariant ? await useFittingVariant(tx, loaded, normalized, input.entryId) : loaded;
  const stored = await evaluateAndStore(tx, snapshot, normalized, "UNKNOWN_READOUT_RESOLUTION",
    { entryId: input.entryId, actorAccountId: input.actorAccountId });
  if (!stored.stored || stored.evaluation.status === "UNKNOWN_CARD") return null;
  return { entryId: input.entryId, readoutId: readout.id, cardNumber: input.cardNumber, readAt: readout.readAt.toISOString(),
    status: stored.evaluation.status, revision: stored.revision.revision };
}

/** Kopplar okända avläsningar för flera nya kopplingar (importen). Anroparen höjer paketversionen. */
export async function linkUnresolvedReadouts(tx: DbExecutor, raceId: string, links: readonly { entryId: string; cardNumber: string;
  detectVariant?: boolean }[], actorAccountId: string | null): Promise<LinkedReadout[]> {
  const linked: LinkedReadout[] = [];
  for (const link of links) {
    const result = await linkUnresolvedReadout(tx, { raceId, ...link, actorAccountId });
    if (result) linked.push(result);
  }
  return linked;
}
