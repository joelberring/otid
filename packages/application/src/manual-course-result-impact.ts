import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { manualCourseResultImpactResponseSchema, type ManualCourseResultImpactResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const decisions = {
  MANUAL_DID_NOT_START: "DNS", START_CHECKIN_DID_NOT_START: "CHECKIN_DNS",
  MANUAL_DISQUALIFICATION: "DSQ", MANUAL_RESULT_APPROVAL: "APPROVAL",
  MANUAL_DID_NOT_FINISH: "DNF", MANUAL_OUT_OF_COMPETITION: "OOC", MANUAL_WITHOUT_TIMING: "NT"
} as const;

export type ManualCourseResultImpact =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" | "too-large" }
  | { status: "ok"; response: ManualCourseResultImpactResponse };

function effectiveManualDecision(cause: string, revision: typeof schema.resultRevisions.$inferSelect) {
  const decision = Object.hasOwn(decisions, cause) ? decisions[cause as keyof typeof decisions] : "NONE";
  if (decision === "NONE") return decision;
  const linked = (decision === "DNS" && revision.didNotStartDecisionId !== null) ||
    (decision === "CHECKIN_DNS" && revision.startCheckinDnsDecisionId !== null) ||
    (decision === "DSQ" && revision.disqualificationDecisionId !== null) ||
    (decision === "APPROVAL" && revision.approvalDecisionId !== null) ||
    (decision === "DNF" && revision.didNotFinishDecisionId !== null) ||
    (decision === "OOC" && revision.notCompetingDecisionId !== null) ||
    (decision === "NT" && revision.withoutTimingDecisionId !== null);
  return linked ? decision : "NONE";
}

async function countImpact(tx: Transaction, raceId: string, classId: string) {
  const [entryCount] = await tx.select({ count: count() }).from(schema.entries).where(and(
    eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)
  ));
  const [resultCount] = await tx.select({ count: count() }).from(schema.resultRevisions).innerJoin(schema.entries, and(
    eq(schema.entries.id, schema.resultRevisions.entryId), eq(schema.entries.raceId, schema.resultRevisions.raceId)
  )).where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)));
  return { entryCount: Number(entryCount?.count ?? 0), historicalResultRevisions: Number(resultCount?.count ?? 0) };
}

export async function getManualCourseResultImpactAsAdministrator(
  db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & { classId: string },
  now = new Date()
): Promise<ManualCourseResultImpact> {
  if (!uuid.test(input.raceId) || !uuid.test(input.classId)) return { status: "invalid-request" };
  if (!Number.isFinite(now.getTime())) throw new Error("Lästiden är ogiltig");
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken, raceId: input.raceId, capability: "MANAGE_RACE"
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const [current] = await tx.select({ raceId: schema.races.id, snapshotVersion: schema.races.snapshotVersion,
      classId: schema.classes.id, className: schema.classes.name, courseId: schema.courses.id, courseName: schema.courses.name,
      courseVersionId: schema.courseVersions.id, courseVersion: schema.courseVersions.version })
      .from(schema.classes).innerJoin(schema.races, eq(schema.races.id, schema.classes.raceId))
      .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
      .innerJoin(schema.courses, and(eq(schema.courses.id, schema.courseVersions.courseId), eq(schema.courses.raceId, schema.races.id)))
      .where(and(eq(schema.classes.id, input.classId), eq(schema.classes.raceId, authorization.principal.raceId),
        isNull(schema.classes.externalSource), isNull(schema.classes.externalId),
        isNull(schema.courses.externalSource), isNull(schema.courses.externalId)));
    if (!current) return { status: "not-found" } as const;
    const impact = await countImpact(tx, current.raceId, current.classId);
    if (impact.entryCount > 10_000) return { status: "too-large" } as const;
    const controls = await tx.select({ code: schema.controls.code }).from(schema.courseControls)
      .innerJoin(schema.controls, and(eq(schema.controls.id, schema.courseControls.controlId), eq(schema.controls.raceId, current.raceId)))
      .where(eq(schema.courseControls.courseVersionId, current.courseVersionId)).orderBy(asc(schema.courseControls.sequence));
    if (controls.length === 0) return { status: "not-found" } as const;
    const revisions = await tx.select().from(schema.resultRevisions).innerJoin(schema.entries, and(
      eq(schema.entries.id, schema.resultRevisions.entryId), eq(schema.entries.raceId, schema.resultRevisions.raceId)
    )).innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.resultRevisions.courseVersionId))
      .innerJoin(schema.courses, and(eq(schema.courses.id, schema.courseVersions.courseId), eq(schema.courses.raceId, current.raceId)))
      .where(and(eq(schema.resultRevisions.raceId, current.raceId), eq(schema.entries.classId, current.classId)))
      .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision), desc(schema.resultRevisions.id));
    const latest = new Map<string, typeof revisions[number]>();
    for (const row of revisions) if (!latest.has(row.result_revision.entryId)) latest.set(row.result_revision.entryId, row);
    const response = manualCourseResultImpactResponseSchema.parse({
      formatVersion: 1, raceId: current.raceId, classId: current.classId, className: current.className,
      course: { id: current.courseId, name: current.courseName, currentVersionId: current.courseVersionId,
        currentVersion: current.courseVersion, controlCodes: controls.map(control => control.code) },
      snapshotVersion: current.snapshotVersion,
      totals: { ...impact, entriesWithResults: latest.size },
      entries: [...latest.entries()].map(([entryId, row]) => { const revision = row.result_revision; return ({ entryId,
        displayName: `${row.entry.givenName} ${row.entry.familyName}`,
        latestResultRevision: {
        id: revision.id, revision: revision.revision, status: revision.status, courseVersionId: revision.courseVersionId,
        snapshotVersion: revision.snapshotVersion, published: revision.published,
        effectiveManualDecision: effectiveManualDecision(revision.cause, revision)
      } }); }),
      generatedAt: now.toISOString()
    });
    return { status: "ok", response } as const;
  }, { isolationLevel: "repeatable read" });
}
