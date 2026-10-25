import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import {
  UNINTERPRETED_READOUT_TRANSPORT, serverResultSummarySchema, uninterpretedReadoutListResponseSchema,
  uninterpretedReadoutPayloadSchema, uninterpretedReadoutReceiptSchema, uninterpretedReadoutRequestSchema,
  uninterpretedReadoutRereadRequestSchema, uninterpretedReadoutRereadResponseSchema,
  type UninterpretedReadoutListResponse, type UninterpretedReadoutReceipt, type UninterpretedReadoutRereadResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { CardDecodeError, decodeRecordedFrames, framesFromHex, normalizeCard, SiTimeError, type NormalizedSiReadout } from "@o-tid/sportident";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { storeIngestedReadout } from "./ingest";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { READOUT_REREAD_TRANSPORT } from "./readout-reread";
import { contentHash } from "./serialization";

/**
 * Steg 45: avläsningar vars tider inte gick att tolka i webbläsaren (SiTimeError). Råramarna sparas på servern som ett
 * råmeddelande (transport `sportident-uninterpreted`, `parser_status` `uninterpreted`) utan avläsning och resultat, så
 * att de finns kvar även om webbläsaren rensas. Administratören läser om dem med datorns klocka vid avläsningen eller
 * en angiven tid: det blir ett nytt råmeddelande (`sportident-reread`, pekar på originalet) och en vanlig avläsning som
 * bedöms som vid mottagningen (okänd bricka hamnar under Okända brickor). Originalet ändras aldrig.
 */
type Failure = { status: "invalid-request" | "unauthorized" | "forbidden" | "not-found" | "conflict" };
type RawMessage = typeof schema.rawDeviceMessages.$inferSelect;
const PARSER_STATUS = "uninterpreted";
const AUDIT_ACTION = "UNINTERPRETED_READOUT_REREAD_BY_ADMIN";
const MAX_ROWS = 10_000;

export type UninterpretedReadoutReceiveResult = Failure | { status: "ok"; response: UninterpretedReadoutReceipt };

/** Avläsningssidan (funktionär eller administratör): sparar en otolkad avläsning. Samma begäran igen ger samma kvitto. */
export async function receiveUninterpretedReadout(db: Database, input: RaceSessionProof & { request: unknown },
  now = new Date()): Promise<UninterpretedReadoutReceiveResult> {
  const parsed = uninterpretedReadoutRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const auth = await requireRaceRole(db, { ...input, role: "FUNCTIONARY", requireCsrf: true }, now);
  if (auth.status !== "authenticated") return auth;
  const raceId = auth.principal.raceId;
  return db.transaction(async (tx) => {
    await lockRaceForSnapshot(tx, raceId);
    const rawPayload = { readoutDeviceId: request.deviceId, ...request.payload };
    const hash = contentHash(rawPayload);
    const [inserted] = await tx.insert(schema.rawDeviceMessages).values({ raceId, deviceId: request.requestId,
      sessionId: request.sessionId, localSequence: 1, packageVersion: request.packageVersion,
      stationReceivedAt: new Date(request.stationReceivedAt), serverReceivedAt: now, transport: UNINTERPRETED_READOUT_TRANSPORT,
      rawPayload, contentHash: hash, parserStatus: PARSER_STATUS }).onConflictDoNothing().returning({ id: schema.rawDeviceMessages.id });
    if (inserted) return { status: "ok" as const, response: receipt(raceId, request.requestId, inserted.id, "stored") };
    const [existing] = await tx.select().from(schema.rawDeviceMessages).where(and(
      eq(schema.rawDeviceMessages.deviceId, request.requestId), eq(schema.rawDeviceMessages.localSequence, 1)));
    if (!existing || existing.raceId !== raceId || existing.contentHash !== hash || existing.transport !== UNINTERPRETED_READOUT_TRANSPORT) {
      return { status: "conflict" as const };
    }
    return { status: "ok" as const, response: receipt(raceId, request.requestId, existing.id, "duplicate") };
  });
}

function receipt(raceId: string, requestId: string, rawMessageId: string, status: "stored" | "duplicate") {
  return uninterpretedReadoutReceiptSchema.parse({ formatVersion: 1, raceId, requestId, rawMessageId, status });
}

type Executor = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Omläsningar av de otolkade avläsningarna: originalets id → avläsningen och serverns bedömning. */
async function rereadsOf(tx: Executor, raceId: string, sourceIds: readonly string[]) {
  if (sourceIds.length === 0) return new Map<string, { readoutId: string; status: string; readAt: Date }>();
  const rows = await tx.select({ source: sql<string>`${schema.rawDeviceMessages.rawPayload}->'rereadOf'->>'rawMessageId'`,
    readoutId: schema.cardReadouts.id, readAt: schema.cardReadouts.readAt, serverResult: schema.deviceIngestOutcomes.serverResult })
    .from(schema.rawDeviceMessages)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.rawMessageId, schema.rawDeviceMessages.id))
    .innerJoin(schema.deviceIngestOutcomes, eq(schema.deviceIngestOutcomes.rawMessageId, schema.rawDeviceMessages.id))
    .where(and(eq(schema.rawDeviceMessages.raceId, raceId), eq(schema.rawDeviceMessages.transport, READOUT_REREAD_TRANSPORT),
      inArray(sql<string>`${schema.rawDeviceMessages.rawPayload}->'rereadOf'->>'rawMessageId'`, [...sourceIds])));
  return new Map(rows.map((row) => [row.source, { readoutId: row.readoutId, readAt: row.readAt,
    status: serverResultSummarySchema.parse(row.serverResult).status }]));
}

export type UninterpretedReadoutListResult = Failure | { status: "ok"; response: UninterpretedReadoutListResponse };

/** Administratören: tävlingens otolkade avläsningar, äldst först, med omläsningen om den finns. */
export async function listUninterpretedReadoutsAsAdmin(db: Database, input: RaceSessionProof, now = new Date()):
  Promise<UninterpretedReadoutListResult> {
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const rows = await tx.select().from(schema.rawDeviceMessages).where(and(eq(schema.rawDeviceMessages.raceId, raceId),
      eq(schema.rawDeviceMessages.transport, UNINTERPRETED_READOUT_TRANSPORT)))
      .orderBy(asc(schema.rawDeviceMessages.stationReceivedAt), asc(schema.rawDeviceMessages.id)).limit(MAX_ROWS);
    const rereads = await rereadsOf(tx, raceId, rows.map((row) => row.id));
    return { status: "ok" as const, response: uninterpretedReadoutListResponseSchema.parse({ formatVersion: 1, raceId,
      readouts: rows.flatMap((row) => {
        const payload = uninterpretedReadoutPayloadSchema.safeParse(withoutDevice(row.rawPayload));
        if (!payload.success) return [];
        const reread = rereads.get(row.id);
        return [{ rawMessageId: row.id, cardNumber: payload.data.cardNumber, stationReceivedAt: row.stationReceivedAt.toISOString(),
          error: payload.data.error, simulated: payload.data.simulated,
          reread: reread ? { readoutId: reread.readoutId, status: reread.status, readAt: reread.readAt.toISOString() } : null }];
      }) }) };
  });
}

function withoutDevice(rawPayload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...rawPayload };
  delete copy.readoutDeviceId;
  return copy;
}

type Decoded = { ok: true; decoded: NormalizedSiReadout } | { ok: false; reason: "TIME" | "FRAMES"; detail: string };

function decode(frames: readonly string[], cardNumber: string, reference: Date, timeZone: string): Decoded {
  try {
    const card = decodeRecordedFrames(framesFromHex(frames));
    if (String(card.cardNumber) !== cardNumber) return { ok: false, reason: "FRAMES", detail: "Bricknumret i råramarna stämmer inte med avläsningen" };
    return { ok: true, decoded: normalizeCard(card, { reference, timeZone }) };
  } catch (error) {
    if (error instanceof CardDecodeError) return { ok: false, reason: "FRAMES", detail: error.message.slice(0, 200) || "Råramarna går inte att avkoda" };
    if (error instanceof SiTimeError) return { ok: false, reason: "TIME", detail: error.message.slice(0, 200) || "Tiderna går inte att placera" };
    throw error;
  }
}

export type UninterpretedReadoutRereadResult = Failure | { status: "ok"; response: UninterpretedReadoutRereadResponse };

/**
 * "Läs om" för en otolkad avläsning (administratör). Datorns klocka = mottagningstiden på avläsningsdatorn; en angiven
 * tid = när brickan faktiskt lästes ut. Går tiderna fortfarande inte att placera sparas inget. Samma begäran igen ger
 * samma kvitto; en annan begäran för en redan omläst avläsning ger konflikt.
 */
export async function rereadUninterpretedReadoutAsAdmin(db: Database, input: RaceSessionProof & { request: unknown },
  now = new Date()): Promise<UninterpretedReadoutRereadResult> {
  const parsed = uninterpretedReadoutRereadRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const authentication = { ...input, role: "ADMIN" as const, requireCsrf: true };
  const initial = await requireRaceRole(db, authentication, now);
  if (initial.status !== "authenticated") return initial;
  return db.transaction(async (tx) => {
    const auth = await requireRaceRole(tx, authentication, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await lockRaceForMutation(tx, raceId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"uninterpreted-reread:" + request.rawMessageId}, 0))`);
    const [source] = await tx.select().from(schema.rawDeviceMessages).where(and(eq(schema.rawDeviceMessages.id, request.rawMessageId),
      eq(schema.rawDeviceMessages.raceId, raceId), eq(schema.rawDeviceMessages.transport, UNINTERPRETED_READOUT_TRANSPORT)));
    if (!source) return { status: "not-found" as const };
    const [prior] = await tx.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, AUDIT_ACTION), eq(schema.auditEvents.entityId, source.id)));
    const existing = (await rereadsOf(tx, raceId, [source.id])).get(source.id);
    if (prior || existing) {
      if (!prior || !existing || prior.requestId !== request.requestId || prior.actorId !== auth.principal.accountId) {
        return { status: "conflict" as const };
      }
      const after = prior.after as { punchCount: number };
      return { status: "ok" as const, response: uninterpretedReadoutRereadResponseSchema.parse({ formatVersion: 1, raceId,
        requestId: request.requestId, rawMessageId: source.id, result: "READ", replayed: true, readoutId: existing.readoutId,
        status: existing.status, punchCount: after.punchCount }) };
    }
    const payload = uninterpretedReadoutPayloadSchema.safeParse(withoutDevice(source.rawPayload));
    if (!payload.success) return { status: "conflict" as const };
    const [event] = await tx.select({ timeZone: schema.events.timeZone }).from(schema.events)
      .innerJoin(schema.races, eq(schema.races.eventId, schema.events.id)).where(eq(schema.races.id, raceId));
    if (!event) throw new Error("Evenemanget saknas");
    const readAt = request.reference.kind === "GIVEN" ? new Date(request.reference.readAt) : source.stationReceivedAt;
    const result = decode(payload.data.frames, payload.data.cardNumber, readAt, event.timeZone);
    if (!result.ok) {
      return { status: "ok" as const, response: uninterpretedReadoutRereadResponseSchema.parse({ formatVersion: 1, raceId,
        requestId: request.requestId, rawMessageId: source.id, result: "UNREADABLE", reason: result.reason, detail: result.detail }) };
    }
    const raw = await storeRereadRaw(tx, raceId, source, payload.data, result.decoded, request.reference.kind);
    const serverResult = await storeIngestedReadout(tx, raceId, raw.id, { cardNumber: result.decoded.cardNumber,
      startPunchedAt: result.decoded.startPunchedAt, finishPunchedAt: result.decoded.finishPunchedAt,
      checkPunchedAt: result.decoded.checkPunchedAt, clearPunchedAt: result.decoded.clearPunchedAt, punches: result.decoded.punches,
      clockSource: "device" }, readAt);
    const [readout] = await tx.select({ id: schema.cardReadouts.id }).from(schema.cardReadouts).where(eq(schema.cardReadouts.rawMessageId, raw.id));
    if (!readout) throw new Error("Omläsningens avläsning saknas");
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "raw_device_message", entityId: source.id, action: AUDIT_ACTION,
      actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, requestId: request.requestId,
      before: { rawMessageId: source.id, parserStatus: source.parserStatus },
      after: { rawMessageId: raw.id, readoutId: readout.id, reference: request.reference, readAt: readAt.toISOString(),
        status: serverResult.status, punchCount: result.decoded.punches.length, resultRevisionId: "resultRevisionId" in serverResult ? serverResult.resultRevisionId : null },
      createdAt: now });
    return { status: "ok" as const, response: uninterpretedReadoutRereadResponseSchema.parse({ formatVersion: 1, raceId,
      requestId: request.requestId, rawMessageId: source.id, result: "READ", replayed: false, readoutId: readout.id,
      status: serverResult.status, punchCount: result.decoded.punches.length }) };
  });
}

/** Omläsningens råmeddelande: enheten är originalets råmeddelande och nyttolasten pekar på originalet (som steg 36). */
async function storeRereadRaw(tx: Executor, raceId: string, source: RawMessage, payload: ReturnType<typeof uninterpretedReadoutPayloadSchema.parse>,
  decoded: NormalizedSiReadout, reference: "DEVICE" | "GIVEN") {
  const [sequence] = await tx.select({ value: max(schema.rawDeviceMessages.localSequence) }).from(schema.rawDeviceMessages)
    .where(eq(schema.rawDeviceMessages.deviceId, source.id));
  const rawPayload: Record<string, unknown> = {
    rereadOf: { rawMessageId: source.id, reference },
    cardNumber: decoded.cardNumber, cardType: decoded.cardType,
    ...(decoded.startPunchedAt ? { startPunchedAt: decoded.startPunchedAt } : {}),
    ...(decoded.finishPunchedAt ? { finishPunchedAt: decoded.finishPunchedAt } : {}),
    ...(decoded.checkPunchedAt ? { checkPunchedAt: decoded.checkPunchedAt } : {}),
    ...(decoded.clearPunchedAt ? { clearPunchedAt: decoded.clearPunchedAt } : {}),
    punches: decoded.punches.map((punch) => ({ code: punch.code, punchedAt: punch.punchedAt })),
    untimedPunchCodes: [...decoded.untimedPunchCodes],
    ...(payload.stationSerial !== undefined ? { stationSerial: payload.stationSerial } : {}),
    clockSource: "device",
    simulated: payload.simulated
  };
  const [raw] = await tx.insert(schema.rawDeviceMessages).values({ raceId, deviceId: source.id, sessionId: source.sessionId,
    localSequence: (sequence?.value ?? 0) + 1, packageVersion: source.packageVersion, stationReceivedAt: source.stationReceivedAt,
    transport: READOUT_REREAD_TRANSPORT, rawPayload, contentHash: contentHash(rawPayload) }).returning();
  if (!raw) throw new Error("Omläsningens råmeddelande kunde inte sparas");
  return raw;
}
