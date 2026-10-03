import { desc, eq, and, sql } from "drizzle-orm";
import {
  adminMapGeoreferenceStateResponseSchema,
  mapGeoreferenceCreateIdempotencyKeySchema,
  mapGeoreferenceCreateRequestSchema,
  mapGeoreferenceResponseSchema,
  type AdminMapGeoreferenceStateResponse,
  type MapGeoreferenceResponse
} from "@o-tid/contracts";
import { deriveRasterGeoreference, RasterGeoreferenceError } from "@o-tid/domain";
import { schema, type Database } from "@o-tid/database";
import { authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Auth = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sameIntent(stored: unknown, expected: unknown): boolean {
  try { return stableJson(stored) === stableJson(expected); }
  catch { return false; }
}

/** Contracts permit finite decimal coordinates; the integer-only shared canonical JSON is unsuitable here. */
function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("NON_FINITE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("NON_JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function response(row: typeof schema.mapGeoreferences.$inferSelect, replayed: boolean): MapGeoreferenceResponse {
  return mapGeoreferenceResponseSchema.parse({
    formatVersion: 1, georeferenceId: row.id, requestId: row.requestId, raceId: row.raceId, revision: row.revision,
    manifestId: row.manifestId, sourceHash: row.sourceHash, imageWidth: row.imageWidth, imageHeight: row.imageHeight,
    crs: row.crs, tiePoints: row.tiePoints, transform: row.transform, maxResidualMeters: row.maxResidualMeters,
    decidedAt: row.decidedAt.toISOString(), replayed
  });
}

export type AdminMapGeoreferenceStateResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
  | { status: "ok"; response: AdminMapGeoreferenceStateResponse };

/** Private review projection; it never joins an object-store key or any route point. */
export async function readMapGeoreferenceStateAsAdmin(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">,
  now = new Date()
): Promise<AdminMapGeoreferenceStateResult> {
  if (!uuid.test(input.raceId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken, raceId: input.raceId, capability
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const rows = await tx.select().from(schema.mapGeoreferences)
      .where(eq(schema.mapGeoreferences.raceId, authorization.principal.raceId))
      .orderBy(desc(schema.mapGeoreferences.revision)).limit(100);
    const georeferences = rows.map(row => {
      const complete = response(row, false);
      return { formatVersion: complete.formatVersion, georeferenceId: complete.georeferenceId, raceId: complete.raceId,
        revision: complete.revision, manifestId: complete.manifestId, sourceHash: complete.sourceHash,
        imageWidth: complete.imageWidth, imageHeight: complete.imageHeight, crs: complete.crs,
        tiePoints: complete.tiePoints, transform: complete.transform, maxResidualMeters: complete.maxResidualMeters,
        decidedAt: complete.decidedAt };
    });
    return { status: "ok", response: adminMapGeoreferenceStateResponseSchema.parse({
      formatVersion: 1, raceId: authorization.principal.raceId,
      latestGeoreferenceRevision: rows[0]?.revision ?? 0, georeferences
    }) };
  });
}

export async function createMapGeoreferenceAsAdmin(db: Database,
  input: Auth & { idempotencyKey: string | null; request: unknown }, now = new Date()
) {
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (authorization.status !== "authenticated") return authorization;
    const key = mapGeoreferenceCreateIdempotencyKeySchema.safeParse(input.idempotencyKey);
    const request = mapGeoreferenceCreateRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
    let calculated;
    try {
      calculated = deriveRasterGeoreference({ imageWidth: request.data.imageWidth, imageHeight: request.data.imageHeight, tiePoints: request.data.tiePoints });
    } catch (error) {
      if (error instanceof RasterGeoreferenceError) return { status: "invalid-request" as const };
      throw error;
    }
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("map-georeference:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.mapGeoreferences).where(eq(schema.mapGeoreferences.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.actorCredentialId !== authorization.principal.accessCredentialId || !sameIntent(existing.intent, request.data)) return { status: "conflict" as const };
      return { status: "created" as const, response: response(existing, true) };
    }
    const [manifest] = await tx.select().from(schema.mapObjectManifests)
      .where(and(eq(schema.mapObjectManifests.uploadId, request.data.manifestId), eq(schema.mapObjectManifests.raceId, input.raceId)));
    if (!manifest) return { status: "not-found" as const };
    const [latest] = await tx.select({ revision: schema.mapGeoreferences.revision }).from(schema.mapGeoreferences)
      .where(eq(schema.mapGeoreferences.raceId, input.raceId)).orderBy(desc(schema.mapGeoreferences.revision)).limit(1);
    if ((latest?.revision ?? 0) !== request.data.expectedGeoreferenceRevision) return { status: "conflict" as const };
    const revision = request.data.expectedGeoreferenceRevision + 1;
    const [saved] = await tx.insert(schema.mapGeoreferences).values({
      requestId, raceId: input.raceId, manifestId: manifest.uploadId, actorCredentialId: authorization.principal.accessCredentialId,
      capability, revision, sourceHash: manifest.sha256, intent: request.data, imageWidth: calculated.imageWidth,
      imageHeight: calculated.imageHeight, crs: request.data.crs, tiePoints: calculated.tiePoints,
      transform: calculated.transform, maxResidualMeters: calculated.maxResidualMeters, decidedAt: now
    }).returning();
    if (!saved) throw new Error("MAP_GEOREFERENCE_NOT_STORED");
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId, entityType: "map_georeference", entityId: saved.id, action: "MAP_GEOREFERENCE_CREATED",
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: authorization.principal.accessCredentialId, requestId,
      after: { capability, revision, manifestId: saved.manifestId, sourceHash: saved.sourceHash,
        imageWidth: saved.imageWidth, imageHeight: saved.imageHeight, crs: saved.crs, maxResidualMeters: saved.maxResidualMeters }
    });
    return { status: "created" as const, response: response(saved, false) };
  });
}
