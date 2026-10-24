import { and, asc, count, eq } from "drizzle-orm";
import {
  SELF_REGISTRATION_CLUB_MAX, SELF_REGISTRATION_NAME_MAX, selfRegistrationInfoResponseSchema, selfRegistrationRequestSchema,
  selfRegistrationResponseSchema, type SelfRegistrationInfoResponse, type SelfRegistrationResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  courseVariantForReadout, normalizeSelfRegistrationName, PARTY_DISPLAY_NAME_MAX, partyDisplayName, selfRegistrationDay, withProposedEntryVariants
} from "@o-tid/domain";
import { consumeAccountRequestAllowance } from "./account-throttle";
import { lockRaceForMutation } from "./concurrency";
import { canAddClassEntry } from "./class-capacity-guard";
import { latestResultReadAt, latestUnresolvedReadout } from "./readout-registration";
import { evaluateAndStore, normalizedReadout } from "./result-revisions";
import { bumpReadoutPackageVersion, loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

/**
 * PLAN.md steg 41: självregistrering på tävlingsdagen, utan inloggning. Öppen när admin slagit på "Tillåt självregistrering
 * på tävlingsdagen", tävlingen är publicerad (och inte dold) och det är tävlingsdagen i tävlingens tidszon (en fest till kl 06
 * dagen efter). Inget skrivs över: en bricka som redan hör till en gäst eller deltagare avvisas.
 *
 * - Fest: gästen får sitt namn på brickan (samma tabell som bardisken), också när brickan redan lästs ut utan namn. Bardisken
 *   hämtar festens läge var femte sekund och känner då igen brickan.
 * - Andra typer: ny deltagare i vald klass med brickan, som direktanmälan i avläsningen (steg 25). En okänd avläsning av
 *   brickan bedöms direkt.
 * - Spärr per IP (hashad) och per tävling. Auditposten har källan "publik självregistrering" men aldrig IP-adressen.
 */
export const SELF_REGISTRATIONS_PER_IP = 20;
export const SELF_REGISTRATION_IP_WINDOW_MS = 10 * 60 * 1000;
export const SELF_REGISTRATIONS_PER_RACE_AND_DAY = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SELF_REGISTRATION_SOURCE = "PUBLIC_SELF_REGISTRATION";

type Field = "cardNumber" | "givenName" | "familyName" | "club" | "classId" | "displayName";
export type SelfRegistrationResult =
  | { status: "not-found" | "closed" | "card-taken" | "class-full" | "rate-limited" }
  | { status: "invalid-request"; fields?: Field[] }
  | { status: "ok"; response: SelfRegistrationResponse };

interface RaceFacts { id: string; raceType: string; raceDate: string; timeZone: string; selfRegistration: boolean }

/** Tävlingen när den syns publikt (publicerad och inte dold), annars undefined. */
async function publicRace(tx: DbExecutor, raceId: string): Promise<RaceFacts | undefined> {
  const [race] = await tx.select({ id: schema.races.id, raceType: schema.races.raceType, raceDate: schema.races.raceDate,
    timeZone: schema.events.timeZone, selfRegistration: schema.races.selfRegistration, publishedAt: schema.races.publishedAt,
    hidden: schema.races.hiddenBySuperadmin }).from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .where(eq(schema.races.id, raceId));
  if (!race || race.hidden || !race.publishedAt) return undefined;
  return race;
}

function isOpen(race: RaceFacts, now: Date): boolean {
  return race.selfRegistration && race.raceType !== "RELAY" &&
    selfRegistrationDay({ raceDate: race.raceDate, timeZone: race.timeZone, party: race.raceType === "PARTY", now });
}

/** Klubbnamn ur tävlingens löpardatabas (förslag i klubbfältet). Bara namnen, som är offentliga. */
async function clubSuggestions(tx: DbExecutor, raceId: string): Promise<string[]> {
  const [link] = await tx.select({ organisationId: schema.raceEventorLinks.organisationId }).from(schema.raceEventorLinks)
    .where(eq(schema.raceEventorLinks.raceId, raceId));
  if (!link?.organisationId) return [];
  const [database] = await tx.select({ id: schema.runnerDatabases.id }).from(schema.runnerDatabases)
    .where(eq(schema.runnerDatabases.eventorOrganisationId, link.organisationId));
  if (!database) return [];
  const rows = await tx.select({ name: schema.runnerDatabaseClubs.name }).from(schema.runnerDatabaseClubs)
    .where(and(eq(schema.runnerDatabaseClubs.runnerDatabaseId, database.id), eq(schema.runnerDatabaseClubs.type, "CLUB")))
    .orderBy(asc(schema.runnerDatabaseClubs.name)).limit(2000);
  return [...new Set(rows.map(row => row.name).filter(name => name.length >= 1 && name.length <= 200))];
}

/** Om formuläret ska visas, och klasserna att välja bland. Undefined när tävlingen inte syns publikt. */
export async function readSelfRegistrationInfo(db: Database, raceId: string, now = new Date()): Promise<SelfRegistrationInfoResponse | undefined> {
  if (!uuid.test(raceId)) return undefined;
  return db.transaction(async tx => {
    const race = await publicRace(tx, raceId);
    if (!race) return undefined;
    const kind = race.raceType === "PARTY" ? "PARTY" as const : "RACE" as const;
    if (!isOpen(race, now)) return selfRegistrationInfoResponseSchema.parse({ formatVersion: 1, open: false, kind, classes: [], clubs: [] });
    const classes = kind === "PARTY" ? [] : await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
      .where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(1000);
    return selfRegistrationInfoResponseSchema.parse({ formatVersion: 1, open: true, kind, classes, clubs: await clubSuggestions(tx, raceId) });
  }, { isolationLevel: "repeatable read" });
}

/** Registrerar brickan. `clientKey` är klientens adress; den sparas bara som hash i spärren. */
export async function selfRegisterCard(db: Database, input: { raceId: string; clientKey: string; request: unknown }, now = new Date()):
  Promise<SelfRegistrationResult> {
  if (!uuid.test(input.raceId)) return { status: "not-found" };
  const parsed = selfRegistrationRequestSchema.safeParse(input.request);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path[0]).filter((key): key is Field =>
      key === "cardNumber" || key === "givenName" || key === "familyName" || key === "club" || key === "classId" ||
      key === "displayName"))];
    return { status: "invalid-request", ...(fields.length ? { fields } : {}) };
  }
  const intent = parsed.data;
  return db.transaction(async tx => {
    const race = await publicRace(tx, input.raceId);
    if (!race) return { status: "not-found" as const };
    if (!isOpen(race, now)) return { status: "closed" as const };
    const ipAllowed = await consumeAccountRequestAllowance(tx, { scope: "SELF_REGISTRATION_IP", key: input.clientKey,
      limit: SELF_REGISTRATIONS_PER_IP, windowMs: SELF_REGISTRATION_IP_WINDOW_MS }, now);
    const raceAllowed = ipAllowed && await consumeAccountRequestAllowance(tx, { scope: "SELF_REGISTRATION_RACE", key: race.id,
      limit: SELF_REGISTRATIONS_PER_RACE_AND_DAY, windowMs: DAY_MS }, now);
    if (!ipAllowed || !raceAllowed) return { status: "rate-limited" as const };

    const party = race.raceType === "PARTY";
    const givenName = normalizeSelfRegistrationName(intent.givenName, SELF_REGISTRATION_NAME_MAX);
    const familyName = normalizeSelfRegistrationName(intent.familyName, SELF_REGISTRATION_NAME_MAX);
    const clubText = intent.club?.trim() ? normalizeSelfRegistrationName(intent.club, SELF_REGISTRATION_CLUB_MAX) : null;
    const fields: Field[] = [];
    if (!givenName) fields.push("givenName");
    if (!familyName) fields.push("familyName");
    if (clubText === undefined) fields.push("club");
    if (!party && !intent.classId) fields.push("classId");
    // Fest: visningsnamnet (smeknamn) är det enda som visas publikt. Tomt = förnamn + efternamnets första bokstav.
    const displayName = party && intent.displayName?.trim() ? normalizeSelfRegistrationName(intent.displayName, PARTY_DISPLAY_NAME_MAX) : null;
    if (displayName === undefined) fields.push("displayName");
    if (fields.length) return { status: "invalid-request" as const, fields };
    const name = `${givenName!} ${familyName!}`;
    const cardNumber = String(Number(intent.cardNumber));
    // Fälla mot robotar: ett ifyllt dolt fält ger samma kvitto som en lyckad registrering, men inget sparas.
    if (intent.website?.trim()) return { status: "ok" as const, response: selfRegistrationResponseSchema.parse({ formatVersion: 1, cardNumber, name }) };

    await lockRaceForMutation(tx, race.id);
    const [assigned] = await tx.select({ id: schema.cardAssignments.id }).from(schema.cardAssignments)
      .where(and(eq(schema.cardAssignments.raceId, race.id), eq(schema.cardAssignments.cardNumber, cardNumber),
        eq(schema.cardAssignments.active, true))).limit(1);
    if (assigned) return { status: "card-taken" as const };

    if (party) {
      const [guest] = await tx.select({ name: schema.partyGuests.name }).from(schema.partyGuests)
        .where(and(eq(schema.partyGuests.raceId, race.id), eq(schema.partyGuests.cardNumber, cardNumber)));
      if (guest) return { status: "card-taken" as const };
      await tx.insert(schema.partyGuests).values({ raceId: race.id, cardNumber, name, club: clubText, displayName, updatedAt: now,
        selfRegisteredAt: now });
      await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "party", entityId: race.id, actorKind: null, actorId: null,
        action: "PARTY_GUEST_SELF_REGISTERED", before: null,
        after: { source: SELF_REGISTRATION_SOURCE, cardNumber, name, club: clubText, displayName }, createdAt: now });
      return { status: "ok" as const, response: selfRegistrationResponseSchema.parse({ formatVersion: 1, cardNumber, name,
        displayName: partyDisplayName({ name, displayName: displayName ?? undefined }) }) };
    }

    const [raceClass] = await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
      .where(and(eq(schema.classes.id, intent.classId!), eq(schema.classes.raceId, race.id)));
    if (!raceClass) return { status: "invalid-request" as const, fields: ["classId" as const] };
    if (!await canAddClassEntry(tx, race.id, raceClass.id)) return { status: "class-full" as const };
    const [total] = await tx.select({ value: count() }).from(schema.entries).where(eq(schema.entries.raceId, race.id));
    if (!total || total.value >= 10_000) return { status: "class-full" as const };
    const [entry] = await tx.insert(schema.entries).values({ raceId: race.id, classId: raceClass.id, givenName: givenName!, familyName: familyName!,
      organisationName: clubText, version: 1, selfRegisteredAt: now }).returning({ id: schema.entries.id });
    if (!entry) throw new Error("Deltagaren kunde inte sparas");
    await tx.insert(schema.cardAssignments).values({ raceId: race.id, entryId: entry.id, cardNumber });
    await bumpReadoutPackageVersion(tx, race.id);

    // Har servern redan brickans avläsning som okänd bedöms den nu (som direktanmälan i avläsningen).
    let linkedRevision: number | null = null;
    const readout = await latestUnresolvedReadout(tx, race.id, cardNumber);
    if (readout && await latestResultReadAt(tx, entry.id) === null) {
      let snapshot = await loadRaceSnapshot(tx, race.id);
      const normalized = normalizedReadout(readout);
      const detected = courseVariantForReadout(normalized, snapshot);
      if (detected && !detected.assigned) {
        await tx.update(schema.entries).set({ courseVariantCode: detected.code }).where(eq(schema.entries.id, entry.id));
        snapshot = withProposedEntryVariants(snapshot, new Map([[entry.id, detected.code]]));
      }
      const stored = await evaluateAndStore(tx, snapshot, normalized, "UNKNOWN_READOUT_RESOLUTION", { entryId: entry.id });
      if (stored.stored) linkedRevision = stored.revision.revision;
    }
    await tx.insert(schema.auditEvents).values({ raceId: race.id, entityType: "entry", entityId: entry.id, actorKind: null, actorId: null,
      action: "ENTRY_SELF_REGISTERED", before: null,
      after: { source: SELF_REGISTRATION_SOURCE, cardNumber, classId: raceClass.id, givenName, familyName, organisationName: clubText,
        linkedRevision }, createdAt: now });
    return { status: "ok" as const, response: selfRegistrationResponseSchema.parse({ formatVersion: 1, cardNumber, name, className: raceClass.name }) };
  });
}
