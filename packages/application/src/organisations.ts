import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ORGANISATION_SEARCH_MAX, type OrganisationSearchResponse, type OrganisationSummary } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { clubSearchRank, clubSearchText, clubSearchTokens } from "@o-tid/domain";
import { eventorClient, parseEventorOrganisations, type EventorOrganisationSummary } from "@o-tid/eventor";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForProtectedRead, type UserAccountSessionProof } from "./user-account";

/**
 * ADR-0209 beslut 1: klubblistan. Eventors organisationer (`GET /api/organisations` med klubbens nyckel i headern `ApiKey`)
 * sparas i `organisation` och uppdateras med ett serverkommando, högst en gång per dygn från Eventor (Eventors villkor), eller
 * ur en fil. En organisation som inte längre finns i listan märks som borttagen men står kvar (tillhörigheter pekar på den).
 */
export const ORGANISATION_REFRESH_INTERVAL_MS = 24 * 3_600_000;
const BATCH = 500;

type Row = typeof schema.organisations.$inferSelect;

export interface OrganisationRefreshReport { organisations: number; added: number; changed: number; removed: number }
export type OrganisationRefreshResult =
  | { status: "done"; report: OrganisationRefreshReport }
  | { status: "too-soon"; lastAt: Date; nextAt: Date }
  | { status: "empty" };

export const organisationSummary = (row: Pick<Row, "id" | "name" | "shortName" | "type">): OrganisationSummary =>
  ({ organisationId: row.id, name: row.name, shortName: row.shortName, type: row.type });

function same(row: Row, next: EventorOrganisationSummary, searchText: string): boolean {
  return row.name === next.name && row.shortName === (next.shortName ?? null) && row.type === next.type &&
    row.parentEventorId === (next.parentId ?? null) && row.country === (next.country ?? null) && row.searchText === searchText &&
    row.removedAt === null;
}

/**
 * Lägger in listan: nya läggs till, ändrade skrivs om, och (bara när `complete`) de som saknas märks som borttagna.
 * En lista utan organisationer ändrar ingenting.
 */
export async function storeOrganisations(db: Database, organisations: readonly EventorOrganisationSummary[],
  input: { source: "EVENTOR" | "FILE"; complete: boolean; startedAt: Date; now?: Date }): Promise<OrganisationRefreshResult> {
  if (organisations.length === 0) return { status: "empty" };
  const now = input.now ?? new Date();
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('organisation-refresh', 0))`);
    const existing = new Map((await tx.select().from(schema.organisations)).map(row => [row.eventorId, row]));
    let added = 0, changed = 0;
    const upserts: (typeof schema.organisations.$inferInsert)[] = [];
    for (const organisation of organisations) {
      const searchText = clubSearchText(organisation.name, organisation.shortName);
      const prior = existing.get(organisation.id);
      if (prior && same(prior, organisation, searchText)) continue;
      if (prior) changed += 1; else added += 1;
      upserts.push({ id: prior?.id ?? randomUUID(), eventorId: organisation.id, name: organisation.name.slice(0, 200),
        shortName: organisation.shortName?.slice(0, 200) ?? null, type: organisation.type, parentEventorId: organisation.parentId ?? null,
        country: organisation.country ?? null, searchText, removedAt: null, updatedAt: now });
    }
    for (let at = 0; at < upserts.length; at += BATCH) {
      await tx.insert(schema.organisations).values(upserts.slice(at, at + BATCH)).onConflictDoUpdate({ target: schema.organisations.eventorId,
        set: { name: sql`excluded.name`, shortName: sql`excluded.short_name`, type: sql`excluded.type`,
          parentEventorId: sql`excluded.parent_eventor_id`, country: sql`excluded.country`, searchText: sql`excluded.search_text`,
          removedAt: sql`null`, updatedAt: sql`excluded.updated_at` } });
    }
    let removed = 0;
    if (input.complete) {
      const present = new Set(organisations.map(organisation => organisation.id));
      const gone = [...existing.values()].filter(row => !present.has(row.eventorId) && row.removedAt === null).map(row => row.id);
      for (let at = 0; at < gone.length; at += BATCH) {
        await tx.update(schema.organisations).set({ removedAt: now, updatedAt: now }).where(inArray(schema.organisations.id, gone.slice(at, at + BATCH)));
      }
      removed = gone.length;
    }
    const report = { organisations: organisations.length, added, changed, removed };
    await tx.insert(schema.organisationRefreshes).values({ id: randomUUID(), source: input.source, startedAt: input.startedAt, finishedAt: now, ...report });
    return { status: "done", report } as const;
  });
}

/** Senaste lyckade hämtningen från Eventor. */
async function lastEventorRefresh(tx: DbExecutor): Promise<Date | undefined> {
  const [row] = await tx.select({ finishedAt: schema.organisationRefreshes.finishedAt }).from(schema.organisationRefreshes)
    .where(eq(schema.organisationRefreshes.source, "EVENTOR")).orderBy(desc(schema.organisationRefreshes.finishedAt)).limit(1);
  return row?.finishedAt;
}

/**
 * `clubs refresh`: hämtar listan från Eventor, högst en gång per dygn (`force` bara när driften uttryckligen vill). Nyckeln
 * skickas bara i headern och loggas aldrig; felen är adapterns koder.
 */
export async function refreshOrganisationsFromEventor(db: Database, input: { apiKey: string; baseUrl?: string | undefined;
  fetch?: typeof fetch; force?: boolean; now?: Date }): Promise<OrganisationRefreshResult> {
  const startedAt = input.now ?? new Date();
  const last = await lastEventorRefresh(db);
  if (last && !input.force && startedAt.getTime() - last.getTime() < ORGANISATION_REFRESH_INTERVAL_MS) {
    return { status: "too-soon", lastAt: last, nextAt: new Date(last.getTime() + ORGANISATION_REFRESH_INTERVAL_MS) };
  }
  const client = eventorClient({ apiKey: input.apiKey, ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}), ...(input.fetch ? { fetch: input.fetch } : {}) });
  const organisations = await client.organisations();
  return storeOrganisations(db, organisations, { source: "EVENTOR", complete: true, startedAt, ...(input.now ? { now: input.now } : {}) });
}

/** `clubs import <fil.xml>`: samma lista ur en fil (t.ex. hämtad på en annan dator). Märker inte saknade som borttagna. */
export async function importOrganisationsFromXml(db: Database, xml: string, now = new Date()): Promise<OrganisationRefreshResult> {
  const organisations = await parseEventorOrganisations(xml);
  return storeOrganisations(db, organisations, { source: "FILE", complete: false, startedAt: now, now });
}

/** Sökning i listan utan inloggning (ren databasfråga): alla ord ska finnas, utan accenter och skiljetecken. */
export async function searchOrganisations(tx: DbExecutor, query: string, options: { types?: readonly Row["type"][]; limit?: number } = {})
  : Promise<OrganisationSummary[]> {
  const tokens = clubSearchTokens(query);
  if (tokens.length === 0) return [];
  const types = options.types ?? ["CLUB"];
  const rows = await tx.select().from(schema.organisations).where(and(isNull(schema.organisations.removedAt),
    inArray(schema.organisations.type, [...types]),
    // Orden är normaliserade (bara bokstäver och siffror), så de behöver inte skyddas i LIKE.
    ...tokens.map(token => sql`${schema.organisations.searchText} like ${`%${token}%`}`))).limit(500);
  const limit = Math.min(options.limit ?? ORGANISATION_SEARCH_MAX, ORGANISATION_SEARCH_MAX);
  return rows.map(row => ({ row, rank: clubSearchRank(row.searchText, query) }))
    .sort((a, b) => a.rank - b.rank || a.row.name.localeCompare(b.row.name, "sv"))
    .slice(0, limit).map(({ row }) => organisationSummary(row));
}

export async function organisationById(tx: DbExecutor, organisationId: string): Promise<Row | undefined> {
  const [row] = await tx.select().from(schema.organisations).where(eq(schema.organisations.id, organisationId));
  return row;
}

/** Klubblistan för inloggade (registreringens steg, Mina klubbar, arrangörsklubben och klubbarkivets koppling). */
export async function searchOrganisationsForAccount(db: Database, proof: UserAccountSessionProof, query: string, now = new Date())
  : Promise<{ status: "unauthorized" } | { status: "ok"; response: OrganisationSearchResponse }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return { status: "unauthorized" } as const;
    const organisations = await searchOrganisations(tx, query.slice(0, 120));
    const directoryEmpty = organisations.length === 0
      && (await tx.select({ id: schema.organisations.id }).from(schema.organisations).limit(1)).length === 0;
    return { status: "ok", response: { formatVersion: 1, organisations, directoryEmpty } } as const;
  });
}
