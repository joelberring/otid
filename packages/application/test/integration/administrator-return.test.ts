import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { type AdministratorReturnRequest, administratorForestWatchResponseSchema } from "@o-tid/contracts";
import {
  registerAdministratorReturn,
  withdrawAdministratorReturn,
  correctAdministratorStart,
  listCheckinHistoryAsAdmin,
  readStartCheckinConflictReviewAsAdmin,
  reviewStartCheckinConflictsAsAdmin,
  listAdministratorForestWatch
} from "../../src";
import { raceLogin, registerTestAccount } from "./accounts";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.startsWith("/otid_") || !new URL(url).pathname.includes("test")) throw new Error("Explicit isolated test database required");
const { db, pool } = createDatabase(url);
afterAll(() => pool.end());
async function authority(raceId: string, role: "ADMIN" | "FUNCTIONARY") {
  const login = await raceLogin(db, raceId, role);
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken, actorId: login.accountId };
}
async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), classId = randomUUID(), courseId = randomUUID(), versionId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "TASK054 synthetic", startsOn: "2026-09-12", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Synthetic", raceDate: "2026-09-12" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Synthetic" });
  await db.insert(schema.courseVersions).values({ id: versionId, courseId, version: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, name: "Synthetic", startRule: "PUNCH", courseVersionId: versionId });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Synthetic", familyName: "Runner" });
  const auth = await authority(raceId, "ADMIN");
  const request: AdministratorReturnRequest = { formatVersion: 1, requestId: randomUUID(), entryId,
    packageVersion: 1, expectedEntryVersion: 1, expectedRevision: 0, observedAt: new Date().toISOString(), expectedStartState: "UNMARKED" };
  return { raceId, entryId, courseVersionId: versionId, auth, request };
}

it("TASK063 administratören granskar administrativa konflikter med ärlig behörighet och oförändrade original", async () => {
  const f = await fixture();
  expect((await registerAdministratorReturn(db, { ...f.auth, request: f.request })).status).toBe("stored");
  const stale = await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, requestId: randomUUID() } });
  expect(stale.status === "stored" && stale.response.receipt.effect.kind).toBe("CONFLICT");
  const before = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId));
  const staff = f.auth;
  // Funktionären granskar inga konflikter (ADR-0172 beslut 3).
  const functionary = await authority(f.raceId, "FUNCTIONARY");
  expect((await readStartCheckinConflictReviewAsAdmin(db, { ...functionary, entryId: f.entryId })).status).toBe("forbidden");
  const candidate = await readStartCheckinConflictReviewAsAdmin(db, { ...staff, entryId: f.entryId });
  if (candidate.status !== "ok") throw new Error("Missing review source");
  expect(candidate.response.source.conflicts).toHaveLength(1);
  expect(candidate.response.source.conflicts[0]?.deviceLabel).toBe("Onlineadministration");
  const intent = {
    formatVersion: 1, requestId: randomUUID(), entryId: f.entryId, sourceHash: candidate.response.sourceHash,
    conflictRequestIds: candidate.response.source.conflicts.map(row => row.operation.requestId),
    decision: "KEEP_CURRENT_STATE", reason: "Syntetisk granskning av administrativ rapport"
  };
  const review = (body = intent) => reviewStartCheckinConflictsAsAdmin(db, { ...staff, readBody: async () => body });
  const reviewed = await review();
  expect(reviewed.status).toBe("reviewed");
  expect(await review()).toEqual(reviewed);
  expect((await review({ ...intent, reason: "Annat beslut" })).status).toBe("conflict");
  const headers = await db.select().from(schema.startCheckinConflictReviews).where(eq(schema.startCheckinConflictReviews.raceId, f.raceId));
  expect(headers).toHaveLength(1);
  expect(headers[0]).toMatchObject({ actorAccountId: staff.actorId });
  const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, headers[0]!.id));
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ actorId: staff.actorId, actorKind: "USER_ACCOUNT" });
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toEqual(before);
  const roster = await listAdministratorForestWatch(db, functionary);
  expect(roster.status === "ok" && roster.response.devices).toEqual([]);
  expect(roster.status === "ok" && roster.response.entries[0]?.conflictingReports).toBe(false);
  const history = await listCheckinHistoryAsAdmin(db, { ...f.auth, entryId: f.entryId, limit: 25 });
  if (history.status !== "ok") throw new Error("Missing reviewed history");
  expect(history.response.rows.find(row => row.effect.kind === "CONFLICT")?.reviewed).toMatchObject({
    decision: "KEEP_CURRENT_STATE", reason: intent.reason });
  expect(history.response.rows.filter(row => row.effect.kind !== "CONFLICT").every(row => row.reviewed === null)).toBe(true);
  const [originalEntry] = await db.select().from(schema.entries).where(eq(schema.entries.id, f.entryId));
  const secondId = randomUUID();
  await db.insert(schema.entries).values({ id: secondId, raceId: f.raceId, classId: originalEntry!.classId,
    givenName: "Synthetic", familyName: "Second" });
  const secondHistory = await listCheckinHistoryAsAdmin(db, { ...f.auth, entryId: secondId, limit: 25 });
  expect(secondHistory.status === "ok" && secondHistory.response.rows).toEqual([]);
  expect((await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, requestId: randomUUID() } })).status).toBe("stored");
  expect(await review()).toEqual(reviewed);
  const later = await listAdministratorForestWatch(db, functionary);
  expect(later.status === "ok" && later.response.entries[0]?.conflictingReports).toBe(true);
});

it("TASK061 extends only admin roster and preserves the current start episode across return corrections", async () => {
  const f = await fixture(), first = "2026-09-12T08:00:00.000Z", later = "2026-09-12T08:30:00.000Z";
  const request = { formatVersion: 1, entryId: f.entryId, packageVersion: 1, expectedEntryVersion: 1,
    expectedRevision: 0, observedAt: first, targetStartState: "STARTED", requestId: randomUUID() };
  expect((await correctAdministratorStart(db, { ...f.auth, request })).status).toBe("stored");
  for (const [index, service] of [registerAdministratorReturn, withdrawAdministratorReturn].entries()) {
    expect((await service(db, { ...f.auth, request: { ...f.request, requestId: randomUUID(), expectedRevision: index + 1,
      expectedStartState: "STARTED", observedAt: later } })).status).toBe("stored");
  }
  const noChange = await correctAdministratorStart(db, { ...f.auth, request: { ...request, requestId: randomUUID(), expectedRevision: 3, observedAt: later } });
  expect(noChange.status === "stored" && noChange.response.receipt.effect.kind).toBe("UNCHANGED");
  const stale = await correctAdministratorStart(db, { ...f.auth, request: { ...request, requestId: randomUUID(), targetStartState: "REPORTED_NOT_STARTED" } });
  expect(stale.status === "stored" && stale.response.receipt.effect.kind).toBe("CONFLICT");
  const admin = await listAdministratorForestWatch(db, f.auth);
  if (admin.status !== "ok") throw new Error("Missing admin roster");
  expect(admin.response.reportedStarts).toEqual([{ entryId: f.entryId, observedAt: first }]);
  expect(administratorForestWatchResponseSchema.safeParse({ ...admin.response, reportedStarts: [] }).success).toBe(false);
  expect(administratorForestWatchResponseSchema.safeParse({ ...admin.response, reportedStarts: [...admin.response.reportedStarts, ...admin.response.reportedStarts] }).success).toBe(false);
  // Funktionären läser samma kvar i skogen-lista som administratören.
  const staff = await authority(f.raceId, "FUNCTIONARY");
  const personnel = await listAdministratorForestWatch(db, staff);
  if (personnel.status !== "ok") throw new Error("Missing functionary roster");
  expect(personnel.response.reportedStarts).toEqual(admin.response.reportedStarts);
  expect((await correctAdministratorStart(db, { ...f.auth, request: { ...request, requestId: randomUUID(), expectedRevision: 3, targetStartState: "UNMARKED" } })).status).toBe("stored");
  const reset = await listAdministratorForestWatch(db, f.auth);
  expect(reset.status === "ok" && reset.response.reportedStarts[0]?.observedAt).toBeNull();
  expect((await correctAdministratorStart(db, { ...f.auth, request: { ...request, requestId: randomUUID(), expectedRevision: 4, observedAt: later } })).status).toBe("stored");
  const restarted = await listAdministratorForestWatch(db, f.auth);
  expect(restarted.status === "ok" && restarted.response.reportedStarts[0]?.observedAt).toBe(later);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(0);
});

it("TASK057 pages tied receipt times, validates scope, preserves all source roles/effects and never writes", async () => {
  const f = await fixture();
  const functionary = await authority(f.raceId, "FUNCTIONARY");
  const now = new Date();
  const base = { formatVersion: 1, entryId: f.entryId, packageVersion: 1, expectedEntryVersion: 1,
    expectedRevision: 0, observedAt: now.toISOString(), targetStartState: "UNMARKED" };
  for (const targetStartState of ["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"]) {
    expect((await correctAdministratorStart(db, { ...f.auth, request: { ...base, requestId: randomUUID(), targetStartState } }, now)).status).toBe("stored");
  }
  // Funktionären är en egen källa: återkomst och sedan startläget tillbaka till omarkerad.
  expect((await registerAdministratorReturn(db, { ...functionary, request: { ...f.request, requestId: randomUUID(),
    expectedRevision: 1, expectedStartState: "STARTED", observedAt: now.toISOString() } }, now)).status).toBe("stored");
  expect((await correctAdministratorStart(db, { ...functionary, request: { ...base, requestId: randomUUID(),
    expectedRevision: 2, targetStartState: "UNMARKED" } }, now)).status).toBe("stored");
  const before = await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId));
  const first = await listCheckinHistoryAsAdmin(db, { ...f.auth, entryId: f.entryId, limit: 2 });
  if (first.status !== "ok" || !first.response.nextCursor) throw new Error("Missing first history page");
  const rows = [...first.response.rows]; let cursor: string | null = first.response.nextCursor;
  while (cursor) {
    const page = await listCheckinHistoryAsAdmin(db, { ...f.auth, entryId: f.entryId, limit: 2, cursor });
    if (page.status !== "ok") throw new Error("Invalid next page");
    rows.push(...page.response.rows); cursor = page.response.nextCursor;
  }
  expect(rows.map(row => row.requestId)).toEqual(before.map(row => row.requestId).sort().reverse());
  expect(new Set(rows.map(row => row.source))).toEqual(new Set(["ADMIN", "FUNCTIONARY"]));
  expect(new Set(rows.map(row => row.effect.kind))).toEqual(new Set(["APPLIED", "UNCHANGED", "CONFLICT"]));
  expect((await listCheckinHistoryAsAdmin(db, { ...f.auth, entryId: randomUUID(), limit: 2, cursor: first.response.nextCursor })).status).toBe("invalid-request");
  expect((await listCheckinHistoryAsAdmin(db, { ...f.auth, entryId: randomUUID(), limit: 2 })).status).toBe("not-found");
  const badCursor = JSON.parse(Buffer.from(first.response.nextCursor, "base64url").toString("utf8")) as Record<string, unknown>;
  badCursor.receivedAt = "not-a-time";
  expect((await listCheckinHistoryAsAdmin(db, { ...f.auth, entryId: f.entryId, limit: 2, cursor: Buffer.from(JSON.stringify(badCursor)).toString("base64url") })).status).toBe("invalid-request");
  expect((await listCheckinHistoryAsAdmin(db, { ...functionary, entryId: f.entryId, limit: 2 })).status).toBe("forbidden");
  expect(await db.select().from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.raceId, f.raceId))).toEqual(before);
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(0);
});

it("TASK056 corrects start without erasing return, binds replay and withdraws checkin DNS", async () => {
  const f = await fixture();
  const { expectedStartState, ...base } = f.request;
  expect(expectedStartState).toBe("UNMARKED");
  const negative = { ...base, targetStartState: "REPORTED_NOT_STARTED" };
  const start = { ...base, requestId: randomUUID(), expectedRevision: 1, targetStartState: "STARTED" };
  expect((await correctAdministratorStart(db, { ...f.auth, request: negative })).status).toBe("stored");
  const dns = await listAdministratorForestWatch(db, f.auth);
  expect(dns.status === "ok" && dns.response.entries[0]?.activeDns).toBe(true);
  const started = await correctAdministratorStart(db, { ...f.auth, request: start });
  expect(started.status === "stored" && started.response.receipt.effect.kind).toBe("APPLIED");
  const active = await listAdministratorForestWatch(db, f.auth);
  expect(active.status === "ok" && active.response.entries[0]).toMatchObject({ startState: "STARTED", activeDns: false });
  expect((await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, expectedStartState: "REPORTED_NOT_STARTED" } })).status).toBe("conflict");
  const returned = await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, requestId: randomUUID(), expectedRevision: 2, expectedStartState: "STARTED" } });
  expect(returned.status === "stored" && returned.response.receipt.effect.kind).toBe("APPLIED");
  expect((await correctAdministratorStart(db, { ...f.auth, request: { ...base, requestId: randomUUID(), expectedRevision: 3, targetStartState: "UNMARKED" } })).status).toBe("stored");
  const conflict = await correctAdministratorStart(db, { ...f.auth, request: { ...negative, requestId: randomUUID(), expectedRevision: 4 } });
  expect(conflict.status === "stored" && conflict.response.receipt.effect.kind).toBe("CONFLICT");
  const replay = await correctAdministratorStart(db, { ...f.auth, request: start });
  expect(replay.status === "stored" && replay.response.replayed).toBe(true);
  expect((await correctAdministratorStart(db, { ...f.auth, request: { ...start, targetStartState: "UNMARKED" } })).status).toBe("conflict");
  const staff = await authority(f.raceId, "FUNCTIONARY");
  const roster = await listAdministratorForestWatch(db, staff);
  expect(roster.status === "ok" && roster.response.entries[0]).toMatchObject({ revision: 4, startState: "UNMARKED", manualReturnRegistered: true });
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(1);
});

it("TASK054 concurrent retry is one honest source/operation, altered intent conflicts and old roster stays readable", async () => {
  const f = await fixture();
  const results = await Promise.all([1, 2].map(() => registerAdministratorReturn(db, { ...f.auth, request: f.request })));
  expect(results.every(row => row.status === "stored" && row.response.receipt.effect.kind === "APPLIED")).toBe(true);
  expect(results.filter(row => row.status === "stored" && !row.response.replayed)).toHaveLength(1);
  expect((await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, observedAt: "2026-01-01T00:00:00.000Z" } })).status).toBe("conflict");
  const other = await authority(f.raceId, "ADMIN");
  expect((await registerAdministratorReturn(db, { ...other, request: f.request })).status).toBe("conflict");
  // Ett konto utan behörighet på eventet.
  const unrelated = await registerTestAccount(db);
  expect((await registerAdministratorReturn(db, { ...unrelated.proof, raceId: f.raceId, request: { ...f.request, requestId: randomUUID() } })).status)
    .toBe("unauthorized");
  const personnel = await authority(f.raceId, "FUNCTIONARY");
  const roster = await listAdministratorForestWatch(db, personnel);
  expect(roster.status === "ok" && roster.response.entries[0]?.manualReturnRegistered).toBe(true);
  expect(roster.status === "ok" && roster.response.devices).toEqual([]);
  const adminRoster = await listAdministratorForestWatch(db, f.auth);
  expect(adminRoster.status === "ok" && adminRoster.response.entries[0]?.forestState).toBe("RETURNED");
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(0);
  expect(await db.select().from(schema.startCheckinDevices).where(eq(schema.startCheckinDevices.raceId, f.raceId))).toHaveLength(1);
  const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, f.raceId));
  expect(audit.filter(row => row.action === "START_CHECKIN_OPERATION_STORED")).toMatchObject([{ actorKind: "USER_ACCOUNT", actorId: f.auth.actorId }]);
  const correctionRequest = { ...f.request, requestId: randomUUID(), expectedRevision: 1 };
  const correction = await withdrawAdministratorReturn(db, { ...f.auth, request: correctionRequest });
  expect(correction.status === "stored" && correction.response.receipt.effect.kind).toBe("APPLIED");
  const restored = await registerAdministratorReturn(db, { ...f.auth,
    request: { ...f.request, requestId: randomUUID(), expectedRevision: 2 } });
  expect(restored.status === "stored" && restored.response.receipt.effect.kind).toBe("APPLIED");
  const replayCorrection = await withdrawAdministratorReturn(db, { ...f.auth, request: correctionRequest });
  expect(replayCorrection.status === "stored" && replayCorrection.response.replayed).toBe(true);
  const latestRoster = await listAdministratorForestWatch(db, f.auth);
  expect(latestRoster.status === "ok" && latestRoster.response.entries[0]?.manualReturnRegistered).toBe(true);
  expect((await withdrawAdministratorReturn(db, { ...f.auth, request: f.request })).status).toBe("conflict");
  expect((await registerAdministratorReturn(db, { ...f.auth, request: correctionRequest })).status).toBe("conflict");
  expect((await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, requestId: randomUUID(), expectedRevision: 3, expectedStartState: "STARTED" } })).status).toBe("invalid-request");
  const stale = await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, requestId: randomUUID() } });
  expect(stale.status === "stored" && stale.response.receipt.effect.kind).toBe("CONFLICT");
});

it("TASK054 return withdraws checkin DNS without rewriting its result or fabricating a start", async () => {
  // Funktionären vid starten rapporterar ej start; det ger ett DNS-resultat (ADR-0172 beslut 3).
  const f = await fixture(), staff = await authority(f.raceId, "FUNCTIONARY");
  const { expectedStartState, ...base } = f.request;
  expect(expectedStartState).toBe("UNMARKED");
  expect((await correctAdministratorStart(db, { ...staff, request: { ...base, requestId: randomUUID(),
    targetStartState: "REPORTED_NOT_STARTED" } })).status).toBe("stored");
  const original = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId));
  expect(original).toHaveLength(1);
  const result = await registerAdministratorReturn(db, { ...f.auth, request: { ...f.request, expectedRevision: 1, expectedStartState: "REPORTED_NOT_STARTED" } });
  expect(result.status === "stored" && result.response.receipt.effect.kind).toBe("APPLIED");
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toEqual(original);
  const roster = await listAdministratorForestWatch(db, f.auth);
  expect(roster.status === "ok" && roster.response.entries[0]).toMatchObject({ startState: "REPORTED_NOT_STARTED", manualReturnRegistered: true, activeDns: false });
  const restoredDns = await withdrawAdministratorReturn(db, { ...f.auth,
    request: { ...f.request, requestId: randomUUID(), expectedRevision: 2, expectedStartState: "REPORTED_NOT_STARTED" } });
  expect(restoredDns.status === "stored" && restoredDns.response.receipt.effect.kind).toBe("APPLIED");
  expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId))).toHaveLength(2);
  const restoredRoster = await listAdministratorForestWatch(db, f.auth);
  expect(restoredRoster.status === "ok" && restoredRoster.response.entries[0]).toMatchObject({
    startState: "REPORTED_NOT_STARTED", manualReturnRegistered: false, activeDns: true });
});
