import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { normalizeAccountEmail } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { consumeEmailVerificationTokens } from "./email-verification";
import type { GoogleIdentity } from "./google-oidc";
import { acceptRacePersonInvitations } from "./race-person-invitations";
import {
  appendUserAccountPasswordVerifier, currentUserAccountVerifier, issueUserAccountSession, revokeAllUserAccountSessions,
  type UserAccountLoginResult, type UserAccountRuntimeOptions
} from "./user-account";

/**
 * Inloggning med Google (ADR-0205 beslut 5), efter att ID-token har kontrollerats (`exchangeGoogleCode`).
 *
 * - Adressen godtas bara med `email_verified`.
 * - Ett konto som redan är kopplat till Google-kontot (`sub`) loggas in.
 * - Annars kopplas ett konto med samma adress och adressen blir bekräftad. Var kontot obekräftat byts lösenordet mot ett
 *   slumpat och dess sessioner spärras, så att ett lösenord som någon annan valde vid registreringen aldrig gäller för en
 *   bekräftad adress (samma skydd som ADR-0186). Ett bekräftat konto behåller sitt lösenord.
 * - Utan konto skapas ett med Googles namn, bekräftad adress och ett slumpat lösenord som ingen känner till (sessionerna
 *   hör till lösenordets version som vid vanlig inloggning). Ett eget lösenord väljs med "Glömt lösenordet".
 * - Ett spärrat konto förblir spärrat. Öppna inbjudningar tas som vid inloggning med lösenord.
 */
export type GoogleSignInResult =
  | { status: "email-not-verified" | "invalid-identity" | "blocked" }
  | (Extract<UserAccountLoginResult, { status: "authenticated" }> & { created: boolean });

const SUB = /^[A-Za-z0-9_-]{1,255}$/;

/** Visningsnamnet: Googles namn, annars adressens första del (1–120 tecken, som registreringen). */
export function googleDisplayName(identity: Pick<GoogleIdentity, "name">, email: string): string {
  const name = (identity.name ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  return (name || email.slice(0, email.indexOf("@")) || "Google-konto").slice(0, 120).trim();
}

/** Ett lösenord som ingen känner till: tidigare lösenord och sessioner slutar gälla. */
async function rotateToRandomPassword(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  const current = await currentUserAccountVerifier(tx, accountId);
  await appendUserAccountPasswordVerifier(tx, { accountId, password: randomBytes(32).toString("base64url"),
    previousVersion: current?.version ?? 0 }, now);
  await revokeAllUserAccountSessions(tx, accountId, now, "GOOGLE_LINKED");
}

export async function signInWithGoogle(db: Database, identity: GoogleIdentity, options: UserAccountRuntimeOptions = {})
  : Promise<GoogleSignInResult> {
  if (!identity.emailVerified) return { status: "email-not-verified" };
  const email = normalizeAccountEmail(identity.email);
  if (!email || !SUB.test(identity.sub)) return { status: "invalid-identity" };
  const now = options.now ?? new Date();
  return db.transaction(async tx => {
    const identities = schema.userAccountGoogleIdentities;
    const [link] = await tx.select().from(identities).where(eq(identities.googleSub, identity.sub)).for("update");
    let [account] = link
      ? await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.id, link.accountId)).for("update")
      : await tx.select().from(schema.userAccounts).where(eq(schema.userAccounts.email, email)).for("update");
    if (account?.blockedAt) return { status: "blocked" } as const;
    let created = false;
    if (!account) {
      [account] = await tx.insert(schema.userAccounts).values({ id: options.accountId ?? randomUUID(), email,
        displayName: googleDisplayName(identity, email), createdAt: now, emailVerifiedAt: now }).returning();
      await rotateToRandomPassword(tx, account!.id, now);
      created = true;
    } else if (!account.emailVerifiedAt && account.email === email) {
      await rotateToRandomPassword(tx, account.id, now);
      [account] = await tx.update(schema.userAccounts).set({ emailVerifiedAt: now })
        .where(eq(schema.userAccounts.id, account.id)).returning();
      await consumeEmailVerificationTokens(tx, account!.id, now);
    }
    const accountId = account!.id;
    if (link) {
      await tx.update(identities).set({ lastLoginAt: now }).where(eq(identities.accountId, accountId));
    } else {
      // Ett konto har en koppling: ett nytt Google-konto med samma bekräftade adress ersätter den gamla.
      await tx.insert(identities).values({ accountId, googleSub: identity.sub, linkedAt: now, lastLoginAt: now })
        .onConflictDoUpdate({ target: identities.accountId, set: { googleSub: identity.sub, linkedAt: now, lastLoginAt: now } });
    }
    const [loggedIn] = await tx.update(schema.userAccounts).set({ lastLoginAt: now })
      .where(eq(schema.userAccounts.id, accountId)).returning();
    // ADR-0188 beslut 6: behörigheter sparade för adressen gäller när personen loggar in med en bekräftad adress.
    await acceptRacePersonInvitations(tx, accountId, now);
    const verifier = await currentUserAccountVerifier(tx, accountId);
    if (!verifier) throw new Error("Kontot saknar lösenordsversion");
    return { ...await issueUserAccountSession(tx, loggedIn!, verifier.version, now, options), created };
  });
}
