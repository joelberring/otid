import { createHmac, hkdfSync, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { CLUB_AREA_DEFAULTS, derivedClubRole } from "@o-tid/domain";
import { normalizeMemberEmail } from "@o-tid/eventor";
import { clubJournal } from "./club-invitations";
import { eventorConfigurationFromEnvironment, type EventorServerConfiguration } from "./eventor-secret";
import type { DbExecutor } from "./snapshot";

/**
 * ADR-0209 beslut 3: vad en bekräftad tillhörighet ger i klubbarkivet. Egen fil utan inloggningen, så att `club-access.ts`
 * kan fråga här (som `club-invitations.ts`).
 */
const memberships = schema.accountClubMemberships;

/** Klubbarkivets koppling och "Vem ser vad" (utan rad: inte kopplad, förvalen). */
export async function clubLinkFacts(tx: DbExecutor, clubId: string) {
  const [setting] = await tx.select({ organisationId: schema.clubSettings.organisationId, archive: schema.clubSettings.archiveVisibility,
    mapBank: schema.clubSettings.mapBankAccess }).from(schema.clubSettings).where(eq(schema.clubSettings.clubId, clubId));
  return { clubId, organisationId: setting?.organisationId ?? null,
    access: { ARCHIVE: setting?.archive ?? CLUB_AREA_DEFAULTS.ARCHIVE, MAP_BANK: setting?.mapBank ?? CLUB_AREA_DEFAULTS.MAP_BANK } };
}

/**
 * Läsare genom en bekräftad tillhörighet (beslut 3). Kräver bekräftad e-postadress och ett konto som inte är spärrat, som
 * behörigheter från andra (ADR-0186). Används av `clubMembership`, så att allt i arkivet följer samma regel.
 */
export async function derivedClubMembership(tx: DbExecutor, accountId: string, clubId: string): Promise<{ id: string; role: "READER" } | undefined> {
  const rows = await tx.select({ id: memberships.id, status: memberships.status, clubId: memberships.clubId, organisationId: memberships.organisationId })
    .from(memberships).where(and(eq(memberships.accountId, accountId), eq(memberships.clubId, clubId), eq(memberships.status, "CONFIRMED")));
  if (rows.length === 0) return undefined;
  if (!derivedClubRole(rows, await clubLinkFacts(tx, clubId))) return undefined;
  const [account] = await tx.select({ verifiedAt: schema.userAccounts.emailVerifiedAt, blockedAt: schema.userAccounts.blockedAt })
    .from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  if (!account?.verifiedAt || account.blockedAt) return undefined;
  return { id: rows[0]!.id, role: "READER" };
}

/** Klubbarkiven där kontot är bekräftad medlem (med läsarrätt), för Mina klubbar i Mina tävlingar. */
export async function derivedClubIds(tx: DbExecutor, accountId: string): Promise<string[]> {
  const rows = await tx.select({ clubId: memberships.clubId }).from(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.status, "CONFIRMED"), isNotNull(memberships.clubId)));
  const result: string[] = [];
  for (const clubId of new Set(rows.map(row => row.clubId!))) if (await derivedClubMembership(tx, accountId, clubId)) result.push(clubId);
  return result;
}

/**
 * Klubbarkiven där kontot räknas som medlem i klubben för "Från klubben": en bekräftad tillhörighet (i ett arkiv som fortfarande
 * är kopplat till samma klubb) eller ett uttryckligt medlemskap i arkivet.
 */
export async function clubsOfMember(tx: DbExecutor, accountId: string): Promise<string[]> {
  const explicit = await tx.select({ clubId: schema.clubMembers.clubId }).from(schema.clubMembers).where(eq(schema.clubMembers.accountId, accountId));
  const confirmed = await tx.select({ clubId: memberships.clubId, organisationId: memberships.organisationId }).from(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.status, "CONFIRMED"), isNotNull(memberships.clubId)));
  const result = new Set(explicit.map(row => row.clubId));
  for (const row of confirmed) {
    const link = await clubLinkFacts(tx, row.clubId!);
    if (row.organisationId === null || row.organisationId === link.organisationId) result.add(row.clubId!);
  }
  return [...result];
}


/** Lägger till arkiven som kontot läser som bekräftad medlem (utan uttryckligt medlemskap) i Mina klubbar, i namnordning. */
export async function withDerivedClubs(tx: DbExecutor, accountId: string,
  rows: { clubId: string; name: string; role: "OWNER" | "ADMIN" | "LEADER" | "READER"; addedBy: string }[]): Promise<void> {
  const known = new Set(rows.map(row => row.clubId));
  const extra = (await derivedClubIds(tx, accountId)).filter(clubId => !known.has(clubId));
  if (extra.length === 0) return;
  const clubs = await tx.select({ clubId: schema.clubs.id, name: schema.clubs.name }).from(schema.clubs).where(inArray(schema.clubs.id, extra));
  rows.push(...clubs.map(club => ({ ...club, role: "READER" as const, addedBy: accountId })));
  rows.sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

// --- Bekräftad via Eventor (ADR-0209 beslut B) ---------------------------------------------------------------------------------

export type Configured = Extract<EventorServerConfiguration, { status: "ok" }>;

export function configured(configuration?: EventorServerConfiguration): Configured | undefined {
  const value = configuration ?? eventorConfigurationFromEnvironment(process.env);
  return value.status === "ok" ? value : undefined;
}

/** Nyckeln för e-posthasharna, härledd ur masternyckeln (eget syfte, så att den aldrig är krypteringsnyckeln). */
function hmacKey(configuration: Configured): Buffer {
  return Buffer.from(hkdfSync("sha256", configuration.masterKey, Buffer.alloc(0), "o-tid:club-member-email-hmac:1", 32));
}

export function memberEmailHash(configuration: Configured, email: string): string {
  return createHmac("sha256", hmacKey(configuration)).update(email, "utf8").digest("hex");
}

/** Bekräftar kontot i arkivet via Eventor: en ny rad, eller en egen väntande anmälan. En avböjd eller bekräftad ändras inte. */
export async function confirmViaEventor(tx: DbExecutor, input: { accountId: string; clubId: string; organisationId: string; now: Date }): Promise<boolean> {
  const [row] = await tx.select().from(memberships)
    .where(and(eq(memberships.accountId, input.accountId), eq(memberships.organisationId, input.organisationId))).for("update");
  if (row && row.status !== "PENDING") return false;
  const values = { status: "CONFIRMED" as const, clubId: input.clubId, confirmedVia: "EVENTOR" as const, decidedBy: null, decidedAt: input.now };
  let id: string;
  if (row) {
    await tx.update(memberships).set(values).where(eq(memberships.id, row.id));
    id = row.id;
  } else {
    id = randomUUID();
    await tx.insert(memberships).values({ id, accountId: input.accountId, organisationId: input.organisationId, freeText: null, origin: "EVENTOR",
      createdAt: input.now, ...values });
  }
  await clubJournal(tx, { clubId: input.clubId, action: "CLUB_AFFILIATION_CONFIRMED", actorAccountId: null,
    details: { membershipId: id, accountId: input.accountId, via: "EVENTOR" }, now: input.now });
  return true;
}

/**
 * Kontot mot klubbarnas medlemslistor (efter inloggning, bekräftad adress, när Mina tävlingar eller klubben öppnas). Bara
 * bekräftade adresser. Ger antalet nya bekräftelser.
 */
export async function applyEventorMemberships(tx: DbExecutor, accountId: string, now: Date, clubId?: string): Promise<number> {
  const config = configured();
  if (!config) return 0;
  const [account] = await tx.select({ email: schema.userAccounts.email, verifiedAt: schema.userAccounts.emailVerifiedAt,
    blockedAt: schema.userAccounts.blockedAt }).from(schema.userAccounts).where(eq(schema.userAccounts.id, accountId));
  if (!account?.verifiedAt || account.blockedAt) return 0;
  const email = normalizeMemberEmail(account.email);
  if (!email) return 0;
  const matches = await tx.select({ clubId: schema.clubEventorMembers.clubId, organisationId: schema.clubSettings.organisationId })
    .from(schema.clubEventorMembers).innerJoin(schema.clubSettings, eq(schema.clubSettings.clubId, schema.clubEventorMembers.clubId))
    .where(and(eq(schema.clubEventorMembers.emailHmac, memberEmailHash(config, email)), eq(schema.clubEventorMembers.keyId, config.keyId),
      isNotNull(schema.clubSettings.organisationId), clubId ? eq(schema.clubEventorMembers.clubId, clubId) : undefined));
  let confirmed = 0;
  for (const match of matches) {
    if (await confirmViaEventor(tx, { accountId, clubId: match.clubId, organisationId: match.organisationId!, now })) confirmed += 1;
  }
  return confirmed;
}

