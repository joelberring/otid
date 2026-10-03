import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  eventorConnectionsResponseSchema, eventorEventProjectionSchema,
  eventorImportIdempotencyKeySchema, eventorImportRequestSchema,
  eventorImportResponseSchema, eventorPreviewRequestSchema, eventorPreviewResponseSchema,
  eventorEntryImportPreviewRequestSchema, eventorEntryImportPreviewResponseSchema,
  eventorEntryImportCommitRequestSchema, eventorEntryImportIdempotencyKeySchema,
  eventorEntryImportResponseSchema, canonicalJsonBytes, type EventorEntryImportCommitRequest,
  type EventorConnectionsResponse, type EventorImportRequest, type EventorImportResponse,
  type EventorPreviewResponse, type EventorEntryImportPreviewResponse, type EventorEntryImportResponse,
  type EventorProfile,
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { fetchEventorEntryImport, fetchEventorEvent } from "@o-tid/eventor";
import {
  authenticateEventCreationAdminSession, authenticateEventCreationAdminSessionForMutation,
  type EventCreationRequestAuthentication,
} from "./event-creation-admin";
import { openEventorApiKey, sealEventorApiKey } from "./eventor-secret";
import { authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Connection = typeof schema.eventorConnections.$inferSelect;
type Journal = typeof schema.eventorImportRequests.$inferSelect;
type EntryImportJournal = typeof schema.eventorEntryImportRequests.$inferSelect;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" | "source-unavailable" };
type ReadInput = EventCreationRequestAuthentication & { readBody: () => Promise<unknown> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class EventorEntryImportConflictError extends Error {}

export interface EventorImportRuntime {
  masterKeyFor: (keyId: string) => Uint8Array | undefined;
  fetchEvent?: typeof fetchEventorEvent;
  fetchEntryImport?: typeof fetchEventorEntryImport;
  now?: () => Date;
}

function now(runtime: Pick<EventorImportRuntime, "now">): Date {
  const value = runtime.now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) throw new Error("INVALID_CONFIGURATION");
  return value;
}

function auth(input: EventCreationRequestAuthentication, requireCsrf = true): EventCreationRequestAuthentication {
  return { sessionToken: input.sessionToken, csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null, requireCsrf };
}

async function authorizeConnection(
  tx: Transaction, input: EventCreationRequestAuthentication, connectionId: string, at: Date,
): Promise<Failure | { status: "authorized"; connection: Connection; actorId: string }> {
  const authorization = await authenticateEventCreationAdminSessionForMutation(tx, auth(input), at);
  if (authorization.status !== "authenticated") return authorization;
  const actorId = authorization.principal.accessCredentialId;
  const [connection] = await tx.select().from(schema.eventorConnections).where(and(
    eq(schema.eventorConnections.id, connectionId), eq(schema.eventorConnections.ownerCredentialId, actorId),
  )).for("update");
  if (!connection || connection.issuedAt > at) return { status: "forbidden" };
  const [revoked] = await tx.select({ id: schema.eventorConnectionRevocations.connectionId })
    .from(schema.eventorConnectionRevocations).where(eq(schema.eventorConnectionRevocations.connectionId, connectionId));
  if (revoked) return { status: "forbidden" };
  return { status: "authorized", connection, actorId };
}

async function source(connection: Connection, eventId: string, runtime: EventorImportRuntime) {
  const masterKey = runtime.masterKeyFor(connection.keyId);
  if (!masterKey) throw new Error("SOURCE_UNAVAILABLE");
  const apiKey = openEventorApiKey({
    formatVersion: connection.formatVersion, iv: connection.iv, tag: connection.tag, ciphertext: connection.ciphertext,
  }, { environment: connection.environment, connectionId: connection.id,
    ownerCredentialId: connection.ownerCredentialId, keyId: connection.keyId }, masterKey);
  const fetched = await (runtime.fetchEvent ?? fetchEventorEvent)({ profile: connection.environment, eventId, apiKey });
  const projection = eventorEventProjectionSchema.parse(fetched.projection);
  if (projection.eventId !== eventId || !/^[a-f0-9]{64}$/.test(fetched.sourceHash) || fetched.sourceHash.length !== 64) {
    throw new Error("SOURCE_UNAVAILABLE");
  }
  return { projection, sourceHash: fetched.sourceHash, fetchedAt: now(runtime) };
}

async function entrySource(connection: Connection, eventId: string, runtime: EventorImportRuntime) {
  const masterKey = runtime.masterKeyFor(connection.keyId);
  if (!masterKey) throw new Error("SOURCE_UNAVAILABLE");
  const apiKey = openEventorApiKey({
    formatVersion: connection.formatVersion, iv: connection.iv, tag: connection.tag, ciphertext: connection.ciphertext,
  }, { environment: connection.environment, connectionId: connection.id,
    ownerCredentialId: connection.ownerCredentialId, keyId: connection.keyId }, masterKey);
  const fetched = await (runtime.fetchEntryImport ?? fetchEventorEntryImport)({ profile: connection.environment, eventId, apiKey });
  if (!/^[a-f0-9]{64}$/.test(fetched.eventClassesSourceHash) || !/^[a-f0-9]{64}$/.test(fetched.entriesSourceHash)) {
    throw new Error("SOURCE_UNAVAILABLE");
  }
  return fetched;
}

/** Stable intent component: caller array ordering must never change a retry. */
export function canonicalEventorEntryImportMappings(input: EventorEntryImportCommitRequest): readonly { readonly externalClassId: string; readonly classId: string }[] {
  return [...input.mappings].sort((left, right) => left.externalClassId.localeCompare(right.externalClassId));
}

export function eventorEntryImportMappingHash(input: EventorEntryImportCommitRequest): string {
  return createHash("sha256").update(canonicalJsonBytes(canonicalEventorEntryImportMappings(input))).digest("hex");
}

export function eventorEntryImportIntentHash(input: EventorEntryImportCommitRequest, scope: {
  raceId: string; grantId: string; actorCredentialId: string;
}): string {
  return createHash("sha256").update(canonicalJsonBytes({
    formatVersion: 1,
    raceId: scope.raceId,
    grantId: scope.grantId,
    actorCredentialId: scope.actorCredentialId,
    eventClassesSourceHash: input.eventClassesSourceHash,
    entriesSourceHash: input.entriesSourceHash,
    mappingHash: eventorEntryImportMappingHash(input)
  })).digest("hex");
}

export function eventorEntryImportFieldsMatch(
  existing: { classId: string; givenName: string; familyName: string; organisationName: string | null },
  incoming: { classId: string; givenName: string; familyName: string; organisationName?: string | null }
): boolean {
  return existing.classId === incoming.classId && existing.givenName === incoming.givenName &&
    existing.familyName === incoming.familyName && existing.organisationName === (incoming.organisationName ?? null);
}

/** Privileged local provisioning only. No browser-facing API accepts an API key. */
export async function createEventorConnection(db: Database, input: {
  connectionId?: string; ownerCredentialId: string; label: string; operatorLabel: string;
  environment: EventorProfile; keyId: string; apiKey: string; masterKey: Uint8Array;
}, issuedAt = new Date()): Promise<{ connectionId: string }> {
  const id = input.connectionId ?? randomUUID();
  const label = input.label.trim();
  const operatorLabel = input.operatorLabel.trim();
  if ((input.environment !== "testeventor-se" && input.environment !== "production-se")
    || label.length < 1 || label.length > 120 || operatorLabel.length < 1 || operatorLabel.length > 120
    || !Number.isFinite(issuedAt.getTime())) throw new Error("INVALID_CONFIGURATION");
  const envelope = sealEventorApiKey(input.apiKey, { environment: input.environment, connectionId: id,
    ownerCredentialId: input.ownerCredentialId, keyId: input.keyId }, input.masterKey);
  return db.transaction(async (tx) => {
    const [owner] = await tx.select().from(schema.eventCreationAccessCredentials)
      .where(eq(schema.eventCreationAccessCredentials.id, input.ownerCredentialId)).for("update");
    const [revoked] = await tx.select({ id: schema.eventCreationAccessCredentialRevocations.id })
      .from(schema.eventCreationAccessCredentialRevocations)
      .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, input.ownerCredentialId));
    if (!owner || revoked || owner.issuedAt > issuedAt || owner.expiresAt <= issuedAt) throw new Error("INVALID_OWNER");
    const active = await tx.select({ id: schema.eventorConnections.id }).from(schema.eventorConnections)
      .leftJoin(schema.eventorConnectionRevocations, eq(schema.eventorConnectionRevocations.connectionId, schema.eventorConnections.id))
      .where(and(eq(schema.eventorConnections.ownerCredentialId, input.ownerCredentialId), isNull(schema.eventorConnectionRevocations.connectionId)))
      .limit(100);
    if (active.length >= 100) throw new Error("CONNECTION_LIMIT");
    await tx.insert(schema.eventorConnections).values({ id, ownerCredentialId: input.ownerCredentialId,
      environment: input.environment, label, operatorLabel, keyId: input.keyId, ...envelope, issuedAt });
    return { connectionId: id };
  });
}

export async function revokeEventorConnection(db: Database, input: {
  connectionId: string; operatorLabel: string;
}, revokedAt = new Date()): Promise<{ status: "revoked" | "already-revoked" }> {
  const operatorLabel = input.operatorLabel.trim();
  if (operatorLabel.length < 1 || operatorLabel.length > 120 || !Number.isFinite(revokedAt.getTime())) {
    throw new Error("INVALID_CONFIGURATION");
  }
  return db.transaction(async (tx) => {
    const [connection] = await tx.select({ id: schema.eventorConnections.id }).from(schema.eventorConnections)
      .where(eq(schema.eventorConnections.id, input.connectionId)).for("update");
    if (!connection) throw new Error("CONNECTION_NOT_FOUND");
    const [row] = await tx.insert(schema.eventorConnectionRevocations).values({ ...input, operatorLabel, revokedAt })
      .onConflictDoNothing().returning({ id: schema.eventorConnectionRevocations.connectionId });
    return { status: row ? "revoked" : "already-revoked" };
  });
}

/**
 * Trusted provisioning only. The recipient keeps using its existing
 * race-scoped IMPORT_IOF credential; this grant is intentionally not a token.
 */
export async function createEventorRaceImportGrant(db: Database, input: {
  grantId?: string;
  eventorImportRequestId: string;
  ownerCredentialId: string;
  recipientCredentialId: string;
  label: string;
  operatorLabel: string;
}, issuedAt = new Date()): Promise<{ grantId: string; raceId: string }> {
  const id = input.grantId ?? randomUUID();
  const label = input.label.trim();
  const operatorLabel = input.operatorLabel.trim();
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(input.eventorImportRequestId) ||
    !UUID_PATTERN.test(input.ownerCredentialId) || !UUID_PATTERN.test(input.recipientCredentialId) ||
    label.length < 1 || label.length > 120 || operatorLabel.length < 1 || operatorLabel.length > 120 ||
    !Number.isFinite(issuedAt.getTime())) throw new Error("INVALID_CONFIGURATION");
  return db.transaction(async (tx) => {
    const [provenance] = await tx.select().from(schema.eventorImportRequests)
      .where(eq(schema.eventorImportRequests.requestId, input.eventorImportRequestId)).for("update");
    if (!provenance || provenance.actorCredentialId !== input.ownerCredentialId) throw new Error("INVALID_OWNER");
    const [connection] = await tx.select().from(schema.eventorConnections)
      .where(and(eq(schema.eventorConnections.id, provenance.connectionId), eq(schema.eventorConnections.ownerCredentialId, input.ownerCredentialId)))
      .for("update");
    const [connectionRevocation] = await tx.select({ id: schema.eventorConnectionRevocations.connectionId })
      .from(schema.eventorConnectionRevocations).where(eq(schema.eventorConnectionRevocations.connectionId, provenance.connectionId));
    const [owner] = await tx.select().from(schema.eventCreationAccessCredentials)
      .where(eq(schema.eventCreationAccessCredentials.id, input.ownerCredentialId)).for("update");
    const [ownerRevocation] = await tx.select({ id: schema.eventCreationAccessCredentialRevocations.id })
      .from(schema.eventCreationAccessCredentialRevocations)
      .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, input.ownerCredentialId));
    if (!connection || connectionRevocation || !owner || ownerRevocation || owner.issuedAt > issuedAt || owner.expiresAt <= issuedAt) {
      throw new Error("INVALID_OWNER");
    }
    const [recipient] = await tx.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, input.recipientCredentialId)).for("update");
    const [recipientRevocation] = await tx.select({ id: schema.pairingAdminAccessCredentialRevocations.id })
      .from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, input.recipientCredentialId));
    if (!recipient || recipientRevocation || recipient.raceId !== provenance.raceId || recipient.capability !== "IMPORT_IOF" ||
      recipient.issuedAt > issuedAt || recipient.expiresAt <= issuedAt) throw new Error("INVALID_RECIPIENT");
    await tx.insert(schema.eventorRaceImportGrants).values({ id,
      eventorImportRequestId: provenance.requestId, raceId: provenance.raceId,
      recipientCredentialId: recipient.id, capability: "IMPORT_IOF", issuerCredentialId: input.ownerCredentialId,
      label, operatorLabel, issuedAt });
    await tx.insert(schema.auditEvents).values({ raceId: provenance.raceId,
      entityType: "eventor_race_import_grant", entityId: id, action: "EVENTOR_ENTRY_IMPORT_GRANT_ISSUED",
      actorKind: "EVENT_CREATION_ACCESS_CREDENTIAL", actorId: input.ownerCredentialId, requestId: id,
      createdAt: issuedAt, after: { eventorImportRequestId: provenance.requestId,
        recipientCredentialId: recipient.id, capability: "IMPORT_IOF", label } });
    return { grantId: id, raceId: provenance.raceId };
  });
}

/** Trusted revocation only; old immutable entry-import receipts are retained. */
export async function revokeEventorRaceImportGrant(db: Database, input: {
  grantId: string;
  ownerCredentialId: string;
  operatorLabel: string;
  reason: string;
}, revokedAt = new Date()): Promise<{ status: "revoked" | "already-revoked" }> {
  const operatorLabel = input.operatorLabel.trim();
  const reason = input.reason.trim();
  if (!UUID_PATTERN.test(input.grantId) || !UUID_PATTERN.test(input.ownerCredentialId) ||
    operatorLabel.length < 1 || operatorLabel.length > 120 || reason.length < 1 || reason.length > 240 ||
    !Number.isFinite(revokedAt.getTime())) throw new Error("INVALID_CONFIGURATION");
  return db.transaction(async (tx) => {
    const [grant] = await tx.select().from(schema.eventorRaceImportGrants)
      .where(eq(schema.eventorRaceImportGrants.id, input.grantId)).for("update");
    if (!grant || grant.issuerCredentialId !== input.ownerCredentialId) throw new Error("GRANT_NOT_FOUND");
    const [created] = await tx.insert(schema.eventorRaceImportGrantRevocations).values({
      grantId: grant.id, revokedAt, issuerCredentialId: input.ownerCredentialId, operatorLabel, reason
    }).onConflictDoNothing().returning({ id: schema.eventorRaceImportGrantRevocations.grantId });
    if (!created) return { status: "already-revoked" };
    await tx.insert(schema.auditEvents).values({ raceId: grant.raceId,
      entityType: "eventor_race_import_grant", entityId: grant.id, action: "EVENTOR_ENTRY_IMPORT_GRANT_REVOKED",
      actorKind: "EVENT_CREATION_ACCESS_CREDENTIAL", actorId: input.ownerCredentialId, requestId: grant.id,
      createdAt: revokedAt, after: { reason } });
    return { status: "revoked" };
  });
}

export async function listEventorConnectionsAsAdmin(db: Database, input: EventCreationRequestAuthentication,
  at = new Date()): Promise<Failure | { status: "available"; response: EventorConnectionsResponse }> {
  return db.transaction(async (tx) => {
    const authorization = await authenticateEventCreationAdminSessionForMutation(tx, auth(input, false), at);
    if (authorization.status !== "authenticated") return authorization;
    const connections = await tx.select({ connectionId: schema.eventorConnections.id,
      label: schema.eventorConnections.label, environment: schema.eventorConnections.environment })
      .from(schema.eventorConnections)
      .leftJoin(schema.eventorConnectionRevocations, eq(schema.eventorConnectionRevocations.connectionId, schema.eventorConnections.id))
      .where(and(eq(schema.eventorConnections.ownerCredentialId, authorization.principal.accessCredentialId),
        isNull(schema.eventorConnectionRevocations.connectionId)))
      .orderBy(asc(schema.eventorConnections.id)).limit(100);
    return { status: "available", response: eventorConnectionsResponseSchema.parse({ formatVersion: 1, connections }) };
  });
}

export async function previewEventorImportAsAdmin(db: Database, input: ReadInput,
  runtime: EventorImportRuntime): Promise<Failure | { status: "available"; response: EventorPreviewResponse }> {
  const preflight = await authenticateEventCreationAdminSession(db, auth(input), now(runtime));
  if (preflight.status !== "authenticated") return preflight;
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const parsed = eventorPreviewRequestSchema.safeParse(body);
  if (!parsed.success) return { status: "invalid-request" };
  const { connectionId, eventId } = parsed.data;
  const access = await db.transaction((tx) => authorizeConnection(tx, input, connectionId, now(runtime)));
  if (access.status !== "authorized") return access;
  let fetched: Awaited<ReturnType<typeof source>>;
  try { fetched = await source(access.connection, eventId, runtime); }
  catch { return { status: "source-unavailable" }; }
  return db.transaction(async (tx) => {
    const current = await authorizeConnection(tx, input, connectionId, now(runtime));
    if (current.status !== "authorized") return current;
    return { status: "available", response: eventorPreviewResponseSchema.parse({ formatVersion: 1,
      environment: current.connection.environment, connectionId, ...fetched, fetchedAt: fetched.fetchedAt.toISOString() }) };
  });
}

type EntryImportReadInput = Omit<PairingAdminRequestAuthentication, "capability"> & { readBody: () => Promise<unknown> };

async function authorizeEntryImportGrant(tx: Transaction, input: Omit<PairingAdminRequestAuthentication, "capability">,
  grantId: string, at: Date): Promise<Failure | { status: "authorized"; grant: typeof schema.eventorRaceImportGrants.$inferSelect; connection: Connection; externalEventId: string }> {
  // The grant is the first TASK098 object locked. Authentication then proves
  // that its designated IMPORT_IOF credential is the caller before source
  // provenance or the Eventor connection are opened.
  const [grant] = await tx.select().from(schema.eventorRaceImportGrants).where(and(
    eq(schema.eventorRaceImportGrants.id, grantId), eq(schema.eventorRaceImportGrants.raceId, input.raceId)
  )).for("update");
  const authorization = await authenticatePairingAdminSessionForMutation(tx, {
    ...input, capability: "IMPORT_IOF", requireCsrf: true
  }, at);
  if (authorization.status !== "authenticated") return authorization;
  if (!grant || grant.recipientCredentialId !== authorization.principal.accessCredentialId || grant.capability !== "IMPORT_IOF") {
    return { status: "forbidden" };
  }
  const [grantRevocation] = await tx.select({ id: schema.eventorRaceImportGrantRevocations.grantId })
    .from(schema.eventorRaceImportGrantRevocations).where(eq(schema.eventorRaceImportGrantRevocations.grantId, grant.id));
  if (grantRevocation) return { status: "forbidden" };
  const [provenance] = await tx.select().from(schema.eventorImportRequests)
    .where(and(eq(schema.eventorImportRequests.requestId, grant.eventorImportRequestId),
      eq(schema.eventorImportRequests.raceId, input.raceId), eq(schema.eventorImportRequests.actorCredentialId, grant.issuerCredentialId)))
    .for("update");
  if (!provenance) return { status: "forbidden" };
  const [connection] = await tx.select().from(schema.eventorConnections).where(and(
    eq(schema.eventorConnections.id, provenance.connectionId), eq(schema.eventorConnections.ownerCredentialId, grant.issuerCredentialId)
  )).for("update");
  const [connectionRevocation] = await tx.select({ id: schema.eventorConnectionRevocations.connectionId })
    .from(schema.eventorConnectionRevocations).where(eq(schema.eventorConnectionRevocations.connectionId, provenance.connectionId));
  const [owner] = await tx.select().from(schema.eventCreationAccessCredentials)
    .where(eq(schema.eventCreationAccessCredentials.id, grant.issuerCredentialId)).for("update");
  const [ownerRevocation] = await tx.select({ id: schema.eventCreationAccessCredentialRevocations.id })
    .from(schema.eventCreationAccessCredentialRevocations)
    .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, grant.issuerCredentialId));
  if (!connection || connectionRevocation || connection.issuedAt > at || !owner || ownerRevocation ||
    owner.issuedAt > at || owner.expiresAt <= at) return { status: "forbidden" };
  return { status: "authorized", grant, connection, externalEventId: provenance.externalEventId };
}

/** Read-only aggregate preview. Names and raw XML remain in the server-side adapter projection only. */
export async function previewEventorEntryImportAsAdmin(db: Database, input: EntryImportReadInput,
  runtime: EventorImportRuntime): Promise<Failure | { status: "available"; response: EventorEntryImportPreviewResponse }> {
  const at = now(runtime);
  const preflight = await authenticatePairingAdminSession(db, { ...input, capability: "IMPORT_IOF", requireCsrf: true }, at);
  if (preflight.status !== "authenticated") return preflight;
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const parsed = eventorEntryImportPreviewRequestSchema.safeParse(body);
  if (!parsed.success) return { status: "invalid-request" };
  const first = await db.transaction((tx) => authorizeEntryImportGrant(tx, input, parsed.data.grantId, at));
  if (first.status !== "authorized") return first;
  let fetched: Awaited<ReturnType<typeof entrySource>>;
  try { fetched = await entrySource(first.connection, first.externalEventId, runtime); }
  catch { return { status: "source-unavailable" }; }
  return db.transaction(async (tx) => {
    const current = await authorizeEntryImportGrant(tx, input, parsed.data.grantId, now(runtime));
    if (current.status !== "authorized") return current;
    const targetClasses = await tx.select({ classId: schema.classes.id, name: schema.classes.name })
      .from(schema.classes).where(eq(schema.classes.raceId, input.raceId)).orderBy(asc(schema.classes.id)).limit(500);
    const countBySourceClass = new Map<string, number>();
    for (const entry of fetched.projection.entries) countBySourceClass.set(entry.externalClassId, (countBySourceClass.get(entry.externalClassId) ?? 0) + 1);
    const response = eventorEntryImportPreviewResponseSchema.parse({ formatVersion: 2, grantId: current.grant.id,
      environment: current.connection.environment,
      eventClassesSourceHash: fetched.eventClassesSourceHash, entriesSourceHash: fetched.entriesSourceHash,
      entriesCount: fetched.projection.entries.length, sourceClasses: fetched.projection.classes.map((sourceClass) => ({
        externalClassId: sourceClass.externalId, name: sourceClass.name, entryCount: countBySourceClass.get(sourceClass.externalId) ?? 0
      })), targetClasses });
    return { status: "available", response };
  });
}

type EntryImportCommitInput = Omit<PairingAdminRequestAuthentication, "capability"> & {
  idempotencyKey: string | null;
  readBody: () => Promise<unknown>;
};

type EntryImportAccess = Extract<Awaited<ReturnType<typeof authorizeEntryImportGrant>>, { status: "authorized" }>;
type ImportedEventorEntry = {
  readonly externalId: string;
  readonly classId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organisationName: string | null;
};

function entryImportResponse(row: EntryImportJournal, replayed: boolean): EventorEntryImportResponse {
  const stored = eventorEntryImportResponseSchema.parse(row.response);
  if (stored.requestId !== row.requestId || stored.raceId !== row.raceId || stored.grantId !== row.grantId ||
    stored.eventClassesSourceHash !== row.eventClassesSourceHash || stored.entriesSourceHash !== row.entriesSourceHash ||
    stored.entriesSeen !== row.entriesSeen || stored.entriesCreated !== row.entriesCreated ||
    stored.entriesUnchanged !== row.entriesUnchanged || stored.snapshotVersionBefore !== row.snapshotVersionBefore ||
    stored.snapshotVersionAfter !== row.snapshotVersionAfter || stored.createdAt !== row.createdAt.toISOString()) {
    throw new Error("EVENTOR_ENTRY_IMPORT_RECEIPT_CORRUPT");
  }
  return eventorEntryImportResponseSchema.parse({ ...stored, replayed });
}

function hasSameEntryImportIntent(row: EntryImportJournal, requestId: string, raceId: string, actorCredentialId: string,
  intent: EventorEntryImportCommitRequest, intentHash: string): boolean {
  if (row.requestId !== requestId || row.raceId !== raceId || row.actorCredentialId !== actorCredentialId ||
    row.capability !== "IMPORT_IOF" || row.grantId !== intent.grantId ||
    row.eventClassesSourceHash !== intent.eventClassesSourceHash || row.entriesSourceHash !== intent.entriesSourceHash ||
    row.mappingHash !== eventorEntryImportMappingHash(intent) || row.intentHash !== intentHash) return false;
  try {
    const persisted = eventorEntryImportCommitRequestSchema.parse({
      formatVersion: 1,
      grantId: row.grantId,
      eventClassesSourceHash: row.eventClassesSourceHash,
      entriesSourceHash: row.entriesSourceHash,
      mappings: row.mapping
    });
    return Buffer.from(canonicalJsonBytes(canonicalEventorEntryImportMappings(persisted)))
      .equals(Buffer.from(canonicalJsonBytes(canonicalEventorEntryImportMappings(intent))));
  } catch {
    return false;
  }
}

function sourceEntriesForCommit(source: Awaited<ReturnType<typeof entrySource>>,
  intent: EventorEntryImportCommitRequest): readonly ImportedEventorEntry[] {
  const mappings = canonicalEventorEntryImportMappings(intent);
  const sourceClassIds = new Set(source.projection.classes.map((value) => value.externalId));
  if (sourceClassIds.size !== source.projection.classes.length || source.projection.classes.length !== mappings.length ||
    mappings.some((mapping) => !sourceClassIds.has(mapping.externalClassId))) {
      throw new EventorEntryImportConflictError("Varje Eventor-klass kräver en explicit klassmappning");
  }
  const classIdByExternalId = new Map(mappings.map((mapping) => [mapping.externalClassId, mapping.classId]));
  const seenEntryIds = new Set<string>();
  const entries: ImportedEventorEntry[] = [];
  for (const entry of source.projection.entries) {
    const classId = classIdByExternalId.get(entry.externalClassId);
    if (!classId || seenEntryIds.has(entry.externalId)) {
      throw new EventorEntryImportConflictError("Eventorunderlaget saknar en entydig klass- eller entryidentitet");
    }
    seenEntryIds.add(entry.externalId);
    entries.push({ externalId: entry.externalId, classId, givenName: entry.givenName,
      familyName: entry.familyName, organisationName: entry.organisationName ?? null });
  }
  if (entries.length > 10_000) throw new EventorEntryImportConflictError("För många Eventoranmälningar");
  return entries;
}

async function assertEntryImportMappings(tx: Transaction, raceId: string,
  intent: EventorEntryImportCommitRequest): Promise<Map<string, { maxEntries: number | null }>> {
  const mappings = canonicalEventorEntryImportMappings(intent);
  const classIds = mappings.map((mapping) => mapping.classId);
  const rows = await tx.select({ id: schema.classes.id, maxEntries: schema.classes.maxEntries })
    .from(schema.classes).where(and(eq(schema.classes.raceId, raceId), inArray(schema.classes.id, classIds)))
    .orderBy(asc(schema.classes.id)).for("update");
  if (rows.length !== classIds.length || new Set(rows.map((row) => row.id)).size !== classIds.length) {
    throw new EventorEntryImportConflictError("En mappad klass finns inte i loppet");
  }
  return new Map(rows.map((row) => [row.id, { maxEntries: row.maxEntries }]));
}

async function applyEventorEntryImport(tx: Transaction, access: EntryImportAccess, race: { id: string; snapshotVersion: number },
  intent: EventorEntryImportCommitRequest, source: Awaited<ReturnType<typeof entrySource>>, requestId: string,
  actorCredentialId: string, createdAt: Date): Promise<EventorEntryImportResponse> {
  const imported = sourceEntriesForCommit(source, intent);
  const mappings = canonicalEventorEntryImportMappings(intent);
  const classes = await assertEntryImportMappings(tx, race.id, intent);
  const importedIds = imported.map((entry) => entry.externalId);
  const existing = importedIds.length === 0 ? [] : await tx.select({ id: schema.entries.id,
    externalId: schema.entries.externalId, classId: schema.entries.classId, givenName: schema.entries.givenName,
    familyName: schema.entries.familyName, organisationName: schema.entries.organisationName
  }).from(schema.entries).where(and(eq(schema.entries.raceId, race.id),
    eq(schema.entries.externalSource, "eventor"), inArray(schema.entries.externalId, importedIds)))
    .orderBy(asc(schema.entries.id)).for("update");
  const existingByExternalId = new Map<string, (typeof existing)[number]>();
  for (const entry of existing) {
    if (entry.externalId === null || existingByExternalId.has(entry.externalId)) {
      throw new EventorEntryImportConflictError("Befintlig Eventor-entry saknar entydig extern identitet");
    }
    existingByExternalId.set(entry.externalId, entry);
  }
  const missing: ImportedEventorEntry[] = [];
  let unchanged = 0;
  for (const incoming of imported) {
    const prior = existingByExternalId.get(incoming.externalId);
    if (!prior) {
      missing.push(incoming);
      continue;
    }
    if (!eventorEntryImportFieldsMatch(prior, incoming)) {
      throw new EventorEntryImportConflictError("Befintlig Eventor-entry skiljer sig från importunderlaget");
    }
    unchanged += 1;
  }
  const [roster] = await tx.select({ entries: count() }).from(schema.entries)
    .where(eq(schema.entries.raceId, race.id));
  if (!roster || roster.entries + missing.length > 10_000) {
    throw new EventorEntryImportConflictError("Loppets deltagargräns överskrids");
  }
  const occupancy = await tx.select({ classId: schema.entries.classId, entries: count() }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, race.id), inArray(schema.entries.classId, [...classes.keys()])))
    .groupBy(schema.entries.classId);
  const countByClass = new Map(occupancy.map((row) => [row.classId, row.entries]));
  for (const incoming of missing) countByClass.set(incoming.classId, (countByClass.get(incoming.classId) ?? 0) + 1);
  for (const [classId, raceClass] of classes) {
    if (raceClass.maxEntries !== null && (countByClass.get(classId) ?? 0) > raceClass.maxEntries) {
      throw new EventorEntryImportConflictError("En mappad klass saknar plats för samtliga deltagare");
    }
  }
  for (let index = 0; index < missing.length; index += 500) {
    await tx.insert(schema.entries).values(missing.slice(index, index + 500).map((entry) => ({ raceId: race.id,
      classId: entry.classId, givenName: entry.givenName, familyName: entry.familyName,
      organisationName: entry.organisationName, externalSource: "eventor", externalId: entry.externalId, version: 1 })));
  }
  if (race.snapshotVersion >= 2_147_483_647 && missing.length > 0) {
    throw new EventorEntryImportConflictError("Loppets snapshotversion kan inte ökas");
  }
  const snapshotVersionAfter = race.snapshotVersion + (missing.length > 0 ? 1 : 0);
  if (missing.length > 0) {
    await tx.update(schema.races).set({ snapshotVersion: snapshotVersionAfter }).where(eq(schema.races.id, race.id));
  }
  const response = eventorEntryImportResponseSchema.parse({ formatVersion: 1, replayed: false, requestId,
    raceId: race.id, grantId: access.grant.id, eventClassesSourceHash: intent.eventClassesSourceHash,
    entriesSourceHash: intent.entriesSourceHash, entriesSeen: imported.length, entriesCreated: missing.length,
    entriesUnchanged: unchanged, snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter,
    createdAt: createdAt.toISOString() });
  await tx.insert(schema.eventorEntryImportRequests).values({ requestId, grantId: access.grant.id,
    raceId: race.id, actorCredentialId, capability: "IMPORT_IOF",
    eventClassesSourceHash: intent.eventClassesSourceHash, entriesSourceHash: intent.entriesSourceHash,
    mappingHash: eventorEntryImportMappingHash(intent), intentHash: eventorEntryImportIntentHash(intent, {
      raceId: race.id, grantId: access.grant.id, actorCredentialId
    }), mapping: mappings, response, entriesSeen: imported.length, entriesCreated: missing.length,
    entriesUnchanged: unchanged, snapshotVersionBefore: race.snapshotVersion, snapshotVersionAfter, createdAt });
  await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "eventor_entry_import",
    entityId: requestId, action: "EVENTOR_ENTRY_IMPORT_COMMITTED", actorKind: "IOF_IMPORT_ACCESS_CREDENTIAL",
    actorId: actorCredentialId, requestId, createdAt, before: { snapshotVersion: race.snapshotVersion }, after: {
      grantId: access.grant.id, eventClassesSourceHash: intent.eventClassesSourceHash,
      entriesSourceHash: intent.entriesSourceHash, mappingHash: eventorEntryImportMappingHash(intent),
      entriesSeen: imported.length, entriesCreated: missing.length, entriesUnchanged: unchanged,
      snapshotVersion: snapshotVersionAfter
    } });
  return response;
}

/**
 * Commits a previously reviewed Testeventor participant set. The upstream is
 * deliberately fetched outside the transaction, while grant/provenance and
 * race state are checked under locks both before and after that fetch.
 */
export async function importEventorEntriesAsAdmin(db: Database, input: EntryImportCommitInput,
  runtime: EventorImportRuntime): Promise<Failure | { status: "created"; response: EventorEntryImportResponse }> {
  const idempotency = eventorEntryImportIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!idempotency.success) return { status: "invalid-request" };
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const request = eventorEntryImportCommitRequestSchema.safeParse(body);
  if (!request.success) return { status: "invalid-request" };
  const requestId = idempotency.data.slice("eventor-entry-import:".length);
  const at = now(runtime);
  const authentication = { ...input, capability: "IMPORT_IOF" as const, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, at);
  if (preflight.status !== "authenticated") return preflight;
  const actorCredentialId = preflight.principal.accessCredentialId;
  const intentHash = eventorEntryImportIntentHash(request.data, { raceId: input.raceId,
    grantId: request.data.grantId, actorCredentialId });

  // An immutable exact receipt is safe to replay even when its grant was
  // subsequently revoked. A non-identical request-id or an equivalent intent
  // with a fresh request-id is a conflict and never reaches Testeventor.
  const [prior] = await db.select().from(schema.eventorEntryImportRequests)
    .where(eq(schema.eventorEntryImportRequests.requestId, requestId));
  if (prior) {
    if (!hasSameEntryImportIntent(prior, requestId, input.raceId, actorCredentialId, request.data, intentHash)) {
      return { status: "conflict" };
    }
    return { status: "created", response: entryImportResponse(prior, true) };
  }
  const [sameIntent] = await db.select({ requestId: schema.eventorEntryImportRequests.requestId })
    .from(schema.eventorEntryImportRequests).where(and(eq(schema.eventorEntryImportRequests.raceId, input.raceId),
      eq(schema.eventorEntryImportRequests.intentHash, intentHash)));
  if (sameIntent) return { status: "conflict" };

  const first = await db.transaction((tx) => authorizeEntryImportGrant(tx, input, request.data.grantId, at));
  if (first.status !== "authorized") return first;
  let fetched: Awaited<ReturnType<typeof entrySource>>;
  try { fetched = await entrySource(first.connection, first.externalEventId, runtime); }
  catch { return { status: "source-unavailable" }; }
  if (fetched.eventClassesSourceHash !== request.data.eventClassesSourceHash ||
    fetched.entriesSourceHash !== request.data.entriesSourceHash) return { status: "conflict" };

  try {
    return await db.transaction(async (tx) => {
      // The request row stays replayable after a later revoke, so check it
      // before grant revalidation. New writes always take grant/provenance
      // locks before the race lock.
      const currentAuthentication = await authenticatePairingAdminSessionForMutation(tx, authentication, now(runtime));
      if (currentAuthentication.status !== "authenticated") return currentAuthentication;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"eventor-entry-import:" + requestId}, 0))`);
      const [existing] = await tx.select().from(schema.eventorEntryImportRequests)
        .where(eq(schema.eventorEntryImportRequests.requestId, requestId));
      if (existing) {
        if (!hasSameEntryImportIntent(existing, requestId, input.raceId,
          currentAuthentication.principal.accessCredentialId, request.data, intentHash)) return { status: "conflict" };
        return { status: "created" as const, response: entryImportResponse(existing, true) };
      }
      const access = await authorizeEntryImportGrant(tx, input, request.data.grantId, now(runtime));
      if (access.status !== "authorized") return access;
      if (access.grant.recipientCredentialId !== currentAuthentication.principal.accessCredentialId) return { status: "forbidden" };
      const [duplicateIntent] = await tx.select({ requestId: schema.eventorEntryImportRequests.requestId })
        .from(schema.eventorEntryImportRequests).where(and(eq(schema.eventorEntryImportRequests.raceId, input.raceId),
          eq(schema.eventorEntryImportRequests.intentHash, intentHash)));
      if (duplicateIntent) return { status: "conflict" };
      const race = await lockRaceForMutation(tx, input.raceId);
      const response = await applyEventorEntryImport(tx, access, race, request.data, fetched, requestId,
        currentAuthentication.principal.accessCredentialId, now(runtime));
      return { status: "created" as const, response };
    });
  } catch (error) {
    if (error instanceof EventorEntryImportConflictError) return { status: "conflict" };
    throw error;
  }
}

function receipt(row: Journal, replayed: boolean): EventorImportResponse {
  return eventorImportResponseSchema.parse({ formatVersion: 1, replayed, requestId: row.requestId,
    eventId: row.eventId, raceId: row.raceId, createdAt: row.createdAt.toISOString(),
    environment: row.environment, externalEventId: row.externalEventId,
    externalEventRaceId: row.externalEventRaceId, sourceHash: row.sourceHash });
}

async function replay(tx: Transaction, requestId: string, actorId: string, intent: EventorImportRequest)
  : Promise<Failure | { status: "created"; response: EventorImportResponse } | undefined> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"eventor-request:" + requestId}, 0))`);
  const [previous] = await tx.select().from(schema.eventorImportRequests)
    .where(eq(schema.eventorImportRequests.requestId, requestId));
  if (!previous) return undefined;
  if (previous.actorCredentialId !== actorId || previous.connectionId !== intent.connectionId
    || previous.externalEventId !== intent.eventId || previous.externalEventRaceId !== intent.eventRaceId
    || previous.timeZone !== intent.timeZone || previous.sourceHash !== intent.sourceHash) return { status: "conflict" };
  return { status: "created", response: receipt(previous, true) };
}

export async function importEventorEventAsAdmin(db: Database, input: ReadInput & { idempotencyKey: string | null },
  runtime: EventorImportRuntime): Promise<Failure | { status: "created"; response: EventorImportResponse }> {
  const preflight = await authenticateEventCreationAdminSession(db, auth(input), now(runtime));
  if (preflight.status !== "authenticated") return preflight;
  const key = eventorImportIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) return { status: "invalid-request" };
  let body: unknown;
  try { body = await input.readBody(); } catch { return { status: "invalid-request" }; }
  const parsed = eventorImportRequestSchema.safeParse(body);
  if (!parsed.success) return { status: "invalid-request" };
  const intent = parsed.data;
  const requestId = key.data.slice("eventor-import:".length);
  const initial = await db.transaction(async (tx) => {
    const access = await authorizeConnection(tx, input, intent.connectionId, now(runtime));
    if (access.status !== "authorized") return access;
    return await replay(tx, requestId, access.actorId, intent) ?? access;
  });
  if (initial.status !== "authorized") return initial;
  let fetched: Awaited<ReturnType<typeof source>>;
  try { fetched = await source(initial.connection, intent.eventId, runtime); }
  catch { return { status: "source-unavailable" }; }
  if (fetched.sourceHash !== intent.sourceHash) return { status: "conflict" };
  const selectedRace = fetched.projection.races.find((race) => race.eventRaceId === intent.eventRaceId);
  if (!selectedRace) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const createdAt = now(runtime);
    const access = await authorizeConnection(tx, input, intent.connectionId, createdAt);
    if (access.status !== "authorized") return access;
    const previous = await replay(tx, requestId, access.actorId, intent);
    if (previous) return previous;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"eventor-external:" + access.connection.environment + ":" + intent.eventId}, 0))`);
    const [duplicate] = await tx.select({ requestId: schema.eventorImportRequests.requestId })
      .from(schema.eventorImportRequests).where(and(eq(schema.eventorImportRequests.environment, access.connection.environment),
        eq(schema.eventorImportRequests.externalEventId, intent.eventId)));
    if (duplicate) return { status: "conflict" };
    const eventId = randomUUID();
    const raceId = randomUUID();
    const fields = { eventName: fetched.projection.eventName, eventStartDate: fetched.projection.startDate,
      raceName: selectedRace.raceName, raceDate: selectedRace.raceDate, timeZone: intent.timeZone };
    await tx.insert(schema.events).values({ id: eventId, name: fields.eventName, startsOn: fields.eventStartDate,
      timeZone: fields.timeZone, createdAt });
    await tx.insert(schema.races).values({ id: raceId, eventId, name: fields.raceName, raceDate: fields.raceDate,
      snapshotVersion: 1, createdAt });
    const [journal] = await tx.insert(schema.eventorImportRequests).values({ requestId,
      connectionId: intent.connectionId, actorCredentialId: access.actorId, environment: access.connection.environment,
      externalEventId: intent.eventId, externalEventRaceId: intent.eventRaceId, sourceHash: intent.sourceHash,
      mappingVersion: 1, ...fields, eventId, raceId, fetchedAt: fetched.fetchedAt, createdAt }).returning();
    if (!journal) throw new Error("IMPORT_FAILED");
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "event", entityId: eventId,
      action: access.connection.environment === "testeventor-se" ? "EVENT_IMPORTED_FROM_TESTEVENTOR" : "EVENT_IMPORTED_FROM_EVENTOR", actorKind: "EVENT_CREATION_ACCESS_CREDENTIAL",
      actorId: access.actorId, requestId, createdAt, after: { ...fields, eventId, raceId,
        connectionId: intent.connectionId, sourceHash: intent.sourceHash, externalEventId: intent.eventId,
        externalEventRaceId: intent.eventRaceId, mappingVersion: 1, environment: access.connection.environment } });
    return { status: "created", response: receipt(journal, false) };
  });
}
