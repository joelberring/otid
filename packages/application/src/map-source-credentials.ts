import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { mapSourceCredentialRequestSchema, type MapSourceCredentialView } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead
} from "./user-account";
import type { ClubProof } from "./club-access";
import { eventorConfigurationFromEnvironment } from "./eventor-secret";

/**
 * ADR-0219 tillägget om hämtningen (K4c, migration 0100): kontots egna uppgifter till Lantmäteriet. Ägaren 2026-11-08: varje
 * användare loggar in med sina egna uppgifter; O-Tid har inget eget konto. Två sätt: Geotorgets användarnamn och lösenord
 * (privatperson, Basic) eller API-portalens nyckel och hemlighet (organisationens systemkonto, OAuth2). Uppgifterna lagras bara
 * krypterade med driftens masternyckel (`OTID_EVENTOR_MASTER_KEY`, samma som Eventor-nycklarna), skrivs aldrig i loggar och
 * visas aldrig igen: bara de fyra sista tecknen i användarnamnet eller nyckeln.
 */
export type MapSourceSecret = { readonly method: "BASIC" | "OAUTH2"; readonly id: string; readonly secret: string };
const PROVIDER = "LANTMATERIET";
const credentials = schema.mapSourceCredentials;

type Master = { keyId: string; masterKey: Uint8Array };
function master(environment: Record<string, string | undefined>): Master | undefined {
  const configuration = eventorConfigurationFromEnvironment(environment);
  return configuration.status === "ok" ? { keyId: configuration.keyId, masterKey: configuration.masterKey } : undefined;
}
const aad = (accountId: string, method: string, keyId: string) =>
  Buffer.from(JSON.stringify(["o-tid:map-source", 1, "aes-256-gcm", accountId, PROVIDER, method, keyId]), "utf8");

function seal(secret: MapSourceSecret, accountId: string, keys: Master) {
  const plaintext = Buffer.from(JSON.stringify([secret.id, secret.secret]), "utf8");
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keys.masterKey, iv, { authTagLength: 16 });
    cipher.setAAD(aad(accountId, secret.method, keys.keyId));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { keyId: keys.keyId, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
  } finally { plaintext.fill(0); }
}

function open(row: typeof credentials.$inferSelect, keys: Master): MapSourceSecret | undefined {
  if (row.keyId !== keys.keyId) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keys.masterKey, Buffer.from(row.iv, "base64url"), { authTagLength: 16 });
    decipher.setAAD(aad(row.accountId, row.method, keys.keyId));
    decipher.setAuthTag(Buffer.from(row.tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64url")), decipher.final()]);
    const [id, secret] = JSON.parse(plaintext.toString("utf8")) as [string, string];
    plaintext.fill(0);
    return { method: row.method, id, secret };
  } catch { return undefined; }
}

const view = (row: typeof credentials.$inferSelect | undefined, keys: Master | undefined): MapSourceCredentialView => ({
  formatVersion: 1, provider: PROVIDER, available: keys !== undefined,
  saved: row ? { method: row.method, hint: row.hint, updatedAt: row.updatedAt.toISOString(), readable: keys !== undefined && row.keyId === keys.keyId } : null
});

export type MapSourceCredentialResult = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-configured" } | { status: "ok"; view: MapSourceCredentialView };

/** Vad som är sparat (aldrig uppgifterna själva). */
export async function readMapSourceCredential(db: Database, proof: ClubProof, environment: Record<string, string | undefined>, now = new Date())
  : Promise<MapSourceCredentialResult> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const [row] = await tx.select().from(credentials).where(and(eq(credentials.accountId, auth.principal.accountId), eq(credentials.provider, PROVIDER)));
    return { status: "ok", view: view(row, master(environment)) } as const;
  });
}

/** Sparar (ersätter) kontots uppgifter. */
export async function saveMapSourceCredential(db: Database, input: ClubProof & { request: unknown }, environment: Record<string, string | undefined>,
  now = new Date()): Promise<MapSourceCredentialResult> {
  const parsed = mapSourceCredentialRequestSchema.safeParse(input.request);
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!parsed.success) return { status: "invalid-request" } as const;
    const keys = master(environment);
    if (!keys) return { status: "not-configured" } as const;
    const accountId = auth.principal.accountId;
    const { method, id, secret } = parsed.data;
    const sealed = seal({ method, id, secret }, accountId, keys);
    const row = { accountId, provider: PROVIDER, method, ...sealed, hint: id.slice(-4), updatedAt: now } as const;
    await tx.insert(credentials).values(row).onConflictDoUpdate({ target: [credentials.accountId, credentials.provider],
      set: { method, ...sealed, hint: row.hint, updatedAt: now } });
    return { status: "ok", view: view(row, keys) } as const;
  });
}

/** Tar bort kontots uppgifter. */
export async function deleteMapSourceCredential(db: Database, proof: ClubProof, environment: Record<string, string | undefined>, now = new Date())
  : Promise<MapSourceCredentialResult> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...proof, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    await tx.delete(credentials).where(and(eq(credentials.accountId, auth.principal.accountId), eq(credentials.provider, PROVIDER)));
    return { status: "ok", view: view(undefined, master(environment)) } as const;
  });
}

/** Kontots uppgifter öppnade (bara på servern, för en hämtning). Undefined om inget är sparat eller nyckeln bytts. */
export async function openMapSourceCredential(db: Database, accountId: string, environment: Record<string, string | undefined>)
  : Promise<MapSourceSecret | undefined> {
  const keys = master(environment);
  if (!keys) return undefined;
  const [row] = await db.select().from(credentials).where(and(eq(credentials.accountId, accountId), eq(credentials.provider, PROVIDER)));
  return row ? open(row, keys) : undefined;
}
