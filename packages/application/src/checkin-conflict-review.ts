import { randomUUID } from "node:crypto";
import { and, desc, eq, notExists, sql } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { canonicalStartCheckinConflictReviewRequest, canonicalStartCheckinConflictReviewSource,
  StartCheckinConflictReviewCandidateSchema, StartCheckinConflictReviewRequestSchema, StartCheckinConflictReviewSourceSchema,
  StartCheckinOperationSchema } from "@o-tid/contracts";
import { planStartCheckinConflictReview } from "@o-tid/domain";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { readAuthorizedStartCheckinRoster } from "./start-checkin-roster";
import { validateStoredStartCheckinReceipt } from "./start-checkin-sync";
import { reviewHash, validateStoredCheckinConflictReview } from "./checkin-conflict-review-journal";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
async function sourceFor(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], raceId: string, entryId: string, now: Date) {
  const roster = await readAuthorizedStartCheckinRoster(tx, raceId, now);
  if (roster.status !== "ok") return roster;
  const entry = roster.response.entries.find(row => row.entryId === entryId);
  if (!entry) return { status: "not-found" as const };
  const [operations, heads] = await Promise.all([
    tx.select().from(schema.startCheckinOperations).where(and(eq(schema.startCheckinOperations.raceId, raceId),
      eq(schema.startCheckinOperations.entryId, entryId), eq(schema.startCheckinOperations.effect, "CONFLICT"),
      notExists(tx.select({ id: schema.startCheckinConflictReviewItems.conflictRequestId }).from(schema.startCheckinConflictReviewItems)
        .where(eq(schema.startCheckinConflictReviewItems.conflictRequestId, schema.startCheckinOperations.requestId)))))
      .orderBy(schema.startCheckinOperations.requestId).limit(1001),
    tx.select({ revision: schema.resultRevisions.revision }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, raceId), eq(schema.resultRevisions.entryId, entryId)))
      .orderBy(desc(schema.resultRevisions.revision)).limit(1)
  ]);
  if (operations.length > 1000) return { status: "too-large" as const };
  // Personnel roster intentionally omits online-admin sources. Review uses real race-scoped labels.
  const sourceDevices = await tx.select({ deviceId: schema.startCheckinDevices.id, label: schema.startCheckinDevices.label })
    .from(schema.startCheckinDevices).where(eq(schema.startCheckinDevices.raceId, raceId));
  const devices = new Map(sourceDevices.map(row => [row.deviceId, row]));
  const source = StartCheckinConflictReviewSourceSchema.parse({ formatVersion: 1, raceId, entryId,
    displayName: entry.displayName, className: entry.className, organisationName: entry.organisationName,
    snapshotVersion: roster.response.snapshotVersion, entryVersion: entry.entryVersion, revision: entry.revision,
    resultRevision: heads[0]?.revision ?? 0, startState: entry.startState, manualReturnRegistered: entry.manualReturnRegistered,
    readoutReturnRegistered: entry.readoutReturnRegistered, activeDns: entry.activeDns,
    conflicts: operations.map(row => ({ operation: StartCheckinOperationSchema.parse(row.intent), contentHash: row.contentHash,
      receipt: validateStoredStartCheckinReceipt(row), deviceLabel: devices.get(row.deviceId)?.label })) });
  return { status: "ok" as const, response: StartCheckinConflictReviewCandidateSchema.parse({ formatVersion: 1, source,
    sourceHash: reviewHash(canonicalStartCheckinConflictReviewSource(source)), generatedAt: now.toISOString() }) };
}

export async function readStartCheckinConflictReviewAsAdmin(db: Database, input: PairingAdminRequestAuthentication & { entryId: string }, now = new Date()) {
  if (input.capability !== "MANAGE_RACE") return { status: "forbidden" as const };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, input, now);
    if (auth.status !== "authenticated") return auth;
    if (!uuid.test(input.entryId)) return { status: "invalid-request" as const };
    return sourceFor(tx, auth.principal.raceId, input.entryId, now);
  }, { isolationLevel: "repeatable read" });
}

export async function reviewStartCheckinConflictsAsAdmin(db: Database, input: PairingAdminRequestAuthentication & {
  readBody: () => Promise<unknown>;
}, clock: () => Date = () => new Date()) {
  if (input.capability !== "MANAGE_RACE") return { status: "forbidden" as const };
  const capability = input.capability;
  const authentication = { ...input, requireCsrf: true };
  const initial = await authenticatePairingAdminSession(db, authentication, clock());
  if (initial.status !== "authenticated") return initial;
  const parsed = StartCheckinConflictReviewRequestSchema.safeParse(await input.readBody());
  if (!parsed.success) return { status: "invalid-request" as const };
  const intent = parsed.data, canonical = canonicalStartCheckinConflictReviewRequest(intent), intentHash = reviewHash(canonical);
  return db.transaction(async tx => {
    const now = clock(), auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, raceId)).for("share");
    if (!race) return { status: "not-found" as const };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'checkin-review-request:' + intent.requestId}, 0))`);
    const [prior] = await tx.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.requestId, intent.requestId));
    if (prior) {
      const saved = validateStoredCheckinConflictReview(prior);
      if (prior.raceId !== raceId || prior.actorCredentialId !== auth.principal.accessCredentialId || prior.intentHash !== intentHash) return { status: "conflict" as const };
      const items = await tx.select().from(schema.startCheckinConflictReviewItems).where(eq(schema.startCheckinConflictReviewItems.reviewId, prior.id))
        .orderBy(schema.startCheckinConflictReviewItems.conflictRequestId);
      if (items.length !== saved.intent.conflictRequestIds.length || items.some((item, index) => item.conflictRequestId !== saved.intent.conflictRequestIds[index] ||
        item.raceId !== raceId || item.entryId !== prior.entryId || item.operationEffect !== "CONFLICT")) throw new Error("Incomplete stored conflict review");
      return { status: "reviewed" as const, response: saved.response };
    }
    const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
      .where(and(eq(schema.entries.id, intent.entryId), eq(schema.entries.raceId, raceId))).for("update");
    if (!entry) return { status: "not-found" as const };
    const candidate = await sourceFor(tx, raceId, entry.id, now);
    if (candidate.status !== "ok") return candidate;
    const current = candidate.response.source;
    const plan = planStartCheckinConflictReview({ raceId, entryId: entry.id, expectedSourceHash: intent.sourceHash,
      sourceHash: candidate.response.sourceHash, expectedConflictRequestIds: intent.conflictRequestIds,
      conflictRequestIds: current.conflicts.map(row => row.operation.requestId), current: { raceId, entryId: entry.id,
        startState: current.startState, returnRegistered: current.manualReturnRegistered || current.readoutReturnRegistered, activeDns: current.activeDns } });
    if (plan.kind === "CONFLICT") return { status: "conflict" as const };
    const row = { id: randomUUID(), requestId: intent.requestId, raceId, entryId: entry.id,
      actorCredentialId: auth.principal.accessCredentialId, capability, decision: intent.decision,
      reason: intent.reason, sourceHash: intent.sourceHash, intentCanonicalJson: new TextDecoder().decode(canonical), intentHash, reviewedAt: now };
    await tx.insert(schema.startCheckinConflictReviews).values(row);
    await tx.insert(schema.startCheckinConflictReviewItems).values(current.conflicts.map(conflict => ({ reviewId: row.id,
      conflictRequestId: conflict.operation.requestId, raceId, entryId: entry.id, contentHash: conflict.contentHash, operationEffect: "CONFLICT" as const })));
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "start_checkin_conflict_review", entityId: row.id,
      requestId: intent.requestId, actorId: row.actorCredentialId,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      action: "START_CHECKIN_CONFLICTS_REVIEWED", after: { entryId: entry.id, sourceHash: intent.sourceHash,
        decision: intent.decision, reason: intent.reason, conflictRequestIds: intent.conflictRequestIds, source: current }, createdAt: now });
    return { status: "reviewed" as const, response: validateStoredCheckinConflictReview(row).response };
  });
}
