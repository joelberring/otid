import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  didNotStartCandidateResponseSchema,
  didNotStartIdempotencyKeySchema,
  didNotStartRequestSchema,
  didNotStartResponseSchema,
  type DidNotStartCandidateResponse,
  type DidNotStartResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { createDidNotStartResult, DID_NOT_START_POLICY_VERSION } from "@o-tid/domain";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type DidNotStartCandidateListResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: DidNotStartCandidateResponse };

export async function listDidNotStartCandidatesAsAdmin(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability">,
  now = new Date()
): Promise<DidNotStartCandidateListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      ...input,
      capability: "DECIDE_DID_NOT_START"
    }, now);
    if (authorization.status !== "authenticated") return authorization;

    const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;
    const entries = await tx.select({
      id: schema.entries.id,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      classId: schema.entries.classId,
      className: schema.classes.name,
      courseVersionId: schema.classes.courseVersionId,
      entryVersion: schema.entries.version
    }).from(schema.entries)
      .innerJoin(schema.classes, and(eq(schema.entries.classId, schema.classes.id), eq(schema.classes.raceId, race.id)))
      .where(eq(schema.entries.raceId, race.id))
      .orderBy(asc(schema.entries.familyName), asc(schema.entries.givenName), asc(schema.entries.id))
      .limit(10_001);
    if (entries.length > 10_000) return { status: "conflict" } as const;
    const revisions = await tx.selectDistinctOn([schema.resultRevisions.entryId], {
      id: schema.resultRevisions.id,
      entryId: schema.resultRevisions.entryId,
      revision: schema.resultRevisions.revision,
      status: schema.resultRevisions.status,
      reason: schema.resultRevisions.reason,
      createdAt: schema.resultRevisions.createdAt,
      snapshotVersion: schema.resultRevisions.snapshotVersion
    }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, race.id))
      .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
    const revisionByEntry = new Map(revisions.map((revision) => [revision.entryId, revision]));
    const parsed = didNotStartCandidateResponseSchema.safeParse({
      formatVersion: 1,
      raceId: race.id,
      snapshotVersion: race.snapshotVersion,
      decisionPolicyVersion: DID_NOT_START_POLICY_VERSION,
      entries: entries.map(({ givenName, familyName, ...entry }) => {
        const latest = revisionByEntry.get(entry.id);
        return {
          ...entry,
          displayName: `${givenName} ${familyName}`,
          readiness: latest ? "HAS_RESULT" : "READY",
          latestResultRevision: latest ? {
            id: latest.id,
            revision: latest.revision,
            status: latest.status,
            reason: latest.reason,
            createdAt: latest.createdAt.toISOString(),
            snapshotVersion: latest.snapshotVersion
          } : null
        };
      })
    });
    if (!parsed.success) return { status: "conflict" } as const;
    return { status: "ok", response: parsed.data } as const;
  }, { isolationLevel: "repeatable read" });
}

export type DecideDidNotStartInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  entryId: string;
  idempotencyKey: string | null;
  request: unknown;
};

export type DecideDidNotStartResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "decided"; response: DidNotStartResponse };

function exactReplay(
  decision: typeof schema.didNotStartDecisions.$inferSelect,
  actorCredentialId: string,
  raceId: string,
  entryId: string,
  request: ReturnType<typeof didNotStartRequestSchema.parse>
): boolean {
  return decision.actorCredentialId === actorCredentialId && decision.raceId === raceId &&
    decision.entryId === entryId && decision.expectedEntryVersion === request.expectedEntryVersion &&
    decision.expectedClassId === request.expectedClassId &&
    decision.expectedCourseVersionId === request.expectedCourseVersionId &&
    decision.expectedSnapshotVersion === request.expectedSnapshotVersion &&
    decision.expectedLatestResultRevision === 0 && request.expectedLatestResultRevision === null &&
    decision.policyVersion === request.policyVersion;
}

function responseFor(
  decision: typeof schema.didNotStartDecisions.$inferSelect,
  revision: typeof schema.resultRevisions.$inferSelect,
  replayed: boolean
): DidNotStartResponse {
  return didNotStartResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: decision.requestId,
    raceId: decision.raceId,
    entryId: decision.entryId,
    didNotStartDecisionId: decision.id,
    resultRevisionId: revision.id,
    revision: revision.revision,
    cause: revision.cause,
    status: revision.status,
    reason: revision.reason,
    decisionPolicyVersion: decision.policyVersion,
    snapshotVersion: revision.snapshotVersion,
    courseVersionId: revision.courseVersionId,
    decidedAt: decision.decidedAt.toISOString()
  });
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Sparar ett ej start-beslut och dess resultatrevision (revision 1). Anroparen har kontrollerat att
 * deltagaren saknar resultat och håller skrivlåset. Används av "Ändra status" och av uppdateringen
 * från Eventor, där en struken anmälan blir ej start (ADR-0170 beslut 4).
 */
export async function insertDidNotStartDecision(tx: Transaction, input: { requestId: string; raceId: string; actorCredentialId: string;
  entryId: string; entryVersion: number; classId: string; courseVersionId: string; snapshotVersion: number; policyVersion: string;
  decidedAt: Date }) {
  const outcome = createDidNotStartResult({ entryId: input.entryId, classId: input.classId, courseVersionId: input.courseVersionId });
  const decisionId = randomUUID();
  const resultRevisionId = randomUUID();
  const [decision] = await tx.insert(schema.didNotStartDecisions).values({ id: decisionId, requestId: input.requestId,
    raceId: input.raceId, actorCredentialId: input.actorCredentialId, entryId: input.entryId,
    expectedEntryVersion: input.entryVersion, expectedClassId: input.classId, expectedCourseVersionId: input.courseVersionId,
    expectedSnapshotVersion: input.snapshotVersion, expectedLatestResultRevision: 0, policyVersion: input.policyVersion,
    status: "DNS", reason: "DID_NOT_START", createdResultRevisionId: resultRevisionId, createdResultRevision: 1,
    decidedAt: input.decidedAt }).returning();
  if (!decision) throw new Error("Ej-startbeslutet kunde inte sparas");
  const [revision] = await tx.insert(schema.resultRevisions).values({ id: resultRevisionId, raceId: input.raceId, entryId: input.entryId,
    readoutId: null, didNotStartDecisionId: decision.id, revision: 1, cause: "MANUAL_DID_NOT_START", status: outcome.status,
    reason: outcome.reason, evaluation: outcome, engineVersion: DID_NOT_START_POLICY_VERSION, snapshotVersion: input.snapshotVersion,
    courseVersionId: input.courseVersionId, published: true, createdAt: input.decidedAt }).returning();
  if (!revision) throw new Error("DNS-revisionen kunde inte sparas");
  return { decision, revision };
}

export async function decideDidNotStartAsAdmin(
  db: Database,
  input: DecideDidNotStartInput,
  now = new Date()
): Promise<DecideDidNotStartResult> {
  const key = didNotStartIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = didNotStartRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) {
    return { status: "invalid-request" };
  }
  const requestId = key.data.slice("did-not-start:".length);
  const decidedAt = new Date(now);
  if (!Number.isFinite(decidedAt.getTime())) throw new Error("Beslutstiden är ogiltig");
  const preflight = await authenticatePairingAdminSession(db, {
    ...input,
    capability: "DECIDE_DID_NOT_START",
    requireCsrf: true
  }, decidedAt);
  if (preflight.status !== "authenticated") return preflight;

  return db.transaction(async (tx) => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, {
      ...input,
      capability: "DECIDE_DID_NOT_START",
      requireCsrf: true
    }, decidedAt);
    if (authorization.status !== "authenticated") return authorization;
    const [race] = await tx.select({ id: schema.races.id, snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
    if (!race) return { status: "not-found" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.didNotStartDecisions)
      .where(eq(schema.didNotStartDecisions.requestId, requestId));
    if (existing) {
      if (!exactReplay(existing, authorization.principal.accessCredentialId, race.id, input.entryId, request.data)) {
        return { status: "conflict" } as const;
      }
      const [existingRevision] = await tx.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.didNotStartDecisionId, existing.id));
      if (!existingRevision) throw new Error("Ej-startbeslutets resultatrevision saknas");
      return { status: "decided", response: responseFor(existing, existingRevision, true) } as const;
    }
    const [entry] = await tx.select().from(schema.entries).where(and(
      eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, race.id)
    )).for("update");
    if (!entry) return { status: "not-found" } as const;
    if (entry.version !== request.data.expectedEntryVersion || entry.classId !== request.data.expectedClassId ||
        race.snapshotVersion !== request.data.expectedSnapshotVersion ||
        request.data.expectedLatestResultRevision !== null ||
        request.data.policyVersion !== DID_NOT_START_POLICY_VERSION) {
      return { status: "conflict" } as const;
    }
    const [raceClass] = await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId })
      .from(schema.classes).where(and(eq(schema.classes.id, entry.classId), eq(schema.classes.raceId, race.id)));
    if (!raceClass || raceClass.courseVersionId !== request.data.expectedCourseVersionId) {
      return { status: "conflict" } as const;
    }
    const [latestRevision] = await tx.select({ id: schema.resultRevisions.id }).from(schema.resultRevisions)
      .where(and(eq(schema.resultRevisions.raceId, race.id), eq(schema.resultRevisions.entryId, entry.id)))
      .orderBy(desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id)).limit(1);
    if (latestRevision) return { status: "conflict" } as const;

    const { decision, revision } = await insertDidNotStartDecision(tx, { requestId, raceId: race.id,
      actorCredentialId: authorization.principal.accessCredentialId, entryId: entry.id, entryVersion: request.data.expectedEntryVersion,
      classId: raceClass.id, courseVersionId: raceClass.courseVersionId, snapshotVersion: race.snapshotVersion,
      policyVersion: request.data.policyVersion, decidedAt });
    await tx.insert(schema.auditEvents).values({
      raceId: race.id,
      entityType: "result_revision",
      entityId: revision.id,
      action: "DID_NOT_START_DECIDED",
      actorKind: authorization.principal.capability === "MANAGE_RACE"
        ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "DID_NOT_START_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId,
      requestId,
      after: {
        entryId: entry.id,
        decisionId: decision.id,
        resultRevisionId: revision.id,
        revision: revision.revision,
        cause: revision.cause,
        status: revision.status,
        reason: revision.reason,
        decisionPolicyVersion: decision.policyVersion,
        snapshotVersion: revision.snapshotVersion,
        courseVersionId: revision.courseVersionId
      }
    });
    return { status: "decided", response: responseFor(decision, revision, false) } as const;
  });
}
