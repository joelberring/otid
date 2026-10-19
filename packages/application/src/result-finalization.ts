import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  frozenRaceFinalizationListResponseSchema,
  frozenRaceFinalizationProjectionSchema,
  publicFrozenRaceResultsResponseSchema,
  resultFinalizationIdempotencyKeySchema,
  resultFinalizationRequestSchema,
  resultFinalizationResponseSchema,
  type FrozenClassFinalizationProjection,
  type FrozenRaceFinalizationListResponse,
  type FrozenRaceFinalizationProjection,
  type PublicFrozenRaceResultsResponse,
  type RaceResultFinalizationMetadata,
  type ResultFinalizationCandidateResponse,
  type ResultFinalizationRequest,
  type ResultFinalizationResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import { ClassRankingError } from "@o-tid/domain";
import {
  serializeIofResultList
} from "@o-tid/iof-xml";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { UUID_PATTERN, sha256Hex as sha256Bytes } from "./serialization";

import {
  FinalizationTooLarge,
  StoredFinalizationConflict,
  asIofClass,
  buildFinalizationBasis,
  finalizationMetadata,
  ResultFinalizationRow
} from "./result-finalization-basis";

export type ResultFinalizationCandidateResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "conflict" | "too-large" }
  | { status: "ok"; response: ResultFinalizationCandidateResponse };

export type FinalizeResultsInput = RaceSessionProof & {
  idempotencyKey: string | null;
  request: unknown;
};

export type FinalizeResultsResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" | "too-large" }
  | { status: "finalized"; response: ResultFinalizationResponse };

export type FrozenRaceFinalizationListResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; response: FrozenRaceFinalizationListResponse };

export type FrozenIofResultListExportResult =
  | { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" }
  | { status: "ok"; bytes: Uint8Array; finalization: RaceResultFinalizationMetadata };

export type PublicFrozenRaceResultsResult =
  | { status: "not-found" | "conflict" }
  | { status: "ok"; response: PublicFrozenRaceResultsResponse };

export type LatestPublicFrozenRaceFinalizationResult =
  | { status: "not-found" | "conflict" }
  | { status: "ok"; finalizationId: string };

export interface ResultFinalizationRuntimeOptions {
  readonly now?: Date;
  readonly finalizationId?: string;
}



export async function listResultFinalizationCandidatesAsAdmin(
  db: Database,
  input: RaceSessionProof,
  now = new Date()
): Promise<ResultFinalizationCandidateResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await requireRaceRole(tx, {
        ...input,
        role: "ADMIN"
      }, now, "share");
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({
        id: schema.races.id,
        eventId: schema.races.eventId,
        snapshotVersion: schema.races.snapshotVersion
      }).from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      return { status: "ok", response: (await buildFinalizationBasis(tx, race)).response } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof FinalizationTooLarge) return { status: "too-large" };
    if (error instanceof StoredFinalizationConflict || error instanceof ClassRankingError) return { status: "conflict" };
    throw error;
  }
}

function exactReplay(
  row: ResultFinalizationRow,
  requestId: string,
  actorAccountId: string,
  raceId: string,
  request: ResultFinalizationRequest
): boolean {
  return row.requestId === requestId && row.actorAccountId === actorAccountId && row.raceId === raceId &&
    row.scope === request.scope && row.classId === request.classId &&
    row.sourceHash === request.expectedBasisHash &&
    row.scopeRevision === (request.expectedLatestScopeRevision ?? 0) + 1;
}

export async function finalizeResultsAsAdmin(
  db: Database,
  input: FinalizeResultsInput,
  options: ResultFinalizationRuntimeOptions = {}
): Promise<FinalizeResultsResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "not-found" };
  const idempotencyKey = resultFinalizationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = resultFinalizationRequestSchema.safeParse(input.request);
  if (!idempotencyKey.success || !request.success) return { status: "invalid-request" };
  const requestId = idempotencyKey.data.slice("result-finalization:".length);
  const finalizedAt = options.now ?? new Date();
  if (!Number.isFinite(finalizedAt.getTime())) throw new Error("Finaliseringstiden är ogiltig");
  const finalizationId = options.finalizationId ?? randomUUID();
  if (!UUID_PATTERN.test(finalizationId)) throw new Error("Finaliserings-id är ogiltigt");

  try {
    return await db.transaction(async (tx) => {
      const authorization = await requireRaceRole(tx, {
        ...input,
        role: "ADMIN",
        requireCsrf: true
      }, finalizedAt, "update");
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({
        id: schema.races.id,
        eventId: schema.races.eventId,
        snapshotVersion: schema.races.snapshotVersion
      }).from(schema.races).where(eq(schema.races.id, authorization.principal.raceId)).for("update");
      if (!race) return { status: "not-found" } as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);

      const [existing] = await tx.select().from(schema.resultFinalizations)
        .where(eq(schema.resultFinalizations.requestId, requestId));
      if (existing) {
        if (!exactReplay(existing, requestId, authorization.principal.accountId, race.id, request.data)) {
          return { status: "conflict" } as const;
        }
        return {
          status: "finalized",
          response: resultFinalizationResponseSchema.parse({
            formatVersion: 1,
            replayed: true,
            requestId,
            finalization: finalizationMetadata(existing)
          })
        } as const;
      }

      const basis = await buildFinalizationBasis(tx, race);
      const candidate = request.data.scope === "CLASS"
        ? basis.response.classes.find((item) => item.classId === request.data.classId)
        : basis.response.race;
      if (!candidate) return { status: "not-found" } as const;
      if (candidate.basisHash !== request.data.expectedBasisHash || candidate.blockerCodes.length > 0) {
        return { status: "conflict" } as const;
      }
      const latest = request.data.scope === "CLASS"
        ? candidate.latestFinalization
        : basis.response.race.latestFinalization;
      if ((latest?.scopeRevision ?? null) !== request.data.expectedLatestScopeRevision) {
        return { status: "conflict" } as const;
      }
      const scopeRevision = (latest?.scopeRevision ?? 0) + 1;

      let frozenProjection: FrozenClassFinalizationProjection | FrozenRaceFinalizationProjection;
      let completeXml: string | null = null;
      let completeXmlHash: string | null = null;
      if (request.data.scope === "CLASS") {
        const projection = basis.classProjectionById.get(request.data.classId);
        if (!projection) return { status: "conflict" } as const;
        frozenProjection = projection;
      } else {
        if (!basis.raceProjection) return { status: "conflict" } as const;
        frozenProjection = basis.raceProjection;
        const bytes = serializeIofResultList({
          status: "Complete",
          finalizationProof: {
            finalizationId,
            revision: scopeRevision,
            sourceHash: request.data.expectedBasisHash
          },
          eventName: basis.raceProjection.eventName,
          classes: basis.raceProjection.classes.map((raceClass) => asIofClass(raceClass.class))
        });
        completeXml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        completeXmlHash = sha256Bytes(bytes);
      }

      const [saved] = await tx.insert(schema.resultFinalizations).values({
        id: finalizationId,
        requestId,
        raceId: race.id,
        scope: request.data.scope,
        classId: request.data.classId,
        scopeRevision,
        sourceSnapshotVersion: race.snapshotVersion,
        sourceHash: request.data.expectedBasisHash,
        frozenProjection,
        completeXml,
        completeXmlHash,
        actorAccountId: authorization.principal.accountId,
        finalizedAt
      }).returning();
      if (!saved) throw new Error("Finaliseringen kunde inte sparas");
      const metadata = finalizationMetadata(saved);
      await tx.insert(schema.auditEvents).values({
        raceId: race.id,
        entityType: "result_finalization",
        entityId: saved.id,
        action: saved.scope === "CLASS" ? "RESULT_CLASS_FINALIZED" : "RESULT_RACE_FINALIZED",
        actorKind: "USER_ACCOUNT",
        actorId: authorization.principal.accountId,
        requestId,
        after: {
          scope: metadata.scope,
          classId: metadata.classId,
          scopeRevision: metadata.scopeRevision,
          sourceSnapshotVersion: metadata.sourceSnapshotVersion,
          basisHash: metadata.basisHash,
          frozenProjectionHash: metadata.frozenProjectionHash,
          entryCount: metadata.entryCount,
          classCount: metadata.classCount,
          completeXmlSha256: metadata.completeXmlSha256,
          finalizedAt: metadata.finalizedAt
        }
      });
      return {
        status: "finalized",
        response: resultFinalizationResponseSchema.parse({
          formatVersion: 1,
          replayed: false,
          requestId,
          finalization: metadata
        })
      } as const;
    });
  } catch (error) {
    if (error instanceof FinalizationTooLarge) return { status: "too-large" };
    if (error instanceof StoredFinalizationConflict || error instanceof ClassRankingError) return { status: "conflict" };
    throw error;
  }
}

export async function listFrozenRaceFinalizationsAsAdmin(
  db: Database,
  input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">,
  now = new Date()
): Promise<FrozenRaceFinalizationListResult> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  try {
    return await db.transaction(async (tx) => {
      const authorization = await requireRaceRole(tx, {
        ...input,
        role: "ADMIN"
      }, now, "share");
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
        .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      const rows = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.raceId, race.id),
        eq(schema.resultFinalizations.scope, "RACE")
      )).orderBy(desc(schema.resultFinalizations.scopeRevision)).limit(10_001);
      if (rows.length > 10_000) return { status: "conflict" } as const;
      const response = frozenRaceFinalizationListResponseSchema.parse({
        formatVersion: 1,
        raceId: race.id,
        finalizations: rows.map((row) => finalizationMetadata(row))
      });
      return { status: "ok", response } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}

export async function exportFrozenIofResultListAsAdmin(
  db: Database,
  input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader"> & {
    finalizationId: string;
  },
  now = new Date()
): Promise<FrozenIofResultListExportResult> {
  if (!UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.finalizationId)) {
    return { status: "invalid-request" };
  }
  try {
    return await db.transaction(async (tx) => {
      const authorization = await requireRaceRole(tx, {
        sessionToken: input.sessionToken,
        raceId: input.raceId,
        role: "ADMIN"
      }, now, "share");
      if (authorization.status !== "authenticated") return authorization;
      const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
        .where(eq(schema.races.id, authorization.principal.raceId)).for("share");
      if (!race) return { status: "not-found" } as const;
      const [row] = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.id, input.finalizationId),
        eq(schema.resultFinalizations.raceId, race.id),
        eq(schema.resultFinalizations.scope, "RACE")
      ));
      if (!row || row.completeXml === null) return { status: "not-found" } as const;
      const metadata = finalizationMetadata(row);
      if (metadata.scope !== "RACE") throw new StoredFinalizationConflict("Finaliseringen är inte ett lopp");
      return {
        status: "ok",
        bytes: new TextEncoder().encode(row.completeXml),
        finalization: metadata
      } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}

function publicFrozenRaceResultsFromRow(row: ResultFinalizationRow): PublicFrozenRaceResultsResponse {
  const parsedProjection = frozenRaceFinalizationProjectionSchema.safeParse(row.frozenProjection);
  if (!parsedProjection.success) {
    throw new StoredFinalizationConflict("Loppsfinaliseringen har ett ogiltigt fryst manifest");
  }
  const metadata = finalizationMetadata(row);
  if (metadata.scope !== "RACE") {
    throw new StoredFinalizationConflict("Finaliseringen är inte ett lopp");
  }
  return publicFrozenRaceResultsResponseSchema.parse({
    formatVersion: 1,
    eventName: parsedProjection.data.eventName,
    finalizedAt: row.finalizedAt.toISOString(),
    results: parsedProjection.data.classes.flatMap((selectedClass) =>
      selectedClass.class.results.map(({ personResult }) => ({
        className: selectedClass.class.name,
        givenName: personResult.givenName,
        familyName: personResult.familyName,
        organisationName: personResult.organisationName,
        status: personResult.status,
        elapsedMs: personResult.elapsedMs,
        position: personResult.position,
        timeBehindMs: personResult.timeBehindMs
      }))
    )
  });
}

/**
 * Reads exactly one immutable RACE finalization. This must never call the
 * live public result projection: later result revisions are intentionally
 * unrelated to an already shared finalization URL.
 */
export async function readPublicFrozenRaceResults(
  db: Database,
  raceId: string,
  finalizationId: string
): Promise<PublicFrozenRaceResultsResult> {
  if (!UUID_PATTERN.test(raceId) || !UUID_PATTERN.test(finalizationId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.id, finalizationId),
        eq(schema.resultFinalizations.raceId, raceId),
        eq(schema.resultFinalizations.scope, "RACE")
      ));
      if (!row) return { status: "not-found" } as const;
      return { status: "ok", response: publicFrozenRaceResultsFromRow(row) } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}

/** The live page may discover a link, but the linked representation stays explicit. */
export async function readLatestPublicFrozenRaceFinalization(
  db: Database,
  raceId: string
): Promise<LatestPublicFrozenRaceFinalizationResult> {
  if (!UUID_PATTERN.test(raceId)) return { status: "not-found" };
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select({ id: schema.resultFinalizations.id }).from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.raceId, raceId),
        eq(schema.resultFinalizations.scope, "RACE")
      )).orderBy(desc(schema.resultFinalizations.scopeRevision)).limit(1);
      if (!row) return { status: "not-found" } as const;
      const exact = await tx.select().from(schema.resultFinalizations).where(and(
        eq(schema.resultFinalizations.id, row.id),
        eq(schema.resultFinalizations.raceId, raceId),
        eq(schema.resultFinalizations.scope, "RACE")
      )).limit(1);
      const finalization = exact[0];
      if (!finalization) return { status: "not-found" } as const;
      publicFrozenRaceResultsFromRow(finalization);
      return { status: "ok", finalizationId: finalization.id } as const;
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (error instanceof StoredFinalizationConflict) return { status: "conflict" };
    throw error;
  }
}
