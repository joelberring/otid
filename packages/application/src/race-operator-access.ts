import { and, asc, eq, inArray } from "drizzle-orm";
import {
  raceOperatorAccessCapabilitySchema, raceOperatorAccessIssueRequestSchema,
  raceOperatorAccessIssueResponseSchema, raceOperatorAccessListResponseSchema,
  raceOperatorAccessMetadataSchema, raceOperatorAccessRevokeRequestSchema,
  raceOperatorAccessRevokeResponseSchema, type RaceOperatorAccessMetadata
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation,
  authenticatePairingAdminSessionForProtectedRead, issuePairingAdminAccessCredential,
  revokePairingAdminAccessCredentialInTransaction, type PairingAdminRequestAuthentication, type RaceAdminCapability
} from "./pairing-admin";

type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const accessCapabilities = ["MANAGE_RACE", "START_CHECKIN", "FINISH_FOREST_WATCH"] as const;
const webIssuedAction = "WEB_OPERATOR_ACCESS_ISSUED";

type AccessCredentialMetadataRow = Pick<typeof schema.pairingAdminAccessCredentials.$inferSelect,
  "id" | "raceId" | "capability" | "label" | "issuedAt" | "expiresAt">;

function metadata(row: AccessCredentialMetadataRow, revokedAt: Date | null): RaceOperatorAccessMetadata {
  return raceOperatorAccessMetadataSchema.parse({
    formatVersion: 1, credentialId: row.id, raceId: row.raceId,
    capability: raceOperatorAccessCapabilitySchema.parse(row.capability), label: row.label,
    issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    revokedAt: revokedAt?.toISOString() ?? null
  });
}

async function webIssuedCredentials(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], raceId: string) {
  const rows = await tx.select({ credentialId: schema.auditEvents.entityId }).from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.action, webIssuedAction)))
    .orderBy(asc(schema.auditEvents.createdAt), asc(schema.auditEvents.id));
  return [...new Set(rows.map((row) => row.credentialId))];
}

export async function listRaceOperatorAccessAsAdministrator(db: Database, input: Authentication, now = new Date()) {
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    const ids = await webIssuedCredentials(tx, input.raceId);
    const credentials = ids.length === 0 ? [] : await tx.select().from(schema.pairingAdminAccessCredentials)
      .where(and(eq(schema.pairingAdminAccessCredentials.raceId, input.raceId),
        inArray(schema.pairingAdminAccessCredentials.id, ids),
        inArray(schema.pairingAdminAccessCredentials.capability, [...accessCapabilities]))
      ).orderBy(asc(schema.pairingAdminAccessCredentials.issuedAt), asc(schema.pairingAdminAccessCredentials.id)).limit(1001);
    if (credentials.length > 1000) throw new Error("För många utfärdade behörigheter för att visas säkert");
    const revocations = ids.length === 0 ? [] : await tx.select().from(schema.pairingAdminAccessCredentialRevocations)
      .where(inArray(schema.pairingAdminAccessCredentialRevocations.credentialId, ids));
    const revokedByCredential = new Map(revocations.map((row) => [row.credentialId, row.revokedAt]));
    return { status: "ok" as const, response: raceOperatorAccessListResponseSchema.parse({
      formatVersion: 1, accesses: credentials.map((row) => metadata(row, revokedByCredential.get(row.id) ?? null))
    }) };
  });
}

export async function issueRaceOperatorAccessAsAdministrator(
  db: Database, input: Authentication & { request: unknown }, now = new Date()
) {
  const parsed = raceOperatorAccessIssueRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" as const };
  const intent = parsed.data;
  const expiresAt = new Date(intent.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now || expiresAt.getTime() - now.getTime() > 8 * 60 * 60 * 1000) {
    return { status: "invalid-request" as const };
  }
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const installation = await issuePairingAdminAccessCredential(tx, {
      raceId: input.raceId, capability: intent.capability as RaceAdminCapability, label: intent.label, expiresAt
    }, { now });
    await tx.insert(schema.auditEvents).values({
      raceId: input.raceId, entityType: "web_operator_access", entityId: installation.credentialId,
      action: webIssuedAction, actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      after: { capability: installation.capability, label: installation.label, issuedAt: installation.issuedAt, expiresAt: installation.expiresAt }
    });
    return { status: "issued" as const, response: raceOperatorAccessIssueResponseSchema.parse({
      formatVersion: 1, accessCredential: installation.accessCredential,
      access: metadata({ id: installation.credentialId, raceId: installation.raceId, capability: installation.capability,
        label: installation.label, issuedAt: new Date(installation.issuedAt), expiresAt: new Date(installation.expiresAt) }, null)
    }) };
  });
}

export async function revokeRaceOperatorAccessAsAdministrator(
  db: Database, input: Authentication & { request: unknown }, now = new Date()
) {
  const parsed = raceOperatorAccessRevokeRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" as const };
  const authentication = { ...input, capability, requireCsrf: true };
  const preflight = await authenticatePairingAdminSession(db, authentication, now);
  if (preflight.status !== "authenticated") return preflight;
  return db.transaction(async (tx) => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, authentication, now);
    if (auth.status !== "authenticated") return auth;
    const [credential] = await tx.select().from(schema.pairingAdminAccessCredentials)
      .where(and(eq(schema.pairingAdminAccessCredentials.id, parsed.data.credentialId),
        eq(schema.pairingAdminAccessCredentials.raceId, input.raceId))).for("update");
    if (!credential || !accessCapabilities.includes(credential.capability as typeof accessCapabilities[number])) return { status: "not-found" as const };
    const issued = await tx.select({ id: schema.auditEvents.id }).from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, input.raceId), eq(schema.auditEvents.entityId, credential.id), eq(schema.auditEvents.action, webIssuedAction)
    )).limit(1);
    if (!issued[0]) return { status: "not-found" as const };
    const result = await revokePairingAdminAccessCredentialInTransaction(tx, { credentialId: credential.id,
      capability: credential.capability as RaceAdminCapability, reason: "WEB_OPERATOR_ACCESS_REVOKED" }, now);
    const [revocation] = await tx.select().from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, credential.id));
    if (!revocation) throw new Error("Credentialspärren kunde inte läsas");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "web_operator_access", entityId: credential.id,
      action: "WEB_OPERATOR_ACCESS_REVOKED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      after: { revokedAt: revocation.revokedAt.toISOString() } });
    return { status: "revoked" as const, response: raceOperatorAccessRevokeResponseSchema.parse({
      formatVersion: 1, status: result.status, access: metadata(credential, revocation.revokedAt)
    }) };
  });
}
