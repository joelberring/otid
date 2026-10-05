import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import { contentHash } from "../../src/hash";
import { ingestDeviceBatch } from "../../src/ingest";
import { registerTestAccount } from "./accounts";
import { listMyPublicResultFollows, setPublicResultFollow } from "../../src/public-result-follow";
import { recalculateEntry } from "../../src/results";
import { publicResultFollowIdempotencyKey } from "@o-tid/contracts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK153 kräver uttrycklig isolerad TEST_DATABASE_URL med CREATEDB");
const source = new URL(base);
const sourceName = source.pathname.slice(1);
// Testet skapar och tar bort en egen databas; källan måste bara vara lokal.
if (!["postgres:", "postgresql:"].includes(source.protocol) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname) ||
  /(?:^|[_-])(demo|race|private)(?:[_-]|$)/i.test(sourceName)) {
  throw new Error("TASK153 avvisar icke-isolerad PostgreSQL-källa");
}
const admin = createDatabase(base);
const databaseName = `otid_task153_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const at = new Date("2026-09-23T10:00:00.000Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task153_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig syntetisk testdatabas");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function account(prefix: string) {
  const created = await registerTestAccount(db, `${prefix}.${randomUUID().slice(0, 8)}`, at);
  const login = created.login;
  if (login.status !== "authenticated") throw new Error("Syntetiskt användarkonto saknas");
  return { accountId: login.response.accountId,
    proof: { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID();
  const courseVersionId = randomUUID(), classId = randomUUID(), controlId = randomUUID();
  const entryId = randomUUID(), unpublishedEntryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetisk följning", startsOn: "2026-09-23", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Följlopp", raceDate: "2026-09-23" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Syntetisk bana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Öppen", startRule: "FIXED" });
  await db.insert(schema.entries).values([
    { id: entryId, raceId, classId, givenName: "Ada", familyName: "Syntetisk", fixedStartTime: new Date("2026-09-23T10:00:00Z") },
    { id: unpublishedEntryId, raceId, classId, givenName: "Opublicerad", familyName: "Syntetisk" }
  ]);
  const cardNumber = `153${entryId.slice(0, 8)}`;
  await db.insert(schema.cardAssignments).values({ raceId, entryId, cardNumber });
  const payload = { cardNumber, startPunchedAt: "2026-09-23T10:00:00Z", finishPunchedAt: "2026-09-23T10:20:00Z",
    punches: [{ code: 31, punchedAt: "2026-09-23T10:10:00Z" }] };
  const deviceId = randomUUID();
  await ingestDeviceBatch(db, raceId, { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-09-23T10:21:00Z", transport: "simulator", payload, contentHash: contentHash(payload) }] });
  const [entry] = await db.select({ publicResultId: schema.entries.publicResultId }).from(schema.entries)
    .where(eq(schema.entries.id, entryId));
  if (!entry) throw new Error("Syntetiskt publikt resultat saknas");
  return { raceId, entryId, publicResultId: entry.publicResultId, unpublishedEntryId };
}

function request(f: Awaited<ReturnType<typeof fixture>>, followed: boolean, requestId = randomUUID()) {
  return { formatVersion: 1 as const, requestId, raceId: f.raceId, publicResultId: f.publicResultId, followed };
}

function set(proof: Awaited<ReturnType<typeof account>>["proof"], body: ReturnType<typeof request>) {
  return setPublicResultFollow(db, { ...proof, idempotencyKey: publicResultFollowIdempotencyKey(body.requestId), request: body }, at);
}

describe("TASK153 kontobunden följning av offentliga resultat", () => {
  it("separerar konton och återspelar exakt samma idempotenta följning", async () => {
    const f = await fixture(), ada = await account("ada"), bo = await account("bo");
    const follow = request(f, true);
    expect(await set(ada.proof, follow)).toMatchObject({ status: "ok", response: { followed: true, replayed: false } });
    expect(await set(ada.proof, follow)).toMatchObject({ status: "ok", response: { followed: true, replayed: true } });
    expect((await listMyPublicResultFollows(db, ada.proof, at))).toMatchObject({ status: "ok", response: { items: [
      { raceId: f.raceId, publicResultId: f.publicResultId, result: { givenName: "Ada" } }
    ] } });
    expect(await listMyPublicResultFollows(db, bo.proof, at)).toMatchObject({ status: "ok", response: { items: [] } });
    expect((await set(bo.proof, { ...follow })).status).toBe("conflict");
    const concurrent = await Promise.all([
      set(ada.proof, { ...follow, requestId: randomUUID(), followed: false }),
      set(ada.proof, { ...follow, requestId: randomUUID(), followed: true })
    ]);
    expect(concurrent.map(result => result.status)).toEqual(["ok", "ok"]);
    const [latest] = await db.select({ followed: schema.userPublicResultFollowEvents.followed })
      .from(schema.userPublicResultFollowEvents)
      .where(and(eq(schema.userPublicResultFollowEvents.accountId, ada.accountId),
        eq(schema.userPublicResultFollowEvents.publicResultId, f.publicResultId)))
      .orderBy(desc(schema.userPublicResultFollowEvents.eventSequence)).limit(1);
    const visible = await listMyPublicResultFollows(db, ada.proof, at);
    expect(visible.status).toBe("ok");
    if (visible.status !== "ok" || !latest) throw new Error("Senaste följbeslut saknas");
    expect(visible.response.items).toHaveLength(latest.followed ? 1 : 0);
  });

  it("avvisar ändrad avsikt med samma request-id och mål som inte är publicerade", async () => {
    const f = await fixture(), ada = await account("ada"), follow = request(f, true);
    expect((await set(ada.proof, follow)).status).toBe("ok");
    expect((await set(ada.proof, { ...follow, followed: false })).status).toBe("conflict");
    expect((await set(ada.proof, { ...follow, publicResultId: randomUUID() })).status).toBe("conflict");
    const unpublishedId = (await db.select({ id: schema.entries.id, publicResultId: schema.entries.publicResultId })
      .from(schema.entries).where(eq(schema.entries.id, f.unpublishedEntryId)))[0]!.publicResultId;
    const unpublished = { ...follow, requestId: randomUUID(), publicResultId: unpublishedId };
    expect(await set(ada.proof, unpublished)).toEqual({ status: "not-found" });
    expect(await set(ada.proof, { ...follow, requestId: randomUUID(), publicResultId: randomUUID() })).toEqual({ status: "not-found" });
  });

  it("avföljer och visar aktuell revision men inga resultatfält för en otillgänglig följning", async () => {
    const f = await fixture(), ada = await account("ada"), follow = request(f, true);
    expect((await set(ada.proof, follow)).status).toBe("ok");
    await recalculateEntry(db, f.raceId, f.entryId);
    expect(await listMyPublicResultFollows(db, ada.proof, at)).toMatchObject({ status: "ok", response: { items: [
      { result: { givenName: "Ada", revision: 2 } }
    ] } });
    const [unpublished] = await db.select({ publicResultId: schema.entries.publicResultId })
      .from(schema.entries).where(eq(schema.entries.id, f.unpublishedEntryId));
    if (!unpublished) throw new Error("Opublicerad syntetisk entry saknas");
    // A journal pointer to an unavailable result models a withdrawn result
    // without mutating the immutable published revision history in this test.
    await db.insert(schema.userPublicResultFollowEvents).values({
      requestId: randomUUID(), accountId: ada.accountId, raceId: f.raceId,
      publicResultId: unpublished.publicResultId, followed: true, createdAt: at
    });
    const includingUnavailable = await listMyPublicResultFollows(db, ada.proof, at);
    expect(includingUnavailable.status).toBe("ok");
    if (includingUnavailable.status !== "ok") throw new Error("Kontoföljning saknas");
    expect(includingUnavailable.response.items).toHaveLength(2);
    const current = includingUnavailable.response.items.find(item => item.publicResultId === f.publicResultId);
    const unavailable = includingUnavailable.response.items.find(item => item.publicResultId === unpublished.publicResultId);
    expect(current?.result).toMatchObject({ givenName: "Ada", revision: 2 });
    expect(unavailable?.result).toBeNull();
    expect((await set(ada.proof, { ...follow, requestId: randomUUID(), publicResultId: unpublished.publicResultId,
      followed: false })).status).toBe("ok");
    expect((await set(ada.proof, { ...follow, requestId: randomUUID(), followed: false })).status).toBe("ok");
    expect(await listMyPublicResultFollows(db, ada.proof, at)).toMatchObject({ status: "ok", response: { items: [] } });
  });
});
