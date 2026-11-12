import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createClub } from "../../src/clubs";
import { createClubTerm, createPlanSessions } from "../../src/club-planning";
import { createTrainingGroup, setRaceGroup } from "../../src/training-groups";
import { createGroupSessions } from "../../src/training-group-sessions";
import { insertEventWithRace } from "../../src/organizer-events";
import { registerTestAccount } from "./accounts";

/**
 * Användartestet av ledarflödet 2026-11-12 (klubbyta → klubbarkiv → terminsplan → träning → arkivet) mot PostgreSQL.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_ledarflode_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-12T12:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_ledarflode_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function member(clubId: string, role: "ADMIN" | "LEADER" | "READER", addedBy: string) {
  const account = await registerTestAccount(db, undefined, NOW);
  await db.insert(schema.clubMembers).values({ id: randomUUID(), clubId, accountId: account.accountId, role, addedAt: NOW, addedBy,
    requestId: randomUUID() });
  return account;
}

/** En klubbyta kopplad till klubbens organisation i Eventor (som efter "Koppla till Eventor"). */
async function linkedClub(name = "OK Ledarflöde") {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name } }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const clubId = created.club.clubId;
  const organisationId = randomUUID();
  await db.insert(schema.organisations).values({ id: organisationId, eventorId: `e${randomUUID().slice(0, 8)}`, name: `${name} (Eventor)`,
    type: "CLUB", searchText: name.toLowerCase(), updatedAt: NOW });
  await db.insert(schema.clubSettings).values({ clubId, organisationId, eventorKeyId: "k", eventorKeyIv: "iv", eventorKeyTag: "tag",
    eventorKeyCiphertext: "chiffer", eventorKeyHint: "1234", linkedBy: owner.accountId, linkedAt: NOW, updatedBy: owner.accountId, updatedAt: NOW });
  return { owner, clubId, organisationId };
}

const organiserOf = async (raceId: string) => (await db.select({ id: schema.raceOrganisers.organisationId }).from(schema.raceOrganisers)
  .where(eq(schema.raceOrganisers.raceId, raceId)))[0]?.id;

describe("A: träningen hör till klubben", () => {
  it("en grupp som hör till en klubb ger sina nya tillfällen och tillagda tävlingar klubben som arrangörsklubb", async () => {
    const { owner, clubId, organisationId } = await linkedClub();
    const leader = await member(clubId, "LEADER", owner.accountId);
    const group = await createTrainingGroup(db, { ...leader.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Ungdom",
      code: `ungdom-${randomUUID().slice(0, 8)}` } }, NOW);
    if (group.status !== "created") throw new Error(group.status);
    const groupId = group.group.groupId;
    const sessionRequest = (requestId: string) => ({ formatVersion: 1, requestId, source: "PREVIOUS", sourceRaceId: null, eventName: "Tisdagsträning",
      raceDate: "2026-11-17", startTime: "18:00", mapId: null, includeCourseSetting: false, publish: false, repeat: null, acknowledgeAgreement: false });

    // Utan koppling till klubben: ingen arrangörsklubb.
    const loose = await createGroupSessions(db, { ...leader.proof, groupId, request: sessionRequest(randomUUID()) }, NOW);
    if (loose.status !== "created") throw new Error(loose.status);
    expect(await organiserOf(loose.raceIds[0]!)).toBeUndefined();

    // Gruppen står på en rad i klubbens terminsplan: den hör till klubben.
    const term = await createClubTerm(db, { ...leader.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), name: "HT 2026",
      startsOn: "2026-08-01", endsOn: "2026-12-31" } }, NOW);
    if (term.status !== "ok") throw new Error(term.status);
    expect((await createPlanSessions(db, { ...leader.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), termId: term.termId,
      sessionDate: "2026-11-24", startTime: null, title: "Gruppträning", place: "", note: "", clubMapId: null, trainingGroupId: groupId,
      responsibleAccountId: null, weekly: false } }, NOW)).status).toBe("ok");
    const created = await createGroupSessions(db, { ...leader.proof, groupId, request: sessionRequest(randomUUID()) }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(await organiserOf(created.raceIds[0]!)).toBe(organisationId);

    // En egen tävling utan arrangörsklubb som läggs i gruppen får klubben; ett val som redan gjorts står kvar.
    const own = await db.transaction(tx => insertEventWithRace(tx, { eventName: "Egen", raceName: "", raceDate: "2026-11-20", timeZone: "Europe/Stockholm",
      raceType: "TRAINING", firstStartTime: null, trainingGroupId: null, ownerAccountId: leader.accountId, now: NOW }));
    expect(await setRaceGroup(db, { ...leader.proof, raceId: own.race.id, request: { formatVersion: 1, groupId } }, NOW))
      .toEqual({ status: "ok", groupId });
    expect(await organiserOf(own.race.id)).toBe(organisationId);
  });
});
