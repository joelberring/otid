import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { emailVerificationRequestSchema, organizerAccountRegistrationRequestSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { consumeAccountRequestAllowance, DEFAULT_REGISTRATIONS_PER_HOUR } from "./account-throttle";
import { sha256Hex as sha256 } from "./serialization";
import type { DbExecutor } from "./snapshot";
import {
  currentUserAccountVerifier, issueUserAccountSession, scryptVerifier, userAccountPasswordMatches, type UserAccountLoginResult,
  type UserAccountRuntimeOptions
} from "./user-account";

/**
 * Bekräftad e-post (ADR-0185). Behörigheter som andra delar ut med e-postadressen (administratör, funktionär, banläggning,
 * gruppledare och gruppmedlem) gäller först när kontots adress är bekräftad (`user_account.email_verified_at`). Ägarskapet
 * för tävlingar kontot självt skapar gäller alltid. Befintliga konton räknades som bekräftade (migration 0038).
 *
 * Med e-post inställd (`OTID_SMTP_URL`) ger registreringen samma svar oavsett om adressen redan har ett konto, och arbetet
 * görs efter svaret: ett nytt konto skapas obekräftat och får en länk; ett obekräftat konto får en ny länk; ett bekräftat
 * konto får ett mejl om att det redan finns. Länken bekräftar adressen och loggar in, men bara tillsammans med lösenordet
 * som valdes vid just den registreringen. Den som registrerar någon annans adress kan alltså inte få kontot, och den som
 * äger adressen kan inte luras att bekräfta ett lösenord som någon annan valt.
 *
 * Utan e-post loggar registreringen in direkt som förut (ADR-0172), men kontot är obekräftat tills superadmin bekräftar det
 * (`node superadmin.mjs verify <e-post>`) eller lösenordet byts med en återställningslänk.
 */
export const EMAIL_VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** Bekräftelsemejl (och "kontot finns redan") per e-postadress och timme. */
export const VERIFY_EMAILS_PER_ADDRESS_AND_HOUR = 3;

export type EmailVerificationDelivery =
  | { kind: "VERIFY"; email: string; displayName: string; token: string; expiresAt: Date }
  | { kind: "ALREADY_REGISTERED"; email: string; displayName: string };

export async function accountEmailVerified(tx: DbExecutor, accountId: string): Promise<boolean> {
  const [account] = await tx.select({ verifiedAt: schema.userAccounts.emailVerifiedAt }).from(schema.userAccounts)
    .where(eq(schema.userAccounts.id, accountId));
  return account?.verifiedAt != null;
}

/** Ny bekräftelselänk med lösenordets verifierare (salt och hash). Bara hashen av nyckeln sparas. */
async function createVerificationToken(tx: DbExecutor, accountId: string, verifier: { saltHex: string; verifierHex: string }, now: Date)
  : Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS);
  await tx.insert(schema.emailVerificationTokens).values({ accountId, tokenHash: sha256(token), saltHex: verifier.saltHex,
    verifierHex: verifier.verifierHex, createdAt: now, expiresAt });
  return { token, expiresAt };
}

/** Spärren per adress: högst tre bekräftelsemejl i timmen, så att ingen kan fylla någons inkorg. */
async function verificationMailAllowed(tx: DbExecutor, email: string, now: Date): Promise<boolean> {
  return consumeAccountRequestAllowance(tx, { scope: "VERIFY_EMAIL", key: email, limit: VERIFY_EMAILS_PER_ADDRESS_AND_HOUR }, now);
}

export interface RegistrationWithVerificationOptions {
  now?: Date;
  clientKey?: string;
  registrationsPerHour?: number;
  accountId?: string;
  saltBytes?: Uint8Array;
}

/**
 * Registrering med bekräftelse. Anroparen har redan svarat (samma svar för alla); här görs arbetet. `delivery` är mejlet
 * att skicka, eller undefined (ogiltig begäran, spärrad, för många mejl).
 */
export async function registerUserAccountWithVerification(db: Database, request: unknown, options: RegistrationWithVerificationOptions = {})
  : Promise<{ status: "invalid-request" | "rate-limited" | "accepted"; delivery?: EmailVerificationDelivery }> {
  const now = options.now ?? new Date();
  const parsed = organizerAccountRegistrationRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  if (options.clientKey !== undefined) {
    const allowed = await db.transaction(tx => consumeAccountRequestAllowance(tx, { scope: "REGISTER_IP", key: options.clientKey!,
      limit: options.registrationsPerHour ?? DEFAULT_REGISTRATIONS_PER_HOUR }, now));
    if (!allowed) return { status: "rate-limited" };
  }
  // Lösenordet hashas alltid, också när adressen redan finns, så att tiden är densamma.
  const salt = options.saltBytes ? Buffer.from(options.saltBytes) : randomBytes(16);
  const verifier = { saltHex: salt.toString("hex"), verifierHex: (await scryptVerifier(parsed.data.password, salt)).toString("hex") };
  return db.transaction(async tx => {
    const { email, displayName } = parsed.data;
    const [existing] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, email)).for("update");
    if (!await verificationMailAllowed(tx, email, now)) return { status: "accepted" } as const;
    if (existing?.emailVerifiedAt || existing?.blockedAt) {
      return existing.blockedAt ? { status: "accepted" } as const
        : { status: "accepted", delivery: { kind: "ALREADY_REGISTERED", email: existing.email, displayName: existing.displayName } } as const;
    }
    let accountId = existing?.id;
    if (!accountId) {
      accountId = options.accountId ?? randomUUID();
      await tx.insert(schema.userAccounts).values({ id: accountId, email, displayName, createdAt: now });
      await tx.insert(schema.userAccountPasswordVerifiers).values({ accountId, version: 1, algorithm: "scrypt-v1", ...verifier, createdAt: now });
    }
    const { token, expiresAt } = await createVerificationToken(tx, accountId, verifier, now);
    return { status: "accepted", delivery: { kind: "VERIFY", email, displayName: existing?.displayName ?? displayName, token, expiresAt } } as const;
  });
}

/**
 * Inloggning på ett obekräftat konto med rätt lösenord när e-post är inställd: ingen inloggning (samma svar som fel lösenord,
 * se `loginUserAccount`), men en ny länk med kontots nuvarande lösenord skickas, så att ett konto från före e-posten kan
 * bekräftas.
 */
export async function verificationForUnverifiedLogin(tx: DbExecutor, account: { id: string; email: string; displayName: string },
  verifier: { saltHex: string; verifierHex: string }, now: Date): Promise<EmailVerificationDelivery | undefined> {
  if (!await verificationMailAllowed(tx, account.email, now)) return undefined;
  const { token, expiresAt } = await createVerificationToken(tx, account.id, verifier, now);
  return { kind: "VERIFY", email: account.email, displayName: account.displayName, token, expiresAt };
}

/**
 * Länken öppnad: nyckeln och lösenordet från samma registrering. Kontot blir bekräftat, lösenordet från registreringen gäller,
 * alla kontots länkar förbrukas och kontot loggas in. En förbrukad eller gammal länk, fel lösenord eller ett konto som redan
 * är bekräftat ger `invalid-token` (samma svar).
 */
export async function verifyEmailAndLogIn(db: Database, request: unknown, options: UserAccountRuntimeOptions = {})
  : Promise<{ status: "invalid-request" | "invalid-token" } | Extract<UserAccountLoginResult, { status: "authenticated" }>> {
  const parsed = emailVerificationRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  const now = options.now ?? new Date();
  return db.transaction(async tx => {
    const [row] = await tx.select().from(schema.emailVerificationTokens)
      .where(eq(schema.emailVerificationTokens.tokenHash, sha256(parsed.data.token))).for("update");
    const matches = await userAccountPasswordMatches(row, parsed.data.password);
    if (!row || !matches || row.usedAt || row.expiresAt.getTime() <= now.getTime()) return { status: "invalid-token" } as const;
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, row.accountId)).for("update");
    if (!account || account.blockedAt || account.emailVerifiedAt) return { status: "invalid-token" } as const;
    const current = await currentUserAccountVerifier(tx, account.id);
    if (!current) return { status: "invalid-token" } as const;
    let version = current.version;
    if (current.saltHex !== row.saltHex || current.verifierHex !== row.verifierHex) {
      version = current.version + 1;
      await tx.insert(schema.userAccountPasswordVerifiers).values({ accountId: account.id, version, algorithm: "scrypt-v1",
        saltHex: row.saltHex, verifierHex: row.verifierHex, createdAt: now });
    }
    const [verified] = await tx.update(schema.userAccounts).set({ emailVerifiedAt: now, lastLoginAt: now })
      .where(eq(schema.userAccounts.id, account.id)).returning();
    await tx.update(schema.emailVerificationTokens).set({ usedAt: now })
      .where(and(eq(schema.emailVerificationTokens.accountId, account.id), isNull(schema.emailVerificationTokens.usedAt)));
    return issueUserAccountSession(tx, verified!, version, now, options);
  });
}

/** Superadmin bekräftar adressen med kommando på servern (`node superadmin.mjs verify <e-post>`), t.ex. utan e-post. */
export async function markEmailVerifiedByCommand(db: Database, email: string, now = new Date())
  : Promise<{ status: "not-found" | "unchanged" | "verified" }> {
  const normalized = email.trim().toLowerCase();
  return db.transaction(async tx => {
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, normalized)).for("update");
    if (!account) return { status: "not-found" } as const;
    if (account.emailVerifiedAt) return { status: "unchanged" } as const;
    await tx.update(schema.userAccounts).set({ emailVerifiedAt: now }).where(eq(schema.userAccounts.id, account.id));
    return { status: "verified" } as const;
  });
}
