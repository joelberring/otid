import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  routeUploadGrantIssueIdempotencyKeySchema,
  routeUploadGrantIssueRequestSchema,
  routeUploadGrantIssueResponseSchema,
  routeUploadGrantListResponseSchema,
  routeUploadGrantRevokeIdempotencyKeySchema,
  routeUploadGrantRevokeRequestSchema,
  routeUploadGrantRevokeResponseSchema
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSession,
  authenticatePairingAdminSessionForProtectedRead,
  authenticatePairingAdminSessionForMutation,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import { lockEntryForRevision, lockRaceForMutation } from "./concurrency";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxGrantLifetimeMs = 30 * 24 * 60 * 60 * 1_000;

function metadata(
  grant: typeof schema.routeUploadGrants.$inferSelect,
  revokedAt: Date | null,
  replayed: boolean
) {
  return {
    formatVersion: 1 as const,
    grantId: grant.id,
    raceId: grant.raceId,
    entryId: grant.entryId,
    expiresAt: grant.expiresAt.toISOString(),
    issuedAt: grant.issuedAt.toISOString(),
    revokedAt: revokedAt?.toISOString() ?? null,
    replayed
  };
}

function validIssueTime(expiresAt: Date, now: Date): boolean {
  return Number.isFinite(expiresAt.getTime()) && Number.isFinite(now.getTime()) &&
    expiresAt.getTime() > now.getTime() && expiresAt.getTime() <= now.getTime() + maxGrantLifetimeMs;
}

/** Creates exactly one active, hash-only participant route link per entry. The caller owns its plaintext secret. */
export async function issueRouteUploadGrantAsAdmin(
  db: Database,
  input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()
) {
  const key = routeUploadGrantIssueIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = routeUploadGrantIssueRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
  const expiresAt = new Date(request.data.expiresAt);
  if (!validIssueTime(expiresAt, now)) return { status: "invalid-request" as const };
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;

  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    await lockEntryForRevision(tx, input.raceId, request.data.entryId);
    const requestId = key.data.slice("route-upload-grant:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.routeUploadGrants)
      .where(eq(schema.routeUploadGrants.requestId, requestId));
    if (existing) {
      if (existing.id !== request.data.grantId || existing.raceId !== input.raceId || existing.entryId !== request.data.entryId ||
        existing.issuerCredentialId !== auth.principal.accessCredentialId || existing.secretHash !== request.data.secretHash ||
        existing.expiresAt.getTime() !== expiresAt.getTime()) return { status: "conflict" as const };
      const [revocation] = await tx.select().from(schema.routeUploadGrantRevocations)
        .where(eq(schema.routeUploadGrantRevocations.grantId, existing.id));
      return { status: "issued" as const, response: routeUploadGrantIssueResponseSchema.parse(metadata(existing, revocation?.revokedAt ?? null, true)) };
    }
    const active = await tx.select({ id: schema.routeUploadGrants.id }).from(schema.routeUploadGrants)
      .leftJoin(schema.routeUploadGrantRevocations, eq(schema.routeUploadGrantRevocations.grantId, schema.routeUploadGrants.id))
      .where(and(eq(schema.routeUploadGrants.raceId, input.raceId), eq(schema.routeUploadGrants.entryId, request.data.entryId),
        gt(schema.routeUploadGrants.expiresAt, now), isNull(schema.routeUploadGrantRevocations.id))).limit(1);
    if (active.length > 0) return { status: "conflict" as const };
    const [saved] = await tx.insert(schema.routeUploadGrants).values({
      id: request.data.grantId,
      requestId,
      raceId: input.raceId,
      entryId: request.data.entryId,
      issuerCredentialId: auth.principal.accessCredentialId,
      capability,
      secretHash: request.data.secretHash,
      issuedAt: now,
      expiresAt
    }).returning();
    if (!saved) throw new Error("ROUTE_UPLOAD_GRANT_NOT_STORED");
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId,
      entityType: "route_upload_grant",
      entityId: saved.id,
      action: "ROUTE_UPLOAD_GRANT_ISSUED",
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId,
      requestId,
      after: { capability, entryId: saved.entryId, expiresAt: saved.expiresAt.toISOString() }
    });
    return { status: "issued" as const, response: routeUploadGrantIssueResponseSchema.parse(metadata(saved, null, false)) };
  });
}

/** Private MANAGE_RACE history used only to issue or explicitly revoke a participant upload link. */
export async function listRouteUploadGrantsAsAdmin(
  db: Database,
  input: Authentication,
  now = new Date()
) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const rows = await tx.select({ grant: schema.routeUploadGrants, revocation: schema.routeUploadGrantRevocations })
      .from(schema.routeUploadGrants)
      .leftJoin(schema.routeUploadGrantRevocations, eq(schema.routeUploadGrantRevocations.grantId, schema.routeUploadGrants.id))
      .where(eq(schema.routeUploadGrants.raceId, input.raceId))
      .orderBy(asc(schema.routeUploadGrants.issuedAt), asc(schema.routeUploadGrants.id));
    return { status: "ok" as const, response: routeUploadGrantListResponseSchema.parse({
      formatVersion: 1, raceId: input.raceId,
      grants: rows.map(({ grant, revocation }) => {
        const grantMetadata = metadata(grant, revocation?.revokedAt ?? null, false);
        return { formatVersion: grantMetadata.formatVersion, grantId: grantMetadata.grantId,
          raceId: grantMetadata.raceId, entryId: grantMetadata.entryId,
          expiresAt: grantMetadata.expiresAt, issuedAt: grantMetadata.issuedAt,
          revokedAt: grantMetadata.revokedAt };
      })
    }) };
  });
}

/** A revoke request is a new immutable fact; only its exact idempotent retry is replayed. */
export async function revokeRouteUploadGrantAsAdmin(
  db: Database,
  input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()
) {
  const key = routeUploadGrantRevokeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const request = routeUploadGrantRevokeRequestSchema.safeParse(input.request);
  if (!key.success || !request.success || !uuid.test(input.raceId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" as const };
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;

  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("route-upload-grant-revoke:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [replayed] = await tx.select().from(schema.routeUploadGrantRevocations)
      .where(eq(schema.routeUploadGrantRevocations.requestId, requestId));
    if (replayed) {
      if (replayed.raceId !== input.raceId || replayed.grantId !== request.data.grantId ||
        replayed.actorCredentialId !== auth.principal.accessCredentialId || replayed.reason !== request.data.reason) return { status: "conflict" as const };
      const [grant] = await tx.select().from(schema.routeUploadGrants).where(eq(schema.routeUploadGrants.id, replayed.grantId));
      if (!grant) throw new Error("ROUTE_UPLOAD_GRANT_MISSING");
      return { status: "revoked" as const, response: routeUploadGrantRevokeResponseSchema.parse(metadata(grant, replayed.revokedAt, true)) };
    }
    const [grant] = await tx.select().from(schema.routeUploadGrants).where(and(
      eq(schema.routeUploadGrants.id, request.data.grantId), eq(schema.routeUploadGrants.raceId, input.raceId)
    )).for("update");
    if (!grant) return { status: "not-found" as const };
    await lockEntryForRevision(tx, input.raceId, grant.entryId);
    const [prior] = await tx.select().from(schema.routeUploadGrantRevocations)
      .where(eq(schema.routeUploadGrantRevocations.grantId, grant.id));
    if (prior) return { status: "conflict" as const };
    const [saved] = await tx.insert(schema.routeUploadGrantRevocations).values({
      requestId,
      grantId: grant.id,
      raceId: input.raceId,
      entryId: grant.entryId,
      actorCredentialId: auth.principal.accessCredentialId,
      capability,
      revokedAt: now,
      reason: request.data.reason
    }).returning();
    if (!saved) throw new Error("ROUTE_UPLOAD_GRANT_REVOCATION_NOT_STORED");
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId,
      entityType: "route_upload_grant",
      entityId: grant.id,
      action: "ROUTE_UPLOAD_GRANT_REVOKED",
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId,
      requestId,
      after: { capability, entryId: grant.entryId, reason: saved.reason }
    });
    return { status: "revoked" as const, response: routeUploadGrantRevokeResponseSchema.parse(metadata(grant, saved.revokedAt, false)) };
  });
}
