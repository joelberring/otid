import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const secret = /^[A-Za-z0-9_-]{43}$/;
const bearerPrefix = "otid_route_upload_v1";
const sessionPrefix = "otid_route_upload_session_v1";
const dummyHash = Buffer.alloc(32);
const sessionLifetimeMs = 60 * 60 * 1_000;

type ParsedToken = { id: string; secret: Buffer };
export type RouteUploadSessionAuthentication = {
  status: "authenticated";
  principal: { sessionId: string; grantId: string; raceId: string; entryId: string };
} | { status: "unauthorized" | "forbidden" };
export type RouteUploadSessionRequestAuthentication = {
  sessionToken: string | null | undefined;
  csrfCookie?: string | null;
  csrfHeader?: string | null;
  requireCsrf?: boolean;
};

function hash(value: Uint8Array): Buffer { return createHash("sha256").update(value).digest(); }

function parseToken(value: string | null | undefined, prefix: string): ParsedToken | null {
  if (!value || value.length > 160) return null;
  const safePrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${safePrefix}\\.([0-9a-f-]{36})\\.([A-Za-z0-9_-]{43})$`).exec(value);
  if (!match?.[1] || !match[2] || !uuid.test(match[1]) || !secret.test(match[2])) return null;
  const bytes = Buffer.from(match[2], "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== match[2]) return null;
  return { id: match[1], secret: bytes };
}

function matches(value: Buffer, expected: string | undefined): boolean {
  const stored = expected && /^[a-f0-9]{64}$/.test(expected) ? Buffer.from(expected, "hex") : dummyHash;
  return timingSafeEqual(hash(value), stored);
}

function csrfMatches(cookie: string | null | undefined, header: string | null | undefined, expected: string): boolean {
  const cookieBytes = cookie && secret.test(cookie) ? Buffer.from(cookie, "base64url") : Buffer.alloc(32);
  const headerBytes = header && secret.test(header) ? Buffer.from(header, "base64url") : Buffer.alloc(32);
  return timingSafeEqual(hash(cookieBytes), Buffer.from(expected, "hex")) &&
    timingSafeEqual(hash(headerBytes), Buffer.from(expected, "hex")) && timingSafeEqual(cookieBytes, headerBytes);
}

async function liveGrant(tx: DbExecutor, grantId: string, now: Date, lock: "share" | "update") {
  const initial = tx.select().from(schema.routeUploadGrants).where(eq(schema.routeUploadGrants.id, grantId));
  const [candidate] = await initial;
  if (!candidate || !Number.isFinite(now.getTime())) return null;
  if (lock === "update") await lockRaceForMutation(tx, candidate.raceId);
  else await lockRaceForSnapshot(tx, candidate.raceId);
  const reread = tx.select().from(schema.routeUploadGrants).where(eq(schema.routeUploadGrants.id, grantId));
  const [grant] = await (lock === "update" ? reread.for("update") : reread.for("share"));
  if (!grant || grant.raceId !== candidate.raceId || grant.issuedAt.getTime() > now.getTime() || grant.expiresAt.getTime() <= now.getTime()) return null;
  const [revocation] = await tx.select({ id: schema.routeUploadGrantRevocations.id })
    .from(schema.routeUploadGrantRevocations).where(eq(schema.routeUploadGrantRevocations.grantId, grant.id));
  return revocation ? null : grant;
}

/** Validates the one-time link and returns only cookie material for the HTTP boundary to set. */
export async function redeemRouteUploadBearerLink(
  db: Database,
  bearerToken: string | null | undefined,
  now = new Date()
): Promise<{ status: "redeemed"; sessionToken: string; csrfToken: string; raceId: string; entryId: string; expiresAt: string } | { status: "unauthorized" }> {
  const parsed = parseToken(bearerToken, bearerPrefix);
  if (!parsed || !Number.isFinite(now.getTime())) return { status: "unauthorized" };
  try {
    return await db.transaction(async tx => {
      const [first] = await tx.select().from(schema.routeUploadGrants).where(eq(schema.routeUploadGrants.id, parsed.id));
      const firstMatches = matches(parsed.secret, first?.secretHash);
      if (!first || !firstMatches) return { status: "unauthorized" as const };
      const grant = await liveGrant(tx, parsed.id, now, "share");
      if (!grant || !matches(parsed.secret, grant.secretHash)) return { status: "unauthorized" as const };
      const sessionId = randomUUID(), sessionSecret = randomBytes(32), csrfSecret = randomBytes(32);
      const expiresAt = new Date(Math.min(now.getTime() + sessionLifetimeMs, grant.expiresAt.getTime()));
      if (expiresAt.getTime() <= now.getTime()) return { status: "unauthorized" as const };
      await tx.insert(schema.routeUploadSessions).values({
        id: sessionId, grantId: grant.id, raceId: grant.raceId, entryId: grant.entryId,
        sessionSecretHash: hash(sessionSecret).toString("hex"), csrfSecretHash: hash(csrfSecret).toString("hex"),
        issuedAt: now, expiresAt
      });
      return {
        status: "redeemed" as const,
        sessionToken: `${sessionPrefix}.${sessionId}.${sessionSecret.toString("base64url")}`,
        csrfToken: csrfSecret.toString("base64url"),
        raceId: grant.raceId,
        entryId: grant.entryId,
        expiresAt: expiresAt.toISOString()
      };
    });
  } finally { parsed.secret.fill(0); }
}

/** Revalidates session, grant expiry and immutable revocation before every private request. */
export async function authenticateRouteUploadSession(
  db: Database,
  input: RouteUploadSessionRequestAuthentication,
  now = new Date()
): Promise<RouteUploadSessionAuthentication> {
  const parsed = parseToken(input.sessionToken, sessionPrefix);
  if (!parsed || !Number.isFinite(now.getTime())) return { status: "unauthorized" };
  try {
    return await db.transaction(tx => authorizeRouteUploadSession(tx, parsed, input, now, "share"));
  } finally { parsed.secret.fill(0); }
}

/** Mutation callers use this in their existing transaction, before their race/entry locks. */
export async function authenticateRouteUploadSessionForMutation(
  tx: DbExecutor,
  input: RouteUploadSessionRequestAuthentication,
  now = new Date()
): Promise<RouteUploadSessionAuthentication> {
  const parsed = parseToken(input.sessionToken, sessionPrefix);
  if (!parsed || !Number.isFinite(now.getTime())) return { status: "unauthorized" };
  try { return await authorizeRouteUploadSession(tx, parsed, input, now, "update"); }
  finally { parsed.secret.fill(0); }
}

/** Keeps read authorization and its principal-scoped query in one shared-lock transaction. */
export async function authenticateRouteUploadSessionForRead(
  tx: DbExecutor,
  input: RouteUploadSessionRequestAuthentication,
  now = new Date()
): Promise<RouteUploadSessionAuthentication> {
  const parsed = parseToken(input.sessionToken, sessionPrefix);
  if (!parsed || !Number.isFinite(now.getTime())) return { status: "unauthorized" };
  try { return await authorizeRouteUploadSession(tx, parsed, input, now, "share"); }
  finally { parsed.secret.fill(0); }
}

async function authorizeRouteUploadSession(
  tx: DbExecutor,
  parsed: ParsedToken,
  input: RouteUploadSessionRequestAuthentication,
  now: Date,
  lock: "share" | "update"
): Promise<RouteUploadSessionAuthentication> {
  const [first] = await tx.select().from(schema.routeUploadSessions).where(eq(schema.routeUploadSessions.id, parsed.id));
  if (!first || !matches(parsed.secret, first.sessionSecretHash)) return { status: "unauthorized" };
  if (lock === "update") await lockRaceForMutation(tx, first.raceId);
  else await lockRaceForSnapshot(tx, first.raceId);
  const sessionQuery = tx.select().from(schema.routeUploadSessions).where(eq(schema.routeUploadSessions.id, parsed.id));
  const [session] = await (lock === "update" ? sessionQuery.for("update") : sessionQuery.for("share"));
  if (!session || session.raceId !== first.raceId || session.expiresAt.getTime() <= now.getTime() || !matches(parsed.secret, session.sessionSecretHash)) return { status: "unauthorized" };
  const grant = await liveGrant(tx, session.grantId, now, lock);
  if (!grant || grant.raceId !== session.raceId || grant.entryId !== session.entryId) return { status: "unauthorized" };
  if (input.requireCsrf && !csrfMatches(input.csrfCookie, input.csrfHeader, session.csrfSecretHash)) return { status: "forbidden" };
  return { status: "authenticated", principal: { sessionId: session.id, grantId: grant.id, raceId: grant.raceId, entryId: grant.entryId } };
}

export const routeUploadBearerTokenPrefix = bearerPrefix;
