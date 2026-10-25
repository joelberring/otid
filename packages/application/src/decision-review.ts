import { and, asc, eq, inArray } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { decisionHidingReadout, OVERLAY_DECISION_CAUSES, type DecisionReview, type DecisionRevision } from "@o-tid/domain";
import type { DbExecutor } from "./snapshot";

type Cause = typeof schema.resultRevisions.$inferSelect["cause"];

/**
 * Steg 45: löpare vars gällande beslut döljer en senare avläsning (`decisionHidingReadout`). Bara löpare med något
 * kvarliggande beslut läses i sin helhet, så att listan över hela tävlingen är billig.
 */
export async function loadDecisionReviews(tx: DbExecutor, raceId: string, entryIds: readonly string[]): Promise<Map<string, DecisionReview>> {
  if (entryIds.length === 0) return new Map();
  const withDecision = (await tx.selectDistinct({ entryId: schema.resultRevisions.entryId }).from(schema.resultRevisions).where(and(
    eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, [...entryIds]),
    inArray(schema.resultRevisions.cause, OVERLAY_DECISION_CAUSES as Cause[])))).map((row) => row.entryId);
  if (withDecision.length === 0) return new Map();
  const rows = await tx.select({ entryId: schema.resultRevisions.entryId, revision: schema.resultRevisions.revision,
    cause: schema.resultRevisions.cause, evaluation: schema.resultRevisions.evaluation, readoutId: schema.resultRevisions.readoutId })
    .from(schema.resultRevisions).where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, withDecision)))
    .orderBy(asc(schema.resultRevisions.entryId), asc(schema.resultRevisions.revision));
  const byEntry = new Map<string, DecisionRevision[]>();
  for (const row of rows) {
    byEntry.set(row.entryId, [...byEntry.get(row.entryId) ?? [], { revision: row.revision, cause: row.cause,
      evaluation: row.evaluation, readoutId: row.readoutId }]);
  }
  const reviews = new Map<string, DecisionReview>();
  for (const [entryId, revisions] of byEntry) {
    const review = decisionHidingReadout(revisions);
    if (review) reviews.set(entryId, review);
  }
  return reviews;
}
