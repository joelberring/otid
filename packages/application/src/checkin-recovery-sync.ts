import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { canonicalStartCheckinOperation, canonicalStartCheckinRecoveryManifest, StartCheckinRecoveryManifestSchema,
  StartCheckinRecoveryTokenSchema, StartCheckinSyncRequestSchema } from "@o-tid/contracts";
import { storeAuthorizedStartCheckinOperation } from "./start-checkin-sync";
import type { DbExecutor } from "./snapshot";

const dummyHash = Buffer.alloc(32);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function tokenIdentity(token: unknown): { grantId: string; secretHash: Buffer } | null {
  const parsed = StartCheckinRecoveryTokenSchema.safeParse(token);
  if (!parsed.success) return null;
  const [, grantId, encoded] = parsed.data.split(".");
  if (!grantId || !encoded) return null;
  const bytes = Buffer.from(encoded, "base64url");
  try {
    if (bytes.length !== 32 || bytes.toString("base64url") !== encoded) return null;
    return { grantId, secretHash: createHash("sha256").update(bytes).digest() };
  } finally { bytes.fill(0); }
}

async function authorize(db: DbExecutor, identity: NonNullable<ReturnType<typeof tokenIdentity>>, raceId: string, now: Date, lock: boolean) {
  const query = db.select().from(schema.checkinRecoveryGrants).where(eq(schema.checkinRecoveryGrants.id, identity.grantId));
  const [grant] = await (lock ? query.for("share") : query);
  const expectedHash = grant && /^[a-f0-9]{64}$/.test(grant.secretHash) ? Buffer.from(grant.secretHash, "hex") : dummyHash;
  const matches = timingSafeEqual(identity.secretHash, expectedHash);
  if (!grant || !matches || !Number.isFinite(now.getTime()) || grant.raceId !== raceId ||
    grant.issuedAt.getTime() > now.getTime() || grant.expiresAt.getTime() <= now.getTime()) return null;
  const [revocation] = await db.select({ grantId: schema.checkinRecoveryGrantRevocations.grantId })
    .from(schema.checkinRecoveryGrantRevocations).where(eq(schema.checkinRecoveryGrantRevocations.grantId, grant.id));
  return revocation ? null : grant;
}

/** Separate bearer authority for exact frozen operations; never renews the old credential. */
export async function syncStartCheckinWithRecovery(db: Database, input: {
  raceId: string; recoveryToken: string | undefined; readBody: () => Promise<unknown>;
}, clock: () => Date = () => new Date()) {
  const identity = tokenIdentity(input.recoveryToken);
  if (!identity || !await authorize(db, identity, input.raceId, clock(), false)) return { status: "unauthorized" as const };
  const parsed = StartCheckinSyncRequestSchema.safeParse(await input.readBody());
  if (!parsed.success || sha256(canonicalStartCheckinOperation(parsed.data.operation)) !== parsed.data.contentHash) {
    return { status: "invalid-request" as const };
  }
  const { operation: op, contentHash } = parsed.data;
  return db.transaction(async (tx) => {
    // Revocation takes UPDATE on the same grant. Authentication is rechecked after acquiring SHARE.
    const grant = await authorize(tx, identity, input.raceId, clock(), true);
    if (!grant) return { status: "unauthorized" as const };
    const now = clock();
    if (grant.expiresAt.getTime() <= now.getTime()) return { status: "unauthorized" as const };
    if (op.raceId !== grant.raceId || op.deviceId !== grant.deviceId || op.actorCredentialId !== grant.actorCredentialId ||
      (grant.capability !== "START_CHECKIN" && grant.capability !== "FINISH_FOREST_WATCH")) return { status: "forbidden" as const };
    const manifest = StartCheckinRecoveryManifestSchema.parse(JSON.parse(grant.manifestCanonicalJson) as unknown);
    const canonical = canonicalStartCheckinRecoveryManifest(manifest);
    if (new TextDecoder().decode(canonical) !== grant.manifestCanonicalJson || sha256(canonical) !== grant.manifestHash ||
      manifest.raceId !== grant.raceId || manifest.deviceId !== grant.deviceId || manifest.actorCredentialId !== grant.actorCredentialId ||
      manifest.capability !== grant.capability || manifest.firstSequence !== grant.firstSequence || manifest.lastSequence !== grant.lastSequence) {
      throw new Error("CHECKIN_RECOVERY_STORED_MANIFEST_INVALID");
    }
    const expected = manifest.items[op.localSequence - manifest.firstSequence];
    if (!expected || expected.requestId !== op.requestId || expected.contentHash !== contentHash) return { status: "forbidden" as const };
    const [item] = await tx.select().from(schema.checkinRecoveryGrantItems).where(and(
      eq(schema.checkinRecoveryGrantItems.grantId, grant.id), eq(schema.checkinRecoveryGrantItems.requestId, op.requestId)));
    if (!item || item.localSequence !== op.localSequence || item.contentHash !== contentHash || item.deviceId !== op.deviceId ||
      item.raceId !== op.raceId || item.actorCredentialId !== op.actorCredentialId) throw new Error("CHECKIN_RECOVERY_STORED_ITEM_INVALID");
    const result = await storeAuthorizedStartCheckinOperation(tx, parsed.data, grant.capability, now);
    if (result.status !== "stored") return result;
    const [delivered] = await tx.select().from(schema.checkinRecoveryDeliveries).where(and(
      eq(schema.checkinRecoveryDeliveries.grantId, grant.id), eq(schema.checkinRecoveryDeliveries.requestId, op.requestId)));
    if (!delivered) {
      await tx.insert(schema.checkinRecoveryDeliveries).values({ ...item, deliveredAt: now });
      await tx.insert(schema.auditEvents).values({ raceId: grant.raceId, entityType: "checkin_recovery_delivery",
        entityId: op.requestId, requestId: op.requestId,
        action: "CHECKIN_RECOVERY_OPERATION_DELIVERED", after: { grantId: grant.id, deviceId: op.deviceId,
          localSequence: op.localSequence, contentHash, effect: result.response.effect }, createdAt: now });
    } else if (delivered.deviceId !== op.deviceId || delivered.actorCredentialId !== op.actorCredentialId ||
      delivered.raceId !== op.raceId || delivered.localSequence !== op.localSequence || delivered.contentHash !== contentHash) {
      throw new Error("CHECKIN_RECOVERY_STORED_DELIVERY_INVALID");
    }
    return result;
  });
}
