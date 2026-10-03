import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  EVENT_CREATION_ACCESS_CREDENTIAL_PREFIX,
  EVENT_CREATION_SESSION_TOKEN_PREFIX,
  eventCreationIdempotencyKeySchema,
  eventCreationLoginRequestSchema,
  eventCreationLoginResponseSchema,
  eventCreationRequestSchema,
  eventCreationResponseSchema,
  type EventCreationLoginRequest,
  type EventCreationLoginResponse,
  type EventCreationResponse
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ACCESS_LIFETIME_MS = 8 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 60 * 60 * 1000;
const DUMMY_ID = "00000000-0000-4000-8000-000000000000";
const DUMMY_HASH = Buffer.from("0e0c2fb493e4475d4ee4055cc5cb7c8229399d72a775ae5c346b57466b72d081", "hex");

interface ParsedToken { id: string; secret: Buffer }

export interface EventCreationRuntimeOptions {
  now?: Date;
  id?: string;
  secretBytes?: Uint8Array;
  sessionId?: string;
  sessionSecretBytes?: Uint8Array;
  csrfSecretBytes?: Uint8Array;
}

export interface EventCreationAccessCredentialInstallation {
  formatVersion: 1;
  accessCredential: string;
  credentialId: string;
  capability: "CREATE_EVENT";
  label: string;
  issuedAt: string;
  expiresAt: string;
}

export interface EventCreationPrincipal {
  accessCredentialId: string;
  capability: "CREATE_EVENT";
  sessionId: string;
  expiresAt: string;
}

export interface EventCreationRequestAuthentication {
  sessionToken: string | null;
  csrfCookie?: string | null;
  csrfHeader?: string | null;
  requireCsrf?: boolean;
}

export type EventCreationAuthenticationResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "authenticated"; principal: EventCreationPrincipal };

export type EventCreationLoginResult =
  | { status: "unauthorized" }
  | {
    status: "authenticated";
    response: EventCreationLoginResponse;
    sessionToken: string;
    csrfToken: string;
  };

export type EventCreationLogoutResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" }
  | { status: "logged-out" | "already-logged-out" };

export type CreateEventAsAdminResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" }
  | { status: "created"; response: EventCreationResponse };

export type CreateEventAsAdminInput = EventCreationRequestAuthentication & {
  idempotencyKey: string | null;
  readBody: () => Promise<unknown>;
};

function validDate(value: Date, description: string): Date {
  if (!Number.isFinite(value.getTime())) throw new Error(`${description} är ogiltig`);
  return value;
}

function uuid(value: string, description: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${description} är ogiltigt`);
  return value;
}

function secret(value?: Uint8Array): Buffer {
  const result = value === undefined ? randomBytes(32) : Buffer.from(value);
  if (result.length !== 32) throw new Error("Secret måste vara exakt 32 bytes");
  return result;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(prefix: string, id: string, value: Buffer): string {
  return `${prefix}.${id}.${value.toString("base64url")}`;
}

function parseToken(value: string | null, prefix: string): ParsedToken | undefined {
  if (value === null || value.length > 160) return undefined;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedPrefix}\\.([0-9a-f-]{36})\\.([A-Za-z0-9_-]{43})$`).exec(value);
  if (!match?.[1] || !match[2] || !UUID_PATTERN.test(match[1]) || !SECRET_PATTERN.test(match[2])) return undefined;
  const decoded = Buffer.from(match[2], "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== match[2]) return undefined;
  return { id: match[1], secret: decoded };
}

function hashesMatch(secretBytes: Buffer, stored: string | undefined): boolean {
  const candidate = Buffer.from(sha256(secretBytes), "hex");
  const expected = stored !== undefined && HASH_PATTERN.test(stored) ? Buffer.from(stored, "hex") : DUMMY_HASH;
  return timingSafeEqual(candidate, expected);
}

function csrfMatches(cookie: string | null | undefined, header: string | null | undefined, storedHash: string): boolean {
  const cookieBytes = cookie && SECRET_PATTERN.test(cookie) ? Buffer.from(cookie, "base64url") : Buffer.alloc(32);
  const headerBytes = header && SECRET_PATTERN.test(header) ? Buffer.from(header, "base64url") : Buffer.alloc(32);
  const expected = HASH_PATTERN.test(storedHash) ? Buffer.from(storedHash, "hex") : DUMMY_HASH;
  return timingSafeEqual(Buffer.from(sha256(cookieBytes), "hex"), expected) &&
    timingSafeEqual(Buffer.from(sha256(headerBytes), "hex"), expected) &&
    timingSafeEqual(cookieBytes, headerBytes);
}

async function authorizeEventCreationSession(
  tx: DbExecutor,
  input: EventCreationRequestAuthentication,
  now: Date,
  lock: "none" | "update"
): Promise<EventCreationAuthenticationResult> {
  const parsed = parseToken(input.sessionToken, EVENT_CREATION_SESSION_TOKEN_PREFIX);
  const sessionQuery = tx.select().from(schema.eventCreationSessions)
    .where(eq(schema.eventCreationSessions.id, parsed?.id ?? DUMMY_ID));
  const [session] = lock === "update" ? await sessionQuery.for("update") : await sessionQuery;
  const matches = hashesMatch(parsed?.secret ?? Buffer.alloc(32), session?.sessionSecretHash);
  if (!session || !parsed || !matches) return { status: "unauthorized" };

  const credentialQuery = tx.select().from(schema.eventCreationAccessCredentials)
    .where(eq(schema.eventCreationAccessCredentials.id, session.accessCredentialId));
  const [credential] = lock === "update" ? await credentialQuery.for("update") : await credentialQuery;
  const [sessionRevocation] = await tx.select({ id: schema.eventCreationSessionRevocations.id })
    .from(schema.eventCreationSessionRevocations)
    .where(eq(schema.eventCreationSessionRevocations.sessionId, session.id)).limit(1);
  const [credentialRevocation] = await tx.select({ id: schema.eventCreationAccessCredentialRevocations.id })
    .from(schema.eventCreationAccessCredentialRevocations)
    .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, session.accessCredentialId)).limit(1);
  if (!credential || sessionRevocation || credentialRevocation ||
    session.issuedAt.getTime() > now.getTime() || session.expiresAt.getTime() <= now.getTime() ||
    credential.issuedAt.getTime() > now.getTime() || credential.expiresAt.getTime() <= now.getTime()) {
    return { status: "unauthorized" };
  }
  if (input.requireCsrf && !csrfMatches(input.csrfCookie, input.csrfHeader, session.csrfSecretHash)) {
    return { status: "forbidden" };
  }
  return {
    status: "authenticated",
    principal: {
      accessCredentialId: credential.id,
      capability: "CREATE_EVENT",
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString()
    }
  };
}

export async function issueEventCreationAccessCredential(
  db: Database,
  input: { label: string; expiresAt: Date },
  options: EventCreationRuntimeOptions = {}
): Promise<EventCreationAccessCredentialInstallation> {
  const label = input.label.trim();
  if (label.length < 1 || label.length > 120) throw new Error("Etiketten måste vara 1–120 tecken");
  const issuedAt = validDate(options.now ?? new Date(), "Utfärdandetiden");
  const expiresAt = validDate(input.expiresAt, "Utgångstiden");
  const lifetime = expiresAt.getTime() - issuedAt.getTime();
  if (lifetime <= 0 || lifetime > ACCESS_LIFETIME_MS) {
    throw new Error("Credentialen måste gälla högst 8 timmar");
  }
  const credentialId = uuid(options.id ?? randomUUID(), "Credential-id");
  const secretBytes = secret(options.secretBytes);
  await db.insert(schema.eventCreationAccessCredentials).values({
    id: credentialId,
    label,
    secretHash: sha256(secretBytes),
    issuedAt,
    expiresAt
  });
  return {
    formatVersion: 1,
    accessCredential: token(EVENT_CREATION_ACCESS_CREDENTIAL_PREFIX, credentialId, secretBytes),
    credentialId,
    capability: "CREATE_EVENT",
    label,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

export async function revokeEventCreationAccessCredential(
  db: Database,
  input: { credentialId: string; reason?: string },
  now = new Date()
): Promise<{ status: "revoked" | "already-revoked"; credentialId: string; revokedAt: string }> {
  const credentialId = uuid(input.credentialId, "Credential-id");
  const revokedAt = validDate(now, "Spärrtiden");
  const reason = input.reason?.trim() || "OPERATOR_REVOKED";
  if (reason.length > 240) throw new Error("Spärrorsaken får vara högst 240 tecken");
  return db.transaction(async (tx) => {
    const [credential] = await tx.select({ id: schema.eventCreationAccessCredentials.id })
      .from(schema.eventCreationAccessCredentials)
      .where(eq(schema.eventCreationAccessCredentials.id, credentialId)).for("update");
    if (!credential) throw new Error("Credentialen finns inte");
    const [created] = await tx.insert(schema.eventCreationAccessCredentialRevocations).values({
      credentialId,
      revokedAt,
      reason
    }).onConflictDoNothing().returning({ id: schema.eventCreationAccessCredentialRevocations.id });
    if (!created) {
      const [existing] = await tx.select({ revokedAt: schema.eventCreationAccessCredentialRevocations.revokedAt })
        .from(schema.eventCreationAccessCredentialRevocations)
        .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, credentialId));
      if (!existing) throw new Error("Credentialspärren kunde inte läsas");
      return { status: "already-revoked", credentialId, revokedAt: existing.revokedAt.toISOString() };
    }
    return { status: "revoked", credentialId, revokedAt: revokedAt.toISOString() };
  });
}

export async function loginEventCreationAdmin(
  db: Database,
  request: EventCreationLoginRequest,
  options: EventCreationRuntimeOptions = {}
): Promise<EventCreationLoginResult> {
  const parsedRequest = eventCreationLoginRequestSchema.safeParse(request);
  const parsedToken = parseToken(parsedRequest.success ? parsedRequest.data.accessCredential : null,
    EVENT_CREATION_ACCESS_CREDENTIAL_PREFIX);
  const now = validDate(options.now ?? new Date(), "Inloggningstiden");
  return db.transaction(async (tx) => {
    const [credential] = await tx.select().from(schema.eventCreationAccessCredentials)
      .where(eq(schema.eventCreationAccessCredentials.id, parsedToken?.id ?? DUMMY_ID)).for("update");
    const matches = hashesMatch(parsedToken?.secret ?? Buffer.alloc(32), credential?.secretHash);
    const [revocation] = credential ? await tx.select({ id: schema.eventCreationAccessCredentialRevocations.id })
      .from(schema.eventCreationAccessCredentialRevocations)
      .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, credential.id)).limit(1) : [];
    if (!parsedRequest.success || !credential || !parsedToken || !matches || revocation ||
      credential.issuedAt.getTime() > now.getTime() || credential.expiresAt.getTime() <= now.getTime()) {
      return { status: "unauthorized" };
    }
    const sessionId = uuid(options.sessionId ?? randomUUID(), "Session-id");
    const sessionSecret = secret(options.sessionSecretBytes);
    const csrfSecret = secret(options.csrfSecretBytes);
    const expiresAt = new Date(Math.min(now.getTime() + SESSION_LIFETIME_MS, credential.expiresAt.getTime()));
    await tx.insert(schema.eventCreationSessions).values({
      id: sessionId,
      accessCredentialId: credential.id,
      sessionSecretHash: sha256(sessionSecret),
      csrfSecretHash: sha256(csrfSecret),
      issuedAt: now,
      expiresAt
    });
    return {
      status: "authenticated",
      response: eventCreationLoginResponseSchema.parse({
        formatVersion: 1,
        capability: "CREATE_EVENT",
        expiresAt: expiresAt.toISOString()
      }),
      sessionToken: token(EVENT_CREATION_SESSION_TOKEN_PREFIX, sessionId, sessionSecret),
      csrfToken: csrfSecret.toString("base64url")
    };
  });
}

export async function authenticateEventCreationAdminSession(
  db: Database,
  input: EventCreationRequestAuthentication,
  now = new Date()
): Promise<EventCreationAuthenticationResult> {
  return authorizeEventCreationSession(db, input, validDate(now, "Autentiseringstiden"), "none");
}

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function authenticateEventCreationAdminSessionForMutation(
  tx: DatabaseTransaction,
  input: EventCreationRequestAuthentication,
  now = new Date()
): Promise<EventCreationAuthenticationResult> {
  return authorizeEventCreationSession(tx, input, validDate(now, "Autentiseringstiden"), "update");
}

export async function logoutEventCreationAdminSession(
  db: Database,
  input: EventCreationRequestAuthentication & { readBodyIsEmpty?: () => Promise<boolean> },
  now = new Date()
): Promise<EventCreationLogoutResult> {
  const loggedOutAt = validDate(now, "Utloggningstiden");
  const parsed = parseToken(input.sessionToken, EVENT_CREATION_SESSION_TOKEN_PREFIX);
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(schema.eventCreationSessions)
      .where(eq(schema.eventCreationSessions.id, parsed?.id ?? DUMMY_ID)).for("update");
    const matches = hashesMatch(parsed?.secret ?? Buffer.alloc(32), session?.sessionSecretHash);
    if (!session || !parsed || !matches) return { status: "unauthorized" };
    const [credential] = await tx.select().from(schema.eventCreationAccessCredentials)
      .where(eq(schema.eventCreationAccessCredentials.id, session.accessCredentialId)).for("update");
    const [credentialRevocation] = credential ? await tx.select({ id: schema.eventCreationAccessCredentialRevocations.id })
      .from(schema.eventCreationAccessCredentialRevocations)
      .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, credential.id)).limit(1) : [];
    if (!credential || credentialRevocation ||
      session.issuedAt.getTime() > loggedOutAt.getTime() || session.expiresAt.getTime() <= loggedOutAt.getTime() ||
      credential.issuedAt.getTime() > loggedOutAt.getTime() || credential.expiresAt.getTime() <= loggedOutAt.getTime()) {
      return { status: "unauthorized" };
    }
    if (!csrfMatches(input.csrfCookie, input.csrfHeader, session.csrfSecretHash)) return { status: "forbidden" };
    if (input.readBodyIsEmpty !== undefined) {
      try {
        if (!await input.readBodyIsEmpty()) return { status: "invalid-request" };
      } catch {
        return { status: "invalid-request" };
      }
    }
    const [existing] = await tx.select({ id: schema.eventCreationSessionRevocations.id })
      .from(schema.eventCreationSessionRevocations)
      .where(eq(schema.eventCreationSessionRevocations.sessionId, session.id));
    if (existing) return { status: "already-logged-out" };
    await tx.insert(schema.eventCreationSessionRevocations).values({
      sessionId: session.id,
      revokedAt: loggedOutAt,
      reason: "USER_LOGOUT"
    });
    return { status: "logged-out" };
  });
}

function responseFor(row: {
  requestId: string;
  eventId: string;
  raceId: string;
  createdAt: Date;
}, replayed: boolean): EventCreationResponse {
  return eventCreationResponseSchema.parse({
    formatVersion: 1,
    replayed,
    requestId: row.requestId,
    eventId: row.eventId,
    raceId: row.raceId,
    createdAt: row.createdAt.toISOString()
  });
}

export async function createEventAsAdmin(
  db: Database,
  input: CreateEventAsAdminInput,
  now = new Date()
): Promise<CreateEventAsAdminResult> {
  const createdAt = validDate(now, "Skapandetiden");
  const preflight = await authenticateEventCreationAdminSession(db, {
    sessionToken: input.sessionToken,
    csrfCookie: input.csrfCookie ?? null,
    csrfHeader: input.csrfHeader ?? null,
    requireCsrf: true
  }, createdAt);
  if (preflight.status !== "authenticated") return preflight;

  const idempotencyKey = eventCreationIdempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!idempotencyKey.success) return { status: "invalid-request" };
  const requestId = idempotencyKey.data.slice("event-create:".length);
  let body: unknown;
  try {
    body = await input.readBody();
  } catch {
    return { status: "invalid-request" };
  }
  const request = eventCreationRequestSchema.safeParse(body);
  if (!request.success) return { status: "invalid-request" };

  return db.transaction(async (tx) => {
    const authorization = await authenticateEventCreationAdminSessionForMutation(tx, {
      sessionToken: input.sessionToken,
      csrfCookie: input.csrfCookie ?? null,
      csrfHeader: input.csrfHeader ?? null,
      requireCsrf: true
    }, createdAt);
    if (authorization.status !== "authenticated") return authorization;

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.eventCreationRequests)
      .where(eq(schema.eventCreationRequests.requestId, requestId));
    if (existing) {
      if (existing.actorCredentialId !== authorization.principal.accessCredentialId ||
        existing.eventName !== request.data.eventName ||
        existing.raceName !== request.data.raceName ||
        existing.raceDate !== request.data.raceDate ||
        existing.timeZone !== request.data.timeZone) {
        return { status: "conflict" };
      }
      return { status: "created", response: responseFor(existing, true) };
    }

    const [event] = await tx.insert(schema.events).values({
      name: request.data.eventName,
      startsOn: request.data.raceDate,
      timeZone: request.data.timeZone,
      createdAt
    }).returning({ id: schema.events.id });
    if (!event) throw new Error("Evenemanget kunde inte skapas");
    const [race] = await tx.insert(schema.races).values({
      eventId: event.id,
      name: request.data.raceName,
      raceDate: request.data.raceDate,
      snapshotVersion: 1,
      createdAt
    }).returning({ id: schema.races.id });
    if (!race) throw new Error("Loppet kunde inte skapas");
    const [journal] = await tx.insert(schema.eventCreationRequests).values({
      requestId,
      actorCredentialId: authorization.principal.accessCredentialId,
      eventName: request.data.eventName,
      raceName: request.data.raceName,
      raceDate: request.data.raceDate,
      timeZone: request.data.timeZone,
      eventId: event.id,
      raceId: race.id,
      createdAt
    }).returning();
    if (!journal) throw new Error("Skapanderequesten kunde inte sparas");
    await tx.insert(schema.auditEvents).values({
      raceId: race.id,
      entityType: "event",
      entityId: event.id,
      action: "EVENT_CREATED_BY_ADMIN",
      actorKind: "EVENT_CREATION_ACCESS_CREDENTIAL",
      actorId: authorization.principal.accessCredentialId,
      requestId,
      after: {
        eventName: request.data.eventName,
        raceName: request.data.raceName,
        raceDate: request.data.raceDate,
        timeZone: request.data.timeZone,
        eventId: event.id,
        raceId: race.id,
        snapshotVersion: 1,
        createdAt: createdAt.toISOString()
      }
    });
    return { status: "created", response: responseFor(journal, false) };
  });
}
