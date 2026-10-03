import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import {
  commitClassStartDrawAsAdmin, issuePairingAdminAccessCredential,
  loginPairingAdmin, previewClassStartDrawAsAdmin, decideStartListPublicationAsAdmin,
  getStartListPublicationPreviewAsAdmin, getPublicStartList, getPublishedStartListXml
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-04T07:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function setup(n: number) {
  const [event] = await db.insert(schema.events).values({ name: `Draw ${n}`, startsOn: "2026-09-04", timeZone: "Europe/Stockholm" }).returning();
  const [race] = await db.insert(schema.races).values({ eventId: event!.id, name: "Race", raceDate: "2026-09-04" }).returning();
  const [course] = await db.insert(schema.courses).values({ raceId: race!.id, name: "Course" }).returning();
  const [version] = await db.insert(schema.courseVersions).values({ courseId: course!.id, version: 1 }).returning();
  const [raceClass] = await db.insert(schema.classes).values({ raceId: race!.id, name: "D21", courseVersionId: version!.id, startRule: "FIXED" }).returning();
  await db.insert(schema.entries).values([
    { raceId: race!.id, classId: raceClass!.id, givenName: "Ada", familyName: "A", fixedStartTime: new Date("2026-09-04T08:00:00Z") },
    { raceId: race!.id, classId: raceClass!.id, givenName: "Bea", familyName: "B" }
  ]);
  const credential = await issuePairingAdminAccessCredential(db, { raceId: race!.id, capability: "DRAW_CLASS_START_TIMES", label: "Draw", expiresAt: new Date("2026-09-04T14:00:00Z") }, { now, secretBytes: Buffer.alloc(32, n) });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { expectedRaceId: race!.id, expectedCapability: "DRAW_CLASS_START_TIMES", now, sessionSecretBytes: Buffer.alloc(32, n + 1), csrfSecretBytes: Buffer.alloc(32, n + 2) });
  if (!login || login.status !== "authenticated") throw new Error("login");
  return { race: race!, raceClass: raceClass!, credential, auth: { raceId: race!.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

describe("TASK 006U PostgreSQL", () => {
  it("rejects changed roster/scope, preserves max-version unchanged entry and frozen publication", async () => {
    const f = await setup(31);
    const parameters = { algorithmVersion: "xorshift32-fisher-yates-v1" as const, seed: 17, firstStartTime: "2026-09-04T10:00:00.000Z", intervalSeconds: 60 };
    const previewRequest = { formatVersion: 1 as const, classId: f.raceClass.id, parameters };
    expect(await previewClassStartDrawAsAdmin(db, { ...f.auth, raceId: randomUUID(), request: previewRequest }, now)).toEqual({ status: "forbidden" });
    expect(await previewClassStartDrawAsAdmin(db, { ...f.auth, request: { ...previewRequest, classId: randomUUID() } }, now)).toEqual({ status: "not-found" });
    const old = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: previewRequest }, now);
    if (old.status !== "ok") throw new Error();
    await db.insert(schema.entries).values({ raceId: f.race.id, classId: f.raceClass.id, givenName: "C", familyName: "C" });
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: `class-start-draw:${randomUUID()}`, request: { ...previewRequest, expectedSnapshotVersion: old.response.snapshotVersion, sourceHash: old.response.sourceHash } }, now)).toEqual({ status: "conflict" });
    const roster = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: previewRequest }, now);
    if (roster.status !== "ok") throw new Error();
    const unchanged = roster.response.entries[0]!;
    await db.update(schema.entries).set({ fixedStartTime: new Date(unchanged.fixedStartTime), version: 2_147_483_647 }).where(eq(schema.entries.id, unchanged.entryId));
    const fresh = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: previewRequest }, now);
    if (fresh.status !== "ok") throw new Error();
    const credential = await issuePairingAdminAccessCredential(db, { raceId: f.race.id, capability: "PUBLISH_START_LIST", label: "Publish", expiresAt: new Date("2026-09-04T14:00:00Z") }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { expectedRaceId: f.race.id, expectedCapability: "PUBLISH_START_LIST", now });
    if (login.status !== "authenticated") throw new Error();
    const auth = { raceId: f.race.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
    expect(await previewClassStartDrawAsAdmin(db, { ...auth, request: previewRequest }, now)).toEqual({ status: "forbidden" });
    const publication = await getStartListPublicationPreviewAsAdmin(db, auth, now);
    if (publication.status !== "ok") throw new Error();
    expect(await decideStartListPublicationAsAdmin(db, { ...auth, idempotencyKey: `start-list-publication:${randomUUID()}`, request: { formatVersion: 1, action: "PUBLISH", expectedRevision: 0, expectedSnapshotVersion: publication.response.snapshotVersion, expectedSourceHash: publication.response.sourceHash } }, now)).toMatchObject({ status: "decided" });
    const oldPublic = await getPublicStartList(db, f.race.id), oldXml = await getPublishedStartListXml(db, f.race.id);
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: `class-start-draw:${randomUUID()}`, request: { ...previewRequest, expectedSnapshotVersion: fresh.response.snapshotVersion, sourceHash: fresh.response.sourceHash } }, now)).toMatchObject({ status: "changed", response: { entryCount: 3, changedEntryCount: 2 } });
    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, unchanged.entryId));
    expect(entry?.version).toBe(2_147_483_647);
    expect(await getPublicStartList(db, f.race.id)).toEqual(oldPublic);
    expect(await getPublishedStartListXml(db, f.race.id)).toEqual(oldXml);
    const [header] = await db.select().from(schema.classStartDrawRequests).where(eq(schema.classStartDrawRequests.raceId, f.race.id));
    await expect(db.update(schema.classStartDrawRequests).set({ seed: 19 }).where(eq(schema.classStartDrawRequests.id, header!.id))).rejects.toThrow();
  });
  it("preview writes nothing; commit freezes all items and exact retry", async () => {
    const f = await setup(201);
    const parameters = { algorithmVersion: "xorshift32-fisher-yates-v1" as const, seed: 11, firstStartTime: "2026-09-04T09:00:00.000Z", intervalSeconds: 60 };
    const before = await db.select().from(schema.classStartDrawRequests);
    const preview = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: { formatVersion: 1, classId: f.raceClass.id, parameters } }, now);
    expect(preview.status).toBe("ok");
    expect(await db.select().from(schema.classStartDrawRequests)).toEqual(before);
    if (preview.status !== "ok") throw new Error();
    const request = { formatVersion: 1 as const, classId: f.raceClass.id, parameters, expectedSnapshotVersion: preview.response.snapshotVersion, sourceHash: preview.response.sourceHash };
    const key = `class-start-draw:${randomUUID()}`;
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: key, request }, now)).toMatchObject({ status: "changed", response: { replayed: false, changedEntryCount: 2 } });
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: key, request }, now)).toMatchObject({ status: "changed", response: { replayed: true } });
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: key, request: { ...request, parameters: { ...parameters, seed: 12 } } }, now)).toEqual({ status: "conflict" });
    const other = await issuePairingAdminAccessCredential(db, { raceId: f.race.id, capability: "DRAW_CLASS_START_TIMES", label: "Other", expiresAt: new Date("2026-09-04T14:00:00Z") }, { now });
    const otherLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: other.accessCredential }, { expectedRaceId: f.race.id, expectedCapability: "DRAW_CLASS_START_TIMES", now });
    if (otherLogin.status !== "authenticated") throw new Error();
    expect(await commitClassStartDrawAsAdmin(db, { raceId: f.race.id, sessionToken: otherLogin.sessionToken, csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken, idempotencyKey: key, request }, now)).toEqual({ status: "conflict" });
    const noOp = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: { formatVersion: 1, classId: f.raceClass.id, parameters } }, now);
    if (noOp.status !== "ok") throw new Error();
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: `class-start-draw:${randomUUID()}`, request: { ...request, expectedSnapshotVersion: noOp.response.snapshotVersion, sourceHash: noOp.response.sourceHash } }, now)).toEqual({ status: "conflict" });
    const [header] = await db.select().from(schema.classStartDrawRequests).where(eq(schema.classStartDrawRequests.raceId, f.race.id));
    const items = await db.select().from(schema.classStartDrawItems).where(eq(schema.classStartDrawItems.drawRequestId, header!.id));
    expect(items).toHaveLength(2);
    await expect(db.update(schema.classStartDrawItems).set({ displayName: "No" }).where(eq(schema.classStartDrawItems.id, items[0]!.id))).rejects.toThrow();
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.race.id))).toHaveLength(0);
  });

  it("stale draw has no writes and concurrent candidates produce one winner", async () => {
    const f = await setup(221);
    const parameters = { algorithmVersion: "xorshift32-fisher-yates-v1" as const, seed: 12, firstStartTime: "2026-09-04T10:00:00.000Z", intervalSeconds: 60 };
    const preview = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: { formatVersion: 1, classId: f.raceClass.id, parameters } }, now);
    if (preview.status !== "ok") throw new Error();
    const request = { formatVersion: 1 as const, classId: f.raceClass.id, parameters, expectedSnapshotVersion: preview.response.snapshotVersion, sourceHash: preview.response.sourceHash };
    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.raceId, f.race.id));
    await db.update(schema.entries).set({ version: entry!.version + 1 }).where(eq(schema.entries.id, entry!.id));
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: `class-start-draw:${randomUUID()}`, request }, now)).toEqual({ status: "conflict" });
    const fresh = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: { formatVersion: 1, classId: f.raceClass.id, parameters } }, now);
    if (fresh.status !== "ok") throw new Error();
    const current = { ...request, expectedSnapshotVersion: fresh.response.snapshotVersion, sourceHash: fresh.response.sourceHash };
    const outcomes = await Promise.all([1, 2].map(() => commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: `class-start-draw:${randomUUID()}`, request: current }, now)));
    expect(outcomes.filter((outcome) => outcome.status === "changed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "conflict")).toHaveLength(1);
  });

  it("rejects PUNCH and a final-time overflow without writes", async () => {
    const f = await setup(241);
    const base = { formatVersion: 1 as const, classId: f.raceClass.id,
      parameters: { algorithmVersion: "xorshift32-fisher-yates-v1" as const, seed: 13, firstStartTime: "9999-12-31T23:59:59.999Z", intervalSeconds: 1 } };
    expect(await previewClassStartDrawAsAdmin(db, { ...f.auth, request: base }, now)).toEqual({ status: "invalid-request" });
    await db.update(schema.classes).set({ startRule: "PUNCH" }).where(eq(schema.classes.id, f.raceClass.id));
    expect(await previewClassStartDrawAsAdmin(db, { ...f.auth, request: { ...base, parameters: { ...base.parameters, firstStartTime: "2026-09-04T10:00:00.000Z" } } }, now)).toEqual({ status: "conflict" });
    expect(await db.select().from(schema.classStartDrawRequests).where(eq(schema.classStartDrawRequests.raceId, f.race.id))).toHaveLength(0);
  });
});
