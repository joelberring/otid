import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { ingestDeviceBatch } from "../../src/ingest";
import { autoArchiveFinishedRaces } from "../../src/race-club-archive-auto";
import {
  liftRaceToClubArchive, readRaceClubArchiveAsAdmin, removeRaceFromClubArchive, setRaceClubArchiveAutoAsAdmin
} from "../../src/race-club-archive";
import { contentHash } from "../../src";
import { registerTestAccount } from "./accounts";
import { statusFlow } from "./entry-status-helpers";
import { clubHelpers, ledarDatabase } from "./ledarflode-fixtures";
import { importIofXml } from "./production-paths";

/**
 * Ägaren 2026-11-12 (docs/plan-ledarflode-2026-11-12.md, G (i)): en träning som hör till en klubb läggs i klubbens arkiv
 * automatiskt när den är genomförd – förval, urkryssad, sista avläsningen och sista beslutet, underhållsvarvet dagen efter,
 * dubbelkörning, NO_ADMIN, Ta ur gör inte om, och rutans behörighet.
 */
const db = ledarDatabase("arkivering");
/** Tjänsternas klocka: avläsningen och besluten använder den riktiga tiden, så "framtida" träningar blir klara bara genom resultaten. */
const NOW = new Date();
const { member, linkedClub, organisedRace } = clubHelpers(db, NOW);
const flow = statusFlow(db);
const day = (offset: number, from = NOW) => new Date(from.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const iof = (name: string) => readFile(new URL(`../../../../fixtures/iof/${name}`, import.meta.url), "utf8");

const lifts = (raceId: string) => db.select().from(schema.raceClubArchives).where(eq(schema.raceClubArchives.raceId, raceId));
const autoRow = async (raceId: string) => (await db.select().from(schema.raceClubArchiveAutos).where(eq(schema.raceClubArchiveAutos.raceId, raceId)))[0];
const auth = (proof: { sessionToken: string; csrfCookie: string; csrfHeader: string }, raceId: string) => ({ ...proof, raceId });

async function viewOf(proof: { sessionToken: string; csrfCookie: string; csrfHeader: string }, raceId: string) {
  const result = await readRaceClubArchiveAsAdmin(db, auth(proof, raceId), NOW);
  if (result.status !== "ok") throw new Error(result.status);
  return result.view;
}

/** Banorna och de två anmälda ur IOF-fixturerna (brickorna 12345 och 67890). */
async function withEntries(raceId: string) {
  await importIofXml(db, raceId, await iof("course-data.xml"));
  await importIofXml(db, raceId, await iof("entry-list.xml"));
}

function readout(cardNumber: string, deviceId = randomUUID()) {
  const payload = { cardNumber, startPunchedAt: "2026-08-30T10:00:00Z", finishPunchedAt: "2026-08-30T10:40:00Z",
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z` })) };
  return { deviceId, sessionId: deviceId, packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
    stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator" as const, payload, contentHash: contentHash(payload) }] };
}

describe("G (i): förvalet och rutan", () => {
  it("på för en Träning med klubbyta, av för en Tävling, inget utan klubbyta; rutan sparas med en auditpost", async () => {
    const { owner, organisationId } = await linkedClub("OK Förval");
    const training = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: day(-1) });
    const competition = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: day(-1), raceType: "STANDARD" });
    expect((await viewOf(owner.proof, training)).auto).toEqual({ enabled: true, explicit: false, archivedAt: null, problem: null });
    expect((await viewOf(owner.proof, competition)).auto).toMatchObject({ enabled: false, explicit: false });
    // En organisation utan klubbyta: ingen ruta.
    const loose = randomUUID();
    await db.insert(schema.organisations).values({ id: loose, eventorId: `e${randomUUID().slice(0, 8)}`, name: "Klubb utan yta", type: "CLUB",
      searchText: "klubb utan yta", updatedAt: NOW });
    const elsewhere = await organisedRace({ ownerId: owner.accountId, organisationId: loose, raceDate: day(-1) });
    expect((await viewOf(owner.proof, elsewhere)).auto).toBeNull();

    const unchecked = await setRaceClubArchiveAutoAsAdmin(db, { ...auth(owner.proof, training), request: { formatVersion: 1, enabled: false } }, NOW);
    if (unchecked.status !== "ok") throw new Error(unchecked.status);
    expect(unchecked.view.auto).toMatchObject({ enabled: false, explicit: true });
    const [audit] = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, training),
      eq(schema.auditEvents.action, "RACE_CLUB_ARCHIVE_AUTO_SET")));
    expect(audit?.after).toEqual({ enabled: false });
    // Urkryssad: underhållsvarvet arkiverar den inte; tävlingen (förval av) inte heller.
    await autoArchiveFinishedRaces(db, NOW);
    expect(await lifts(training)).toHaveLength(0);
    expect(await lifts(competition)).toHaveLength(0);
    // Ikryssad för tävlingen: den arkiveras.
    await setRaceClubArchiveAutoAsAdmin(db, { ...auth(owner.proof, competition), request: { formatVersion: 1, enabled: true } }, NOW);
    await autoArchiveFinishedRaces(db, NOW);
    expect(await lifts(competition)).toHaveLength(1);
  });

  it("rutan kräver administratör i tävlingen och i klubbytan; utloggad och fel roll nekas, klubbytan röjs inte", async () => {
    const { owner, clubId, organisationId } = await linkedClub("OK Rutan");
    const raceId = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: day(-1) });
    const request = { formatVersion: 1, enabled: false };
    expect((await setRaceClubArchiveAutoAsAdmin(db, { raceId, sessionToken: "ingen", csrfCookie: "x", csrfHeader: "x", request }, NOW)).status)
      .toBe("unauthorized");
    // Utan behörighet på tävlingen: samma svar som Lägg i klubbarkivet (tävlingens behörighet, ADR-0172).
    const stranger = await registerTestAccount(db, undefined, NOW);
    const strangerLift = await liftRaceToClubArchive(db, { ...auth(stranger.proof, raceId), request: { formatVersion: 1, confirmSecrecy: false } }, NOW);
    expect(["unauthorized", "forbidden"]).toContain(strangerLift.status);
    expect((await setRaceClubArchiveAutoAsAdmin(db, { ...auth(stranger.proof, raceId), request }, NOW)).status).toBe(strangerLift.status);
    // Administratör i tävlingen men ledare i klubbytan: nekas; inte med i klubbytan: samma svar som utan klubbyta.
    const leader = await member(clubId, "LEADER", owner.accountId);
    const [race] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId));
    const outsider = await registerTestAccount(db, undefined, NOW);
    for (const person of [leader, outsider]) {
      await db.insert(schema.eventAdministrationGrants).values({ eventId: race!.eventId, accountId: person.accountId, role: "ADMIN", grantedAt: NOW });
    }
    expect((await setRaceClubArchiveAutoAsAdmin(db, { ...auth(leader.proof, raceId), request }, NOW)).status).toBe("forbidden");
    expect((await setRaceClubArchiveAutoAsAdmin(db, { ...auth(outsider.proof, raceId), request }, NOW)).status).toBe("no-space");
    // Ledaren och den utomstående ser inte rutan (samma villkor som Lägg i klubbarkivet).
    expect((await viewOf(leader.proof, raceId)).auto).toBeNull();
    expect((await viewOf(outsider.proof, raceId)).auto).toBeNull();
    // Behörigheten prövas före kroppen.
    expect((await setRaceClubArchiveAutoAsAdmin(db, { ...auth(leader.proof, raceId), request: { trasig: true } }, NOW)).status).toBe("forbidden");
    expect((await setRaceClubArchiveAutoAsAdmin(db, { ...auth(owner.proof, raceId), request: { trasig: true } }, NOW)).status).toBe("invalid-request");
    expect(await autoRow(raceId)).toBeUndefined();
  });
});

describe("G (i): när träningen blir klar", () => {
  it("den sista avläsningen arkiverar i samma transaktion, en gång", async () => {
    const { owner, clubId, organisationId } = await linkedClub("OK Avläsning");
    // En träning långt fram: klar bara när alla har ett resultat (banorna publika, ADR-0176).
    const raceId = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: "2030-06-04" });
    await withEntries(raceId);
    const ownerAuth = auth(owner.proof, raceId);
    await flow.decide(ownerAuth, await flow.entryId(raceId, "Bo"), { kind: "DID_NOT_START" });
    expect(await lifts(raceId)).toHaveLength(0);
    const batch = readout("12345");
    await ingestDeviceBatch(db, raceId, batch);
    const [lift] = await lifts(raceId);
    expect(lift?.clubId).toBe(clubId);
    expect(lift?.liftedBy).toBe(owner.accountId);
    const [journal] = await db.select().from(schema.clubJournal).where(and(eq(schema.clubJournal.clubId, clubId),
      eq(schema.clubJournal.action, "CLUB_ARCHIVE_RACE_ADDED")));
    expect(journal?.details).toMatchObject({ raceId, automatic: true, beforeFinished: false });
    expect((await autoRow(raceId))?.archivedAt).not.toBeNull();
    // Samma avläsning igen, en ny avläsning och underhållsvarvet: ingen ny arkivpost.
    await ingestDeviceBatch(db, raceId, batch);
    await ingestDeviceBatch(db, raceId, readout("12345"));
    await autoArchiveFinishedRaces(db, new Date(Date.parse("2030-06-05T12:00:00Z")));
    expect(await lifts(raceId)).toHaveLength(1);
    expect(await db.select().from(schema.clubArchiveEntries).where(eq(schema.clubArchiveEntries.clubId, clubId))).toHaveLength(1);
    const view = await viewOf(owner.proof, raceId);
    expect(view.lifted?.entryId).toBe(lift!.entryId);
    expect(view.auto?.archivedAt).not.toBeNull();
  });

  it("det sista beslutet (DNS) arkiverar; utan beslut och avläsning ingenting", async () => {
    const { owner, organisationId } = await linkedClub("OK Beslut");
    const raceId = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: "2030-06-11" });
    await withEntries(raceId);
    await ingestDeviceBatch(db, raceId, readout("12345"));
    expect(await lifts(raceId)).toHaveLength(0);
    const decided = await flow.decide(auth(owner.proof, raceId), await flow.entryId(raceId, "Bo"), { kind: "DID_NOT_START" });
    expect(decided.status).toBe("decided");
    expect(await lifts(raceId)).toHaveLength(1);
  });

  it("underhållsvarvet arkiverar dagen efter när ingen läste ut alla, och bara de senaste två veckorna", async () => {
    const { owner, organisationId } = await linkedClub("OK Dagen efter");
    const at = new Date("2031-03-10T09:00:00Z");
    const yesterday = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: "2031-03-09" });
    const today = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: "2031-03-10" });
    const old = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: "2031-02-01" });
    await withEntries(yesterday);
    const counts = await autoArchiveFinishedRaces(db, at);
    expect(counts.archived).toBeGreaterThanOrEqual(1);
    expect(await lifts(yesterday)).toHaveLength(1);
    expect(await lifts(today)).toHaveLength(0);
    expect(await lifts(old)).toHaveLength(0);
    await autoArchiveFinishedRaces(db, at);
    expect(await lifts(yesterday)).toHaveLength(1);
  });

  it("utan administratör i klubbytan sparas NO_ADMIN och inget skapas; den ansvarige i planen kan vara aktören", async () => {
    const { owner, clubId, organisationId } = await linkedClub("OK Ingen admin");
    const leader = await member(clubId, "LEADER", owner.accountId);
    const at = new Date("2031-04-10T09:00:00Z");
    const raceId = await organisedRace({ ownerId: leader.accountId, organisationId, raceDate: "2031-04-09" });
    await autoArchiveFinishedRaces(db, at);
    expect(await lifts(raceId)).toHaveLength(0);
    expect((await autoRow(raceId))?.problem).toBe("NO_ADMIN");
    expect(await db.select().from(schema.clubArchiveEntries).where(eq(schema.clubArchiveEntries.clubId, clubId))).toHaveLength(0);

    // Klubbytans administratör är planens ansvarige och administratör i träningen: hen blir aktören.
    const clubAdmin = await member(clubId, "ADMIN", owner.accountId);
    const [race] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId));
    await db.insert(schema.eventAdministrationGrants).values({ eventId: race!.eventId, accountId: clubAdmin.accountId, role: "ADMIN", grantedAt: at });
    const termId = randomUUID();
    await db.insert(schema.clubTerms).values({ id: termId, clubId, name: "VT 2031", startsOn: "2031-01-01", endsOn: "2031-06-30", createdAt: at,
      createdBy: owner.accountId, requestId: randomUUID() });
    await db.insert(schema.clubPlanSessions).values({ id: randomUUID(), clubId, termId, sessionDate: "2031-04-09", title: "Träning",
      responsibleAccountId: clubAdmin.accountId, raceId, createdAt: at, createdBy: owner.accountId, updatedAt: at, requestId: randomUUID() });
    expect((await viewOf(clubAdmin.proof, raceId)).auto?.problem).toBe("NO_ADMIN");
    await autoArchiveFinishedRaces(db, at);
    const [lift] = await lifts(raceId);
    expect(lift?.liftedBy).toBe(clubAdmin.accountId);
    expect((await autoRow(raceId))?.problem).toBeNull();
  });

  it("Ta ur gör inte om; Lägg i för hand sätter också spärren", async () => {
    const { owner, organisationId } = await linkedClub("OK Ta ur");
    const at = new Date("2031-05-10T09:00:00Z");
    const automatic = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: "2031-05-09" });
    await autoArchiveFinishedRaces(db, at);
    expect(await lifts(automatic)).toHaveLength(1);
    expect((await removeRaceFromClubArchive(db, auth(owner.proof, automatic), NOW)).status).toBe("ok");
    await autoArchiveFinishedRaces(db, at);
    expect(await lifts(automatic)).toHaveLength(0);
    // Lägg i för hand fungerar som förut.
    const again = await liftRaceToClubArchive(db, { ...auth(owner.proof, automatic), request: { formatVersion: 1, confirmSecrecy: true } }, NOW);
    expect(again.status).toBe("ok");

    // En träning som lades i för hand och togs ur läggs inte dit automatiskt.
    const manual = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: "2031-05-08" });
    await setRaceClubArchiveAutoAsAdmin(db, { ...auth(owner.proof, manual), request: { formatVersion: 1, enabled: false } }, NOW);
    expect((await liftRaceToClubArchive(db, { ...auth(owner.proof, manual), request: { formatVersion: 1, confirmSecrecy: true } }, NOW)).status).toBe("ok");
    await setRaceClubArchiveAutoAsAdmin(db, { ...auth(owner.proof, manual), request: { formatVersion: 1, enabled: true } }, NOW);
    expect((await removeRaceFromClubArchive(db, auth(owner.proof, manual), NOW)).status).toBe("ok");
    await autoArchiveFinishedRaces(db, at);
    expect(await lifts(manual)).toHaveLength(0);
  });

  it("migration 0113 ger spärren åt tävlingar som redan har lagts i ett arkiv", async () => {
    const { owner, organisationId } = await linkedClub("OK Före");
    const raceId = await organisedRace({ ownerId: owner.accountId, organisationId, raceDate: day(-2) });
    // Som före migrationen: inlyftet och Ta ur gav bara auditposter.
    await db.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "RACE_ADDED_TO_CLUB_ARCHIVE",
      actorKind: "USER_ACCOUNT", actorId: owner.accountId, after: {}, createdAt: new Date("2026-11-01T10:00:00Z") });
    const migration = await readFile(new URL("../../../database/migrations/0113_automatisk_arkivering.sql", import.meta.url), "utf8");
    await db.execute(sql.raw(migration));
    expect((await autoRow(raceId))?.archivedAt?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    await autoArchiveFinishedRaces(db, NOW);
    expect(await lifts(raceId)).toHaveLength(0);
  });
});
