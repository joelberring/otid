import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { raceDateMovePreviewRequestSchema, raceDateMovePreviewResponseSchema, type RaceDateMoveBlock,
  type RaceDateMovePreviewResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { moveToRaceDate } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForSnapshot } from "./concurrency";
import type { DbExecutor } from "./snapshot";
import { loadDrawPlans } from "./start-draw-basis";
import { UUID_PATTERN as uuid } from "./serialization";

/**
 * ADR-0188 beslut 3: tävlingen flyttas till ett annat datum efter lottningen. Alla starttider (löparnas fasta tider,
 * lottningarnas tider och stafettsträckornas masstart och omstart) får samma klockslag på det nya datumet. Det går bara
 * så länge ingen har läst ut, stämplat på en radiokontroll, checkats in vid starten eller fått ett resultat; då hör tiderna
 * till en tävling som redan har börjat. Förhandsvisningen läser bara; flytten görs av Inställningar i samma transaktion som
 * det nya datumet och skrivs i journalen. Lottningarna är oföränderliga: varje gällande lottning får en ny lottningspost
 * med samma klasser, ordning och vakanser på det nya datumet, och klasserna pekar på den. Den gamla står kvar som historik.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const MAX_VERSION = 2_147_483_647;

export type RaceDateMovePlan = {
  fromDate: string; toDate: string; timeZone: string;
  entries: { id: string; version: number; before: Date; after: Date }[];
  /** Klassernas gällande lottningar (klassen pekar på dem), med tiderna flyttade. */
  drawClasses: { drawId: string; classId: string; method: "MINUTE" | "MASS"; intervalSeconds: number; vacancyCount: number;
    before: Date; after: Date; slots: { position: number; entryId: string | null; before: Date; after: Date }[] }[];
  relayLegs: { classId: string; leg: number; before: Date; after: Date }[];
  blocked: RaceDateMoveBlock[];
  startListPublished: boolean;
};

/** Spärrarna: något har redan hänt på tävlingen. */
async function moveBlocks(tx: DbExecutor, raceId: string): Promise<RaceDateMoveBlock[]> {
  const exists = async (query: PromiseLike<unknown[]>) => (await query).length > 0;
  const blocks: RaceDateMoveBlock[] = [];
  if (await exists(tx.select({ id: schema.cardReadouts.id }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)).limit(1))) blocks.push("READOUTS");
  if (await exists(tx.select({ id: schema.radioPunches.id }).from(schema.radioPunches).where(eq(schema.radioPunches.raceId, raceId)).limit(1))) blocks.push("PUNCHES");
  if (await exists(tx.select({ id: schema.startCheckinOperations.requestId }).from(schema.startCheckinOperations)
    .where(eq(schema.startCheckinOperations.raceId, raceId)).limit(1))) blocks.push("CHECKINS");
  if (await exists(tx.select({ id: schema.resultRevisions.id }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)).limit(1))) blocks.push("RESULTS");
  return blocks;
}

/** Vad som flyttas från `fromDate` till `toDate`. Kastar om en tid inte går att flytta (ogiltigt datum). */
export async function planRaceDateMove(tx: DbExecutor, raceId: string, fromDate: string, toDate: string, timeZone: string): Promise<RaceDateMovePlan> {
  const move = (instant: Date) => {
    const moved = moveToRaceDate(instant, fromDate, toDate, timeZone);
    if (!moved) throw new Error("Starttiden kunde inte flyttas");
    return moved;
  };
  const entries = await tx.select({ id: schema.entries.id, version: schema.entries.version, fixedStartTime: schema.entries.fixedStartTime })
    .from(schema.entries).where(and(eq(schema.entries.raceId, raceId), isNotNull(schema.entries.fixedStartTime)));
  const classes = await tx.select({ id: schema.classes.id, startDrawId: schema.classes.startDrawId }).from(schema.classes)
    .where(and(eq(schema.classes.raceId, raceId), isNotNull(schema.classes.startDrawId)));
  const plans = [...(await loadDrawPlans(tx, classes)).values()];
  const relayLegs = await tx.select({ classId: schema.relayLegs.classId, leg: schema.relayLegs.leg, startTime: schema.relayLegs.startTime })
    .from(schema.relayLegs).where(and(eq(schema.relayLegs.raceId, raceId), isNotNull(schema.relayLegs.startTime)));
  const [publication] = await tx.select({ action: schema.startListPublications.action }).from(schema.startListPublications)
    .where(eq(schema.startListPublications.raceId, raceId)).orderBy(desc(schema.startListPublications.revision)).limit(1);
  return { fromDate, toDate, timeZone,
    entries: entries.map(row => ({ id: row.id, version: row.version, before: row.fixedStartTime!, after: move(row.fixedStartTime!) })),
    drawClasses: plans.map(plan => ({ drawId: plan.drawId, classId: plan.classId, method: plan.method, intervalSeconds: plan.intervalSeconds,
      vacancyCount: plan.vacancyCount, before: plan.firstStartTime, after: move(plan.firstStartTime),
      slots: plan.slots.map(slot => ({ position: slot.position, entryId: slot.entryId, before: slot.startTime, after: move(slot.startTime) })) })),
    relayLegs: relayLegs.map(row => ({ classId: row.classId, leg: row.leg, before: row.startTime!, after: move(row.startTime!) })),
    blocked: await moveBlocks(tx, raceId), startListPublished: publication?.action === "PUBLISH" };
}

/** Något att flytta? Utan starttider ändras bara datumet, som förut. */
export function hasStartTimes(plan: RaceDateMovePlan): boolean {
  return plan.entries.length + plan.drawClasses.length + plan.relayLegs.length > 0;
}

/**
 * Skriver flytten (anroparen håller tävlingens skrivlås och har kontrollerat spärrarna) och en journalpost per löpare
 * och en för hela flytten. Löparnas version ökar, så att öppna formulär och avläsningspaket läser om.
 */
export async function applyRaceDateMove(tx: Transaction, input: { raceId: string; plan: RaceDateMovePlan; requestId: string;
  actorAccountId: string; snapshotVersionBefore: number; now: Date }): Promise<void> {
  const { raceId, plan, now } = input;
  if (plan.entries.some(row => row.version >= MAX_VERSION)) throw new Error("Deltagarens version är slut");
  for (const row of plan.entries) {
    const [updated] = await tx.update(schema.entries).set({ fixedStartTime: row.after, version: row.version + 1 })
      .where(and(eq(schema.entries.id, row.id), eq(schema.entries.raceId, raceId), eq(schema.entries.version, row.version)))
      .returning({ id: schema.entries.id });
    if (!updated) throw new Error("Deltagaren ändrades under flytten");
  }
  // En ny lottningspost per gällande lottning (posterna är oföränderliga).
  const drawIds = [...new Set(plan.drawClasses.map(row => row.drawId))];
  const originals = drawIds.length === 0 ? [] : await tx.select({ id: schema.startDrawRequests.id, seed: schema.startDrawRequests.seed })
    .from(schema.startDrawRequests).where(and(inArray(schema.startDrawRequests.id, drawIds), eq(schema.startDrawRequests.raceId, raceId)));
  for (const original of originals) {
    const rows = plan.drawClasses.filter(row => row.drawId === original.id);
    const record = { kind: "RACE_DATE_MOVE", movedFromDrawId: original.id, fromDate: plan.fromDate, toDate: plan.toDate,
      settingsRequestId: input.requestId, classIds: rows.map(row => row.classId) };
    const [saved] = await tx.insert(schema.startDrawRequests).values({ requestId: randomUUID(), raceId, actorAccountId: input.actorAccountId,
      seed: original.seed, request: record, response: record, snapshotVersionBefore: input.snapshotVersionBefore,
      snapshotVersionAfter: input.snapshotVersionBefore + 1, drawnAt: now }).returning({ id: schema.startDrawRequests.id });
    if (!saved) throw new Error("Lottningen kunde inte flyttas");
    for (const row of rows) {
      await tx.insert(schema.startDrawClasses).values({ drawId: saved.id, raceId, classId: row.classId, method: row.method,
        firstStartTime: row.after, intervalSeconds: row.intervalSeconds, vacancyCount: row.vacancyCount });
      const slots = row.slots.map(slot => ({ drawId: saved.id, classId: row.classId, position: slot.position, startTime: slot.after, entryId: slot.entryId }));
      for (let offset = 0; offset < slots.length; offset += 1_000) await tx.insert(schema.startDrawSlots).values(slots.slice(offset, offset + 1_000));
      await tx.update(schema.classes).set({ startDrawId: saved.id }).where(and(eq(schema.classes.id, row.classId), eq(schema.classes.raceId, raceId)));
    }
  }
  for (const row of plan.relayLegs) {
    await tx.update(schema.relayLegs).set({ startTime: row.after })
      .where(and(eq(schema.relayLegs.classId, row.classId), eq(schema.relayLegs.raceId, raceId), eq(schema.relayLegs.leg, row.leg)));
  }
  const actor = { actorKind: "USER_ACCOUNT" as const, actorId: input.actorAccountId, requestId: input.requestId, createdAt: now };
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_DATE_MOVED_WITH_START_TIMES", ...actor,
    before: { raceDate: plan.fromDate }, after: { raceDate: plan.toDate, timeZone: plan.timeZone, startTimeCount: plan.entries.length,
      drawClassCount: plan.drawClasses.length, drawSlotCount: plan.drawClasses.reduce((sum, row) => sum + row.slots.length, 0),
      relayLegCount: plan.relayLegs.length } });
  const rows = plan.entries.map(row => ({ raceId, entityType: "entry", entityId: row.id, action: "ENTRY_START_TIME_MOVED_WITH_RACE_DATE", ...actor,
    before: { fixedStartTime: row.before.toISOString(), version: row.version },
    after: { fixedStartTime: row.after.toISOString(), version: row.version + 1 } }));
  for (let offset = 0; offset < rows.length; offset += 1_000) await tx.insert(schema.auditEvents).values(rows.slice(offset, offset + 1_000));
}

const iso = (value: Date | undefined) => value ? value.toISOString() : null;
function span(values: readonly Date[]) {
  const sorted = [...values].sort((a, b) => a.getTime() - b.getTime());
  return { first: sorted[0], last: sorted.at(-1) };
}

export type RaceDateMovePreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "ok"; response: RaceDateMovePreviewResponse };

/** Förhandsvisningen under Inställningar: vad som flyttas och om något spärrar. Läser bara. */
export async function previewRaceDateMoveAsAdmin(db: Database, input: RaceSessionProof & { request: unknown },
  now = new Date()): Promise<RaceDateMovePreviewResult> {
  const parsed = raceDateMovePreviewRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    const [row] = await tx.select({ raceDate: schema.races.raceDate, timeZone: schema.events.timeZone }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
    if (!row) return { status: "not-found" as const };
    const plan = await planRaceDateMove(tx, raceId, row.raceDate, parsed.data.raceDate, row.timeZone);
    const times = [...plan.entries, ...plan.drawClasses.flatMap(row => row.slots), ...plan.relayLegs];
    const before = span(times.map(time => time.before)), after = span(times.map(time => time.after));
    return { status: "ok" as const, response: raceDateMovePreviewResponseSchema.parse({ formatVersion: 1, raceId,
      snapshotVersion: race.snapshotVersion, fromDate: plan.fromDate, toDate: plan.toDate, timeZone: plan.timeZone,
      startTimeCount: plan.entries.length, drawClassCount: plan.drawClasses.length, relayLegCount: plan.relayLegs.length,
      firstBefore: iso(before.first), lastBefore: iso(before.last), firstAfter: iso(after.first), lastAfter: iso(after.last),
      startListPublished: plan.startListPublished, blocked: plan.blocked }) };
  }, { isolationLevel: "repeatable read" });
}
