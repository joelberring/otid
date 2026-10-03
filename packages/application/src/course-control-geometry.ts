import { and, asc, desc, eq, sql } from "drizzle-orm";
import { adminCourseControlGeometryStateResponseSchema, canonicalJsonBytes, courseControlGeometryCreateRequestSchema, courseControlGeometryIdempotencyKeySchema, courseControlGeometryResponseSchema, type AdminCourseControlGeometryStateResponse, type CourseControlGeometryResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { lockRaceForMutation } from "./concurrency";
import { authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";

const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Input = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };

function sameIntent(left: unknown, right: unknown): boolean { try { return Buffer.from(canonicalJsonBytes(left)).equals(Buffer.from(canonicalJsonBytes(right))); } catch { return false; } }
function response(row: typeof schema.courseControlGeometryRevisions.$inferSelect, replayed: boolean): CourseControlGeometryResponse {
  return courseControlGeometryResponseSchema.parse({ formatVersion: 1, geometryRevisionId: row.id, requestId: row.requestId, raceId: row.raceId, courseVersionId: row.courseVersionId, mapManifestId: row.mapManifestId, georeferenceId: row.georeferenceId, revision: row.revision, decidedAt: row.decidedAt.toISOString(), replayed });
}

export async function readCourseControlGeometryStateAsAdmin(db: Database, input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">, now = new Date()): Promise<{ status: "ok"; response: AdminCourseControlGeometryStateResponse } | { status: "unauthorized" | "forbidden" | "invalid-request" }> {
  if (!uuid.test(input.raceId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { sessionToken: input.sessionToken, raceId: input.raceId, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const controls = await tx.select({ courseVersionId: schema.courseControls.courseVersionId, courseControlId: schema.courseControls.id, sequence: schema.courseControls.sequence, controlCode: schema.controls.code, courseName: schema.courses.name, version: schema.courseVersions.version }).from(schema.courseControls)
      .innerJoin(schema.courseVersions, eq(schema.courseControls.courseVersionId, schema.courseVersions.id)).innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id)).innerJoin(schema.controls, eq(schema.courseControls.controlId, schema.controls.id))
      .where(eq(schema.courses.raceId, input.raceId)).orderBy(asc(schema.courses.name), asc(schema.courseVersions.version), asc(schema.courseControls.sequence));
    const courses = new Map<string, { courseVersionId: string; courseName: string; version: number; controls: { courseControlId: string; sequence: number; controlCode: number }[] }>();
    for (const control of controls) { const course = courses.get(control.courseVersionId) ?? { courseVersionId: control.courseVersionId, courseName: control.courseName, version: control.version, controls: [] }; course.controls.push({ courseControlId: control.courseControlId, sequence: control.sequence, controlCode: control.controlCode }); courses.set(control.courseVersionId, course); }
    const rows = await tx.select().from(schema.courseControlGeometryRevisions).where(eq(schema.courseControlGeometryRevisions.raceId, input.raceId)).orderBy(desc(schema.courseControlGeometryRevisions.decidedAt)).limit(100);
    const geometries = rows.map(row => ({ formatVersion: 1 as const, geometryRevisionId: row.id, raceId: row.raceId, courseVersionId: row.courseVersionId, mapManifestId: row.mapManifestId, georeferenceId: row.georeferenceId, revision: row.revision, decidedAt: row.decidedAt.toISOString() }));
    return { status: "ok" as const, response: adminCourseControlGeometryStateResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, courses: [...courses.values()], geometries }) };
  });
}

/** Private, complete geometry revision for exactly one course and raster calibration. */
export async function createCourseControlGeometryAsAdmin(db: Database, input: Input, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const key = courseControlGeometryIdempotencyKeySchema.safeParse(input.idempotencyKey);
    const request = courseControlGeometryCreateRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("course-control-geometry:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.courseControlGeometryRevisions).where(eq(schema.courseControlGeometryRevisions.requestId, requestId));
    if (existing) {
      const same = existing.raceId === input.raceId && existing.actorCredentialId === auth.principal.accessCredentialId && sameIntent(existing.intent, request.data);
      return same ? { status: "created" as const, response: response(existing, true) } : { status: "conflict" as const };
    }
    const [course] = await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
      .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
      .where(and(eq(schema.courseVersions.id, request.data.courseVersionId), eq(schema.courses.raceId, input.raceId)));
    const [map] = await tx.select().from(schema.mapObjectManifests).where(and(eq(schema.mapObjectManifests.uploadId, request.data.mapManifestId), eq(schema.mapObjectManifests.raceId, input.raceId)));
    const [geo] = await tx.select().from(schema.mapGeoreferences).where(and(eq(schema.mapGeoreferences.id, request.data.georeferenceId), eq(schema.mapGeoreferences.raceId, input.raceId)));
    if (!course || !map || !geo || geo.manifestId !== map.uploadId || geo.sourceHash !== map.sha256) return { status: "not-found" as const };
    const controls = await tx.select({ id: schema.courseControls.id, sequence: schema.courseControls.sequence }).from(schema.courseControls).where(eq(schema.courseControls.courseVersionId, course.id)).orderBy(asc(schema.courseControls.sequence));
    if (controls.length === 0 || controls.length !== request.data.points.length || new Set(controls.map(row => row.id)).size !== controls.length) return { status: "conflict" as const };
    const coordinates = new Map(request.data.points.map(point => [point.courseControlId, point]));
    if (controls.some(control => !coordinates.has(control.id)) || request.data.points.some(point => point.pixelX >= geo.imageWidth || point.pixelY >= geo.imageHeight)) return { status: "conflict" as const };
    const [latest] = await tx.select({ revision: schema.courseControlGeometryRevisions.revision }).from(schema.courseControlGeometryRevisions)
      .where(and(eq(schema.courseControlGeometryRevisions.courseVersionId, course.id), eq(schema.courseControlGeometryRevisions.mapManifestId, map.uploadId))).orderBy(desc(schema.courseControlGeometryRevisions.revision)).limit(1);
    if ((latest?.revision ?? 0) !== request.data.expectedGeometryRevision) return { status: "conflict" as const };
    const [saved] = await tx.insert(schema.courseControlGeometryRevisions).values({ requestId, raceId: input.raceId, courseVersionId: course.id, mapManifestId: map.uploadId, georeferenceId: geo.id, actorCredentialId: auth.principal.accessCredentialId, capability, revision: request.data.expectedGeometryRevision + 1, sourceHash: map.sha256, intent: request.data, decidedAt: now }).returning();
    if (!saved) throw new Error("COURSE_CONTROL_GEOMETRY_NOT_STORED");
    await tx.insert(schema.courseControlGeometryPoints).values(controls.map(control => {
      const coordinate = coordinates.get(control.id); if (!coordinate) throw new Error("COURSE_CONTROL_GEOMETRY_POINT_MISSING");
      return { revisionId: saved.id, courseControlId: control.id, courseVersionId: course.id, sequence: control.sequence, pixelX: coordinate.pixelX, pixelY: coordinate.pixelY };
    }));
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "course_control_geometry", entityId: saved.id, action: "COURSE_CONTROL_GEOMETRY_CREATED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, requestId, after: { courseVersionId: course.id, mapManifestId: map.uploadId, georeferenceId: geo.id, revision: saved.revision, pointCount: controls.length } });
    return { status: "created" as const, response: response(saved, false) };
  });
}
