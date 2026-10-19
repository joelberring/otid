import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  readoutRegistrationIdempotencyKeySchema, readoutRegistrationRequestSchema, readoutRegistrationResponseSchema,
  type ReadoutRegistrationResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { courseVariantForReadout, withProposedEntryVariants } from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation } from "./concurrency";
import { canAddClassEntry } from "./class-capacity-guard";
import { bumpReadoutPackageVersion, loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { evaluateAndStore, normalizedReadout } from "./result-revisions";

/**
 * PLAN.md steg 25: direktanmälan av en okänd bricka från avläsningssidan, även offline (köad i webbläsaren).
 *
 * - Brickan har redan en aktiv koppling (anmäld någon annanstans under tiden): ingen ny deltagare; svaret säger vem
 *   brickan hör till (EXISTING). Annars skapas deltagaren och brickkopplingen (CREATED). En stafettklass eller en full
 *   klass avvisas.
 * - Ordningen mot avläsningen spelar ingen roll: kommer avläsningen efter anmälan bedöms den som vanligt när den tas
 *   emot. Har servern redan avläsningen som okänd bricka bedöms den senaste sådana här, mot deltagaren, om deltagaren
 *   inte redan har ett resultat från en senare avläsning.
 * - Idempotent på begärans id: samma begäran ger samma kvitto. Journalen (`readout_registration`) skrivs aldrig om.
 */
type Authentication = RaceSessionProof;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type ReadoutRegistrationResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "registered"; response: ReadoutRegistrationResponse };

/** Den senaste avläsningen av brickan som togs emot som okänd och ännu inte gett något resultat. */
async function latestUnresolvedReadout(tx: Transaction, raceId: string, cardNumber: string) {
  const [row] = await tx.select({ readout: schema.cardReadouts }).from(schema.cardReadouts)
    .innerJoin(schema.deviceIngestOutcomes, eq(schema.deviceIngestOutcomes.rawMessageId, schema.cardReadouts.rawMessageId))
    .leftJoin(schema.resultRevisions, eq(schema.resultRevisions.readoutId, schema.cardReadouts.id))
    .leftJoin(schema.unknownReadoutResolutions, eq(schema.unknownReadoutResolutions.readoutId, schema.cardReadouts.id))
    .where(and(eq(schema.cardReadouts.raceId, raceId), eq(schema.cardReadouts.cardNumber, cardNumber),
      sql`${schema.deviceIngestOutcomes.serverResult}->>'status' = 'UNKNOWN_CARD'`, isNull(schema.resultRevisions.id),
      isNull(schema.unknownReadoutResolutions.requestId)))
    .orderBy(desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)).limit(1);
  return row?.readout;
}

/** Läsningstiden för deltagarens senaste avläsning med resultat, eller null. */
async function latestResultReadAt(tx: DbExecutor, entryId: string): Promise<Date | null> {
  const [row] = await tx.select({ readAt: schema.cardReadouts.readAt }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(eq(schema.resultRevisions.entryId, entryId)).orderBy(desc(schema.cardReadouts.readAt)).limit(1);
  return row?.readAt ?? null;
}

export async function registerReadoutCard(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<ReadoutRegistrationResult> {
  const parsed = readoutRegistrationRequestSchema.safeParse(input.request);
  const key = readoutRegistrationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `readout-registration:${parsed.data.requestId}`) return { status: "invalid-request" };
  const intent = parsed.data;
  const registeredAt = new Date(now);
  if (!Number.isFinite(registeredAt.getTime())) throw new Error("Anmälningstiden är ogiltig");
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY", requireCsrf: true }, registeredAt, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"readout-registration:" + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.readoutRegistrations).where(eq(schema.readoutRegistrations.requestId, intent.requestId));
    if (prior) {
      if (prior.raceId !== raceId || prior.actorAccountId !== auth.principal.accountId ||
        JSON.stringify(readoutRegistrationRequestSchema.parse(prior.request)) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "registered", response: readoutRegistrationResponseSchema.parse({ ...prior.response, replayed: true }) };
    }
    await lockRaceForMutation(tx, raceId);
    const [raceClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
      .where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, raceId)));
    if (!raceClass) return { status: "not-found" };

    const [owner] = await tx.select({ entryId: schema.cardAssignments.entryId }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, intent.cardNumber),
        eq(schema.cardAssignments.active, true))).limit(1);
    let entry: { id: string; givenName: string; familyName: string; classId: string };
    let outcome: "CREATED" | "EXISTING";
    if (owner) {
      // Anmäld någon annanstans under tiden: den deltagaren gäller, ingen ny deltagare skapas.
      const [existing] = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
        classId: schema.entries.classId }).from(schema.entries).where(and(eq(schema.entries.id, owner.entryId), eq(schema.entries.raceId, raceId)))
        .for("update");
      if (!existing) throw new Error("Brickans deltagare saknas");
      entry = existing; outcome = "EXISTING";
    } else {
      if (!await canAddClassEntry(tx, raceId, intent.classId)) return { status: "conflict" };
      const [total] = await tx.select({ value: count() }).from(schema.entries).where(eq(schema.entries.raceId, raceId));
      if (!total || total.value >= 10_000) return { status: "conflict" };
      const [created] = await tx.insert(schema.entries).values({ raceId, classId: intent.classId, givenName: intent.givenName,
        familyName: intent.familyName, organisationName: intent.organisationName, version: 1 })
        .returning({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName, classId: schema.entries.classId });
      if (!created) throw new Error("Deltagaren kunde inte sparas");
      await tx.insert(schema.cardAssignments).values({ raceId, entryId: created.id, cardNumber: intent.cardNumber });
      entry = created; outcome = "CREATED";
    }
    await bumpReadoutPackageVersion(tx, raceId);

    // Har servern redan brickans avläsning som okänd bedöms den nu, om den är nyare än deltagarens senaste resultat.
    let linkedResult: { status: "OK" | "OVERTIME" | "MP"; revision: number } | null = null;
    const readout = await latestUnresolvedReadout(tx, raceId, intent.cardNumber);
    const latestReadAt = readout ? await latestResultReadAt(tx, entry.id) : null;
    if (readout && (latestReadAt === null || latestReadAt < readout.readAt)) {
      let snapshot = await loadRaceSnapshot(tx, raceId);
      const normalized = normalizedReadout(readout);
      // Direktanmäld i en gafflad klass har redan sprungit: den får varianten som stämplingarna passar.
      const detected = outcome === "CREATED" ? courseVariantForReadout(normalized, snapshot) : undefined;
      if (detected && !detected.assigned) {
        await tx.update(schema.entries).set({ courseVariantCode: detected.code }).where(eq(schema.entries.id, entry.id));
        snapshot = withProposedEntryVariants(snapshot, new Map([[entry.id, detected.code]]));
      }
      const stored = await evaluateAndStore(tx, snapshot, normalized, "UNKNOWN_READOUT_RESOLUTION",
        { entryId: entry.id, actorAccountId: auth.principal.accountId });
      if (stored.stored && stored.evaluation.status !== "UNKNOWN_CARD") {
        linkedResult = { status: stored.evaluation.status, revision: stored.revision.revision };
      }
    }
    const [className] = outcome === "EXISTING" ? await tx.select({ name: schema.classes.name }).from(schema.classes)
      .where(eq(schema.classes.id, entry.classId)) : [raceClass];
    const response = readoutRegistrationResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      cardNumber: intent.cardNumber, outcome, entryId: entry.id, entryName: `${entry.givenName} ${entry.familyName}`,
      className: className?.name ?? raceClass.name, linkedResult, registeredAt: registeredAt.toISOString() });
    await tx.insert(schema.readoutRegistrations).values({ requestId: intent.requestId, raceId, cardNumber: intent.cardNumber,
      classId: intent.classId, givenName: intent.givenName, familyName: intent.familyName, organisationName: intent.organisationName,
      outcome, entryId: entry.id, actorAccountId: auth.principal.accountId, request: intent, response, createdAt: registeredAt });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "entry", entityId: entry.id, requestId: intent.requestId,
      action: outcome === "CREATED" ? "READOUT_CARD_REGISTERED" : "READOUT_CARD_ALREADY_REGISTERED", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, before: null,
      after: { cardNumber: intent.cardNumber, classId: entry.classId, outcome, linkedRevision: linkedResult?.revision ?? null },
      createdAt: registeredAt });
    return { status: "registered", response };
  });
}

/** Avläsningar som redan har ett resultat räknas inte som okända (direktanmälan kopplar utan resolutionsjournal). */
export async function readoutsWithResults(tx: DbExecutor, readoutIds: readonly string[]): Promise<Set<string>> {
  if (readoutIds.length === 0) return new Set();
  const rows = await tx.selectDistinct({ readoutId: schema.resultRevisions.readoutId }).from(schema.resultRevisions)
    .where(inArray(schema.resultRevisions.readoutId, [...readoutIds])).orderBy(asc(schema.resultRevisions.readoutId));
  return new Set(rows.flatMap((row) => row.readoutId ? [row.readoutId] : []));
}
