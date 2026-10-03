import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { canonicalStartCheckinRecoveryManifest, StartCheckinRecoveryManifestSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_LIFETIME_MS = 60 * 60 * 1000;
const INSERT_CHUNK_SIZE = 500;

type Manifest = ReturnType<typeof StartCheckinRecoveryManifestSchema.parse>;

export interface CheckinRecoveryGrantClock {
  now?: Date;
  id?: string;
  secretBytes?: Uint8Array;
}

function invalid(): never {
  throw new Error("Ogiltig recovery-grant-begäran");
}

function date(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid();
  return value;
}

function text(value: string, maximum: number): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < 1 || trimmed.length > maximum) invalid();
  return trimmed;
}

function id(value: string): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}

function secret(value: Uint8Array | undefined): Buffer {
  const bytes = value === undefined ? randomBytes(32) : Buffer.from(value);
  if (bytes.length !== 32) invalid();
  return bytes;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseManifest(value: unknown): { manifest: Manifest; canonical: Uint8Array; canonicalJson: string; manifestHash: string } {
  const parsed = StartCheckinRecoveryManifestSchema.safeParse(value);
  if (!parsed.success) invalid();
  const canonical = canonicalStartCheckinRecoveryManifest(parsed.data);
  return { manifest: parsed.data, canonical, canonicalJson: new TextDecoder().decode(canonical), manifestHash: sha256(canonical) };
}

/**
 * Trusted-server-only issuance. It deliberately has no HTTP/session authority:
 * callers must be the provisioning CLI that has already obtained database access.
 */
export async function issueCheckinRecoveryGrant(
  db: Database,
  input: { manifest: unknown; operatorLabel: string; reason: string; expiresAt: Date },
  clock: CheckinRecoveryGrantClock = {}
): Promise<{ grantId: string; token: string; manifestHash: string; expiresAt: string }> {
  const { manifest, canonicalJson, manifestHash } = parseManifest(input.manifest);
  const operatorLabel = text(input.operatorLabel, 120);
  const reason = text(input.reason, 500);
  const now = date(clock.now ?? new Date());
  const expiresAt = date(input.expiresAt);
  if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() - now.getTime() > MAX_LIFETIME_MS) invalid();
  const grantId = id(clock.id ?? randomUUID());
  const secretBytes = secret(clock.secretBytes);

  try {
    await db.transaction(async (tx) => {
    // Issuance locks credential -> race -> device before inspecting frozen operations.
    const [credential] = await tx.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, manifest.actorCredentialId)).for("update");
    if (!credential || credential.raceId !== manifest.raceId || credential.capability !== manifest.capability ||
      credential.issuedAt.getTime() > now.getTime()) invalid();
    const [credentialRevocation] = await tx.select({ id: schema.pairingAdminAccessCredentialRevocations.id })
      .from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, credential.id)).limit(1);
    if (!credentialRevocation && credential.expiresAt.getTime() > now.getTime()) invalid();

    const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
      .where(eq(schema.races.id, manifest.raceId)).for("share");
    if (!race) invalid();
    const [device] = await tx.select().from(schema.startCheckinDevices)
      .where(eq(schema.startCheckinDevices.id, manifest.deviceId)).for("update");
    if (!device || device.raceId !== manifest.raceId || device.actorCredentialId !== manifest.actorCredentialId ||
      device.capability !== manifest.capability) invalid();

    const requestIds = manifest.items.map((item) => item.requestId);
    const byRequest: { requestId: string; deviceId: string; actorCredentialId: string; raceId: string; localSequence: number; contentHash: string }[] = [];
    for (let offset = 0; offset < requestIds.length; offset += INSERT_CHUNK_SIZE) {
      byRequest.push(...await tx.select({ requestId: schema.startCheckinOperations.requestId, deviceId: schema.startCheckinOperations.deviceId,
        actorCredentialId: schema.startCheckinOperations.actorCredentialId, raceId: schema.startCheckinOperations.raceId,
        localSequence: schema.startCheckinOperations.localSequence, contentHash: schema.startCheckinOperations.contentHash }).from(schema.startCheckinOperations)
        .where(inArray(schema.startCheckinOperations.requestId, requestIds.slice(offset, offset + INSERT_CHUNK_SIZE))));
    }
    const requests = new Map(byRequest.map((row) => [row.requestId, row]));
    const savedForDevice = await tx.select({ requestId: schema.startCheckinOperations.requestId, deviceId: schema.startCheckinOperations.deviceId,
      actorCredentialId: schema.startCheckinOperations.actorCredentialId, raceId: schema.startCheckinOperations.raceId,
      localSequence: schema.startCheckinOperations.localSequence, contentHash: schema.startCheckinOperations.contentHash }).from(schema.startCheckinOperations)
      .where(and(eq(schema.startCheckinOperations.deviceId, manifest.deviceId), gte(schema.startCheckinOperations.localSequence, manifest.firstSequence),
        lte(schema.startCheckinOperations.localSequence, manifest.lastSequence)));
    const bySequence = new Map(savedForDevice.map((row) => [row.localSequence, row]));

    let firstMissing: number | undefined;
    for (const item of manifest.items) {
      const sequenceRow = bySequence.get(item.localSequence);
      const requestRow = requests.get(item.requestId);
      if (sequenceRow || requestRow) {
        if (firstMissing !== undefined) invalid();
        if (!sequenceRow || !requestRow || sequenceRow.requestId !== item.requestId || requestRow.deviceId !== manifest.deviceId ||
          requestRow.actorCredentialId !== manifest.actorCredentialId || requestRow.raceId !== manifest.raceId ||
          requestRow.localSequence !== item.localSequence || requestRow.contentHash !== item.contentHash) invalid();
      } else if (firstMissing === undefined) {
        firstMissing = item.localSequence;
      }
    }
    const [last] = await tx.select({ localSequence: schema.startCheckinOperations.localSequence })
      .from(schema.startCheckinOperations).where(eq(schema.startCheckinOperations.deviceId, manifest.deviceId))
      .orderBy(desc(schema.startCheckinOperations.localSequence)).limit(1);
    if (firstMissing !== undefined && firstMissing !== (last?.localSequence ?? 0) + 1) invalid();

    await tx.insert(schema.checkinRecoveryGrants).values({
      id: grantId, deviceId: manifest.deviceId, actorCredentialId: manifest.actorCredentialId, raceId: manifest.raceId,
      capability: manifest.capability, manifestCanonicalJson: canonicalJson, manifestHash, secretHash: sha256(secretBytes),
      firstSequence: manifest.firstSequence, lastSequence: manifest.lastSequence, operatorLabel, reason, issuedAt: now, expiresAt
    });
    for (let offset = 0; offset < manifest.items.length; offset += INSERT_CHUNK_SIZE) {
      await tx.insert(schema.checkinRecoveryGrantItems).values(manifest.items.slice(offset, offset + INSERT_CHUNK_SIZE).map((item) => ({
        grantId, requestId: item.requestId, deviceId: manifest.deviceId, actorCredentialId: manifest.actorCredentialId,
        raceId: manifest.raceId, localSequence: item.localSequence, contentHash: item.contentHash
      })));
    }
    await tx.insert(schema.auditEvents).values({
      raceId: manifest.raceId, entityType: "checkin_recovery_grant", entityId: grantId, action: "CHECKIN_RECOVERY_GRANT_ISSUED",
      after: { manifestHash, firstSequence: manifest.firstSequence, lastSequence: manifest.lastSequence, capability: manifest.capability,
        operatorLabel, reason, expiresAt: expiresAt.toISOString() }, createdAt: now
    });
    });
    const token = `otid_checkin_recovery_v1.${grantId}.${secretBytes.toString("base64url")}`;
    return { grantId, token, manifestHash, expiresAt: expiresAt.toISOString() };
  } finally {
    secretBytes.fill(0);
  }
}

/** Revoke under the grant row lock; a same-intent repeat is explicitly idempotent. */
export async function revokeCheckinRecoveryGrant(
  db: Database,
  input: { grantId: string; operatorLabel: string; reason: string },
  nowInput: Date = new Date()
): Promise<{ status: "revoked" | "already-revoked"; grantId: string; revokedAt: string }> {
  const grantId = id(input.grantId), operatorLabel = text(input.operatorLabel, 120), reason = text(input.reason, 500);
  const now = date(nowInput);
  return db.transaction(async (tx) => {
    const [grant] = await tx.select().from(schema.checkinRecoveryGrants)
      .where(eq(schema.checkinRecoveryGrants.id, grantId)).for("update");
    if (!grant) invalid();
    if (now.getTime() < grant.issuedAt.getTime()) invalid();
    const [existing] = await tx.select().from(schema.checkinRecoveryGrantRevocations)
      .where(eq(schema.checkinRecoveryGrantRevocations.grantId, grantId));
    if (existing) {
      if (existing.operatorLabel !== operatorLabel || existing.reason !== reason) invalid();
      return { status: "already-revoked" as const, grantId, revokedAt: existing.revokedAt.toISOString() };
    }
    await tx.insert(schema.checkinRecoveryGrantRevocations).values({ grantId, operatorLabel, reason, revokedAt: now });
    await tx.insert(schema.auditEvents).values({
      raceId: grant.raceId, entityType: "checkin_recovery_grant", entityId: grantId, action: "CHECKIN_RECOVERY_GRANT_REVOKED",
      after: { operatorLabel, reason, revokedAt: now.toISOString() }, createdAt: now
    });
    return { status: "revoked" as const, grantId, revokedAt: now.toISOString() };
  });
}
