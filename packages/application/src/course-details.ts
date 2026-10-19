import { and, eq } from "drizzle-orm";
import { courseDetailsIdempotencyKeySchema, courseDetailsRequestSchema, courseDetailsResponseSchema,
  type CourseDetailsResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { requireRaceRole, type RaceSessionProof } from "./race-session";

/**
 * Banans längd och stigning i meter (PLAN.md steg 25), från banformuläret. Påverkar inga resultat eller avläsningens
 * paket och sparas därför direkt. Samma begäran två gånger ger samma kvitto (värdet sätts, inget räknas upp).
 */
export type CourseDetailsResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "saved"; response: CourseDetailsResponse };

export async function saveCourseDetailsAsAdmin(db: Database, input: RaceSessionProof & { idempotencyKey: string | null; request: unknown },
  now = new Date()): Promise<CourseDetailsResult> {
  const parsed = courseDetailsRequestSchema.safeParse(input.request);
  const key = courseDetailsIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!parsed.success || !key.success || key.data !== `course-details:${parsed.data.requestId}`) return { status: "invalid-request" };
  const intent = parsed.data;
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const [before] = await tx.select({ lengthMeters: schema.courses.lengthMeters, climbMeters: schema.courses.climbMeters })
      .from(schema.courses).where(and(eq(schema.courses.id, intent.courseId), eq(schema.courses.raceId, raceId))).for("update");
    if (!before) return { status: "not-found" };
    await tx.update(schema.courses).set({ lengthMeters: intent.lengthMeters, climbMeters: intent.climbMeters })
      .where(and(eq(schema.courses.id, intent.courseId), eq(schema.courses.raceId, raceId)));
    if (before.lengthMeters !== intent.lengthMeters || before.climbMeters !== intent.climbMeters) {
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "course", entityId: intent.courseId, requestId: intent.requestId,
        action: "COURSE_DETAILS_CHANGED_BY_ADMIN", actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId,
        before, after: { lengthMeters: intent.lengthMeters, climbMeters: intent.climbMeters }, createdAt: now });
    }
    return { status: "saved", response: courseDetailsResponseSchema.parse({ formatVersion: 1, replayed: false, requestId: intent.requestId,
      raceId, request: intent, savedAt: now.toISOString() }) };
  });
}
