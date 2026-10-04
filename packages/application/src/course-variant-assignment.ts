import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  classVariantDistributionIdempotencyKeySchema, classVariantDistributionRequestSchema, classVariantDistributionResponseSchema,
  entryVariantIdempotencyKeySchema, entryVariantPreviewRequestSchema, entryVariantPreviewResponseSchema, entryVariantRequestSchema,
  entryVariantResponseSchema, type ClassVariantDistributionResponse, type EntryVariantPreviewResponse, type EntryVariantResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { withProposedEntryVariants, type RaceSnapshot } from "@o-tid/domain";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { loadRaceSnapshot } from "./snapshot";
import { assessReadOutEntries, recalculateAssessedEntries, summarizeAssessment, type AssessedEntry } from "./result-reassessment";
import { classVariantCodes, planVariantDistribution, writeEntryVariants } from "./course-variants";

/**
 * Gafflingar (ADR-0169 beslut 2): byt variant på en löpare och fördela varianter i en
 * klass. Avlästa löpare prövas mot den nya varianten med resultatmotorn och räknas om
 * i samma transaktion (ny revision, historik kvar). Bekräftelse krävs bara när en
 * löpares status ändras.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_VERSION = 2_147_483_647;

async function loadEntry(tx: Transaction, raceId: string, entryId: string, lock: boolean) {
  const query = tx.select({ id: schema.entries.id, classId: schema.entries.classId, version: schema.entries.version,
    code: schema.entries.courseVariantCode, className: schema.classes.name }).from(schema.entries)
    .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId)));
  const [entry] = lock ? await query.for("update", { of: schema.entries }) : await query;
  return entry;
}

type LoadedEntry = NonNullable<Awaited<ReturnType<typeof loadEntry>>>;

/** Prövar löparens avläsning mot den nya varianten. */
async function assessEntry(tx: Transaction, raceId: string, entry: LoadedEntry, snapshot: RaceSnapshot, variantCode: string)
  : Promise<AssessedEntry[] | "too-large"> {
  const proposed = withProposedEntryVariants(snapshot, new Map([[entry.id, variantCode]]));
  const assessed = await assessReadOutEntries(tx, raceId, [{ id: entry.classId, name: entry.className }], snapshot, proposed);
  return assessed === "too-large" ? assessed : assessed.filter(row => row.entryId === entry.id);
}

function previewResponse(raceId: string, entry: LoadedEntry, snapshotVersion: number, variantCode: string,
  assessed: readonly AssessedEntry[]): EntryVariantPreviewResponse {
  return entryVariantPreviewResponseSchema.parse({ formatVersion: 1, raceId, entryId: entry.id, snapshotVersion,
    currentVariantCode: entry.code, variantCode, ...summarizeAssessment(assessed) });
}

export type EntryVariantPreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; response: EntryVariantPreviewResponse };

/** Läser bara: ändras löparens resultat om löparen får varianten? */
export async function previewEntryVariantAsAdministrator(db: Database, input: Authentication & { entryId: string; request: unknown },
  now = new Date()): Promise<EntryVariantPreviewResult> {
  const parsed = entryVariantPreviewRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId) || !uuid.test(input.entryId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForSnapshot(tx, raceId);
    if (race.snapshotVersion !== parsed.data.expectedSnapshotVersion) return { status: "conflict" };
    const entry = await loadEntry(tx, raceId, input.entryId, false);
    if (!entry) return { status: "not-found" };
    if (entry.version !== parsed.data.expectedEntryVersion) return { status: "conflict" };
    const codes = await classVariantCodes(tx, raceId, entry.classId);
    if (!codes.includes(parsed.data.variantCode) || entry.code === parsed.data.variantCode) return { status: "invalid-request" };
    const assessed = await assessEntry(tx, raceId, entry, await loadRaceSnapshot(tx, raceId), parsed.data.variantCode);
    if (assessed === "too-large") return { status: "too-large" };
    return { status: "ok", response: previewResponse(raceId, entry, race.snapshotVersion, parsed.data.variantCode, assessed) };
  }, { isolationLevel: "repeatable read" });
}

export type EntryVariantResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "confirmation-required"; preview: EntryVariantPreviewResponse }
  | { status: "changed"; response: EntryVariantResponse };

async function priorRequest(tx: Transaction, requestId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-variant:" + requestId}, 0))`);
  const [prior] = await tx.select().from(schema.courseVariantAssignmentRequests)
    .where(eq(schema.courseVariantAssignmentRequests.requestId, requestId));
  return prior;
}

/** Byter löparens variant. Kräver `confirmResultChanges` när löparens status ändras; annars sparas direkt. */
export async function changeEntryVariantAsAdministrator(db: Database, input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<EntryVariantResult> {
  const parsed = entryVariantRequestSchema.safeParse(input.request);
  const key = entryVariantIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `entry-variant:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
    return { status: "invalid-request" };
  }
  const intent = parsed.data;
  const authentication = { ...input, capability, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    const prior = await priorRequest(tx, intent.requestId);
    if (prior) {
      if (prior.kind !== "ENTRY") return { status: "conflict" };
      const response = entryVariantResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
          JSON.stringify(response.request) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "changed", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const entry = await loadEntry(tx, raceId, intent.entryId, true);
    if (!entry) return { status: "not-found" };
    if (entry.version !== intent.expectedEntryVersion || entry.version >= MAX_VERSION) return { status: "conflict" };
    const codes = await classVariantCodes(tx, raceId, entry.classId);
    if (!codes.includes(intent.variantCode) || entry.code === intent.variantCode) return { status: "invalid-request" };
    const assessed = await assessEntry(tx, raceId, entry, await loadRaceSnapshot(tx, raceId), intent.variantCode);
    if (assessed === "too-large") return { status: "too-large" };
    const preview = previewResponse(raceId, entry, race.snapshotVersion, intent.variantCode, assessed);
    if (preview.requiresConfirmation && !intent.confirmResultChanges) return { status: "confirmation-required", preview };

    await writeEntryVariants(tx, raceId, new Map([[entry.id, intent.variantCode]]));
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));
    const [courseVersion] = await tx.select({ id: schema.classes.courseVersionId }).from(schema.classes)
      .where(eq(schema.classes.id, entry.classId));
    const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot: await loadRaceSnapshot(tx, raceId),
      snapshotVersion: snapshotVersionAfter, courseVersionId: courseVersion!.id });
    const response = entryVariantResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId, raceId,
      entryId: entry.id, request: intent, previousVariantCode: entry.code, entryVersionAfter: entry.version + 1,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, recalculated, changedAt: now.toISOString() });
    await tx.insert(schema.courseVariantAssignmentRequests).values({ requestId: intent.requestId, raceId, kind: "ENTRY",
      classId: entry.classId, entryId: entry.id, seed: null, actorCredentialId: auth.principal.accessCredentialId, capability,
      request: intent, response, assignedAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "entry", entityId: entry.id, requestId: intent.requestId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, action: "ENTRY_COURSE_VARIANT_CHANGED_BY_ADMIN",
      before: { courseVariantCode: entry.code, entryVersion: entry.version, snapshotVersion: race.snapshotVersion },
      after: { courseVariantCode: intent.variantCode, entryVersion: entry.version + 1, snapshotVersion: snapshotVersionAfter,
        recalculatedCount: recalculated.length }, createdAt: now });
    return { status: "changed", response };
  });
}

function randomSeed(): number {
  let seed = 0;
  while (seed === 0) seed = randomBytes(4).readUInt32BE(0);
  return seed;
}

export type ClassVariantDistributionResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" | "too-large" }
  | { status: "distributed"; response: ClassVariantDistributionResponse };

/**
 * "Fördela gafflingar": löpare i klassen som saknar variant får en. Avlästa löpare får
 * varianten som stämplingarna passar (resultatet ändras inte, men räknas om med varianten);
 * övriga fördelas jämnt med ett lottat frö som sparas men aldrig visas.
 */
export async function distributeClassVariantsAsAdministrator(db: Database,
  input: Authentication & { idempotencyKey: string | null; request: unknown }, now = new Date()): Promise<ClassVariantDistributionResult> {
  const parsed = classVariantDistributionRequestSchema.safeParse(input.request);
  const key = classVariantDistributionIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `variant-distribution:${parsed.data.requestId}` || !uuid.test(input.raceId)) {
    return { status: "invalid-request" };
  }
  const intent = parsed.data;
  const authentication = { ...input, capability, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const race = await lockRaceForMutation(tx, raceId);
    const prior = await priorRequest(tx, intent.requestId);
    if (prior) {
      if (prior.kind !== "CLASS") return { status: "conflict" };
      const response = classVariantDistributionResponseSchema.parse(prior.response);
      if (prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId ||
          JSON.stringify(response.request) !== JSON.stringify(intent)) return { status: "conflict" };
      return { status: "distributed", response: { ...response, replayed: true } };
    }
    if (race.snapshotVersion !== intent.expectedSnapshotVersion || race.snapshotVersion >= MAX_VERSION) return { status: "conflict" };
    const [raceClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name, courseVersionId: schema.classes.courseVersionId })
      .from(schema.classes).where(and(eq(schema.classes.id, intent.classId), eq(schema.classes.raceId, raceId)));
    if (!raceClass) return { status: "not-found" };
    if ((await classVariantCodes(tx, raceId, raceClass.id)).length === 0) return { status: "invalid-request" };
    await tx.select({ id: schema.entries.id }).from(schema.entries).where(and(eq(schema.entries.raceId, raceId),
      eq(schema.entries.classId, raceClass.id))).orderBy(asc(schema.entries.id)).for("update");
    const seed = randomSeed();
    const snapshot = await loadRaceSnapshot(tx, raceId);
    const planned = await planVariantDistribution(tx, raceId, [raceClass.id], seed, snapshot);
    if (planned.size === 0) return { status: "conflict" };
    const assessedAll = await assessReadOutEntries(tx, raceId, [raceClass], snapshot, withProposedEntryVariants(snapshot, planned));
    if (assessedAll === "too-large") return { status: "too-large" };
    const assessed = assessedAll.filter(row => planned.has(row.entryId));
    // Avlästa löpare får sin stämplade variant: bedömningen blir densamma, så ingen bekräftelse behövs.
    await writeEntryVariants(tx, raceId, planned);
    const snapshotVersionAfter = race.snapshotVersion + 1;
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, raceId));
    const recalculated = await recalculateAssessedEntries(tx, { raceId, assessed, snapshot: await loadRaceSnapshot(tx, raceId),
      snapshotVersion: snapshotVersionAfter, courseVersionId: raceClass.courseVersionId });
    const response = classVariantDistributionResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId,
      raceId, classId: raceClass.id, request: intent, assignedCount: planned.size, recalculatedCount: recalculated.length,
      snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, distributedAt: now.toISOString() });
    await tx.insert(schema.courseVariantAssignmentRequests).values({ requestId: intent.requestId, raceId, kind: "CLASS",
      classId: raceClass.id, entryId: null, seed, actorCredentialId: auth.principal.accessCredentialId, capability,
      request: intent, response, assignedAt: now });
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "class", entityId: raceClass.id, requestId: intent.requestId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, action: "CLASS_COURSE_VARIANTS_DISTRIBUTED_BY_ADMIN",
      before: { snapshotVersion: race.snapshotVersion },
      after: { snapshotVersion: snapshotVersionAfter, assignedCount: planned.size, recalculatedCount: recalculated.length }, createdAt: now });
    return { status: "distributed", response };
  });
}
