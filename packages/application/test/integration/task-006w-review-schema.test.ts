import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-05T10:00:00.000Z"), hash = "a".repeat(64);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());
async function fixture(effect: "CONFLICT" | "UNCHANGED" | "APPLIED" = "CONFLICT") {
  const eventId = randomUUID(), raceId = randomUUID(), entryId = randomUUID(), courseId = randomUUID(), courseVersionId = randomUUID(),
    classId = randomUUID(), actorCredentialId = randomUUID(), deviceId = randomUUID(), conflictRequestId = randomUUID();
  const createdRevisionId = effect === "APPLIED" ? randomUUID() : null;
  await db.transaction(async tx => {
    await tx.insert(schema.events).values({ id: eventId, name: "Synthetic review schema", startsOn: "2026-09-05", timeZone: "Europe/Stockholm" });
    await tx.insert(schema.races).values({ id: raceId, eventId, name: "Synthetic", raceDate: "2026-09-05" });
    await tx.insert(schema.courses).values({ id: courseId, raceId, name: "Synthetic" });
    await tx.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
    await tx.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Synthetic" });
    await tx.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Synthetic", familyName: "Runner" });
    await tx.insert(schema.pairingAdminAccessCredentials).values({ id: actorCredentialId, raceId, capability: "FINISH_FOREST_WATCH",
      label: "Synthetic", secretHash: hash, issuedAt: now, expiresAt: new Date("2026-09-05T18:00:00.000Z") });
    await tx.insert(schema.startCheckinDevices).values({ id: deviceId, raceId, actorCredentialId, capability: "FINISH_FOREST_WATCH", label: "Synthetic", registeredAt: now });
    await tx.insert(schema.startCheckinOperations).values({ requestId: conflictRequestId, deviceId, actorCredentialId, raceId, entryId,
      localSequence: 1, packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0, contentHash: hash,
      intent: {}, receipt: {}, observedAt: now, receivedAt: now, effect, resultingRevision: effect === "APPLIED" ? 1 : 0, createdRevisionId,
      conflictReason: effect === "CONFLICT" ? "STALE_REVISION" : null });
    if (createdRevisionId) await tx.insert(schema.startCheckinRevisions).values({ id: createdRevisionId, requestId: conflictRequestId,
      raceId, entryId, revision: 1, startState: "UNMARKED", manualReturnRegistered: false });
  });
  const review = { id: randomUUID(), requestId: randomUUID(), raceId, entryId, actorCredentialId, capability: "FINISH_FOREST_WATCH" as const,
    decision: "KEEP_CURRENT_STATE" as const, reason: "Synthetic review", sourceHash: hash, intentCanonicalJson: "{}", intentHash: hash, reviewedAt: now };
  const item = { reviewId: review.id, conflictRequestId, raceId, entryId, contentHash: hash, operationEffect: "CONFLICT" as const };
  return { review, item };
}

describe("immutable conflict review schema", () => {
  it("requires exact operation hash and conflict effect without duplicate-key masking", async () => {
    const f = await fixture(); await db.insert(schema.startCheckinConflictReviews).values(f.review);
    await expect(db.insert(schema.startCheckinConflictReviewItems).values({ ...f.item, contentHash: "b".repeat(64) }))
      .rejects.toMatchObject({ cause: { code: "23503", constraint: "start_checkin_conflict_review_item_operation_source_fk" } });
    for (const effect of ["UNCHANGED", "APPLIED"] as const) {
      const other = await fixture(effect); await db.insert(schema.startCheckinConflictReviews).values(other.review);
      await expect(db.insert(schema.startCheckinConflictReviewItems).values(other.item))
        .rejects.toMatchObject({ cause: { code: "23503", constraint: "start_checkin_conflict_review_item_operation_source_fk" } });
    }
    await db.insert(schema.startCheckinConflictReviewItems).values(f.item);
    expect(await db.select().from(schema.startCheckinConflictReviewItems).where(eq(schema.startCheckinConflictReviewItems.reviewId, f.review.id))).toHaveLength(1);
  });
  it("binds item to header scope and permits only one review of an original report", async () => {
    const f = await fixture(), other = await fixture();
    await db.insert(schema.startCheckinConflictReviews).values([f.review, other.review]);
    await expect(db.insert(schema.startCheckinConflictReviewItems).values({ ...f.item, reviewId: other.review.id }))
      .rejects.toMatchObject({ cause: { code: "23503", constraint: "start_checkin_conflict_review_item_review_scope_fk" } });
    await db.insert(schema.startCheckinConflictReviewItems).values(f.item);
    const repeated = { ...f.review, id: randomUUID(), requestId: randomUUID() };
    await db.insert(schema.startCheckinConflictReviews).values(repeated);
    await expect(db.insert(schema.startCheckinConflictReviewItems).values({ ...f.item, reviewId: repeated.id }))
      .rejects.toMatchObject({ cause: { code: "23505" } });
    await expect(db.insert(schema.startCheckinConflictReviews).values({ ...f.review, id: randomUUID() }))
      .rejects.toMatchObject({ cause: { code: "23505" } });
  });
  it("requires finish authority in the same race and structured canonical intent", async () => {
    const f = await fixture(), other = await fixture();
    await expect(db.insert(schema.startCheckinConflictReviews).values({ ...f.review, actorCredentialId: other.review.actorCredentialId }))
      .rejects.toMatchObject({ cause: { code: "23503", constraint: "start_checkin_conflict_review_actor_scope_fk" } });
    await expect(db.insert(schema.startCheckinConflictReviews).values({ ...f.review, capability: "START_CHECKIN" }))
      .rejects.toMatchObject({ cause: { code: "23514", constraint: "start_checkin_conflict_review_capability_check" } });
    await expect(db.insert(schema.startCheckinConflictReviews).values({ ...f.review, intentCanonicalJson: "[]" }))
      .rejects.toMatchObject({ cause: { code: "23514", constraint: "start_checkin_conflict_review_intent_check" } });
  });
  it("preserves immutable rows and rolls back an incomplete review transaction", async () => {
    const f = await fixture();
    await expect(db.transaction(async tx => {
      await tx.insert(schema.startCheckinConflictReviews).values(f.review);
      await tx.insert(schema.startCheckinConflictReviewItems).values(f.item);
      throw new Error("Synthetic late failure");
    })).rejects.toThrow("Synthetic late failure");
    expect(await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.id, f.review.id))).toHaveLength(0);
    await db.insert(schema.startCheckinConflictReviews).values(f.review); await db.insert(schema.startCheckinConflictReviewItems).values(f.item);
    await expect(db.update(schema.startCheckinConflictReviews).set({ reason: "Changed" }).where(eq(schema.startCheckinConflictReviews.id, f.review.id))).rejects.toThrow();
    await expect(db.delete(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.id, f.review.id))).rejects.toThrow();
    await expect(db.update(schema.startCheckinConflictReviewItems).set({ contentHash: "b".repeat(64) }).where(eq(schema.startCheckinConflictReviewItems.reviewId, f.review.id))).rejects.toThrow();
    await expect(db.delete(schema.startCheckinConflictReviewItems).where(eq(schema.startCheckinConflictReviewItems.reviewId, f.review.id))).rejects.toThrow();
    const [original] = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.requestId, f.item.conflictRequestId));
    expect(original).toMatchObject({ effect: "CONFLICT", contentHash: hash });
  });
});
