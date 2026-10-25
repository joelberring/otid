import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  selfRegistrationCleanupIdempotencyKeySchema, selfRegistrationCleanupPreviewSchema, selfRegistrationCleanupRequestSchema,
  selfRegistrationCleanupResponseSchema, type SelfRegistrationCleanupPreview, type SelfRegistrationCleanupResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { bumpReadoutPackageVersion, type DbExecutor } from "./snapshot";

/**
 * PLAN.md steg 46: stryk självregistrerade deltagare som inte läst ut. En kandidat är självregistrerad (publika
 * formuläret), inte struken och saknar resultatrevision (ingen avläsning och inget beslut). Att stryka är samma som
 * "Stryk" på deltagarkortet: dold i alla listor och brickan släpps; inget tas bort. En auditpost per deltagare och en för
 * åtgärden, med begärans id, så att samma begäran igen inte stryker något nytt.
 */
async function candidates(tx: DbExecutor, raceId: string): Promise<SelfRegistrationCleanupPreview["entries"]> {
  const rows = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    organisationName: schema.entries.organisationName, className: schema.classes.name, selfRegisteredAt: schema.entries.selfRegisteredAt })
    .from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt), isNotNull(schema.entries.selfRegisteredAt),
      isNull(schema.entries.teamId)))
    .orderBy(asc(schema.entries.selfRegisteredAt), asc(schema.entries.id)).limit(10_001);
  if (rows.length > 10_000) throw new Error("För många självregistrerade");
  const withResult = new Set((await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions)
    .where(eq(schema.resultRevisions.raceId, raceId))).map(row => row.entryId));
  const cards = new Map((await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
    .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.active, true))))
    .map(row => [row.entryId, row.cardNumber]));
  return rows.filter(row => !withResult.has(row.id)).map(row => ({ entryId: row.id, name: `${row.givenName} ${row.familyName}`,
    className: row.className, organisationName: row.organisationName, cardNumber: cards.get(row.id) ?? null,
    selfRegisteredAt: row.selfRegisteredAt!.toISOString() }));
}

export type SelfRegistrationCleanupPreviewResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" }
  | { status: "ok"; response: SelfRegistrationCleanupPreview };

export async function previewSelfRegistrationCleanupAsAdmin(db: Database, input: RaceSessionProof, now = new Date()):
  Promise<SelfRegistrationCleanupPreviewResult> {
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    await lockRaceForSnapshot(tx, auth.principal.raceId);
    return { status: "ok", response: selfRegistrationCleanupPreviewSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId,
      entries: await candidates(tx, auth.principal.raceId) }) };
  }, { isolationLevel: "repeatable read" });
}

export type SelfRegistrationCleanupResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" }
  | { status: "saved"; response: SelfRegistrationCleanupResponse };

export async function strikeSelfRegisteredAsAdmin(db: Database, input: RaceSessionProof & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<SelfRegistrationCleanupResult> {
  const parsed = selfRegistrationCleanupRequestSchema.safeParse(input.request);
  const key = selfRegistrationCleanupIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `self-registration-cleanup:${parsed.data.requestId}`) return { status: "invalid-request" };
  const intent = parsed.data;
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    const earlier = await tx.select({ entityId: schema.auditEvents.entityId }).from(schema.auditEvents)
      .where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.requestId, intent.requestId),
        eq(schema.auditEvents.action, "ENTRY_STRUCK_BY_ADMIN"), inArray(schema.auditEvents.entityId, intent.entryIds)));
    const done = new Set(earlier.map(row => row.entityId));
    const open = new Set((await candidates(tx, raceId)).map(row => row.entryId));
    const struck: string[] = [];
    let skippedCount = 0, created = 0;
    for (const entryId of intent.entryIds) {
      if (done.has(entryId)) { struck.push(entryId); continue; }
      if (!open.has(entryId)) { skippedCount += 1; continue; }
      const [entry] = await tx.select().from(schema.entries).where(eq(schema.entries.id, entryId)).for("update");
      await tx.update(schema.entries).set({ struckAt: now, version: entry!.version + 1 }).where(eq(schema.entries.id, entryId));
      await tx.update(schema.cardAssignments).set({ active: false })
        .where(and(eq(schema.cardAssignments.entryId, entryId), eq(schema.cardAssignments.active, true)));
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "entry", entityId: entryId, action: "ENTRY_STRUCK_BY_ADMIN",
        actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, requestId: intent.requestId,
        before: { givenName: entry!.givenName, familyName: entry!.familyName, classId: entry!.classId, version: entry!.version,
          selfRegistered: true }, after: { outcome: "STRUCK", source: "SELF_REGISTRATION_CLEANUP" }, createdAt: now });
      struck.push(entryId); created += 1;
    }
    if (created > 0) await bumpReadoutPackageVersion(tx, raceId);
    return { status: "saved", response: selfRegistrationCleanupResponseSchema.parse({ formatVersion: 1,
      replayed: created === 0 && struck.length > 0, requestId: intent.requestId, raceId, request: intent, struckEntryIds: struck, skippedCount }) };
  });
}
