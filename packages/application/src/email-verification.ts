import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { acceptOnLogin } from "./account-arrival";
import { logAction, SERVER_COMMAND_ACTOR } from "./superadmin-log";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { emailVerificationCheckRequestSchema, emailVerificationRequestSchema, organizerAccountRegistrationRequestSchema } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { consumeAccountRequestAllowance, DEFAULT_REGISTRATIONS_PER_HOUR } from "./account-throttle";
import { sha256Hex as sha256 } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { normalizeAccountEmail } from "@o-tid/contracts";
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
 * ADR-0205 tillägg 2026-11-12 ("två gånger räcker"): registreringen sätter en HttpOnly-kaka med en slumpad hemlighet
 * (`browserSecret`), och länken minns hemlighetens sha256 och registreringens verifierare. Öppnas länken inom en timme i samma
 * webbläsare (kakan) bekräftas adressen med lösenordet från registreringsformuläret, utan att det skrivs igen. Både länken
 * (adressen) och kakan (webbläsaren som skrev lösenordet) krävs, och bindningen gäller bara registreringen som skapade just den
 * länken. Utan kakan väljer personen lösenord som förut, så den som registrerat någon annans adress får fortfarande inte kontot.
 *
 * Utan e-post loggar registreringen in direkt som förut (ADR-0172), men kontot är obekräftat tills superadmin bekräftar det
 * (`node superadmin.mjs verify <e-post>`) eller lösenordet byts med en återställningslänk.
 */
export const EMAIL_VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
/**
 * Hur länge registreringens kaka bekräftar länken utan nytt lösenord (tillägg 2026-11-12). Kort, så att en lånad dator där
 * någon annan registrerat adressen inte står öppen länge; efter en timme väljer man lösenord som förut.
 */
export const REGISTRATION_BROWSER_LIFETIME_MS = 60 * 60 * 1000;
const BROWSER_SECRET = /^[A-Za-z0-9_-]{43}$/;
/** Hemligheten i registreringens kaka: 32 slumpade byte (base64url). Bara dess sha256 sparas. */
export function newRegistrationBrowserSecret(): string {
  return randomBytes(32).toString("base64url");
}

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

interface RegistrationBinding { browserSecretHash: string; saltHex: string; verifierHex: string }

/**
 * Ny bekräftelselänk. Bara hashen av nyckeln sparas. Registreringens verifierare sparas bara med en bindning till webbläsaren
 * (tillägg 2026-11-12, migration 0115); utan den är kolumnerna tomma som sedan 0087.
 */
async function createVerificationToken(tx: DbExecutor, accountId: string, now: Date,
  displayName: string | null = null, binding?: RegistrationBinding): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_LIFETIME_MS);
  await tx.insert(schema.emailVerificationTokens).values({ accountId, tokenHash: sha256(token), createdAt: now, expiresAt, displayName,
    ...(binding ?? {}) });
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
  /** Hemligheten i kakan som registreringens svar satte (tillägg 2026-11-12); utan den väljs lösenordet vid länken. */
  browserSecret?: string;
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
  const binding = options.browserSecret && BROWSER_SECRET.test(options.browserSecret)
    ? { browserSecretHash: sha256(options.browserSecret), ...verifier } : undefined;
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
    // Länken minns den här registreringens lösenord bara med webbläsarens hemlighet, inte kontots (som kan vara någon annans).
    const { token, expiresAt } = await createVerificationToken(tx, accountId, now, displayName, binding);
    return { status: "accepted", delivery: { kind: "VERIFY", email, displayName, token, expiresAt } } as const;
  });
}

/**
 * Inloggning på ett obekräftat konto med rätt lösenord när e-post är inställd: ingen inloggning (samma svar som fel lösenord,
 * se `loginUserAccount`), men en ny länk skickas, så att ett konto från före e-posten kan bekräftas.
 */
export async function verificationForUnverifiedLogin(tx: DbExecutor, account: { id: string; email: string; displayName: string },
  now: Date): Promise<EmailVerificationDelivery | undefined> {
  if (!await verificationMailAllowed(tx, account.email, now)) return undefined;
  const { token, expiresAt } = await createVerificationToken(tx, account.id, now);
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

/**
 * Tillägg 2026-11-12: registreringens verifierare om länken öppnas i webbläsaren som registrerade (kakans hemlighet stämmer med
 * just den här länken) inom en timme från registreringen, annars undefined.
 */
function registrationVerifier(row: typeof schema.emailVerificationTokens.$inferSelect, browserSecret: string | undefined, now: Date)
  : { saltHex: string; verifierHex: string } | undefined {
  if (!browserSecret || !BROWSER_SECRET.test(browserSecret) || !row.browserSecretHash || !row.saltHex || !row.verifierHex) return undefined;
  if (now.getTime() >= row.createdAt.getTime() + REGISTRATION_BROWSER_LIFETIME_MS) return undefined;
  const same = timingSafeEqual(Buffer.from(sha256(browserSecret), "hex"), Buffer.from(row.browserSecretHash, "hex"));
  return same ? { saltHex: row.saltHex, verifierHex: row.verifierHex } : undefined;
}

export interface EmailVerificationOptions { now?: Date; browserSecret?: string }

export async function checkEmailVerificationToken(db: Database, request: unknown, options: EmailVerificationOptions = {})
  : Promise<{ status: "invalid-request" } | { status: "checked"; state: EmailVerificationState; sameBrowser?: true }> {
  const parsed = emailVerificationCheckRequestSchema.safeParse(request);
  if (!parsed.success) return { status: "invalid-request" };
  const now = options.now ?? new Date();
  return db.transaction(async tx => {
    const found = await tokenAndAccount(tx, parsed.data.token);
    const state = stateOf(found, now);
    const sameBrowser = state === "valid" && found && registrationVerifier(found.row, options.browserSecret, now) !== undefined;
    return { status: "checked", state, ...(sameBrowser ? { sameBrowser: true } : {}) } as const;
  });
}

/** Registreringens verifierare blir kontots lösenord (en ny version, om den inte redan är den senaste). */
async function useRegistrationVerifier(tx: DbExecutor, accountId: string, current: { version: number; saltHex: string; verifierHex: string },
  verifier: { saltHex: string; verifierHex: string }, now: Date): Promise<number> {
  if (current.saltHex === verifier.saltHex && current.verifierHex === verifier.verifierHex) return current.version;
  if (current.version >= 2_147_483_647) throw new Error("Verifierarversionen är full");
  const version = current.version + 1;
  await tx.insert(schema.userAccountPasswordVerifiers).values({ accountId, version, algorithm: "scrypt-v1", ...verifier, createdAt: now });
  return version;
}

/**
 * Länken öppnad och lösenordet valt (ADR-0205, ändrar ADR-0186): länken bevisar att personen har adressen, och kontot får
 * lösenordet som personen skriver nu (samma som vid registreringen eller ett nytt). Så gäller aldrig ett lösenord som någon
 * annan valde vid registreringen. Adressen blir bekräftad, alla kontots bekräftelselänkar förbrukas, andra sessioner spärras,
 * inloggningsspärren nollställs, öppna inbjudningar tas och kontot loggas in.
 *
 * Tillägg 2026-11-12: utan lösenord i begäran gäller registreringens lösenord, men bara om kakans hemlighet hör till just den
 * här länken (`registrationVerifier`); annars `password-required` och sidan ber om lösenordet som förut.
 */
export async function verifyEmailAndLogIn(db: Database, request: unknown,
  options: UserAccountRuntimeOptions & Pick<EmailVerificationOptions, "browserSecret"> = {})
  : Promise<{ status: "invalid-request" | "invalid-token" | "already-verified" | "password-required" }
    | Extract<UserAccountLoginResult, { status: "authenticated" }>> {
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
    let version: number;
    if (parsed.data.password !== undefined) {
      version = await appendUserAccountPasswordVerifier(tx, { accountId: account.id, password: parsed.data.password,
        previousVersion: current.version }, now, options.saltBytes);
    } else {
      const registered = registrationVerifier(found.row, options.browserSecret, now);
      if (!registered) return { status: "password-required" } as const;
      version = await useRegistrationVerifier(tx, account.id, current, registered, now);
    }
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

/**
 * Förbrukar kontots öppna bekräftelselänkar (bekräftelse, återställning, Google, superadmin) och tömmer registreringarnas kopior
 * av verifieraren och webbläsarens hemlighet (tillägg 2026-11-12), som inte behövs efter bekräftelsen.
 */
export async function consumeEmailVerificationTokens(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  await tx.update(schema.emailVerificationTokens).set({ usedAt: now })
    .where(and(eq(schema.emailVerificationTokens.accountId, accountId), isNull(schema.emailVerificationTokens.usedAt)));
  await tx.update(schema.emailVerificationTokens).set({ browserSecretHash: null, saltHex: null, verifierHex: null })
    .where(and(eq(schema.emailVerificationTokens.accountId, accountId), isNotNull(schema.emailVerificationTokens.verifierHex)));
}

/**
 * Superadmin bekräftar adressen: i appen (`VERIFY_EMAIL` i superadmin.ts) eller med kommandot på servern. Lösenordet ändras
 * inte; kontots bekräftelselänkar förbrukas (de visar sedan "redan bekräftad"). Anroparen har låst kontot.
 */
export async function markAccountEmailVerified(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  await tx.update(schema.userAccounts).set({ emailVerifiedAt: now }).where(eq(schema.userAccounts.id, accountId));
  await consumeEmailVerificationTokens(tx, accountId, now);
}

/**
 * `node superadmin.mjs verify <e-post>`, t.ex. utan e-post på servern. Loggas i superadmins logg som "Serverkommando"
 * (tillägg 2026-11-12), som `grant` och `revoke`.
 */
export async function markEmailVerifiedByCommand(db: Database, email: string, now = new Date())
  : Promise<{ status: "not-found" | "unchanged" | "verified" }> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return { status: "not-found" };
  return db.transaction(async tx => {
    const [account] = await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, normalized)).for("update");
    if (!account) return { status: "not-found" } as const;
    if (account.emailVerifiedAt) return { status: "unchanged" } as const;
    await markAccountEmailVerified(tx, account.id, now);
    await logAction(tx, { actorAccountId: null, actorLabel: SERVER_COMMAND_ACTOR, action: "VERIFY_EMAIL", targetType: "ACCOUNT",
      targetId: account.id, targetLabel: account.email, reason: "Bekräftad med serverkommando" }, now);
    return { status: "verified" } as const;
  });
}
