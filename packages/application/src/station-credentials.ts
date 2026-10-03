import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, max } from "drizzle-orm";
import type { Database } from "@o-tid/database";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SECRET_HASH_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_PREFIX = "otid_stn_v1";
const DUMMY_SECRET_HASH = Buffer.from(
  "1b3b5c4d3f19d588440514da91c4c70dc43af4ae5b2ec46ab44fe6887c9f7135",
  "hex"
);

export type StationCredentialScope = "READOUT";

export interface StationCredentialInstallation {
  formatVersion: 1;
  token: string;
  credentialId: string;
  deviceId: string;
  raceId: string;
  scope: StationCredentialScope;
  generation: number;
  issuedAt: string;
  expiresAt: string;
}

export interface StationCredentialPrincipal {
  credentialId: string;
  stationDeviceId: string;
  deviceId: string;
  raceId: string;
  scope: StationCredentialScope;
  generation: number;
  issuedAt: string;
  expiresAt: string;
}

export type StationAuthenticationResult =
  | { status: "unauthorized" }
  | { status: "authenticated"; principal: StationCredentialPrincipal };

interface CredentialRuntimeOptions {
  now?: Date;
  secretBytes?: Uint8Array;
}

interface ParsedBearerToken {
  credentialId: string;
  secretBytes: Buffer;
}

export interface CreatedStationCredential {
  credentialId: string;
  stationDeviceId: string;
  deviceId: string;
  raceId: string;
  scope: StationCredentialScope;
  generation: number;
  issuedAt: string;
  expiresAt: string;
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
  if (scope !== "READOUT") throw new Error("Stationscredentialens scope är ogiltigt");
}

function secretFor(options: CredentialRuntimeOptions): Buffer {
  const secret = options.secretBytes === undefined ? randomBytes(32) : Buffer.from(options.secretBytes);
  if (secret.length !== 32) throw new Error("Stationscredentialens secret måste vara exakt 32 bytes");
  return secret;
}

function secretHash(secret: Uint8Array): string {
  return createHash("sha256").update(secret).digest("hex");
}

function tokenFor(credentialId: string, secret: Uint8Array): string {
  return `${TOKEN_PREFIX}.${credentialId}.${Buffer.from(secret).toString("base64url")}`;
}

function parseBearerToken(authorization: string | null): ParsedBearerToken | undefined {
  if (authorization === null || authorization.length > 128) return undefined;
  const match = /^Bearer otid_stn_v1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(authorization);
  if (!match?.[1] || !match[2] || !LOWERCASE_UUID_PATTERN.test(match[1]) || !SECRET_PATTERN.test(match[2])) {
    return undefined;
  }
  const secretBytes = Buffer.from(match[2], "base64url");
  if (secretBytes.length !== 32 || secretBytes.toString("base64url") !== match[2]) return undefined;
  return { credentialId: match[1], secretBytes };
}

async function assertRaceExists(tx: DbExecutor, raceId: string): Promise<void> {
  const [race] = await tx.select({ id: schema.races.id }).from(schema.races)
    .where(eq(schema.races.id, raceId)).limit(1);
  if (!race) throw new Error("Loppet finns inte");
}

async function lockedStationDevice(tx: DbExecutor, deviceId: string) {
  await tx.insert(schema.stationDevices).values({ deviceId }).onConflictDoNothing();
  const [device] = await tx.select().from(schema.stationDevices)
    .where(eq(schema.stationDevices.deviceId, deviceId)).for("update");
  if (!device) throw new Error("Stationsenheten kunde inte skapas");
  return device;
}

async function insertCredentialWithHash(
  tx: DbExecutor,
  input: {
    stationDeviceId: string;
    deviceId: string;
    raceId: string;
    scope: StationCredentialScope;
    generation: number;
    issuedAt: Date;
    expiresAt: Date;
    secretHash: string;
    auditAction: "STATION_CREDENTIAL_ISSUED" | "STATION_CREDENTIAL_ROTATED" | "STATION_CREDENTIAL_PAIRED";
  },
): Promise<CreatedStationCredential> {
  if (!SECRET_HASH_PATTERN.test(input.secretHash)) {
    throw new Error("Stationscredentialens secrethash är ogiltig");
  }
  const [credential] = await tx.insert(schema.stationCredentials).values({
    stationDeviceId: input.stationDeviceId,
    raceId: input.raceId,
    scope: input.scope,
    generation: input.generation,
    secretHash: input.secretHash,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  }).returning({ id: schema.stationCredentials.id });
  if (!credential) throw new Error("Stationscredentialen kunde inte skapas");

  const issuedAt = input.issuedAt.toISOString();
  const expiresAt = input.expiresAt.toISOString();
  await tx.insert(schema.auditEvents).values({
    raceId: input.raceId,
    entityType: "station_credential",
    entityId: credential.id,
    action: input.auditAction,
    after: { generation: input.generation, scope: input.scope, issuedAt, expiresAt }
  });
  return {
    credentialId: credential.id,
    stationDeviceId: input.stationDeviceId,
    deviceId: input.deviceId,
    raceId: input.raceId,
    scope: input.scope,
    generation: input.generation,
    issuedAt,
    expiresAt
  };
}

async function createCredential(
  tx: DbExecutor,
  input: {
    stationDeviceId: string;
    deviceId: string;
    raceId: string;
    scope: StationCredentialScope;
    generation: number;
    issuedAt: Date;
    expiresAt: Date;
    auditAction: "STATION_CREDENTIAL_ISSUED" | "STATION_CREDENTIAL_ROTATED";
  },
  secret: Buffer
): Promise<StationCredentialInstallation> {
  const created = await insertCredentialWithHash(tx, {
    ...input,
    secretHash: secretHash(secret)
  });
  return {
    formatVersion: 1,
    token: tokenFor(created.credentialId, secret),
    credentialId: created.credentialId,
    deviceId: created.deviceId,
    raceId: created.raceId,
    scope: created.scope,
    generation: created.generation,
    issuedAt: created.issuedAt,
    expiresAt: created.expiresAt
  };
}

export async function createNextStationCredentialFromHash(
  tx: DbExecutor,
  input: {
    deviceId: string;
    raceId: string;
    scope: StationCredentialScope;
    secretHash: string;
    issuedAt: Date;
    expiresAt: Date;
  }
): Promise<CreatedStationCredential> {
  const deviceId = normalizedUuid(input.deviceId, "Stationens device-id");
  const raceId = normalizedUuid(input.raceId, "Lopp-id");
  assertScope(input.scope);
  const issuedAt = validDate(input.issuedAt, "Utfärdandetiden");
  const expiresAt = validDate(input.expiresAt, "Utgångstiden");
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    throw new Error("Utgångstiden måste ligga efter utfärdandetiden");
  }
  if (!SECRET_HASH_PATTERN.test(input.secretHash)) {
    throw new Error("Stationscredentialens secrethash är ogiltig");
  }
  await assertRaceExists(tx, raceId);
  const device = await lockedStationDevice(tx, deviceId);
  const [latest] = await tx.select({ generation: max(schema.stationCredentials.generation) })
    .from(schema.stationCredentials).where(and(
      eq(schema.stationCredentials.stationDeviceId, device.id),
      eq(schema.stationCredentials.raceId, raceId),
      eq(schema.stationCredentials.scope, input.scope)
    ));
  return insertCredentialWithHash(tx, {
    stationDeviceId: device.id,
    deviceId,
    raceId,
    scope: input.scope,
    generation: (latest?.generation ?? 0) + 1,
    issuedAt,
    expiresAt,
    secretHash: input.secretHash,
    auditAction: "STATION_CREDENTIAL_PAIRED"
  });
}

export async function issueStationCredential(
  db: Database,
  input: { deviceId: string; raceId: string; scope: StationCredentialScope; expiresAt: Date },
  options: CredentialRuntimeOptions = {}
): Promise<StationCredentialInstallation> {
  const deviceId = normalizedUuid(input.deviceId, "Stationens device-id");
  const raceId = normalizedUuid(input.raceId, "Lopp-id");
  assertScope(input.scope);
  const issuedAt = validDate(options.now ?? new Date(), "Utfärdandetiden");
  const expiresAt = validDate(input.expiresAt, "Utgångstiden");
  if (expiresAt.getTime() <= issuedAt.getTime()) throw new Error("Utgångstiden måste ligga efter utfärdandetiden");
  const secret = secretFor(options);

  return db.transaction(async (tx) => {
    await assertRaceExists(tx, raceId);
    const device = await lockedStationDevice(tx, deviceId);
    const [latest] = await tx.select({ generation: max(schema.stationCredentials.generation) })
      .from(schema.stationCredentials).where(and(
        eq(schema.stationCredentials.stationDeviceId, device.id),
        eq(schema.stationCredentials.raceId, raceId),
        eq(schema.stationCredentials.scope, input.scope)
      ));
    if (latest?.generation !== null && latest?.generation !== undefined) {
      throw new Error("Stationen har redan en credential för loppet; använd rotation");
    }
    return createCredential(tx, {
      stationDeviceId: device.id,
      deviceId,
      raceId,
      scope: input.scope,
      generation: 1,
      issuedAt,
      expiresAt,
      auditAction: "STATION_CREDENTIAL_ISSUED"
    }, secret);
  });
}

export async function rotateStationCredential(
  db: Database,
  input: { credentialId: string; expiresAt: Date },
  options: CredentialRuntimeOptions = {}
): Promise<StationCredentialInstallation> {
  const credentialId = normalizedUuid(input.credentialId, "Credential-id");
  const issuedAt = validDate(options.now ?? new Date(), "Rotationstiden");
  const expiresAt = validDate(input.expiresAt, "Utgångstiden");
  if (expiresAt.getTime() <= issuedAt.getTime()) throw new Error("Utgångstiden måste ligga efter rotationstiden");
  const secret = secretFor(options);

  return db.transaction(async (tx) => {
    const [source] = await tx.select({
      stationDeviceId: schema.stationCredentials.stationDeviceId,
      deviceId: schema.stationDevices.deviceId,
      raceId: schema.stationCredentials.raceId,
      scope: schema.stationCredentials.scope
    }).from(schema.stationCredentials)
      .innerJoin(schema.stationDevices, eq(schema.stationCredentials.stationDeviceId, schema.stationDevices.id))
      .where(eq(schema.stationCredentials.id, credentialId)).limit(1);
    if (!source) throw new Error("Stationscredentialen finns inte");
    const [device] = await tx.select({ id: schema.stationDevices.id }).from(schema.stationDevices)
      .where(eq(schema.stationDevices.id, source.stationDeviceId)).for("update");
    if (!device) throw new Error("Stationsenheten finns inte");
    const [latest] = await tx.select({ generation: max(schema.stationCredentials.generation) })
      .from(schema.stationCredentials).where(and(
        eq(schema.stationCredentials.stationDeviceId, source.stationDeviceId),
        eq(schema.stationCredentials.raceId, source.raceId),
        eq(schema.stationCredentials.scope, source.scope)
      ));
    const generation = (latest?.generation ?? 0) + 1;
    return createCredential(tx, {
      stationDeviceId: source.stationDeviceId,
      deviceId: source.deviceId,
      raceId: source.raceId,
      scope: source.scope,
      generation,
      issuedAt,
      expiresAt,
      auditAction: "STATION_CREDENTIAL_ROTATED"
    }, secret);
  });
}

export async function revokeStationCredential(
  db: Database,
  input: { credentialId: string },
  now = new Date()
): Promise<{ status: "revoked" | "already-revoked"; credentialId: string; revokedAt: string }> {
  const credentialId = normalizedUuid(input.credentialId, "Credential-id");
  const revokedAtDate = validDate(now, "Spärrtiden");
  const revokedAt = revokedAtDate.toISOString();
  return db.transaction(async (tx) => {
    const [credential] = await tx.select({
      id: schema.stationCredentials.id,
      raceId: schema.stationCredentials.raceId,
      scope: schema.stationCredentials.scope,
      generation: schema.stationCredentials.generation
    }).from(schema.stationCredentials).where(eq(schema.stationCredentials.id, credentialId)).for("update");
    if (!credential) throw new Error("Stationscredentialen finns inte");
    const [created] = await tx.insert(schema.stationCredentialRevocations).values({
      credentialId,
      revokedAt: revokedAtDate,
      reason: "OPERATOR_REVOKED"
    }).onConflictDoNothing().returning({ id: schema.stationCredentialRevocations.id });
    if (!created) {
      const [existing] = await tx.select({ revokedAt: schema.stationCredentialRevocations.revokedAt })
        .from(schema.stationCredentialRevocations)
        .where(eq(schema.stationCredentialRevocations.credentialId, credentialId));
      if (!existing) throw new Error("Credentialspärren kunde inte läsas");
      return { status: "already-revoked", credentialId, revokedAt: existing.revokedAt.toISOString() };
    }
    await tx.insert(schema.auditEvents).values({
      raceId: credential.raceId,
      entityType: "station_credential",
      entityId: credential.id,
      action: "STATION_CREDENTIAL_REVOKED",
      after: { generation: credential.generation, scope: credential.scope, revokedAt }
    });
    return { status: "revoked", credentialId, revokedAt };
  });
}

export async function authenticateStationBearer(
  db: Database,
  authorization: string | null,
  now = new Date()
): Promise<StationAuthenticationResult> {
  const parsed = parseBearerToken(authorization);
  if (!parsed || !Number.isFinite(now.getTime())) return { status: "unauthorized" };
  const [credential] = await db.select({
    credentialId: schema.stationCredentials.id,
    stationDeviceId: schema.stationCredentials.stationDeviceId,
    deviceId: schema.stationDevices.deviceId,
    raceId: schema.stationCredentials.raceId,
    scope: schema.stationCredentials.scope,
    generation: schema.stationCredentials.generation,
    secretHash: schema.stationCredentials.secretHash,
    issuedAt: schema.stationCredentials.issuedAt,
    expiresAt: schema.stationCredentials.expiresAt,
    revocationId: schema.stationCredentialRevocations.id
  }).from(schema.stationCredentials)
    .innerJoin(schema.stationDevices, eq(schema.stationCredentials.stationDeviceId, schema.stationDevices.id))
    .leftJoin(
      schema.stationCredentialRevocations,
      eq(schema.stationCredentialRevocations.credentialId, schema.stationCredentials.id)
    )
    .where(eq(schema.stationCredentials.id, parsed.credentialId)).limit(1);

  const presentedHash = Buffer.from(secretHash(parsed.secretBytes), "hex");
  const storedHash = credential && SECRET_HASH_PATTERN.test(credential.secretHash)
    ? Buffer.from(credential.secretHash, "hex")
    : DUMMY_SECRET_HASH;
  const secretMatches = timingSafeEqual(presentedHash, storedHash);
  if (!credential || !secretMatches || credential.revocationId !== null ||
      credential.issuedAt.getTime() > now.getTime() || credential.expiresAt.getTime() <= now.getTime()) {
    return { status: "unauthorized" };
  }
  return {
    status: "authenticated",
    principal: {
      credentialId: credential.credentialId,
      stationDeviceId: credential.stationDeviceId,
      deviceId: credential.deviceId,
      raceId: credential.raceId,
      scope: credential.scope,
      generation: credential.generation,
      issuedAt: credential.issuedAt.toISOString(),
      expiresAt: credential.expiresAt.toISOString()
    }
  };
}

export function hasStationCredentialScope(
  principal: StationCredentialPrincipal,
  required: { raceId: string; deviceId?: string; scope: string }
): boolean {
  return principal.raceId === required.raceId.toLowerCase() &&
    principal.scope === required.scope &&
    (required.deviceId === undefined || principal.deviceId === required.deviceId.toLowerCase());
}
