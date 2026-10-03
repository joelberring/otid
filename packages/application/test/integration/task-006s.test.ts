import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { decideStartListPublicationAsAdmin, getPublicStartList, getPublishedStartListXml, getStartListPublicationPreviewAsAdmin, issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src";
const url = process.env.TEST_DATABASE_URL;
if (!url)
    throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-04T07:00:00.000Z");
beforeAll(async () => {
    await migrate(db, {
        migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname
    });
});
afterAll(async () => pool.end());
async function setup(n: number) {
    const [e] = await db.insert(schema.events).values({
        name: `E${n}`, startsOn: "2026-09-04", timeZone: "Europe/Stockholm"
    }).returning();
    if (!e)
        throw Error();
    const [r] = await db.insert(schema.races).values({
        eventId: e.id, name: "R", raceDate: "2026-09-04"
    }).returning();
    if (!r)
        throw Error();
    const [c] = await db.insert(schema.courses).values({
        raceId: r.id, name: "B"
    }).returning();
    if (!c)
        throw Error();
    const [v] = await db.insert(schema.courseVersions).values({
        courseId: c.id, version: 1
    }).returning();
    if (!v)
        throw Error();
    const [cl] = await db.insert(schema.classes).values({
        raceId: r.id, name: "D21", courseVersionId: v.id, startRule: "FIXED"
    }).returning();
    if (!cl)
        throw Error();
    const [x] = await db.insert(schema.entries).values({
        raceId: r.id, classId: cl.id, givenName: "Ada", familyName: "A", organisationName: "Klubb", fixedStartTime: new Date("2026-09-04T08:00:00Z")
    }).returning();
    if (!x)
        throw Error();
    const cred = await issuePairingAdminAccessCredential(db, {
        raceId: r.id, capability: "PUBLISH_START_LIST", label: "P", expiresAt: new Date("2026-09-04T14:00:00Z")
    }, {
        now, secretBytes: Buffer.alloc(32, n)
    });
    const login = await loginPairingAdmin(db, {
        formatVersion: 1, accessCredential: cred.accessCredential
    }, {
        expectedRaceId: r.id, expectedCapability: "PUBLISH_START_LIST", now, sessionSecretBytes: Buffer.alloc(32, n + 1), csrfSecretBytes: Buffer.alloc(32, n + 2)
    });
    if (login.status !== "authenticated")
        throw Error();
    return {
        r, e, x, cred, login
    };
}
describe("TASK 006S / TASK 006T PostgreSQL", () => {
    it("TASK 006T kräver ny publicering för legacy och binder strukturerat namn i hash", async () => {
        const f = await setup(121);
        const auth = { raceId: f.r.id, sessionToken: f.login.sessionToken, csrfCookie: f.login.csrfToken, csrfHeader: f.login.csrfToken };
        expect(await getPublishedStartListXml(db, f.r.id)).toEqual({ status: "not-found" });
        const preview = await getStartListPublicationPreviewAsAdmin(db, auth, now);
        if (preview.status !== "ok" || !preview.response.content || !preview.response.sourceHash) throw Error();
        await db.insert(schema.startListPublications).values({ requestId: randomUUID(), raceId: f.r.id,
            actorCredentialId: f.cred.credentialId, revision: 1, action: "PUBLISH", intent: {},
            sourceSnapshotVersion: 1, sourceHash: "a".repeat(64), content: preview.response.content, decidedAt: now });
        expect(await getPublishedStartListXml(db, f.r.id)).toEqual({ status: "unavailable" });
        expect(await getPublicStartList(db, f.r.id)).toMatchObject({ status: "published", response: { iofExportAvailable: false } });
        const publish = { formatVersion: 1, action: "PUBLISH", expectedRevision: 1,
            expectedSnapshotVersion: 1, expectedSourceHash: preview.response.sourceHash };
        expect(await decideStartListPublicationAsAdmin(db, { ...auth, idempotencyKey: `start-list-publication:${randomUUID()}`, request: publish }, now)).toMatchObject({ status: "decided" });
        expect(await getPublishedStartListXml(db, f.r.id)).toMatchObject({ status: "exported", revision: 2 });
        await db.update(schema.entries).set({ givenName: "Ada B", familyName: "C" }).where(eq(schema.entries.id, f.x.id));
        const before = await getStartListPublicationPreviewAsAdmin(db, auth, now);
        await db.update(schema.entries).set({ givenName: "Ada", familyName: "B C" }).where(eq(schema.entries.id, f.x.id));
        const after = await getStartListPublicationPreviewAsAdmin(db, auth, now);
        if (before.status !== "ok" || after.status !== "ok") throw Error();
        expect(before.response.content).toEqual(after.response.content);
        expect(before.response.sourceHash).not.toEqual(after.response.sourceHash);
    });
    it("fryser publish, retry och withdrawal även efter trasigt underlag", async () => {
        const f = await setup(81);
        const a = {
            raceId: f.r.id, sessionToken: f.login.sessionToken, csrfCookie: f.login.csrfToken, csrfHeader: f.login.csrfToken
        };
        const p = await getStartListPublicationPreviewAsAdmin(db, a, now);
        if (p.status !== "ok" || !p.response.content || !p.response.sourceHash)
            throw Error();
        const req = {
            formatVersion: 1 as const, action: "PUBLISH" as const, expectedSnapshotVersion: p.response.snapshotVersion, expectedSourceHash: p.response.sourceHash, expectedRevision: 0
        };
        const key = `start-list-publication:${randomUUID()}`;
        const first = await decideStartListPublicationAsAdmin(db, {
            ...a, idempotencyKey: key, request: req
        }, now);
        expect(first.status).toBe("decided");
        const retry = await decideStartListPublicationAsAdmin(db, {
            ...a, idempotencyKey: key, request: req
        }, now);
        expect(retry).toMatchObject({
            status: "decided", response: {
                replayed: true
            }
        });
        const old = await getPublicStartList(db, f.r.id);
        const frozenXml = await getPublishedStartListXml(db, f.r.id);
        expect(frozenXml).toMatchObject({ status: "exported", revision: 1 });
        expect(old.status).toBe("published");
        expect(await decideStartListPublicationAsAdmin(db, { ...a, idempotencyKey: `start-list-publication:${randomUUID()}`, request: { ...req, expectedRevision: 1 } }, now)).toEqual({ status: "conflict" });
        const otherCredential = await issuePairingAdminAccessCredential(db, { raceId: f.r.id, capability: "PUBLISH_START_LIST", label: "Other actor", expiresAt: new Date("2026-09-04T14:00:00Z") }, { now });
        const otherLogin = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: otherCredential.accessCredential }, { expectedRaceId: f.r.id, expectedCapability: "PUBLISH_START_LIST", now });
        if (otherLogin.status !== "authenticated") throw Error();
        expect(await decideStartListPublicationAsAdmin(db, { raceId: f.r.id, sessionToken: otherLogin.sessionToken, csrfCookie: otherLogin.csrfToken, csrfHeader: otherLogin.csrfToken, idempotencyKey: key, request: req }, now)).toEqual({ status: "conflict" });
        await db.update(schema.entries).set({ givenName: "Ändrat", fixedStartTime: new Date("2026-09-04T09:00:00Z") }).where(eq(schema.entries.id, f.x.id));
        expect(await getPublicStartList(db, f.r.id)).toEqual(old);
        expect(await getPublishedStartListXml(db, f.r.id)).toEqual(frozenXml);
        expect(await decideStartListPublicationAsAdmin(db, { ...a, idempotencyKey: key, request: { ...req, expectedRevision: 1 } }, now)).toEqual({ status: "conflict" });
        await db.update(schema.events).set({
            timeZone: "Bad/Zone"
        }).where(eq(schema.events.id, f.e.id));
        const bad = await getStartListPublicationPreviewAsAdmin(db, a, now);
        expect(bad).toMatchObject({
            status: "ok", response: {
                content: null, sourceHash: null
            }
        });
        const wd = await decideStartListPublicationAsAdmin(db, {
            ...a, idempotencyKey: `start-list-publication:${randomUUID()}`, request: {
                formatVersion: 1, action: "WITHDRAW", expectedRevision: 1
            }
        }, now);
        expect(wd.status).toBe("decided");
        expect(await getPublishedStartListXml(db, f.r.id)).toEqual({ status: "not-found" });
        expect(await decideStartListPublicationAsAdmin(db, { ...a, idempotencyKey: `start-list-publication:${randomUUID()}`, request: { ...req, expectedRevision: 2 } }, now)).toEqual({ status: "conflict" });
        expect(await getPublicStartList(db, f.r.id)).toEqual({
            status: "not-found"
        });
        expect(await decideStartListPublicationAsAdmin(db, {
            ...a, idempotencyKey: key, request: req
        }, now)).toMatchObject({
            status: "decided", response: {
                replayed: true
            }
        });
        await db.update(schema.events).set({ timeZone: "Europe/Stockholm" }).where(eq(schema.events.id, f.e.id));
        const refreshed = await getStartListPublicationPreviewAsAdmin(db, a, now);
        if (refreshed.status !== "ok" || !refreshed.response.sourceHash) throw Error();
        expect(await decideStartListPublicationAsAdmin(db, { ...a, idempotencyKey: `start-list-publication:${randomUUID()}`, request: { ...req, expectedRevision: 2, expectedSourceHash: refreshed.response.sourceHash } }, now)).toMatchObject({ status: "decided", response: { revision: 3 } });
        expect(await getPublicStartList(db, f.r.id)).not.toEqual(old);
        const stored = await db.select().from(schema.startListPublications).where(eq(schema.startListPublications.raceId, f.r.id));
        expect(stored).toHaveLength(3);
        const original = stored.find(row => row.revision === 1);
        if (!original) throw Error();
        expect(original.content).toEqual(old.status === "published" ? old.response.content : undefined);
        await expect(db.update(schema.startListPublications).set({ sourceHash: "b".repeat(64) }).where(eq(schema.startListPublications.id, original.id))).rejects.toThrow();
        await expect(db.insert(schema.startListPublications).values({ ...original, id: randomUUID(), requestId: randomUUID(), revision: 9, sourceHash: null })).rejects.toThrow();
        expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.r.id))).toHaveLength(0);
    });
    it("isolerar race och låter endast en samtida publicering vinna", async () => {
        const f = await setup(91), g = await setup(101);
        const a = {
            raceId: f.r.id, sessionToken: f.login.sessionToken, csrfCookie: f.login.csrfToken, csrfHeader: f.login.csrfToken
        };
        const p = await getStartListPublicationPreviewAsAdmin(db, a, now);
        if (p.status !== "ok" || !p.response.sourceHash)
            throw Error();
        const req = {
            formatVersion: 1 as const, action: "PUBLISH" as const, expectedSnapshotVersion: 1, expectedSourceHash: p.response.sourceHash, expectedRevision: 0
        };
        expect(await getStartListPublicationPreviewAsAdmin(db, {
            ...a, raceId: g.r.id
        }, now)).toEqual({
            status: "forbidden"
        });
        const [one, two] = await Promise.all([decideStartListPublicationAsAdmin(db, {
                ...a, idempotencyKey: `start-list-publication:${randomUUID()}`, request: req
            }, now), decideStartListPublicationAsAdmin(db, {
                ...a, idempotencyKey: `start-list-publication:${randomUUID()}`, request: req
            }, now)]);
        expect([one.status, two.status].sort()).toEqual(["conflict", "decided"]);
    });
});
