import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createClub } from "../../src/clubs";
import { createClubTerm, createPlanSessions, readClubPlan, updatePlanSession } from "../../src/club-planning";
import { createPlannedRace, createPlanTask, updatePlanTask, type PlanTaskMail } from "../../src/club-plan-tasks";
import { createTrainingGroup, setRaceGroup } from "../../src/training-groups";
import { createGroupSessions } from "../../src/training-group-sessions";
import { insertEventWithRace } from "../../src/organizer-events";
import { liftRaceToClubArchive, readRaceClubArchiveAsAdmin } from "../../src/race-club-archive";
import { readClubArchiveEntry } from "../../src/club-archive";
import { readFile } from "node:fs/promises";
import { readPpen } from "@o-tid/course-setting";
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

describe("C: banor utan lägen på kartan", () => {
  it("dialogen och arkivposten säger vilka av tidtagningens banor som inte finns i banläggningen", async () => {
    const { owner, clubId, organisationId } = await linkedClub("OK Banor");
    const created = await db.transaction(tx => insertEventWithRace(tx, { eventName: "Torsdagsträning", raceName: "", raceDate: "2026-11-05",
      timeZone: "Europe/Stockholm", raceType: "TRAINING", firstStartTime: null, trainingGroupId: null, ownerAccountId: owner.accountId, now: NOW }));
    const raceId = created.race.id;
    await db.insert(schema.raceOrganisers).values({ raceId, organisationId, setBy: owner.accountId, setAt: NOW });
    const document = readPpen(await readFile(new URL("../../../../fixtures/course-setting/kartfil.ppen", import.meta.url), "utf8")).document;
    await db.insert(schema.courseSettings).values({ raceId, document: document as never, version: 1, updatedAt: NOW, updatedBy: owner.accountId });
    // Lång är ritad i banläggningen; Kort och Kvart finns bara i tidtagningen (kontrollkoder i arbetsytan).
    for (const name of ["Lång", "Kort", "Kvart"]) await db.insert(schema.courses).values({ raceId, name });
    const view = await readRaceClubArchiveAsAdmin(db, { ...owner.proof, raceId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.contents.coursesWithoutMap).toEqual(["Kort", "Kvart"]);
    const lifted = await liftRaceToClubArchive(db, { ...owner.proof, raceId, request: { formatVersion: 1, confirmSecrecy: false } }, NOW);
    if (lifted.status !== "ok") throw new Error(lifted.status);
    const entry = await readClubArchiveEntry(db, { ...owner.proof, clubId, entryId: lifted.view.lifted!.entryId }, NOW);
    if (entry.status !== "ok") throw new Error(entry.status);
    expect(entry.view.entry.notes).toContain("Kort och Kvart har bara kontrollkoder och kan inte visas på kartan.");
    expect(entry.view.entry.courseNames).not.toContain("Kort");
  });
});

describe("D: uppgift och ansvar till en medlem ger ett mejl", () => {
  it("medlemmen och den ansvarige får mejl (inte den som ger sig själv), veckorna blir ett mejl, och uppgifter går att ändra", async () => {
    const { owner, clubId } = await linkedClub("OK Mejl");
    const leader = await member(clubId, "LEADER", owner.accountId);
    const other = await member(clubId, "LEADER", owner.accountId);
    const reader = await member(clubId, "READER", owner.accountId);
    const mails: PlanTaskMail[] = [];
    const mailer = async (mail: PlanTaskMail) => { mails.push(mail); };
    const term = await createClubTerm(db, { ...leader.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), name: "VT 2027",
      startsOn: "2027-01-01", endsOn: "2027-02-28" } }, NOW);
    if (term.status !== "ok") throw new Error(term.status);
    const fields = { termId: term.termId, startTime: "18:00", title: "Nattträning", place: "Skogen", note: "", clubMapId: null, trainingGroupId: null };

    // Varje vecka med en annan ledare som ansvarig: ett mejl för alla veckorna.
    const weekly = await createPlanSessions(db, { ...leader.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), ...fields,
      sessionDate: "2027-01-05", responsibleAccountId: other.accountId, weekly: true } }, NOW, mailer);
    if (weekly.status !== "ok") throw new Error(weekly.status);
    expect(weekly.sessionIds).toHaveLength(8);
    expect(weekly.mailed).toBe(true);
    expect(mails).toEqual([expect.objectContaining({ to: other.email, kind: "RESPONSIBLE", account: "MEMBER", sessionDate: "2027-01-05",
      repeats: { count: 8, lastDate: "2027-02-23" } })]);
    // Ansvarig själv: inget mejl.
    const own = await createPlanSessions(db, { ...leader.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), ...fields,
      sessionDate: "2027-01-07", responsibleAccountId: leader.accountId, weekly: false } }, NOW, mailer);
    if (own.status !== "ok") throw new Error(own.status);
    expect(own.mailed).toBe(false);
    expect(mails).toHaveLength(1);

    // En ny ansvarig vid ändringen får mejlet; en ändring som behåller den ansvarige ger inget.
    const plan = await readClubPlan(db, { ...leader.proof, clubId, termId: term.termId }, NOW);
    if (plan.status !== "ok") throw new Error(plan.status);
    const first = plan.response.term!.planSessions.find(row => row.sessionId === own.sessionIds[0])!;
    const update = (version: number, responsibleAccountId: string) => updatePlanSession(db, { ...leader.proof, clubId, sessionId: first.sessionId,
      request: { formatVersion: 1, version, sessionDate: "2027-01-07", startTime: "18:00", title: "Nattträning", place: "Skogen", note: "",
        clubMapId: null, trainingGroupId: null, responsibleAccountId } }, NOW, mailer);
    expect(await update(first.version, owner.accountId)).toEqual({ status: "ok", version: first.version + 1, mailed: true });
    expect(await update(first.version + 1, owner.accountId)).toEqual({ status: "ok", version: first.version + 2, mailed: false });
    expect(mails.at(-1)).toMatchObject({ to: owner.email, kind: "RESPONSIBLE", repeats: null });

    // Uppgifter: till sig själv inget mejl; till en adress med konto säger mejlet logga in.
    const sessionId = first.sessionId;
    const mine = await createPlanTask(db, { ...leader.proof, clubId, sessionId, request: { formatVersion: 1, requestId: randomUUID(), title: "Fika",
      assignee: { kind: "MEMBER", accountId: leader.accountId } } }, NOW, mailer);
    expect(mine).toMatchObject({ status: "ok", mailed: false });
    const byAddress = await createPlanTask(db, { ...leader.proof, clubId, sessionId, request: { formatVersion: 1, requestId: randomUUID(),
      title: "Start", assignee: { kind: "EMAIL", email: reader.email } } }, NOW, mailer);
    expect(byAddress).toMatchObject({ status: "ok", mailed: true });
    expect(mails.at(-1)).toMatchObject({ to: reader.email, kind: "TASK", account: "ACCOUNT" });
    if (mine.status !== "ok") throw new Error(mine.status);

    // Träningen finns: att flytta uppgiften till en annan medlem flyttar läsrätten och ger den nya ett mejl.
    const race = await createPlannedRace(db, { ...leader.proof, clubId, sessionId }, NOW);
    if (race.status !== "ok") throw new Error(race.status);
    const grantOf = async (accountId: string) => (await db.select({ requestId: schema.courseSettingGrants.requestId }).from(schema.courseSettingGrants)
      .where(eq(schema.courseSettingGrants.accountId, accountId))).filter(row => row.requestId === mine.taskId);
    const count = mails.length;
    expect(await updatePlanTask(db, { ...leader.proof, clubId, sessionId, taskId: mine.taskId, request: { formatVersion: 1, title: "Fika och saft",
      assignee: { kind: "MEMBER", accountId: leader.accountId } } }, NOW, mailer)).toEqual({ status: "ok", mailed: false });
    expect(mails).toHaveLength(count);
    expect(await updatePlanTask(db, { ...leader.proof, clubId, sessionId, taskId: mine.taskId, request: { formatVersion: 1, title: "Fika och saft",
      assignee: { kind: "MEMBER", accountId: reader.accountId } } }, NOW, mailer)).toEqual({ status: "ok", mailed: true });
    expect(mails.at(-1)).toMatchObject({ to: reader.email, kind: "TASK", taskTitle: "Fika och saft", account: "MEMBER" });
    expect(await grantOf(reader.accountId)).toHaveLength(1);
    const after = await readClubPlan(db, { ...leader.proof, clubId, termId: term.termId }, NOW);
    if (after.status !== "ok") throw new Error(after.status);
    expect(after.response.term!.planSessions.find(row => row.sessionId === sessionId)!.tasks.find(task => task.taskId === mine.taskId))
      .toMatchObject({ title: "Fika och saft", assigneeAccountId: reader.accountId });
    // En medlem utan ledarroll får inte ändra.
    expect((await updatePlanTask(db, { ...reader.proof, clubId, sessionId, taskId: mine.taskId, request: { formatVersion: 1, title: "X",
      assignee: { kind: "NONE" } } }, NOW, mailer)).status).toBe("forbidden");
  });
});
