import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, notInArray } from "drizzle-orm";
import type {
  StationPairingRedemptionRequest,
  StationPairingRedemptionResponse
} from "@o-tid/contracts";
import { stationPairingRedemptionRequestSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import {
  createNextStationCredentialFromHash,
  type StationCredentialScope
} from "./station-credentials";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SECRET_HASH_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PREFIX = "otid_pair_v1";
const MAX_GRANT_LIFETIME_MS = 15 * 60 * 1000;
const FAILED_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const DUMMY_SECRET_HASH = Buffer.from(
  "b7777d50c9b44f365abf996566de5d79fd4241033135f2389037577e39fb5d7b",
  "hex"
);
const NON_FAILURE_OUTCOMES = ["REDEEMED"] as const;

type PairingAttemptOutcome =
  | "AUTH_FAILED"
  | "BODY_INVALID"
  | "IDEMPOTENCY_KEY_INVALID"
  | "CONFLICT"
  | "REDEEMED";

export interface StationPairingGrantInstallation {
  formatVersion: 1;
  token: string;
  grantId: string;
  raceId: string;
  scope: StationCredentialScope;
  issuedAt: string;
  expiresAt: string;
  credentialExpiresAt: string;
}

export type StationPairingRedemptionResult =
  | { status: "stored" | "duplicate"; response: StationPairingRedemptionResponse }
  | { status: "unauthorized" }
  | { status: "invalid-request" }
  | { status: "conflict" }
  | { status: "rate-limited"; retryAfterSeconds: number };

interface PairingRuntimeOptions {
  now?: Date;
  secretBytes?: Uint8Array;
  grantId?: string;
}

interface ParsedGrantBearer {
  grantId: string;
  secretBytes: Buffer;
}

function validDate(value: Date, description: string): Date {
  if (!Number.isFinite(value.getTime())) throw new Error(`${description} är ogiltig`);
  return value;
}

function normalizedUuid(value: string, description: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${description} är ogiltigt`);
  return value.toLowerCase();
}

function assertScope(scope: string): asserts scope is StationCredentialScope {
  if (scope !== "READOUT") throw new Error("Parningsgrantets scope är ogiltigt");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseGrantBearer(authorization: string | null): ParsedGrantBearer | undefined {
  if (authorization === null || authorization.length > 128) return undefined;
  const match = /^Bearer otid_pair_v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match?.[1] || !match[2] || !LOWERCASE_UUID_PATTERN.test(match[1]) || !SECRET_PATTERN.test(match[2])) {
    return undefined;
  }
  const secretBytes = Buffer.from(match[2], "base64url");
  if (secretBytes.length !== 32 || secretBytes.toString("base64url") !== match[2]) return undefined;
  return { grantId: match[1], secretBytes };
}

async function appendAttempt(
  tx: DbExecutor,
  input: {
    grantId: string;
    outcome: PairingAttemptOutcome;
    attemptedAt: Date;
    request?: StationPairingRedemptionRequest;
  }
): Promise<void> {
  await tx.insert(schema.stationPairingAttempts).values({
    grantId: input.grantId,
    attemptId: input.request?.attemptId,
    deviceId: input.request?.deviceId,
    outcome: input.outcome,
    attemptedAt: input.attemptedAt
  });
}

function retryAfterSeconds(oldestFailure: Date, now: Date): number {
  const remainingMs = oldestFailure.getTime() + FAILED_ATTEMPT_WINDOW_MS - now.getTime();
  return Math.max(1, Math.min(600, Math.ceil(remainingMs / 1000)));
}

async function failedAttemptResult(
  tx: DbExecutor,
  input: {
    grantId: string;
    outcome: Exclude<PairingAttemptOutcome, "REDEEMED">;
    attemptedAt: Date;
    request?: StationPairingRedemptionRequest;
    previousFailures: Date[];
    fallbackStatus: "unauthorized" | "invalid-request" | "conflict";
  }
): Promise<StationPairingRedemptionResult> {
  await appendAttempt(tx, input);
  if (input.previousFailures.length + 1 < MAX_FAILED_ATTEMPTS) return { status: input.fallbackStatus };
  const oldest = input.previousFailures[0] ?? input.attemptedAt;
  return { status: "rate-limited", retryAfterSeconds: retryAfterSeconds(oldest, input.attemptedAt) };
}

async function assertRaceExists(tx: DbExecutor, raceId: string): Promise<void> {
  const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
    .where(eq(schema.races.id, raceId)).limit(1);
  if (!race) throw new Error("Loppet finns inte");
}

export async function issueStationPairingGrant(
  db: Database,
  input: {
    raceId: string;
    scope: StationCredentialScope;
    expiresAt: Date;
    credentialExpiresAt: Date;
  },
  options: PairingRuntimeOptions = {}
): Promise<StationPairingGrantInstallation> {
  const raceId = normalizedUuid(input.raceId, "Lopp-id");
  assertScope(input.scope);
  const issuedAt = validDate(options.now ?? new Date(), "Utfärdandetiden");
  const expiresAt = validDate(input.expiresAt, "Grantets utgångstid");
  const credentialExpiresAt = validDate(input.credentialExpiresAt, "Credentialens utgångstid");
  const lifetime = expiresAt.getTime() - issuedAt.getTime();
  if (lifetime <= 0 || lifetime > MAX_GRANT_LIFETIME_MS) {
    throw new Error("Parningsgrantet måste gälla mer än 0 och högst 15 minuter");
  }
  if (credentialExpiresAt.getTime() <= expiresAt.getTime()) {
    throw new Error("Credentialens utgångstid måste ligga efter grantets utgångstid");
  }
  const grantId = normalizedUuid(options.grantId ?? randomUUID(), "Grant-id");
  const secret = options.secretBytes === undefined ? randomBytes(32) : Buffer.from(options.secretBytes);
  if (secret.length !== 32) throw new Error("Parningsgrantets secret måste vara exakt 32 bytes");
  const secretHash = sha256(secret);

  await db.transaction(async (tx) => {
    await assertRaceExists(tx, raceId);
    await tx.insert(schema.stationPairingGrants).values({
      id: grantId,
      raceId,
      scope: input.scope,
      secretHash,
      issuedAt,
      expiresAt,
      credentialExpiresAt
    });
    await tx.insert(schema.auditEvents).values({
      raceId,
      entityType: "station_pairing_grant",
      entityId: grantId,
      action: "STATION_PAIRING_GRANT_ISSUED",
      after: {
        scope: input.scope,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        credentialExpiresAt: credentialExpiresAt.toISOString()
      }
    });
  });

  return {
    formatVersion: 1,
    token: `${TOKEN_PREFIX}.${grantId}.${secret.toString("base64url")}`,
    grantId,
    raceId,
    scope: input.scope,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    credentialExpiresAt: credentialExpiresAt.toISOString()
  };
}

export async function revokeStationPairingGrant(
  db: Database,
  input: { grantId: string },
  now = new Date()
): Promise<{ status: "revoked" | "already-revoked"; grantId: string; revokedAt: string }> {
  const grantId = normalizedUuid(input.grantId, "Grant-id");
  const revokedAtDate = validDate(now, "Spärrtiden");
  return db.transaction(async (tx) => {
    const [grant] = await tx.select({ id: schema.stationPairingGrants.id, raceId: schema.stationPairingGrants.raceId })
      .from(schema.stationPairingGrants).where(eq(schema.stationPairingGrants.id, grantId)).for("update");
    if (!grant) throw new Error("Parningsgrantet finns inte");
    const [created] = await tx.insert(schema.stationPairingGrantRevocations).values({
      grantId,
      revokedAt: revokedAtDate,
      reason: "OPERATOR_REVOKED"
    }).onConflictDoNothing().returning({ id: schema.stationPairingGrantRevocations.id });
    if (!created) {
      const [existing] = await tx.select({ revokedAt: schema.stationPairingGrantRevocations.revokedAt })
        .from(schema.stationPairingGrantRevocations)
        .where(eq(schema.stationPairingGrantRevocations.grantId, grantId));
      if (!existing) throw new Error("Grantspärren kunde inte läsas");
      return { status: "already-revoked" as const, grantId, revokedAt: existing.revokedAt.toISOString() };
    }
    await tx.insert(schema.auditEvents).values({
      raceId: grant.raceId,
      entityType: "station_pairing_grant",
      entityId: grant.id,
      action: "STATION_PAIRING_GRANT_REVOKED",
      after: { revokedAt: revokedAtDate.toISOString() }
    });
    return { status: "revoked" as const, grantId, revokedAt: revokedAtDate.toISOString() };
  });
}

export async function redeemStationPairingGrant(
  db: Database,
  input: {
    authorization: string | null;
    idempotencyKey: string | null;
    readBody: () => Promise<unknown>;
  },
  now = new Date()
): Promise<StationPairingRedemptionResult> {
  const attemptedAt = validDate(now, "Inlösentiden");
  const parsedBearer = parseGrantBearer(input.authorization);
  if (!parsedBearer) return { status: "unauthorized" };

  return db.transaction(async (tx) => {
    const [grant] = await tx.select().from(schema.stationPairingGrants)
      .where(eq(schema.stationPairingGrants.id, parsedBearer.grantId)).for("update");
    const presentedHash = Buffer.from(sha256(parsedBearer.secretBytes), "hex");
    const storedHash = grant && SECRET_HASH_PATTERN.test(grant.secretHash)
      ? Buffer.from(grant.secretHash, "hex")
      : DUMMY_SECRET_HASH;
    const secretMatches = timingSafeEqual(presentedHash, storedHash);
    if (!grant) return { status: "unauthorized" };

    const windowStart = new Date(attemptedAt.getTime() - FAILED_ATTEMPT_WINDOW_MS);
    const failureRows = await tx.select({ attemptedAt: schema.stationPairingAttempts.attemptedAt })
      .from(schema.stationPairingAttempts).where(and(
        eq(schema.stationPairingAttempts.grantId, grant.id),
        gte(schema.stationPairingAttempts.attemptedAt, windowStart),
        notInArray(schema.stationPairingAttempts.outcome, [...NON_FAILURE_OUTCOMES])
      )).orderBy(asc(schema.stationPairingAttempts.attemptedAt));
    const previousFailures = failureRows.map((row) => row.attemptedAt);
    if (!secretMatches) {
      if (previousFailures.length >= MAX_FAILED_ATTEMPTS) {
        return {
          status: "rate-limited",
          retryAfterSeconds: retryAfterSeconds(previousFailures[0]!, attemptedAt)
        };
      }
      return failedAttemptResult(tx, {
        grantId: grant.id,
        outcome: "AUTH_FAILED",
        attemptedAt,
        previousFailures,
        fallbackStatus: "unauthorized"
      });
    }

    const [revocation] = await tx.select({ id: schema.stationPairingGrantRevocations.id })
      .from(schema.stationPairingGrantRevocations)
      .where(eq(schema.stationPairingGrantRevocations.grantId, grant.id)).limit(1);
    const [existing] = await tx.select({
      redemptionId: schema.stationPairingRedemptions.id,
      attemptId: schema.stationPairingRedemptions.attemptId,
      credentialId: schema.stationCredentials.id,
      credentialSecretHash: schema.stationCredentials.secretHash,
      stationDeviceId: schema.stationDevices.id,
      deviceId: schema.stationDevices.deviceId,
      raceId: schema.stationCredentials.raceId,
      scope: schema.stationCredentials.scope,
      generation: schema.stationCredentials.generation,
      issuedAt: schema.stationCredentials.issuedAt,
      expiresAt: schema.stationCredentials.expiresAt
    }).from(schema.stationPairingRedemptions)
      .innerJoin(schema.stationCredentials,
        eq(schema.stationPairingRedemptions.credentialId, schema.stationCredentials.id))
      .innerJoin(schema.stationDevices,
        eq(schema.stationPairingRedemptions.stationDeviceId, schema.stationDevices.id))
      .where(eq(schema.stationPairingRedemptions.grantId, grant.id)).limit(1);

    if (!existing && previousFailures.length >= MAX_FAILED_ATTEMPTS) {
      return {
        status: "rate-limited",
        retryAfterSeconds: retryAfterSeconds(previousFailures[0]!, attemptedAt)
      };
    }
    if (existing && existing.expiresAt.getTime() <= attemptedAt.getTime() &&
      previousFailures.length >= MAX_FAILED_ATTEMPTS) {
      return {
        status: "rate-limited",
        retryAfterSeconds: retryAfterSeconds(previousFailures[0]!, attemptedAt)
      };
    }
    if ((!existing && (revocation !== undefined || grant.issuedAt.getTime() > attemptedAt.getTime() ||
      grant.expiresAt.getTime() <= attemptedAt.getTime() ||
      grant.credentialExpiresAt.getTime() <= attemptedAt.getTime())) ||
      (existing && existing.expiresAt.getTime() <= attemptedAt.getTime())) {
      return failedAttemptResult(tx, {
        grantId: grant.id,
        outcome: "AUTH_FAILED",
        attemptedAt,
        previousFailures,
        fallbackStatus: "unauthorized"
      });
    }

    let body: unknown;
    try {
      body = await input.readBody();
    } catch {
      if (previousFailures.length >= MAX_FAILED_ATTEMPTS) {
        return {
          status: "rate-limited",
          retryAfterSeconds: retryAfterSeconds(previousFailures[0]!, attemptedAt)
        };
      }
      return failedAttemptResult(tx, {
        grantId: grant.id,
        outcome: "BODY_INVALID",
        attemptedAt,
        previousFailures,
        fallbackStatus: "invalid-request"
      });
    }
    const parsedRequest = stationPairingRedemptionRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      if (previousFailures.length >= MAX_FAILED_ATTEMPTS) {
        return {
          status: "rate-limited",
          retryAfterSeconds: retryAfterSeconds(previousFailures[0]!, attemptedAt)
        };
      }
      return failedAttemptResult(tx, {
        grantId: grant.id,
        outcome: "BODY_INVALID",
        attemptedAt,
        previousFailures,
        fallbackStatus: "invalid-request"
      });
    }
    const request = parsedRequest.data;
    if (input.idempotencyKey !== `pairing:${request.attemptId}`) {
      if (previousFailures.length >= MAX_FAILED_ATTEMPTS) {
        return {
          status: "rate-limited",
          retryAfterSeconds: retryAfterSeconds(previousFailures[0]!, attemptedAt)
        };
      }
      return failedAttemptResult(tx, {
        grantId: grant.id,
        outcome: "IDEMPOTENCY_KEY_INVALID",
        attemptedAt,
        request,
        previousFailures,
        fallbackStatus: "invalid-request"
      });
    }

    if (existing) {
      const exactReplay = existing.attemptId === request.attemptId &&
        existing.deviceId === request.deviceId &&
        existing.credentialSecretHash === request.credentialSecretHash;
      if (!exactReplay) {
        if (previousFailures.length >= MAX_FAILED_ATTEMPTS) {
          return {
            status: "rate-limited",
            retryAfterSeconds: retryAfterSeconds(previousFailures[0]!, attemptedAt)
          };
        }
        return failedAttemptResult(tx, {
          grantId: grant.id,
          outcome: "CONFLICT",
          attemptedAt,
          request,
          previousFailures,
          fallbackStatus: "conflict"
        });
      }
      return {
        status: "duplicate",
        response: {
          formatVersion: 1,
          attemptId: request.attemptId,
          credential: {
            credentialId: existing.credentialId,
            deviceId: existing.deviceId,
            raceId: existing.raceId,
            scope: existing.scope,
            generation: existing.generation,
            issuedAt: existing.issuedAt.toISOString(),
            expiresAt: existing.expiresAt.toISOString()
          }
        }
      };
    }

    const [attemptAlreadyUsed] = await tx.select({ id: schema.stationPairingRedemptions.id })
      .from(schema.stationPairingRedemptions)
      .where(eq(schema.stationPairingRedemptions.attemptId, request.attemptId)).limit(1);
    if (attemptAlreadyUsed) {
      return failedAttemptResult(tx, {
        grantId: grant.id,
        outcome: "CONFLICT",
        attemptedAt,
        request,
        previousFailures,
        fallbackStatus: "conflict"
      });
    }

    const credential = await createNextStationCredentialFromHash(tx, {
      deviceId: request.deviceId,
      raceId: grant.raceId,
      scope: grant.scope,
      secretHash: request.credentialSecretHash,
      issuedAt: attemptedAt,
      expiresAt: grant.credentialExpiresAt
    });
    const [redemption] = await tx.insert(schema.stationPairingRedemptions).values({
      grantId: grant.id,
      attemptId: request.attemptId,
      stationDeviceId: credential.stationDeviceId,
      credentialId: credential.credentialId,
      redeemedAt: attemptedAt
    }).returning({ id: schema.stationPairingRedemptions.id });
    if (!redemption) throw new Error("Parningsinlösen kunde inte sparas");
    await appendAttempt(tx, { grantId: grant.id, outcome: "REDEEMED", attemptedAt, request });
    await tx.insert(schema.auditEvents).values({
      raceId: grant.raceId,
      entityType: "station_pairing_redemption",
      entityId: redemption.id,
      action: "STATION_PAIRING_REDEEMED",
      after: {
        credentialId: credential.credentialId,
        scope: credential.scope,
        generation: credential.generation,
        issuedAt: credential.issuedAt,
        expiresAt: credential.expiresAt
      }
    });
    return {
      status: "stored",
      response: {
        formatVersion: 1,
        attemptId: request.attemptId,
        credential: {
          credentialId: credential.credentialId,
          deviceId: credential.deviceId,
          raceId: credential.raceId,
          scope: credential.scope,
          generation: credential.generation,
          issuedAt: credential.issuedAt,
          expiresAt: credential.expiresAt
        }
      }
    };
  });
}
