import { desc, eq, sql, and, inArray, isNull } from "drizzle-orm";
import { publicStartListResponseSchema, startListPublicationContentSchema, startListPublicationIdempotencyKeySchema, startListPublicationPreviewResponseSchema, startListPublicationRequestSchema, startListPublicationResponseSchema, type PublicStartListResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { IofStartListSerializationError, serializeIofStartList, type IofStartListProjection } from "@o-tid/iof-xml";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import type { DbExecutor } from "./snapshot";
import { loadCourseVersionVariants } from "./course-variants";
import { loadRelayClassConfigs, loadRelayTeams } from "./relay-model";
import { loadStartListFacts } from "./start-draw-basis";
import { canonicalHash as hh, UUID_PATTERN as raceIdPattern } from "./serialization";
const MAX_CLASSES = 1000, MAX_ENTRIES = 10000;
type Auth = RaceSessionProof;
type Row = typeof schema.startListPublications.$inferSelect;
class SourceProjectionError extends Error {
}
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
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
        id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule, courseVersionId: schema.classes.courseVersionId,
        courseName: schema.courses.name, courseLengthMeters: schema.courses.lengthMeters, courseClimbMeters: schema.courses.climbMeters
    }).from(schema.classes).innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
        .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
        .where(eq(schema.classes.raceId, race.id)).limit(MAX_CLASSES + 1);
    const es = await tx.select({
        id: schema.entries.id, classId: schema.entries.classId, givenName: schema.entries.givenName, familyName: schema.entries.familyName, organisationName: schema.entries.organisationName, fixedStartTime: schema.entries.fixedStartTime,
        eventorPersonId: schema.entries.eventorPersonId, eventorOrganisationId: schema.entries.eventorOrganisationId,
        courseVariantCode: schema.entries.courseVariantCode, teamId: schema.entries.teamId, relayLeg: schema.entries.relayLeg,
        selfRegisteredAt: schema.entries.selfRegisteredAt
    }).from(schema.entries).where(and(eq(schema.entries.raceId, race.id), isNull(schema.entries.struckAt))).limit(MAX_ENTRIES + 1);
    if (cs.length > MAX_CLASSES || es.length > MAX_ENTRIES)
        throw new SourceProjectionError();
    const ids = new Set(cs.map(c => c.id));
    // Steg 33: aktiv bricka följer med i ögonblicksbilden; den publika sidan visar den bara när inställningen är på.
    const cards = new Map<string, string | null>();
    for (const a of await tx.select({ entryId: schema.cardAssignments.entryId, cardNumber: schema.cardAssignments.cardNumber })
        .from(schema.cardAssignments).where(and(eq(schema.cardAssignments.raceId, race.id), eq(schema.cardAssignments.active, true)))) {
        cards.set(a.entryId, cards.has(a.entryId) ? null : a.cardNumber);
    }
    if (es.some(e => !ids.has(e.classId)))
        throw new SourceProjectionError();
    // Stafett (ADR-0169 beslut 3): sträcklöparna listas per lag i lagnummer- och sträckordning.
    const relayClasses = await loadRelayClassConfigs(tx, race.id);
    const teams = new Map((relayClasses.size === 0 ? [] : await loadRelayTeams(tx, race.id)).map(t => [t.id, t]));
    // Steg 47: stafettsträckans egen bana (namn och varianter).
    const legVersionIds = [...new Set([...relayClasses.values()].flatMap(config => config.legs.flatMap(leg => leg.courseVersionId ? [leg.courseVersionId] : [])))];
    const legCourseNames = new Map((legVersionIds.length === 0 ? [] : await tx.select({ id: schema.courseVersions.id, name: schema.courses.name })
        .from(schema.courseVersions).innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
        .where(inArray(schema.courseVersions.id, legVersionIds))).map(row => [row.id, row.name]));
    const variants = await loadCourseVersionVariants(tx, [...cs.map(c => c.courseVersionId), ...legVersionIds]);
    const legCourseOf = (e: (typeof es)[number]) => relayClasses.get(e.classId)?.legs.find(l => l.leg === e.relayLeg)?.courseVersionId ?? null;
    const relayOf = (e: (typeof es)[number]) => {
        const team = e.teamId ? teams.get(e.teamId) : undefined, legs = relayClasses.get(e.classId)?.legs;
        const rule = legs?.find(l => l.leg === e.relayLeg);
        // Steg 56: sträckans bana visas när klassens sträckor springer olika banor (och då på varje sträcka).
        const courseOf = (versionId: string | null) => versionId ? legCourseNames.get(versionId) : cs.find(c => c.id === e.classId)?.courseName;
        const several = new Set((legs ?? []).map(l => courseOf(l.courseVersionId))).size > 1;
        const own = several && rule ? courseOf(rule.courseVersionId) : undefined;
        return team && rule ? { teamNumber: team.number, teamName: team.name, teamOrganisationName: team.organisationName, leg: rule.leg,
            startMethod: rule.startMethod, ...(own ? { courseName: own } : {}) } : null;
    };
    // PLAN.md steg 13: bana, startfålla (första kontroll), lottningens startsätt och vakanta tider per klass.
    const facts = await loadStartListFacts(tx, race.id);
    const ordered = [...cs].sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id)).map(c => ({
            name: c.name, startRule: c.startRule, relay: relayClasses.has(c.id), courseName: c.courseName, facts: facts.get(c.id),
            courseLengthMeters: c.courseLengthMeters, courseClimbMeters: c.courseClimbMeters,
            relayLegCount: relayClasses.get(c.id)?.legs.length, entries: es.filter(e => e.classId === c.id).map(e => ({
                displayName: `${e.givenName} ${e.familyName}`, organisationName: e.organisationName,
                personEventorId: e.eventorPersonId, organisationEventorId: e.eventorOrganisationId, fixedStartTime: c.startRule === "FIXED" ? e.fixedStartTime?.toISOString() ?? null : null, id: e.id, f: e.familyName, g: e.givenName,
                variant: (variants.get(legCourseOf(e) ?? c.courseVersionId) ?? []).some(v => v.code === e.courseVariantCode) ? e.courseVariantCode : null,
                relay: relayOf(e), cardNumber: cards.get(e.id) ?? null, selfRegistered: e.selfRegisteredAt !== null
            })).sort((a, b) => {
                if (a.relay && b.relay) return a.relay.teamNumber - b.relay.teamNumber || a.relay.leg - b.relay.leg;
                const at = a.fixedStartTime ? Date.parse(a.fixedStartTime) : Infinity, bt = b.fixedStartTime ? Date.parse(b.fixedStartTime) : Infinity;
                return c.startRule === "FIXED" && at !== bt ? at - bt : cmp(a.displayName, b.displayName) || cmp(a.f, b.f) || cmp(a.g, b.g) || cmp(a.id, b.id);
            })
        }));
    const parsed = startListPublicationContentSchema.safeParse({
        eventName: ev.name, raceName: race.name, raceDate: race.raceDate, timeZone: ev.timeZone,
        classes: ordered.map(c => ({ name: c.name, startRule: c.startRule, courseName: c.courseName, ...c.facts,
            courseLengthMeters: c.courseLengthMeters, courseClimbMeters: c.courseClimbMeters,
            ...(c.relayLegCount === undefined ? {} : { relayLegCount: c.relayLegCount }), entries: c.entries.map(e => ({
                displayName: e.displayName, organisationName: e.organisationName, fixedStartTime: e.fixedStartTime,
                ...(e.variant ? { courseVariantCode: e.variant } : {}),
                ...(e.relay ? { relay: e.relay } : {}),
                ...(e.cardNumber ? { cardNumber: e.cardNumber } : {}),
                ...(e.selfRegistered ? { selfRegistered: true as const } : {})
            })) }))
    });
    if (!parsed.success) throw new SourceProjectionError();
    const content = parsed.data;
    const person = (e: (typeof ordered)[number]["entries"][number], courseName?: string) => ({ givenName: e.g, familyName: e.f,
        ...(e.organisationName === null ? {} : { organisationName: e.organisationName }),
        ...(e.fixedStartTime === null ? {} : { startTime: e.fixedStartTime }),
        // PLAN.md steg 25: Eventors person- och klubb-id och (gafflad klass) löparens variant som bana.
        ...(e.personEventorId ? { personEventorId: e.personEventorId } : {}),
        ...(e.organisationEventorId ? { organisationEventorId: e.organisationEventorId } : {}),
        ...(courseName && e.variant ? { courseName: `${courseName}-${e.variant}` } : {}) });
    const course = (c: (typeof ordered)[number]) => ({ name: c.courseName,
        ...(c.courseLengthMeters === null ? {} : { lengthMeters: c.courseLengthMeters }),
        ...(c.courseClimbMeters === null ? {} : { climbMeters: c.courseClimbMeters }) });
    const iofProjection: IofStartListProjection = {
        eventName: content.eventName,
        // Stafett (PLAN.md steg 13): lagen som TeamStart med sträcklöparna i sträckordning.
        classes: ordered.map(c => c.relay ? { className: c.name, startRule: c.startRule, course: course(c), starts: [],
            teamStarts: [...new Map(c.entries.flatMap(e => e.relay ? [[e.relay.teamNumber, e.relay] as const] : [])).values()].map(team => ({
                name: team.teamName, bibNumber: team.teamNumber,
                ...(team.teamOrganisationName === null ? {} : { organisationName: team.teamOrganisationName }),
                members: c.entries.filter(e => e.relay?.teamNumber === team.teamNumber).map(e => ({ leg: e.relay!.leg,
                    ...person(e, e.relay!.courseName ?? c.courseName),
                    // Steg 47: sträckans egen bana utan gaffling som Course.
                    ...(e.relay!.courseName && !e.variant ? { courseName: e.relay!.courseName } : {}) })) })) }
            : { className: c.name, startRule: c.startRule, course: course(c), starts: c.entries.map(e => person(e, c.courseName)) })
    };
    let xml: string | null = null;
    try {
        if (iofProjection.classes.some(c => c.starts.length > 0 || (c.teamStarts?.length ?? 0) > 0)) xml = new TextDecoder().decode(serializeIofStartList(iofProjection));
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
        const a = await requireRaceRole(tx, {
            ...input, role: "ADMIN"
        }, now, "share");
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
/**
 * PLAN.md steg 13: startlistan som den ser ut nu, som IOF XML för arrangören (samma projektion som publiceringen,
 * inte den senast publicerade).
 */
export async function exportCurrentStartListXmlAsAdmin(db: Database, input: Auth, now = new Date()) {
    return db.transaction(async (tx) => {
        const a = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
        if (a.status !== "authenticated") return a;
        const race = await locked(tx, input.raceId, "share");
        if (!race) return { status: "not-found" as const };
        try {
            const s = await projection(tx, race);
            return s.xml === null ? { status: "empty" as const } : { status: "exported" as const, xml: s.xml, snapshotVersion: race.snapshotVersion };
        } catch (error) {
            if (error instanceof SourceProjectionError) return { status: "conflict" as const };
            throw error;
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
        const a = await requireRaceRole(tx, {
            ...input, role: "ADMIN", requireCsrf: true
        }, now, "update");
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
            if (old.raceId !== input.raceId || old.actorAccountId !== a.principal.accountId || !oi.success || JSON.stringify(oi.data) !== JSON.stringify(r.data))
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
            if (r.data.expectedRevision !== rev || r.data.expectedSourceHash !== s.hash || s.content.classes.every(c => c.entries.length === 0) || (last?.action === "PUBLISH" && last.sourceHash === s.hash))
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
            requestId: id, raceId: race.id, actorAccountId: a.principal.accountId, revision: rev + 1, action: r.data.action, intent: r.data, sourceSnapshotVersion: race.snapshotVersion, sourceHash: hash, content, decidedAt: now
        }).returning();
        if (!saved)
            throw new Error("Beslut saknas");
        await tx.insert(schema.auditEvents).values({
            raceId: race.id, entityType: "start_list_publication", entityId: saved.id, action: saved.action === "PUBLISH" ? "START_LIST_PUBLISHED" : "START_LIST_WITHDRAWN", actorKind: "USER_ACCOUNT", actorId: a.principal.accountId, requestId: id, after: {
                revision: saved.revision
            }
        });
        return {
            status: "decided" as const, response: out(saved, false)
        };
    });
}
/**
 * "Uppdatera startlistan löpande": samma projektion som en publicering, läst nu. Undefined = listan kan inte visas
 * (tom eller trasigt underlag); då gäller den senast publicerade.
 */
async function liveStartList(db: Database, raceId: string, showCardNumbers: boolean, now: Date): Promise<PublicStartListResponse | undefined> {
    return db.transaction(async (tx) => {
        const race = await locked(tx, raceId, "share");
        if (!race) return undefined;
        let s: Awaited<ReturnType<typeof projection>>;
        try {
            s = await projection(tx, race);
        } catch (error) {
            if (error instanceof SourceProjectionError) return undefined;
            throw error;
        }
        if (s.content.classes.every(c => c.entries.length === 0)) return undefined;
        return publicStartListResponseSchema.parse({ iofExportAvailable: false, showCardNumbers, live: true, formatVersion: 1,
            revision: race.snapshotVersion, publishedAt: now.toISOString(), content: showCardNumbers ? s.content : withoutCardNumbers(s.content) });
    }, { isolationLevel: "repeatable read" });
}
export async function getPublicStartList(db: Database, raceId: string, now = new Date()): Promise<{
    status: "published";
    response: PublicStartListResponse;
} | {
    status: "not-found";
}> {
    if (!raceIdPattern.test(raceId))
        return {
            status: "not-found"
        };
    const [settings] = await db.select({ live: schema.races.startListLive, cards: schema.races.publicStartListCardNumbers })
        .from(schema.races).where(eq(schema.races.id, raceId));
    if (settings?.live) {
        const live = await liveStartList(db, raceId, settings.cards, now);
        if (live) return { status: "published", response: live };
    }
    const [r] = await db.select({
        iofExportAvailable: sql<boolean>`${schema.startListPublications.iofStartListXml} IS NOT NULL`,
        showCardNumbers: sql<boolean>`(select ${schema.races.publicStartListCardNumbers} from ${schema.races} where ${schema.races.id} = ${schema.startListPublications.raceId})`,
        action: schema.startListPublications.action, revision: schema.startListPublications.revision, content: schema.startListPublications.content, decidedAt: schema.startListPublications.decidedAt
    }).from(schema.startListPublications).where(eq(schema.startListPublications.raceId, raceId)).orderBy(desc(schema.startListPublications.revision)).limit(1);
    return !r || r.action !== "PUBLISH" || !r.content ? {
        status: "not-found"
    } : {
        status: "published", response: publicStartListResponseSchema.parse({
            iofExportAvailable: r.iofExportAvailable, showCardNumbers: r.showCardNumbers === true,
            formatVersion: 1, revision: r.revision, publishedAt: r.decidedAt.toISOString(),
            content: r.showCardNumbers === true ? r.content : withoutCardNumbers(r.content)
        })
    };
}

/** Steg 33: inställningen avstängd = inga bricknummer, även i en lista som publicerades med dem. */
function withoutCardNumbers(content: unknown): unknown {
    const parsed = startListPublicationContentSchema.parse(content);
    return { ...parsed, classes: parsed.classes.map(c => ({ ...c, entries: c.entries.map(e => {
        const copy = { ...e };
        delete copy.cardNumber;
        return copy;
    }) })) };
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
