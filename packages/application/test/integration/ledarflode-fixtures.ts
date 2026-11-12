import { randomUUID } from "node:crypto";
import { afterAll, beforeAll } from "vitest";
import { createDatabase, migrate, schema, type Database } from "@o-tid/database";
import { createClub } from "../../src/clubs";
import { insertEventWithRace } from "../../src/organizer-events";
import { registerTestAccount } from "./accounts";

/**
 * Gemensamt för ledarflödets integrationstester (2026-11-12): en egen databas per fil, medlemmar i en klubbyta och en klubbyta
 * kopplad till klubbens organisation i Eventor (som efter "Koppla till Eventor").
 */
export function ledarDatabase(prefix: string) {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
  if (!/^[a-z_]+$/.test(prefix)) throw new Error("Ogiltigt prefix");
  const admin = createDatabase(base);
  const databaseName = `otid_${prefix}_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(base);
  url.pathname = `/${databaseName}`;
  const created = createDatabase(url.href);
  beforeAll(async () => {
    await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(created.db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  }, 60_000);
  afterAll(async () => {
    await created.pool.end();
    if (!new RegExp(`^otid_${prefix}_[a-f0-9]{32}$`).test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
    await admin.pool.query(`DROP DATABASE "${databaseName}"`);
    await admin.pool.end();
  });
  return created.db;
}

export type TestAccount = Awaited<ReturnType<typeof registerTestAccount>>;

export function clubHelpers(db: Database, now: Date) {
  async function member(clubId: string, role: "ADMIN" | "LEADER" | "READER", addedBy: string) {
    const account = await registerTestAccount(db, undefined, now);
    await db.insert(schema.clubMembers).values({ id: randomUUID(), clubId, accountId: account.accountId, role, addedAt: now, addedBy,
      requestId: randomUUID() });
    return account;
  }

  async function linkedClub(name = "OK Ledarflöde") {
    const owner = await registerTestAccount(db, undefined, now);
    const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name } }, now);
    if (created.status !== "created") throw new Error(created.status);
    const clubId = created.club.clubId;
    const organisationId = randomUUID();
    await db.insert(schema.organisations).values({ id: organisationId, eventorId: `e${randomUUID().slice(0, 8)}`, name: `${name} (Eventor)`,
      type: "CLUB", searchText: name.toLowerCase(), updatedAt: now });
    await db.insert(schema.clubSettings).values({ clubId, organisationId, eventorKeyId: "k", eventorKeyIv: "iv", eventorKeyTag: "tag",
      eventorKeyCiphertext: "chiffer", eventorKeyHint: "1234", linkedBy: owner.accountId, linkedAt: now, updatedBy: owner.accountId, updatedAt: now });
    return { owner, clubId, organisationId };
  }

  /** En träning (eller tävling) med ägaren och arrangörsklubben, utan klasser och banor. */
  async function organisedRace(input: { ownerId: string; organisationId: string | null; raceDate: string; raceType?: "TRAINING" | "STANDARD";
    name?: string }) {
    const created = await db.transaction(tx => insertEventWithRace(tx, { eventName: input.name ?? "Tisdagsträning", raceName: "",
      raceDate: input.raceDate, timeZone: "Europe/Stockholm", raceType: input.raceType ?? "TRAINING", firstStartTime: null, trainingGroupId: null,
      ownerAccountId: input.ownerId, now }));
    if (input.organisationId) {
      await db.insert(schema.raceOrganisers).values({ raceId: created.race.id, organisationId: input.organisationId, setBy: input.ownerId, setAt: now })
        .onConflictDoUpdate({ target: schema.raceOrganisers.raceId, set: { organisationId: input.organisationId } });
    }
    return created.race.id;
  }

  return { member, linkedClub, organisedRace };
}
