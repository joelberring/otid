import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { canonicalJsonBytes, publicStartListResponseSchema, startListPublicationContentSchema, startListPublicationIdempotencyKeySchema, startListPublicationPreviewResponseSchema, startListPublicationRequestSchema, startListPublicationResponseSchema, type PublicStartListResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { IofStartListSerializationError, serializeIofStartList, type IofStartListProjection } from "@o-tid/iof-xml";
import { authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import type { DbExecutor } from "./snapshot";
const MAX_CLASSES = 1000, MAX_ENTRIES = 10000;
const raceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Auth = Omit<PairingAdminRequestAuthentication, "capability">;
type Row = typeof schema.startListPublications.$inferSelect;
class SourceProjectionError extends Error {
}
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hh = (v: unknown) => createHash("sha256").update(canonicalJsonBytes(v)).digest("hex");
async function locked(tx: DbExecutor, raceId: string, lock: "share" | "update") {
    const q = tx.select({
        id: schema.races.id, eventId: schema.races.eventId, name: schema.races.name, raceDate: schema.races.raceDate, snapshotVersion: schema.races.snapshotVersion
    }).from(schema.races).where(eq(schema.races.id, raceId));
    const [r] = lock === "share" ? await q.for("share") : await q.for("update");
    return r;
}
async function projection(tx: DbExecutor, race: {
    id: string;
    eventId: string;
    name: string;
    raceDate: string;
    snapshotVersion: number;
}) {
    const [ev] = await tx.select({
        name: schema.events.name, timeZone: schema.events.timeZone
    }).from(schema.events).where(eq(schema.events.id, race.eventId));
    if (!ev)
        throw new SourceProjectionError();
    const cs = await tx.select({
        id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule
    }).from(schema.classes).where(eq(schema.classes.raceId, race.id)).limit(MAX_CLASSES + 1);
    const es = await tx.select({
        id: schema.entries.id, classId: schema.entries.classId, givenName: schema.entries.givenName, familyName: schema.entries.familyName, organisationName: schema.entries.organisationName, fixedStartTime: schema.entries.fixedStartTime
    }).from(schema.entries).where(eq(schema.entries.raceId, race.id)).limit(MAX_ENTRIES + 1);
    if (cs.length > MAX_CLASSES || es.length > MAX_ENTRIES)
        throw new SourceProjectionError();
    const ids = new Set(cs.map(c => c.id));
    if (es.some(e => !ids.has(e.classId)))
        throw new SourceProjectionError();
    const ordered = [...cs].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id)).map(c => ({
            name: c.name, startRule: c.startRule, entries: es.filter(e => e.classId === c.id).map(e => ({
                displayName: `${e.givenName} ${e.familyName}`, organisationName: e.organisationName, fixedStartTime: c.startRule === "FIXED" ? e.fixedStartTime?.toISOString() ?? null : null, id: e.id, f: e.familyName, g: e.givenName
            })).sort((a, b) => {
                const at = a.fixedStartTime ? Date.parse(a.fixedStartTime) : Infinity, bt = b.fixedStartTime ? Date.parse(b.fixedStartTime) : Infinity;
                return c.startRule === "FIXED" && at !== bt ? at - bt : cmp(a.displayName, b.displayName) || cmp(a.f, b.f) || cmp(a.g, b.g) || cmp(a.id, b.id);
            })
        }));
    const parsed = startListPublicationContentSchema.safeParse({
        eventName: ev.name, raceName: race.name, raceDate: race.raceDate, timeZone: ev.timeZone,
        classes: ordered.map(c => ({ name: c.name, startRule: c.startRule, entries: c.entries.map(e => ({
                displayName: e.displayName, organisationName: e.organisationName, fixedStartTime: e.fixedStartTime
            })) }))
    });
    if (!parsed.success) throw new SourceProjectionError();
    const content = parsed.data;
    const iofProjection: IofStartListProjection = {
        eventName: content.eventName,
        classes: ordered.map(c => ({ className: c.name, startRule: c.startRule,
            starts: c.entries.map(e => ({ givenName: e.g, familyName: e.f,
                ...(e.organisationName === null ? {} : { organisationName: e.organisationName }),
                ...(e.fixedStartTime === null ? {} : { startTime: e.fixedStartTime }) })) }))
    };
    let xml: string | null = null;
    try {
        if (es.length > 0) xml = new TextDecoder().decode(serializeIofStartList(iofProjection));
    } catch (error) {
        if (error instanceof IofStartListSerializationError) throw new SourceProjectionError();
        throw error;
    }
    return {
        content, xml, hash: hh({
            formatVersion: 2, snapshotVersion: race.snapshotVersion, content, iofProjection
        })
    };
}
function out(row: Row, replayed: boolean) {
    return startListPublicationResponseSchema.parse({
        formatVersion: 1, raceId: row.raceId, requestId: row.requestId, replayed, revision: row.revision, action: row.action, decidedAt: row.decidedAt.toISOString(), sourceSnapshotVersion: row.sourceSnapshotVersion, sourceHash: row.sourceHash
    });
}
export async function getStartListPublicationPreviewAsAdmin(db: Database, input: Auth, now = new Date()) {
    return db.transaction(async (tx) => {
        const a = await authenticatePairingAdminSessionForProtectedRead(tx, {
            ...input, capability: "PUBLISH_START_LIST"
        }, now);
        if (a.status !== "authenticated")
            return a;
        const race = await locked(tx, input.raceId, "share");
        if (!race)
            return {
                status: "not-found" as const
            };
        const [latest] = await tx.select().from(schema.startListPublications).where(eq(schema.startListPublications.raceId, input.raceId)).orderBy(desc(schema.startListPublications.revision)).limit(1);
        try {
            const s = await projection(tx, race);
            return {
                status: "ok" as const, response: startListPublicationPreviewResponseSchema.parse({
                    formatVersion: 1, raceId: race.id, snapshotVersion: race.snapshotVersion, sourceHash: s.hash, latestDecision: latest ? {
                        revision: latest.revision, action: latest.action, decidedAt: latest.decidedAt.toISOString(), sourceSnapshotVersion: latest.sourceSnapshotVersion, sourceHash: latest.sourceHash
                    } : null, content: s.content
                })
            };
        }
        catch (e) {
            if (!(e instanceof SourceProjectionError))
                throw e;
            return {
                status: "ok" as const, response: startListPublicationPreviewResponseSchema.parse({
                    formatVersion: 1, raceId: race.id, snapshotVersion: race.snapshotVersion, sourceHash: null, latestDecision: latest ? {
                        revision: latest.revision, action: latest.action, decidedAt: latest.decidedAt.toISOString(), sourceSnapshotVersion: latest.sourceSnapshotVersion, sourceHash: latest.sourceHash
                    } : null, content: null
                })
            };
        }
    });
}
export async function decideStartListPublicationAsAdmin(db: Database, input: Auth & {
    idempotencyKey: string | null;
    request: unknown;
}, now = new Date()) {
    const k = startListPublicationIdempotencyKeySchema.safeParse(input.idempotencyKey), r = startListPublicationRequestSchema.safeParse(input.request);
    if (!k.success || !r.success)
        return {
            status: "invalid-request" as const
        };
    const id = k.data.slice("start-list-publication:".length);
    return db.transaction(async (tx) => {
        const a = await authenticatePairingAdminSessionForMutation(tx, {
            ...input, capability: "PUBLISH_START_LIST", requireCsrf: true
        }, now);
        if (a.status !== "authenticated")
            return a;
        const race = await locked(tx, input.raceId, "update");
        if (!race)
            return {
                status: "not-found" as const
            };
        await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${id},0))`);
        const [old] = await tx.select().from(schema.startListPublications).where(eq(schema.startListPublications.requestId, id));
        if (old) {
            const oi = startListPublicationRequestSchema.safeParse(old.intent);
            if (old.raceId !== input.raceId || old.actorCredentialId !== a.principal.accessCredentialId || !oi.success || JSON.stringify(oi.data) !== JSON.stringify(r.data))
                return {
                    status: "conflict" as const
                };
            return {
                status: "decided" as const, response: out(old, true)
            };
        }
        const [last] = await tx.select().from(schema.startListPublications).where(eq(schema.startListPublications.raceId, input.raceId)).orderBy(desc(schema.startListPublications.revision)).limit(1);
        const rev = last?.revision ?? 0;
        if (rev >= 2147483647)
            return {
                status: "conflict" as const
            };
        let content: null | ReturnType<typeof startListPublicationContentSchema.parse> = null, hash: null | string = null;
        let iofStartListXml: string | null = null;
        if (r.data.action === "PUBLISH") {
            let s: Awaited<ReturnType<typeof projection>>;
            try {
                s = await projection(tx, race);
            } catch (error) {
                if (error instanceof SourceProjectionError) return { status: "conflict" as const };
                throw error;
            }
            if (r.data.expectedRevision !== rev || r.data.expectedSnapshotVersion !== race.snapshotVersion || r.data.expectedSourceHash !== s.hash || s.content.classes.every(c => c.entries.length === 0) || (last?.action === "PUBLISH" && last.sourceHash === s.hash))
                return {
                    status: "conflict" as const
                };
            content = s.content;
            hash = s.hash;
            iofStartListXml = s.xml;
        }
        else if (r.data.expectedRevision !== rev || last?.action !== "PUBLISH")
            return {
                status: "conflict" as const
            };
        const [saved] = await tx.insert(schema.startListPublications).values({
            iofStartListXml,
            requestId: id, raceId: race.id, actorCredentialId: a.principal.accessCredentialId, revision: rev + 1, action: r.data.action, intent: r.data, sourceSnapshotVersion: race.snapshotVersion, sourceHash: hash, content, decidedAt: now
        }).returning();
        if (!saved)
            throw new Error("Beslut saknas");
        await tx.insert(schema.auditEvents).values({
            raceId: race.id, entityType: "start_list_publication", entityId: saved.id, action: saved.action === "PUBLISH" ? "START_LIST_PUBLISHED" : "START_LIST_WITHDRAWN", actorKind: a.principal.capability === "MANAGE_RACE" ? "RACE_ADMIN_ACCESS_CREDENTIAL" : "START_LIST_PUBLICATION_ACCESS_CREDENTIAL", actorId: a.principal.accessCredentialId, requestId: id, after: {
                revision: saved.revision
            }
        });
        return {
            status: "decided" as const, response: out(saved, false)
        };
    });
}
export async function getPublicStartList(db: Database, raceId: string): Promise<{
    status: "published";
    response: PublicStartListResponse;
} | {
    status: "not-found";
}> {
    if (!raceIdPattern.test(raceId))
        return {
            status: "not-found"
        };
    const [r] = await db.select({
        iofExportAvailable: sql<boolean>`${schema.startListPublications.iofStartListXml} IS NOT NULL`,
        action: schema.startListPublications.action, revision: schema.startListPublications.revision, content: schema.startListPublications.content, decidedAt: schema.startListPublications.decidedAt
    }).from(schema.startListPublications).where(eq(schema.startListPublications.raceId, raceId)).orderBy(desc(schema.startListPublications.revision)).limit(1);
    return !r || r.action !== "PUBLISH" || !r.content ? {
        status: "not-found"
    } : {
        status: "published", response: publicStartListResponseSchema.parse({
            iofExportAvailable: r.iofExportAvailable,
            formatVersion: 1, revision: r.revision, publishedAt: r.decidedAt.toISOString(), content: r.content
        })
    };
}

/** Read only the active immutable decision, never today's participants. */
export async function getPublishedStartListXml(db: Database, raceId: string): Promise<
    { status: "exported"; xml: string; revision: number } |
    { status: "not-found" | "unavailable" }
> {
    if (!raceIdPattern.test(raceId)) return { status: "not-found" };
    const [row] = await db.select({ action: schema.startListPublications.action,
        xml: schema.startListPublications.iofStartListXml, revision: schema.startListPublications.revision
    }).from(schema.startListPublications).where(eq(schema.startListPublications.raceId, raceId))
      .orderBy(desc(schema.startListPublications.revision)).limit(1);
    if (!row || row.action !== "PUBLISH") return { status: "not-found" };
    if (row.xml === null) return { status: "unavailable" };
    if (row.xml.length === 0 || Buffer.byteLength(row.xml, "utf8") > 67_108_864 || !Number.isSafeInteger(row.revision) || row.revision < 1) {
        throw new Error("Invalid frozen start-list export");
    }
    return { status: "exported", xml: row.xml, revision: row.revision };
}
