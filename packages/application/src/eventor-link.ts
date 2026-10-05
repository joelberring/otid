import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  eventorEventChoiceRequestSchema, eventorEventChoiceResponseSchema, eventorEventsResponseSchema, eventorKeyRequestSchema,
  eventorSettingsResponseSchema, eventorTestResponseSchema, type EventorConnectionOutcome, type EventorEventChoiceResponse,
  type EventorEventsResponse, type EventorSettingsResponse, type EventorTestResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { EventorAdapterError, eventorClient, type EventorClient } from "@o-tid/eventor";
import { EventorSecretError, openEventorApiKey, sealEventorApiKey, type EventorServerConfiguration } from "./eventor-secret";
import {
  authenticatePairingAdminSession, authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication
} from "./pairing-admin";

/**
 * Tävlingens Eventor-koppling (ADR-0170 beslut 4): administratören klistrar in klubbens
 * API-nyckel, testar anslutningen och väljer tävlingen i Eventor. Nyckeln sparas bara
 * krypterad och lämnar aldrig servern. Eventor anropas utanför databastransaktioner.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" };
const capability = "MANAGE_RACE" as const;

/** Driftens inställningar och (i tester) en egen fetch. */
export interface EventorRuntime {
  readonly configuration: EventorServerConfiguration;
  readonly fetch?: typeof fetch;
}

type Link = typeof schema.raceEventorLinks.$inferSelect;

async function loadLink(tx: Transaction | Database, raceId: string): Promise<Link | undefined> {
  const [link] = await tx.select().from(schema.raceEventorLinks).where(eq(schema.raceEventorLinks.raceId, raceId));
  return link;
}

function keyState(link: Link | undefined, runtime: EventorRuntime): EventorSettingsResponse["key"] {
  if (!link?.ciphertext) return "NONE";
  return runtime.configuration.status === "ok" && link.keyId === runtime.configuration.keyId ? "SAVED" : "UNREADABLE";
}

async function settings(tx: Transaction | Database, raceId: string, runtime: EventorRuntime): Promise<EventorSettingsResponse> {
  const link = await loadLink(tx, raceId);
  const [applied] = await tx.select({ appliedAt: schema.sourceSnapshots.appliedAt }).from(schema.sourceSnapshots)
    .where(and(eq(schema.sourceSnapshots.raceId, raceId), eq(schema.sourceSnapshots.source, "EVENTOR"), isNotNull(schema.sourceSnapshots.appliedAt)))
    .orderBy(desc(schema.sourceSnapshots.appliedAt)).limit(1);
  return eventorSettingsResponseSchema.parse({ formatVersion: 1, raceId,
    server: runtime.configuration.status === "ok" ? "OK" : runtime.configuration.status === "invalid" ? "INVALID" : "MISSING",
    key: keyState(link, runtime),
    organisation: link?.organisationId ? { id: link.organisationId, name: link.organisationName } : null,
    event: link?.eventId ? { id: link.eventId, name: link.eventName, date: link.eventDate, form: link.eventForm } : null,
    lastAppliedAt: applied?.appliedAt?.toISOString() ?? null });
}

/** Klienten med tävlingens nyckel, eller varför den inte finns. */
export function clientForLink(link: Link | undefined, raceId: string, runtime: EventorRuntime)
  : { outcome: "OK"; client: EventorClient } | { outcome: Exclude<EventorConnectionOutcome, "CONNECTED" | "REJECTED" | "UNAVAILABLE"> } {
  const configuration = runtime.configuration;
  if (configuration.status !== "ok") return { outcome: "NOT_CONFIGURED" };
  if (!link?.ciphertext || !link.iv || !link.tag || !link.keyId) return { outcome: "NO_KEY" };
  let apiKey: string;
  try {
    apiKey = openEventorApiKey({ keyId: link.keyId, iv: link.iv, tag: link.tag, ciphertext: link.ciphertext },
      { raceId, keyId: configuration.keyId }, configuration.masterKey);
  } catch (error) {
    if (error instanceof EventorSecretError) return { outcome: "KEY_UNREADABLE" };
    throw error;
  }
  return { outcome: "OK", client: eventorClient({ apiKey, ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
    ...(runtime.fetch ? { fetch: runtime.fetch } : {}) }) };
}

/** Eventors fel som läge i vyn. Andra fel (programfel) kastas vidare. */
export function upstreamOutcome(error: unknown): "REJECTED" | "UNAVAILABLE" | "NOT_FOUND" {
  if (!(error instanceof EventorAdapterError)) throw error;
  return error.code === "REJECTED" ? "REJECTED" : error.code === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE";
}

async function authorized(db: Database, input: Authentication, write: boolean, now: Date) {
  return authenticatePairingAdminSession(db, { ...input, capability, requireCsrf: write }, now);
}

/** Skriver i en transaktion efter ny kontroll av administratören. */
async function mutate<T>(db: Database, input: Authentication, now: Date, action: string, write: (tx: Transaction, actorId: string) => Promise<T>)
  : Promise<Failure | { status: "ok"; value: T }> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const value = await write(tx, auth.principal.accessCredentialId);
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "race", entityId: input.raceId, action,
      actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, createdAt: now });
    return { status: "ok" as const, value };
  });
}

async function upsertLink(tx: Transaction, raceId: string, values: Partial<Omit<Link, "raceId">>, now: Date) {
  await tx.insert(schema.raceEventorLinks).values({ raceId, ...values, updatedAt: now })
    .onConflictDoUpdate({ target: schema.raceEventorLinks.raceId, set: { ...values, updatedAt: now } });
}

export async function getEventorSettingsAsAdministrator(db: Database, input: Authentication, runtime: EventorRuntime, now = new Date())
  : Promise<Failure | { status: "ok"; response: EventorSettingsResponse }> {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    return { status: "ok" as const, response: await settings(tx, input.raceId, runtime) };
  });
}

/** Testar anslutningen och sparar klubben som nyckeln tillhör. */
async function test(db: Database, input: Authentication, runtime: EventorRuntime, now: Date): Promise<Failure | { status: "ok"; response: EventorTestResponse }> {
  const client = clientForLink(await loadLink(db, input.raceId), input.raceId, runtime);
  let outcome: EventorConnectionOutcome = client.outcome === "OK" ? "CONNECTED" : client.outcome;
  let organisation: { id: string; name: string } | undefined;
  if (client.outcome === "OK") {
    try { organisation = await client.client.organisation(); }
    catch (error) { const upstream = upstreamOutcome(error); outcome = upstream === "NOT_FOUND" ? "UNAVAILABLE" : upstream; }
  }
  const saved = await mutate(db, input, now, outcome === "CONNECTED" ? "EVENTOR_CONNECTION_TESTED" : "EVENTOR_CONNECTION_FAILED", async tx => {
    if (organisation) await upsertLink(tx, input.raceId, { organisationId: organisation.id, organisationName: organisation.name }, now);
    return settings(tx, input.raceId, runtime);
  });
  if (saved.status !== "ok") return saved;
  return { status: "ok", response: eventorTestResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, outcome, settings: saved.value }) };
}

export async function testEventorConnectionAsAdministrator(db: Database, input: Authentication, runtime: EventorRuntime, now = new Date()) {
  const auth = await authorized(db, input, true, now);
  if (auth.status !== "authenticated") return auth;
  return test(db, input, runtime, now);
}

/** Sparar (eller ersätter) klubbens nyckel krypterad och testar den direkt. */
export async function saveEventorKeyAsAdministrator(db: Database, input: Authentication & { request: unknown }, runtime: EventorRuntime,
  now = new Date()): Promise<Failure | { status: "not-configured" } | { status: "ok"; response: EventorTestResponse }> {
  const parsed = eventorKeyRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const auth = await authorized(db, input, true, now);
  if (auth.status !== "authenticated") return auth;
  const configuration = runtime.configuration;
  if (configuration.status !== "ok") return { status: "not-configured" };
  const envelope = sealEventorApiKey(parsed.data.apiKey, { raceId: input.raceId, keyId: configuration.keyId }, configuration.masterKey);
  const saved = await mutate(db, input, now, "EVENTOR_KEY_SAVED", tx => upsertLink(tx, input.raceId,
    { ...envelope, organisationId: null, organisationName: null }, now));
  if (saved.status !== "ok") return saved;
  return test(db, input, runtime, now);
}

export async function removeEventorKeyAsAdministrator(db: Database, input: Authentication, runtime: EventorRuntime, now = new Date())
  : Promise<Failure | { status: "ok"; response: EventorSettingsResponse }> {
  const saved = await mutate(db, input, now, "EVENTOR_KEY_REMOVED", async tx => {
    await upsertLink(tx, input.raceId, { keyId: null, iv: null, tag: null, ciphertext: null, organisationId: null, organisationName: null }, now);
    return settings(tx, input.raceId, runtime);
  });
  return saved.status === "ok" ? { status: "ok", response: saved.value } : saved;
}

const day = 86_400_000;

/** Klubbens tävlingar från en månad bakåt till ett år framåt, närmast först. */
export async function listEventorEventsAsAdministrator(db: Database, input: Authentication, runtime: EventorRuntime, now = new Date())
  : Promise<Failure | { status: "ok"; response: EventorEventsResponse }> {
  const auth = await authorized(db, input, false, now);
  if (auth.status !== "authenticated") return auth;
  const link = await loadLink(db, input.raceId);
  const client = clientForLink(link, input.raceId, runtime);
  const reply = (outcome: EventorConnectionOutcome, events: EventorEventsResponse["events"] = []) =>
    ({ status: "ok" as const, response: eventorEventsResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, outcome, events }) });
  if (client.outcome !== "OK") return reply(client.outcome);
  try {
    const organisation = link?.organisationId ?? (await client.client.organisation()).id;
    const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
    const events = await client.client.events({ organisationId: organisation, fromDate: iso(now.getTime() - 30 * day), toDate: iso(now.getTime() + 365 * day) });
    return reply("CONNECTED", [...events].sort((left, right) => left.date.localeCompare(right.date))
      .map(event => ({ id: event.id, name: event.name, date: event.date, form: event.form })));
  } catch (error) {
    const outcome = upstreamOutcome(error);
    return reply(outcome === "NOT_FOUND" ? "UNAVAILABLE" : outcome);
  }
}

/** Väljer tävlingen i Eventor (ur listan eller med inklistrat id). Tävlingen hämtas för att visa namn och datum. */
export async function chooseEventorEventAsAdministrator(db: Database, input: Authentication & { request: unknown }, runtime: EventorRuntime,
  now = new Date()): Promise<Failure | { status: "ok"; response: EventorEventChoiceResponse }> {
  const parsed = eventorEventChoiceRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const auth = await authorized(db, input, true, now);
  if (auth.status !== "authenticated") return auth;
  const client = clientForLink(await loadLink(db, input.raceId), input.raceId, runtime);
  const reply = async (outcome: EventorEventChoiceResponse["outcome"]) => {
    const current = await settings(db, input.raceId, runtime);
    return { status: "ok" as const, response: eventorEventChoiceResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, outcome, settings: current }) };
  };
  if (client.outcome !== "OK") return reply(client.outcome);
  let event;
  try { event = await client.client.event(parsed.data.eventId); }
  catch (error) { return reply(upstreamOutcome(error)); }
  const saved = await mutate(db, input, now, "EVENTOR_EVENT_CHOSEN", async tx => {
    await upsertLink(tx, input.raceId, { eventId: event.id, eventName: event.name, eventDate: event.date, eventForm: event.form }, now);
    return settings(tx, input.raceId, runtime);
  });
  if (saved.status !== "ok") return saved;
  return { status: "ok", response: eventorEventChoiceResponseSchema.parse({ formatVersion: 1, raceId: input.raceId, outcome: "CONNECTED",
    settings: saved.value }) };
}
