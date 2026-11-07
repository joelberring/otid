import { randomBytes, randomUUID } from "node:crypto";
import { acceptOnLogin } from "./account-arrival";
import { and, eq, isNull } from "drizzle-orm";
import { emailVerificationCheckRequestSchema, emailVerificationRequestSchema, organizerAccountRegistrationRequestSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { consumeAccountRequestAllowance, DEFAULT_REGISTRATIONS_PER_HOUR } from "./account-throttle";
import { sha256Hex as sha256 } from "./serialization";
import type { DbExecutor } from "./snapshot";
import {
  appendUserAccountPasswordVerifier, clearUserAccountLoginThrottle, currentUserAccountVerifier, issueUserAccountSession,
  revokeAllUserAccountSessions, scryptVerifier, type UserAccountLoginResult, type UserAccountRuntimeOptions
} from "./user-account";

/**
 * Bekräftad e-post (ADR-0186). Behörigheter som andra delar ut med e-postadressen (administratör, funktionär, banläggning,
 * gruppledare och gruppmedlem) gäller först när kontots adress är bekräftad (`user_account.email_verified_at`). Ägarskapet
 * för tävlingar kontot självt skapar gäller alltid. Befintliga konton räknades som bekräftade (migration 0040).
 *
 * Med e-post inställd (`OTID_SMTP_URL`) ger registreringen samma svar oavsett om adressen redan har ett konto, och arbetet
 * görs efter svaret: ett nytt konto skapas obekräftat och får en länk; ett obekräftat konto får en ny länk; ett bekräftat
 * konto får ett mejl om att det redan finns. ADR-0205: länken bevisar att personen har adressen; på sidan väljer personen
 * lösenordet (samma som vid registreringen eller ett nytt), och först då är adressen bekräftad och kontot inloggat. Den som
 * registrerar någon annans adress kan alltså inte få kontot: lösenordet från registreringen gäller inte efter bekräftelsen.
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

/**
 * Ny bekräftelselänk. Bara hashen av nyckeln sparas. Lösenordets verifierare sparas med länken som förut (kolumnerna är
 * NOT NULL), men används inte längre vid bekräftelsen (ADR-0205).
 */
async function createVerificationToken(tx: DbExecutor, accountId: string, verifier: { saltHex: string; verifierHex: string }, now: Date,
  displayName: string | null = null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS);
  await tx.insert(schema.emailVerificationTokens).values({ accountId, tokenHash: sha256(token), saltHex: verifier.saltHex,
    verifierHex: verifier.verifierHex, createdAt: now, expiresAt, displayName });
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
    } else if (existing && existing.displayName !== displayName) {
      // Ett obekräftat konto: den senaste registreringen gäller, så att mejlet inte hälsar med namnet någon annan skrev in
      // för adressen (städrundan 2026-11-07). Länken minns sitt namn, så den som öppnar en äldre länk får sitt eget namn.
      // `created_at` skyddas av databasen (kontots identitet) och står kvar.
      await tx.update(schema.userAccounts).set({ displayName }).where(eq(schema.userAccounts.id, accountId));
    }
    const { token, expiresAt } = await createVerificationToken(tx, accountId, verifier, now, displayName);
    return { status: "accepted", delivery: { kind: "VERIFY", email, displayName, token, expiresAt } } as const;
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

/** Nyckelns rad och kontot bakom den (låsta), eller undefined. */
async function tokenAndAccount(tx: DbExecutor, token: string) {
  const [row] = await tx.select().from(schema.emailVerificationTokens)
    .where(eq(schema.emailVerificationTokens.tokenHash, sha256(token))).for("update");
  if (!row) return undefined;
  const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, row.accountId)).for("update");
  return account ? { row, account } : undefined;
}

/**
 * ADR-0205: vad länken leder till, innan personen skriver något. `valid` = välj lösenord; `already-verified` = adressen är
 * redan bekräftad (logga in); `invalid` = okänd, gammal eller använd länk till ett obekräftat konto, eller spärrat konto
 * (välj nytt lösenord via "Glömt lösenordet", som också bekräftar adressen). Bara den som har länken får veta något.
 */
export type EmailVerificationState = "valid" | "already-verified" | "invalid";

function stateOf(found: Awaited<ReturnType<typeof tokenAndAccount>>, now: Date): EmailVerificationState {
  if (!found || found.account.blockedAt) return "invalid";
  if (found.account.emailVerifiedAt) return "already-verified";
  return found.row.usedAt || found.row.expiresAt.getTime() <= now.getTime() ? "invalid" : "valid";
}

export async function checkEmailVerificationToken(db: Database, request: unknown, now = new Date())
  : Promise<{ status: "invalid-request" } | { status: "checked"; state: EmailVerificationState }> {
  const parsed = emailVerificationCheckRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => ({ status: "checked", state: stateOf(await tokenAndAccount(tx, parsed.data.token), now) }) as const);
}

/**
 * Länken öppnad och lösenordet valt (ADR-0205, ändrar ADR-0186): länken bevisar att personen har adressen, och kontot får
 * lösenordet som personen skriver nu (samma som vid registreringen eller ett nytt). Så gäller aldrig ett lösenord som någon
 * annan valde vid registreringen. Adressen blir bekräftad, alla kontots bekräftelselänkar förbrukas, andra sessioner spärras,
 * inloggningsspärren nollställs, öppna inbjudningar tas och kontot loggas in.
 */
export async function verifyEmailAndLogIn(db: Database, request: unknown, options: UserAccountRuntimeOptions = {})
  : Promise<{ status: "invalid-request" | "invalid-token" | "already-verified" } | Extract<UserAccountLoginResult, { status: "authenticated" }>> {
  const parsed = emailVerificationRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  const now = options.now ?? new Date();
  return db.transaction(async tx => {
    const found = await tokenAndAccount(tx, parsed.data.token);
    const state = stateOf(found, now);
    if (state !== "valid" || !found) return { status: state === "already-verified" ? "already-verified" : "invalid-token" } as const;
    const { account } = found;
    const current = await currentUserAccountVerifier(tx, account.id);
    if (!current) return { status: "invalid-token" } as const;
    const version = await appendUserAccountPasswordVerifier(tx, { accountId: account.id, password: parsed.data.password,
      previousVersion: current.version }, now, options.saltBytes);
    await revokeAllUserAccountSessions(tx, account.id, now, "EMAIL_VERIFIED");
    // Namnet från registreringen som skapade just den här länken (inte från någon annans registrering av adressen).
    const [verified] = await tx.update(schema.userAccounts).set({ emailVerifiedAt: now, lastLoginAt: now,
      ...(found.row.displayName ? { displayName: found.row.displayName } : {}) })
      .where(eq(schema.userAccounts.id, account.id)).returning();
    await consumeEmailVerificationTokens(tx, account.id, now);
    await clearUserAccountLoginThrottle(tx, account.email, now, options.clientKey);
    // ADR-0188 beslut 6: behörigheter sparade för adressen gäller när den är bekräftad.
    await acceptOnLogin(tx, account.id, now);
    return issueUserAccountSession(tx, verified!, version, now, options);
  });
}

/** Förbrukar kontots öppna bekräftelselänkar (bekräftelse, återställning, Google). */
export async function consumeEmailVerificationTokens(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  await tx.update(schema.emailVerificationTokens).set({ usedAt: now })
    .where(and(eq(schema.emailVerificationTokens.accountId, accountId), isNull(schema.emailVerificationTokens.usedAt)));
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
