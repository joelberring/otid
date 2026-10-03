import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { canonicalStartCheckinConflictReviewRequest, StartCheckinConflictReviewRequestSchema, StartCheckinConflictReviewResponseSchema } from "@o-tid/contracts";
import type { DbExecutor } from "./snapshot";

export const reviewHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function validateStoredCheckinConflictReview(row: typeof schema.startCheckinConflictReviews.$inferSelect) {
  const intent = StartCheckinConflictReviewRequestSchema.parse(JSON.parse(row.intentCanonicalJson) as unknown);
  const canonical = canonicalStartCheckinConflictReviewRequest(intent);
  if (new TextDecoder().decode(canonical) !== row.intentCanonicalJson || reviewHash(canonical) !== row.intentHash ||
    intent.requestId !== row.requestId || intent.entryId !== row.entryId || intent.sourceHash !== row.sourceHash ||
    intent.reason !== row.reason || (row.capability !== "FINISH_FOREST_WATCH" && row.capability !== "MANAGE_RACE") || intent.decision !== row.decision) {
    throw new Error("Invalid stored conflict review");
  }
  return { intent, response: StartCheckinConflictReviewResponseSchema.parse({ formatVersion: 1, reviewId: row.id,
    requestId: row.requestId, raceId: row.raceId, entryId: row.entryId, sourceHash: row.sourceHash,
    conflictRequestIds: intent.conflictRequestIds, decision: row.decision, reviewedAt: row.reviewedAt.toISOString() }) };
}

/** Validate immutable membership before removing any report from the unresolved projection. */
export async function reviewedCheckinRequests(tx: DbExecutor, raceId: string,
  operations: ReadonlyMap<string, typeof schema.startCheckinOperations.$inferSelect>, entryId?: string) {
  const [headers, items] = await Promise.all([
    tx.select().from(schema.startCheckinConflictReviews).where(and(eq(schema.startCheckinConflictReviews.raceId, raceId), entryId ? eq(schema.startCheckinConflictReviews.entryId, entryId) : undefined)).limit(100_001),
    tx.select().from(schema.startCheckinConflictReviewItems).where(and(eq(schema.startCheckinConflictReviewItems.raceId, raceId), entryId ? eq(schema.startCheckinConflictReviewItems.entryId, entryId) : undefined)).limit(100_001)
  ]);
  if (headers.length > 100_000 || items.length > 100_000) throw new Error("Conflict review projection too large");
  const byHeader = new Map<string, typeof items>();
  for (const item of items) {
    const group = byHeader.get(item.reviewId) ?? []; group.push(item); byHeader.set(item.reviewId, group);
  }
  const reviewed = new Map<string, { decision: "KEEP_CURRENT_STATE"; reason: string; reviewedAt: string }>();
  for (const header of headers) {
    const { intent } = validateStoredCheckinConflictReview(header);
    const members = (byHeader.get(header.id) ?? []).sort((a, b) => a.conflictRequestId < b.conflictRequestId ? -1 : 1);
    if (members.length !== intent.conflictRequestIds.length) throw new Error("Incomplete conflict review membership");
    members.forEach((item, index) => {
      const operation = operations.get(item.conflictRequestId);
      if (item.conflictRequestId !== intent.conflictRequestIds[index] || item.entryId !== header.entryId ||
        !operation || operation.entryId !== header.entryId || operation.raceId !== raceId ||
        operation.effect !== "CONFLICT" || item.operationEffect !== "CONFLICT" || operation.contentHash !== item.contentHash || reviewed.has(item.conflictRequestId)) {
        throw new Error("Invalid conflict review membership");
      }
      reviewed.set(item.conflictRequestId, { decision: intent.decision, reason: intent.reason, reviewedAt: header.reviewedAt.toISOString() });
    });
    byHeader.delete(header.id);
  }
  if (byHeader.size) throw new Error("Orphan conflict review membership");
  return reviewed;
}
