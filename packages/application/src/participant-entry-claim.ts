import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  participantClaimIssueIdempotencyKeySchema,
  participantClaimIssueRequestSchema,
  participantClaimIssueResponseSchema,
  participantClaimListResponseSchema,
  participantClaimRedeemIdempotencyKeySchema,
  participantClaimRedeemRequestSchema,
  participantClaimRedeemResponseSchema,
  participantClaimRevokeIdempotencyKeySchema,
  participantClaimRevokeRequestSchema,
  participantClaimRevokeResponseSchema,
  participantOwnResultsResponseSchema,
  publicResultListResponseV7Schema,
  type ParticipantClaimIssueResponse,
  type ParticipantClaimListResponse,
  type ParticipantClaimRedeemResponse,
  type ParticipantClaimRevokeResponse,
  type ParticipantOwnResultsResponse,
  type PublicResultListResponseV7
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";
import {
  authenticateUserAccountSessionForMutation,
  authenticateUserAccountSessionForProtectedRead,
  type UserAccountSessionProof
} from "./user-account";
import { publicResults } from "./results";

type AdminProof = Omit<PairingAdminRequestAuthentication, "capability">;
type AdminIssueInput = AdminProof & { entryId: string; idempotencyKey: string | null; request: unknown };
type AdminRevokeInput = AdminIssueInput & { claimId: string };
type AccountRedeemInput = UserAccountSessionProof & { idempotencyKey: string | null; request: unknown };
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "conflict" | "not-found" };
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxLifetimeMs = 7 * 24 * 60 * 60 * 1_000;
const capability = "MANAGE_RACE" as const;

function validNow(now: Date): boolean { return Number.isFinite(now.getTime()); }

async function lockRaceAndEntry(tx: DatabaseTransaction, raceId: string, entryId: string): Promise<boolean> {
  const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
    .where(eq(schema.races.id, raceId)).for("update");
  if (!race) return false;
  const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
    .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId))).for("update");
  return !!entry;
}

function issueResponse(
  issue: typeof schema.participantEntryClaimIssues.$inferSelect, replayed: boolean
): ParticipantClaimIssueResponse {
  return participantClaimIssueResponseSchema.parse({
    formatVersion: 1, requestId: issue.requestId, claimId: issue.id, raceId: issue.raceId,
    entryId: issue.entryId, issuedAt: issue.issuedAt.toISOString(),
    expiresAt: issue.expiresAt.toISOString(), replayed
  });
}

function revokeResponse(
  revoke: typeof schema.participantEntryClaimRevocations.$inferSelect, replayed: boolean
): ParticipantClaimRevokeResponse {
  return participantClaimRevokeResponseSchema.parse({
    formatVersion: 1, requestId: revoke.requestId, claimId: revoke.claimId,
    revokedAt: revoke.revokedAt.toISOString(), replayed
  });
}

/** Only a MANAGE_RACE operator may attest and issue a hash-only code for one exact Entry. */
export async function issueParticipantEntryClaimAsAdmin(
  db: Database, input: AdminIssueInput, now = new Date()
): Promise<Failure | { status: "issued"; response: ParticipantClaimIssueResponse }> {
  const key = participantClaimIssueIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = participantClaimIssueRequestSchema.safeParse(input.request);
  if (!validNow(now) || !uuid.test(input.raceId) || !uuid.test(input.entryId) ||
    !key.success || !parsed.success || key.data !== `participant-claim-issue:${parsed.data.requestId}` ||
    parsed.data.raceId !== input.raceId || parsed.data.entryId !== input.entryId) return { status: "invalid-request" };
  const expiresAt = new Date(parsed.data.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!await lockRaceAndEntry(tx, input.raceId, input.entryId)) return { status: "not-found" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${parsed.data.requestId}, 0))`);
    const [existing] = await tx.select().from(schema.participantEntryClaimIssues)
      .where(eq(schema.participantEntryClaimIssues.requestId, parsed.data.requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.entryId !== input.entryId ||
        existing.issuerCredentialId !== auth.principal.accessCredentialId ||
        existing.secretHash !== parsed.data.secretHash ||
        existing.expiresAt.getTime() !== expiresAt.getTime() ||
        existing.attestation !== parsed.data.attestation) return { status: "conflict" } as const;
      return { status: "issued", response: issueResponse(existing, true) } as const;
    }
    if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > now.getTime() + maxLifetimeMs) {
      return { status: "invalid-request" } as const;
    }
    const prior = await tx.select({ id: schema.participantEntryClaimIssues.id,
      expiresAt: schema.participantEntryClaimIssues.expiresAt,
      redemptionId: schema.participantEntryClaimRedemptions.id })
      .from(schema.participantEntryClaimIssues)
      .leftJoin(schema.participantEntryClaimRedemptions,
        eq(schema.participantEntryClaimRedemptions.claimId, schema.participantEntryClaimIssues.id))
      .leftJoin(schema.participantEntryClaimRevocations,
        eq(schema.participantEntryClaimRevocations.claimId, schema.participantEntryClaimIssues.id))
      .where(and(eq(schema.participantEntryClaimIssues.raceId, input.raceId),
        eq(schema.participantEntryClaimIssues.entryId, input.entryId),
        isNull(schema.participantEntryClaimRevocations.id)));
    if (prior.some((row) => row.redemptionId !== null || row.expiresAt.getTime() > now.getTime())) {
      return { status: "conflict" } as const;
    }
    const [issue] = await tx.insert(schema.participantEntryClaimIssues).values({
      id: randomUUID(), requestId: parsed.data.requestId, raceId: input.raceId,
      entryId: input.entryId, issuerCredentialId: auth.principal.accessCredentialId,
      capability, secretHash: parsed.data.secretHash, issuedAt: now, expiresAt,
      attestation: parsed.data.attestation
    }).onConflictDoNothing().returning();
    if (!issue) return { status: "conflict" } as const;
    await tx.insert(schema.auditEvents).values({
      raceId: issue.raceId, entityType: "participant_entry_claim", entityId: issue.id,
      action: "PARTICIPANT_ENTRY_CLAIM_ISSUED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId: issue.requestId,
      after: { entryId: issue.entryId, expiresAt: issue.expiresAt.toISOString(),
        attestation: issue.attestation }
    });
    return { status: "issued", response: issueResponse(issue, false) } as const;
  });
}

/** Private, exact-entry metadata; neither code nor code hash is ever returned. */
export async function listParticipantEntryClaimsAsAdmin(
  db: Database, input: AdminProof & { entryId: string }, now = new Date()
): Promise<Failure | { status: "ok"; response: ParticipantClaimListResponse }> {
  if (!validNow(now) || !uuid.test(input.raceId) || !uuid.test(input.entryId)) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
      .where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId))).for("share");
    if (!entry) return { status: "not-found" } as const;
    const rows = await tx.select({ issue: schema.participantEntryClaimIssues,
      redeemedAt: schema.participantEntryClaimRedemptions.redeemedAt,
      revokedAt: schema.participantEntryClaimRevocations.revokedAt })
      .from(schema.participantEntryClaimIssues)
      .leftJoin(schema.participantEntryClaimRedemptions,
        eq(schema.participantEntryClaimRedemptions.claimId, schema.participantEntryClaimIssues.id))
      .leftJoin(schema.participantEntryClaimRevocations,
        eq(schema.participantEntryClaimRevocations.claimId, schema.participantEntryClaimIssues.id))
      .where(and(eq(schema.participantEntryClaimIssues.raceId, input.raceId),
        eq(schema.participantEntryClaimIssues.entryId, input.entryId)))
      .orderBy(desc(schema.participantEntryClaimIssues.issuedAt), desc(schema.participantEntryClaimIssues.id))
      .limit(100);
    return { status: "ok", response: participantClaimListResponseSchema.parse({
      formatVersion: 1, raceId: input.raceId, entryId: input.entryId,
      claims: rows.map(({ issue, redeemedAt, revokedAt }) => ({
        claimId: issue.id, issuedAt: issue.issuedAt.toISOString(),
        expiresAt: issue.expiresAt.toISOString(),
        redeemedAt: redeemedAt?.toISOString() ?? null,
        revokedAt: revokedAt?.toISOString() ?? null
      }))
    }) } as const;
  });
}

/** Revokes an issued code or an already redeemed association without rewriting either journal. */
export async function revokeParticipantEntryClaimAsAdmin(
  db: Database, input: AdminRevokeInput, now = new Date()
): Promise<Failure | { status: "revoked"; response: ParticipantClaimRevokeResponse }> {
  const key = participantClaimRevokeIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = participantClaimRevokeRequestSchema.safeParse(input.request);
  if (!validNow(now) || !uuid.test(input.raceId) || !uuid.test(input.entryId) || !uuid.test(input.claimId) ||
    !key.success || !parsed.success || key.data !== `participant-claim-revoke:${parsed.data.requestId}` ||
    parsed.data.raceId !== input.raceId || parsed.data.entryId !== input.entryId ||
    parsed.data.claimId !== input.claimId) return { status: "invalid-request" };
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!await lockRaceAndEntry(tx, input.raceId, input.entryId)) return { status: "not-found" } as const;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${parsed.data.requestId}, 0))`);
    const [replayed] = await tx.select().from(schema.participantEntryClaimRevocations)
      .where(eq(schema.participantEntryClaimRevocations.requestId, parsed.data.requestId));
    if (replayed) {
      if (replayed.claimId !== input.claimId || replayed.raceId !== input.raceId ||
        replayed.actorCredentialId !== auth.principal.accessCredentialId ||
        replayed.reason !== parsed.data.reason) return { status: "conflict" } as const;
      return { status: "revoked", response: revokeResponse(replayed, true) } as const;
    }
    const [issue] = await tx.select().from(schema.participantEntryClaimIssues)
      .where(and(eq(schema.participantEntryClaimIssues.id, input.claimId),
        eq(schema.participantEntryClaimIssues.raceId, input.raceId),
        eq(schema.participantEntryClaimIssues.entryId, input.entryId)));
    if (!issue) return { status: "not-found" } as const;
    const [old] = await tx.select({ id: schema.participantEntryClaimRevocations.id })
      .from(schema.participantEntryClaimRevocations)
      .where(eq(schema.participantEntryClaimRevocations.claimId, issue.id));
    if (old) return { status: "conflict" } as const;
    const [revocation] = await tx.insert(schema.participantEntryClaimRevocations).values({
      id: randomUUID(), requestId: parsed.data.requestId, claimId: issue.id,
      raceId: input.raceId, actorCredentialId: auth.principal.accessCredentialId,
      capability, revokedAt: now, reason: parsed.data.reason
    }).returning();
    if (!revocation) throw new Error("Spärr av deltagarkoppling saknas");
    await tx.insert(schema.auditEvents).values({
      raceId: issue.raceId, entityType: "participant_entry_claim", entityId: issue.id,
      action: "PARTICIPANT_ENTRY_CLAIM_REVOKED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId: revocation.requestId,
      after: { entryId: issue.entryId, reason: revocation.reason }
    });
    return { status: "revoked", response: revokeResponse(revocation, false) } as const;
  });
}

/** The account session, not the public result identity, is the redeeming principal. */
export async function redeemParticipantEntryClaimAsAccount(
  db: Database, input: AccountRedeemInput, now = new Date()
): Promise<Failure | { status: "redeemed"; response: ParticipantClaimRedeemResponse }> {
  const key = participantClaimRedeemIdempotencyKeySchema.safeParse(input.idempotencyKey);
  const parsed = participantClaimRedeemRequestSchema.safeParse(input.request);
  if (!validNow(now) || !key.success || !parsed.success ||
    key.data !== `participant-claim-redeem:${parsed.data.requestId}`) return { status: "invalid-request" };
  const secret = Buffer.from(parsed.data.code, "base64url");
  if (secret.length !== 16 || secret.toString("base64url") !== parsed.data.code) return { status: "invalid-request" };
  const secretHash = createHash("sha256").update(secret).digest("hex");
  return db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key.data}, 0))`);
    const [existing] = await tx.select({ redemption: schema.participantEntryClaimRedemptions,
      issueSecretHash: schema.participantEntryClaimIssues.secretHash })
      .from(schema.participantEntryClaimRedemptions)
      .innerJoin(schema.participantEntryClaimIssues,
        eq(schema.participantEntryClaimIssues.id, schema.participantEntryClaimRedemptions.claimId))
      .where(eq(schema.participantEntryClaimRedemptions.requestId, parsed.data.requestId));
    if (existing) {
      if (existing.redemption.accountId !== auth.principal.accountId || existing.issueSecretHash !== secretHash) {
        return { status: "conflict" } as const;
      }
      return { status: "redeemed", response: participantClaimRedeemResponseSchema.parse({
        formatVersion: 1, requestId: existing.redemption.requestId,
        claimedAt: existing.redemption.redeemedAt.toISOString(), replayed: true
      }) } as const;
    }
    const [issue] = await tx.select().from(schema.participantEntryClaimIssues)
      .where(eq(schema.participantEntryClaimIssues.secretHash, secretHash));
    if (!issue) return { status: "not-found" } as const;
    if (!await lockRaceAndEntry(tx, issue.raceId, issue.entryId)) return { status: "not-found" } as const;
    const [revocation] = await tx.select({ id: schema.participantEntryClaimRevocations.id })
      .from(schema.participantEntryClaimRevocations)
      .where(eq(schema.participantEntryClaimRevocations.claimId, issue.id));
    const [priorRedemption] = await tx.select({ id: schema.participantEntryClaimRedemptions.id })
      .from(schema.participantEntryClaimRedemptions)
      .where(eq(schema.participantEntryClaimRedemptions.claimId, issue.id));
    if (revocation || priorRedemption || issue.expiresAt.getTime() <= now.getTime()) {
      return { status: "not-found" } as const;
    }
    const [redemption] = await tx.insert(schema.participantEntryClaimRedemptions).values({
      id: randomUUID(), requestId: parsed.data.requestId, claimId: issue.id,
      accountId: auth.principal.accountId, redeemedAt: now
    }).onConflictDoNothing().returning();
    if (!redemption) return { status: "conflict" } as const;
    await tx.insert(schema.auditEvents).values({
      raceId: issue.raceId, entityType: "participant_entry_claim", entityId: issue.id,
      action: "PARTICIPANT_ENTRY_CLAIM_REDEEMED", actorKind: "USER_ACCOUNT",
      actorId: auth.principal.accountId, requestId: redemption.requestId,
      after: { entryId: issue.entryId, accountId: redemption.accountId }
    });
    return { status: "redeemed", response: participantClaimRedeemResponseSchema.parse({
      formatVersion: 1, requestId: redemption.requestId,
      claimedAt: redemption.redeemedAt.toISOString(), replayed: false
    }) } as const;
  });
}

/** A per-account index over the same public result projection used by anonymous visitors. */
export async function listMyParticipantResults(
  db: Database, proof: UserAccountSessionProof, now = new Date()
): Promise<Failure | { status: "ok"; response: ParticipantOwnResultsResponse }> {
  if (!validNow(now)) return { status: "invalid-request" };
  const linked = await db.transaction(async (tx) => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const candidates = await tx.select({
      claimId: schema.participantEntryClaimIssues.id,
      raceId: schema.participantEntryClaimIssues.raceId,
      entryId: schema.participantEntryClaimIssues.entryId,
      publicResultId: schema.entries.publicResultId,
      raceName: schema.races.name,
      eventName: schema.events.name
    }).from(schema.participantEntryClaimRedemptions)
      .innerJoin(schema.participantEntryClaimIssues,
        eq(schema.participantEntryClaimIssues.id, schema.participantEntryClaimRedemptions.claimId))
      .innerJoin(schema.entries, and(
        eq(schema.entries.id, schema.participantEntryClaimIssues.entryId),
        eq(schema.entries.raceId, schema.participantEntryClaimIssues.raceId)))
      .innerJoin(schema.races, eq(schema.races.id, schema.participantEntryClaimIssues.raceId))
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.participantEntryClaimRedemptions.accountId, auth.principal.accountId))
      .orderBy(asc(schema.participantEntryClaimIssues.raceId), asc(schema.participantEntryClaimIssues.entryId))
      .limit(10_001);
    if (candidates.length > 10_000) throw new Error("För många kontobundna anmälningar");
    const active: typeof candidates = [];
    for (const candidate of candidates) {
      // Recheck under the entry lock so a committed administrative revocation
      // cannot be bypassed by a stale candidate read in this request.
      const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
        .where(and(eq(schema.entries.id, candidate.entryId), eq(schema.entries.raceId, candidate.raceId)))
        .for("share");
      if (!entry) continue;
      const [revocation] = await tx.select({ id: schema.participantEntryClaimRevocations.id })
        .from(schema.participantEntryClaimRevocations)
        .where(eq(schema.participantEntryClaimRevocations.claimId, candidate.claimId));
      if (!revocation) active.push(candidate);
    }
    return { status: "ok", active } as const;
  });
  if (linked.status !== "ok") return linked;
  const lists = new Map<string, PublicResultListResponseV7>();
  const items: ParticipantOwnResultsResponse["items"] = [];
  for (const entry of linked.active) {
    let list = lists.get(entry.raceId);
    if (!list) {
      list = publicResultListResponseV7Schema.parse(await publicResults(db, entry.raceId));
      lists.set(entry.raceId, list);
    }
    const result = list.results.find((row) => "publicResultId" in row && row.publicResultId === entry.publicResultId) ?? null;
    items.push({ raceId: entry.raceId, eventName: entry.eventName, raceName: entry.raceName, result });
  }
  return { status: "ok", response: participantOwnResultsResponseSchema.parse({ formatVersion: 1, items }) };
}
