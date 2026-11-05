import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  mapLinkCreatedSchema, mapLinkCreateRequestSchema, mapLinkReplyRequestSchema, mapLinkStateSchema, mapLinkVerdictRequestSchema,
  mapLinkViewSchema, type MapLinkCreated, type MapLinkState, type MapLinkView
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  isMapLinkToken, localRaceDate, mapLinkExpiresAt, mapLinkOpenJournaled, mapLinkStatus, mapMakerName, raceTitle
} from "@o-tid/domain";
import { consumeAccountRequestAllowance } from "./account-throttle";
import { actors, courseSettingRead, courseSettingWrite, type Failure, type ReadProof, type Transaction } from "./course-setting";
import { rowContent } from "./map-content";
import type { RaceSessionProof } from "./race-session";
import { sha256Hex } from "./serialization";

/**
 * ADR-0214: länken till kartritaren ("alla med länken"). Den som får ändra banläggningen (och ägare och administratörer)
 * skapar och stänger av länken i Kartfel. Kartritaren öppnar den utan konto och ser bara kartan och kartfelen (läge,
 * ritning, text och tråd), svarar och säger "Åtgärdat i kartan" eller "Inte åtgärdat".
 *
 * - Nyckeln är 32 slumpade byte (base64url) och bara dess sha256 sparas, som återställnings- och inbjudningslänkarna.
 *   Uppslaget görs på hashen (ett unikt index), så ingen jämförelse av nyckeln beror på hur mycket som stämmer.
 * - Nyckeln lämnas ut en gång, när länken skapas. "Skapa ny länk" stänger den förra och ger en ny; ingen kopia sparas.
 * - En länk per tävling som inte är avstängd (ett unikt index); en ny länk stänger den förra i samma transaktion.
 * - Ogiltig, okänd, avstängd och utgången länk ger samma svar ("invalid"), så att svaret inte avslöjar om den funnits.
 * - Varje anrop räknas i spärren per IP-adress och per länk (`account_request_throttle`, nyckeln som HMAC), också missar.
 * - Länken ger bara det här: kartfelen och kartfilen för tävlingen. Ingen bana, kontroll, notis av annat slag, inget foto,
 *   inga namn på den som skrev kartfelet och inga deltagare.
 * - Journalen (`audit_event`): skapad, avstängd, öppnad (högst en gång i timmen), svar och besked. Ingen IP-adress.
 */
export const MAP_LINK_REQUESTS_PER_IP_HOUR = 300;
export const MAP_LINK_REQUESTS_PER_TOKEN_HOUR = 600;

export interface MapLinkLimits { readonly perIp: number; readonly perToken: number }
const DEFAULT_LIMITS: MapLinkLimits = { perIp: MAP_LINK_REQUESTS_PER_IP_HOUR, perToken: MAP_LINK_REQUESTS_PER_TOKEN_HOUR };

type LinkRow = typeof schema.courseSettingMapLinks.$inferSelect;
const links = schema.courseSettingMapLinks;
const notes = schema.courseSettingNotes;
const replies = schema.courseSettingNoteReplies;
const uuidPattern = /^[0-9a-f-]{36}$/;

/** En ny nyckel och dess hash (bara hashen sparas). */
export function newMapLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

async function audit(tx: Transaction, raceId: string, entity: { type: string; id: string }, action: string,
  actor: { kind: "USER_ACCOUNT" | "COURSE_SETTING_MAP_LINK"; id: string }, after: Record<string, unknown>, now: Date) {
  await tx.insert(schema.auditEvents).values({ raceId, entityType: entity.type, entityId: entity.id, action, actorKind: actor.kind,
    actorId: actor.id, after, createdAt: now });
}

async function raceDates(tx: Transaction, raceId: string, now: Date)
  : Promise<{ raceDate: string; today: string; timeZone: string; name: string } | undefined> {
  const [row] = await tx.select({ raceDate: schema.races.raceDate, timeZone: schema.events.timeZone, raceName: schema.races.name,
    eventName: schema.events.name }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(eq(schema.races.id, raceId));
  return row && { raceDate: row.raceDate, today: localRaceDate(now, row.timeZone), timeZone: row.timeZone, name: raceTitle(row.eventName, row.raceName) };
}

/** Den senaste länken som inte är avstängd (gäller eller har gått ut). */
async function openLink(tx: Transaction, raceId: string): Promise<LinkRow | undefined> {
  const [row] = await tx.select().from(links).where(and(eq(links.raceId, raceId), isNull(links.revokedAt)))
    .orderBy(desc(links.createdAt)).limit(1);
  return row;
}

async function stateOf(tx: Transaction, raceId: string, now: Date): Promise<MapLinkState | undefined> {
  const dates = await raceDates(tx, raceId, now);
  if (!dates) return undefined;
  const link = await openLink(tx, raceId);
  const status = link ? mapLinkStatus(link, now) : undefined;
  return mapLinkStateSchema.parse({ formatVersion: 1, raceId, raceDate: dates.raceDate, today: dates.today,
    link: link && status !== "REVOKED" ? { status, createdAt: link.createdAt.toISOString(), expiresAt: link.expiresAt?.toISOString() ?? null,
      showRaceName: link.showRaceName, lastOpenedAt: link.lastOpenedAt?.toISOString() ?? null } : null });
}

/** Länkens läge för banläggaren (den som får ändra). */
export async function readMapLinkAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: MapLinkState }> {
  return courseSettingRead(db, input, now, async (tx, raceId) => {
    const state = await stateOf(tx, raceId, now);
    return state ? { status: "ok" as const, response: state } : { status: "not-found" as const };
  }, "EDIT");
}

/** Stänger av länkar som inte redan är avstängda. Ger hur många. */
async function revokeOpen(tx: Transaction, raceId: string, actorId: string, now: Date, replaced: boolean): Promise<number> {
  const revoked = await tx.update(links).set({ revokedAt: now, revokedBy: actorId })
    .where(and(eq(links.raceId, raceId), isNull(links.revokedAt))).returning({ id: links.id });
  for (const row of revoked) {
    await audit(tx, raceId, { type: "course_setting_map_link", id: row.id }, "MAP_LINK_REVOKED", { kind: "USER_ACCOUNT", id: actorId },
      { replaced }, now);
  }
  return revoked.length;
}

/** Ny länk ("Dela med kartritaren" eller "Skapa ny länk"): den förra stängs av. Nyckeln lämnas ut bara här. */
export async function createMapLinkAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; response: MapLinkCreated }> {
  const parsed = mapLinkCreateRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
    const dates = await raceDates(tx, raceId, now);
    if (!dates) return { status: "not-found" as const };
    const expiresAt = parsed.data.lastDay === null ? null : mapLinkExpiresAt(parsed.data.lastDay, dates.timeZone);
    if (parsed.data.lastDay !== null && (!expiresAt || expiresAt.getTime() <= now.getTime())) return { status: "invalid-request" as const };
    const replaced = await revokeOpen(tx, raceId, actorId, now, true);
    const { token, tokenHash } = newMapLinkToken();
    const id = randomUUID();
    await tx.insert(links).values({ id, raceId, tokenHash, createdBy: actorId, createdAt: now, expiresAt, showRaceName: parsed.data.showRaceName });
    await audit(tx, raceId, { type: "course_setting_map_link", id }, "MAP_LINK_CREATED", { kind: "USER_ACCOUNT", id: actorId },
      { expiresAt: expiresAt?.toISOString() ?? null, showRaceName: parsed.data.showRaceName, replacedLinks: replaced }, now);
    const state = await stateOf(tx, raceId, now);
    return { status: "ok" as const, response: mapLinkCreatedSchema.parse({ ...state, token }) };
  });
}

/** "Stäng av länken": gäller direkt (nästa anrop med nyckeln avvisas). Samma val igen ändrar inget. */
export async function revokeMapLinkAsAdmin(db: Database, input: RaceSessionProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: MapLinkState }> {
  return courseSettingWrite(db, input, now, "EDIT", async (tx, raceId, actorId) => {
    await revokeOpen(tx, raceId, actorId, now, false);
    const state = await stateOf(tx, raceId, now);
    return state ? { status: "ok" as const, response: state } : { status: "not-found" as const };
  });
}

// --- Med länken (utan konto) ---

export interface MapLinkInput {
  readonly token: string;
  /** Klientens adress; sparas bara som HMAC i spärren. */
  readonly clientKey: string;
  readonly limits?: MapLinkLimits;
}
export type MapLinkFailure = { status: "invalid" } | { status: "rate-limited" };

/**
 * Spärren (IP och länk) och länken: gäller den inte svarar allt likadant ("invalid"). Raden låses för delning, så att en
 * avstängning väntar på pågående anrop och gäller från nästa.
 */
async function withLink<T>(db: Database, input: MapLinkInput, now: Date, use: (tx: Transaction, link: LinkRow) => Promise<T>)
  : Promise<MapLinkFailure | T> {
  const limits = input.limits ?? DEFAULT_LIMITS;
  return db.transaction(async tx => {
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_LINK_IP", key: input.clientKey, limit: limits.perIp }, now)) {
      return { status: "rate-limited" as const };
    }
    if (!isMapLinkToken(input.token)) return { status: "invalid" as const };
    const tokenHash = sha256Hex(input.token);
    if (!await consumeAccountRequestAllowance(tx, { scope: "MAP_LINK_TOKEN", key: tokenHash, limit: limits.perToken }, now)) {
      return { status: "rate-limited" as const };
    }
    const [link] = await tx.select().from(links).where(eq(links.tokenHash, tokenHash)).for("share");
    if (!link || mapLinkStatus(link, now) !== "ACTIVE") return { status: "invalid" as const };
    return use(tx, link);
  });
}

const isMapError = sql`${notes.kind} = 'MAP_ERROR' and ${notes.target} in ('POINT', 'SKETCH')`;

async function viewOf(tx: Transaction, link: LinkRow, now: Date): Promise<MapLinkView> {
  const rows = await tx.select({ id: notes.id, target: notes.target, atX: notes.atX, atY: notes.atY, sketch: notes.sketch, text: notes.text,
    status: notes.status, editedAt: notes.editedAt }).from(notes).where(and(eq(notes.raceId, link.raceId), isMapError))
    .orderBy(asc(notes.createdAt), asc(notes.id)).limit(5000);
  const ids = rows.map(row => row.id);
  const answers = ids.length === 0 ? [] : await tx.select().from(replies).where(inArray(replies.noteId, ids))
    .orderBy(asc(replies.createdAt), asc(replies.id));
  const names = await actors(tx, answers.flatMap(answer => answer.createdBy ? [answer.createdBy] : []));
  const [map] = await tx.select({ sha256: schema.raceMapSources.sha256, georeference: schema.raceMapSources.georeference })
    .from(schema.raceMapSources).where(eq(schema.raceMapSources.raceId, link.raceId));
  const dates = link.showRaceName ? await raceDates(tx, link.raceId, now) : undefined;
  return mapLinkViewSchema.parse({ formatVersion: 1, raceName: dates?.name ?? null,
    map: map ? { sha256: map.sha256, georeferenced: map.georeference !== null } : null,
    mapErrors: rows.map((row, index) => ({ id: row.id, number: index + 1, text: row.text, status: row.status,
      point: row.target === "POINT" && row.atX !== null && row.atY !== null ? { x: row.atX, y: row.atY } : null,
      shapes: row.target === "SKETCH" ? row.sketch : null, editedAt: row.editedAt?.toISOString() ?? null,
      replies: answers.filter(answer => answer.noteId === row.id).map(answer => ({ id: answer.id, text: answer.text,
        createdAt: answer.createdAt.toISOString(), mapMaker: answer.mapLinkId !== null,
        author: answer.mapLinkId !== null ? answer.authorName : names.get(answer.createdBy ?? "") ?? null,
        verdict: answer.verdict ?? null, editedAt: answer.editedAt?.toISOString() ?? null })) })) });
}

/** Sidan med länken: kartfelen och kartfilens hash. Räknas som att länken öppnades ("Senast öppnad"). */
export async function readMapLinkView(db: Database, input: MapLinkInput, now = new Date())
  : Promise<MapLinkFailure | { status: "ok"; raceId: string; response: MapLinkView }> {
  return withLink(db, input, now, async (tx, link) => {
    if (mapLinkOpenJournaled(link.lastOpenedAt, now)) {
      await audit(tx, link.raceId, { type: "course_setting_map_link", id: link.id }, "MAP_LINK_OPENED",
        { kind: "COURSE_SETTING_MAP_LINK", id: link.id }, {}, now);
    }
    await tx.update(links).set({ lastOpenedAt: now }).where(eq(links.id, link.id));
    return { status: "ok" as const, raceId: link.raceId, response: await viewOf(tx, link, now) };
  });
}

/** Kartfilen som sidan ritar (bara med en giltig länk). `ifNoneMatch` = hashen webbläsaren redan har. */
export async function readMapLinkMapFile(db: Database, input: MapLinkInput & { ifNoneMatch?: string | undefined }, now = new Date())
  : Promise<MapLinkFailure | { status: "not-found" } | { status: "not-modified"; sha256: string }
    | { status: "ok"; sha256: string; format: "OCD" | "OMAP"; file: Buffer }> {
  return withLink(db, input, now, async (tx, link) => {
    const [row] = await tx.select({ format: schema.raceMapSources.format, sha256: schema.raceMapSources.sha256,
      inline: schema.raceMapSources.file, contentSha256: schema.raceMapSources.contentSha256 }).from(schema.raceMapSources)
      .where(eq(schema.raceMapSources.raceId, link.raceId));
    if (!row) return { status: "not-found" as const };
    if (input.ifNoneMatch === row.sha256) return { status: "not-modified" as const, sha256: row.sha256 };
    const file = await rowContent(tx, row);
    // Filens namn lämnas inte ut (det kan säga något om banorna); bara formatet, som Workern behöver.
    return file ? { status: "ok" as const, sha256: row.sha256, format: row.format, file } : { status: "not-found" as const };
  });
}

type WriteResult = MapLinkFailure | { status: "invalid-request" } | { status: "not-found" } | { status: "conflict" } | { status: "ok"; raceId: string };

/** Kartfelet finns i länkens tävling och är ett kartfel (allt annat är "not-found" med länken). */
async function mapErrorOf(tx: Transaction, raceId: string, noteId: string): Promise<boolean> {
  const [row] = await tx.select({ id: notes.id }).from(notes).where(and(eq(notes.id, noteId), eq(notes.raceId, raceId), isMapError));
  return !!row;
}

/**
 * Samma begäran igen (requestId) ger samma svar utan att något görs två gånger. Ett id som redan använts av någon annan
 * (ett annat kartfel eller en annan länk) är en konflikt.
 */
async function replayed(tx: Transaction, requestId: string, noteId: string, linkId: string): Promise<"new" | "same" | "conflict"> {
  const [existing] = await tx.select({ noteId: replies.noteId, mapLinkId: replies.mapLinkId }).from(replies).where(eq(replies.requestId, requestId));
  if (!existing) return "new";
  return existing.noteId === noteId && existing.mapLinkId === linkId ? "same" : "conflict";
}

/** Kartritarens svar i kartfelets tråd. */
export async function replyViaMapLink(db: Database, input: MapLinkInput & { noteId: string; request: unknown }, now = new Date())
  : Promise<WriteResult> {
  const parsed = mapLinkReplyRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuidPattern.test(input.noteId)) return { status: "invalid-request" };
  return withLink(db, input, now, async (tx, link) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-setting:" + link.raceId}, 0))`);
    if (!await mapErrorOf(tx, link.raceId, input.noteId)) return { status: "not-found" as const };
    const again = await replayed(tx, parsed.data.requestId, input.noteId, link.id);
    if (again === "conflict") return { status: "conflict" as const };
    if (again === "new") {
      const id = randomUUID();
      await tx.insert(replies).values({ id, noteId: input.noteId, raceId: link.raceId, text: parsed.data.text, createdAt: now, createdBy: null,
        requestId: parsed.data.requestId, mapLinkId: link.id, authorName: mapMakerName(parsed.data.name), verdict: null });
      await audit(tx, link.raceId, { type: "course_setting_note", id: input.noteId }, "MAP_LINK_REPLY", { kind: "COURSE_SETTING_MAP_LINK", id: link.id },
        { replyId: id }, now);
    }
    return { status: "ok" as const, raceId: link.raceId };
  });
}

/**
 * "Åtgärdat i kartan" (kartfelet blir klart) eller "Inte åtgärdat" (det står öppet, så att banläggaren ser det), med en
 * valfri kommentar. Beskedet blir ett svar i tråden med kartritaren som avsändare.
 */
export async function setVerdictViaMapLink(db: Database, input: MapLinkInput & { noteId: string; request: unknown }, now = new Date())
  : Promise<WriteResult> {
  const parsed = mapLinkVerdictRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuidPattern.test(input.noteId)) return { status: "invalid-request" };
  return withLink(db, input, now, async (tx, link) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"course-setting:" + link.raceId}, 0))`);
    if (!await mapErrorOf(tx, link.raceId, input.noteId)) return { status: "not-found" as const };
    const again = await replayed(tx, parsed.data.requestId, input.noteId, link.id);
    if (again === "conflict") return { status: "conflict" as const };
    if (again === "new") {
      const id = randomUUID(), fixed = parsed.data.verdict === "FIXED";
      await tx.insert(replies).values({ id, noteId: input.noteId, raceId: link.raceId, text: parsed.data.text.trim(), createdAt: now, createdBy: null,
        requestId: parsed.data.requestId, mapLinkId: link.id, authorName: mapMakerName(parsed.data.name), verdict: parsed.data.verdict });
      await tx.update(notes).set({ status: fixed ? "DONE" : "OPEN", resolvedAt: fixed ? now : null, resolvedBy: null })
        .where(and(eq(notes.id, input.noteId), eq(notes.raceId, link.raceId)));
      await audit(tx, link.raceId, { type: "course_setting_note", id: input.noteId }, "MAP_LINK_VERDICT",
        { kind: "COURSE_SETTING_MAP_LINK", id: link.id }, { replyId: id, verdict: parsed.data.verdict }, now);
    }
    return { status: "ok" as const, raceId: link.raceId };
  });
}
