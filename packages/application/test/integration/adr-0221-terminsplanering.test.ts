import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createClub } from "../../src/clubs";
import { changeClubTerm, createClubTerm, createPlanSessions, readClubPlan, removePlanSession, updatePlanSession } from "../../src/club-planning";
import { createPlannedRace, createPlanTask, listMyPlanTasks, removePlanTask, setPlanTaskDone, type PlanTaskMail } from "../../src/club-plan-tasks";
import { requireCourseSettingForAccount } from "../../src/course-setting-access";
import { activeEventAdministrationGrant } from "../../src/race-session";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0221: terminsplaneringen mot PostgreSQL – bara ledare och mer ser och ändrar planen, veckovis upprepning till
 * terminens slut, uppgifter till en medlem eller en adress (som blir kontots när hen loggar in), "Mina uppgifter" med bara
 * de egna, "Skapa träningen" med den ansvarige som administratör och läsrätten i banläggningen som följer uppgiften.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0221_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-09T20:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0221_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function member(clubId: string, role: "ADMIN" | "LEADER" | "READER", addedBy: string) {
  const account = await registerTestAccount(db, undefined, NOW);
  await db.insert(schema.clubMembers).values({ id: randomUUID(), clubId, accountId: account.accountId, role, addedAt: NOW, addedBy,
    requestId: randomUUID() });
  return account;
}

async function setup() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Planering" } }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const clubId = created.club.clubId;
  return { owner, clubId, leader: await member(clubId, "LEADER", owner.accountId), reader: await member(clubId, "READER", owner.accountId) };
}

const tasksOf = (result: Awaited<ReturnType<typeof listMyPlanTasks>>) => {
  if (result.status !== "ok") throw new Error(result.status);
  return result.response.tasks;
};

const session = (termId: string, fields: Partial<{ sessionDate: string; responsibleAccountId: string | null; weekly: boolean }> = {}) => ({
  formatVersion: 1, requestId: randomUUID(), termId, sessionDate: "2027-01-12", startTime: "18:00", title: "Kurvbildsträning", place: "Älvsjöskogen",
  note: "", clubMapId: null, trainingGroupId: null, responsibleAccountId: null, weekly: false, ...fields
});

describe("ADR-0221: terminsplaneringen", () => {
  it("ledare planerar en termin vecka för vecka; medlemmar ser inte planen", async () => {
    const { clubId, leader, reader } = await setup();
    const termRequest = { formatVersion: 1, requestId: randomUUID(), name: "VT 2027", startsOn: "2027-01-07", endsOn: "2027-03-31" };
    const term = await createClubTerm(db, { ...leader.proof, clubId, request: termRequest }, NOW);
    if (term.status !== "ok") throw new Error(term.status);
    expect(await createClubTerm(db, { ...leader.proof, clubId, request: termRequest }, NOW)).toEqual(term);
    expect((await createClubTerm(db, { ...reader.proof, clubId, request: { ...termRequest, requestId: randomUUID() } }, NOW)).status).toBe("forbidden");
    expect((await readClubPlan(db, { ...reader.proof, clubId, termId: null }, NOW)).status).toBe("forbidden");

    const weekly = session(term.termId, { weekly: true, responsibleAccountId: leader.accountId });
    const created = await createPlanSessions(db, { ...leader.proof, clubId, request: weekly }, NOW);
    if (created.status !== "ok") throw new Error(created.status);
    expect(created.sessionIds).toHaveLength(12);
    expect(await createPlanSessions(db, { ...leader.proof, clubId, request: weekly }, NOW)).toEqual(created);
    expect((await createPlanSessions(db, { ...leader.proof, clubId, request: session(term.termId, { sessionDate: "2027-04-02" }) }, NOW)).status)
      .toBe("outside");
    // Den ansvarige måste vara ledare i klubben.
    expect((await createPlanSessions(db, { ...leader.proof, clubId, request: session(term.termId, { responsibleAccountId: reader.accountId }) }, NOW))
      .status).toBe("invalid-request");

    const plan = await readClubPlan(db, { ...leader.proof, clubId, termId: null }, NOW);
    if (plan.status !== "ok") throw new Error(plan.status);
    expect(plan.response.term?.name).toBe("VT 2027");
    expect(plan.response.terms.map(row => row.sessions)).toEqual([12]);
    expect(plan.response.term?.planSessions.map(row => row.sessionDate).slice(0, 3)).toEqual(["2027-01-12", "2027-01-19", "2027-01-26"]);
    expect(plan.response.term?.planSessions[0]?.responsibleName).toBe(`Arrangör ${leader.email.split("@")[0]}`);
    expect(plan.response.people.find(person => person.accountId === reader.accountId)).toMatchObject({ leader: false });

    const first = plan.response.term!.planSessions[0]!;
    const changed = await updatePlanSession(db, { ...leader.proof, clubId, sessionId: first.sessionId, request: { formatVersion: 1, version: first.version,
      sessionDate: "2027-01-13", startTime: null, title: "Stråkorientering", place: "Solberga", note: "Ta med skärmar", clubMapId: null,
      trainingGroupId: null, responsibleAccountId: leader.accountId } }, NOW);
    expect(changed).toEqual({ status: "ok", version: 2 });
    expect((await updatePlanSession(db, { ...leader.proof, clubId, sessionId: first.sessionId, request: { formatVersion: 1, version: 1,
      sessionDate: "2027-01-13", startTime: null, title: "X", place: "", note: "", clubMapId: null, trainingGroupId: null,
      responsibleAccountId: null } }, NOW)).status).toBe("conflict");
    // Terminen kan inte krympas förbi de planerade träningarna, och tas bort bara när den är tom.
    expect((await changeClubTerm(db, { ...leader.proof, clubId, termId: term.termId, remove: false,
      request: { formatVersion: 1, name: "VT 2027", startsOn: "2027-02-01", endsOn: "2027-03-31" } }, NOW)).status).toBe("outside");
    expect((await changeClubTerm(db, { ...leader.proof, clubId, termId: term.termId, remove: true, request: undefined }, NOW)).status).toBe("not-empty");
    expect(await removePlanSession(db, { ...leader.proof, clubId, sessionId: first.sessionId }, NOW)).toEqual({ status: "ok" });
  });

  it("uppgifter: bara de egna syns, adressen blir kontots, och läsrätten i banläggningen följer uppgiften", async () => {
    const { owner, clubId, leader, reader } = await setup();
    const term = await createClubTerm(db, { ...leader.proof, clubId,
      request: { formatVersion: 1, requestId: randomUUID(), name: "VT 2027", startsOn: "2027-01-01", endsOn: "2027-06-30" } }, NOW);
    if (term.status !== "ok") throw new Error(term.status);
    const created = await createPlanSessions(db, { ...leader.proof, clubId, request: session(term.termId, { responsibleAccountId: owner.accountId }) }, NOW);
    if (created.status !== "ok") throw new Error(created.status);
    const sessionId = created.sessionIds[0]!;
    const mails: PlanTaskMail[] = [];
    const print = await createPlanTask(db, { ...leader.proof, clubId, sessionId, request: { formatVersion: 1, requestId: randomUUID(),
      title: "Skriva ut kartor", assignee: { kind: "MEMBER", accountId: reader.accountId } } }, NOW, async mail => { mails.push(mail); });
    const parentEmail = `foralder.${randomUUID().slice(0, 6)}@test.o-tid.se`;
    const place = await createPlanTask(db, { ...leader.proof, clubId, sessionId, request: { formatVersion: 1, requestId: randomUUID(),
      title: "Sätta ut kontroller", assignee: { kind: "EMAIL", email: parentEmail.toUpperCase() } } }, NOW, async mail => { mails.push(mail); });
    if (print.status !== "ok" || place.status !== "ok") throw new Error("uppgifterna");
    expect(print.mailed).toBe(false);
    expect(place.mailed).toBe(true);
    expect(mails).toEqual([expect.objectContaining({ to: parentEmail, taskTitle: "Sätta ut kontroller", sessionTitle: "Kurvbildsträning",
      sessionDate: "2027-01-12", clubName: "OK Planering" })]);
    // En medlem får inte lägga uppgifter.
    expect((await createPlanTask(db, { ...reader.proof, clubId, sessionId, request: { formatVersion: 1, requestId: randomUUID(), title: "X",
      assignee: { kind: "NONE" } } }, NOW)).status).toBe("forbidden");

    const mine = await listMyPlanTasks(db, reader.proof, NOW);
    if (mine.status !== "ok") throw new Error(mine.status);
    expect(mine.response.tasks).toEqual([expect.objectContaining({ title: "Skriva ut kartor", sessionTitle: "Kurvbildsträning", raceId: null,
      responsibleName: `Arrangör ${owner.email.split("@")[0]}`, otherTasks: [{ title: "Sätta ut kontroller", done: false }] })]);
    expect(JSON.stringify(mine.response)).not.toContain(parentEmail);

    // Föräldern skapar konto med adressen och ser sin uppgift.
    const parent = await registerTestAccount(db, parentEmail.split("@")[0], NOW);
    const parentTasks = await listMyPlanTasks(db, parent.proof, NOW);
    if (parentTasks.status !== "ok") throw new Error(parentTasks.status);
    expect(parentTasks.response.tasks.map(task => task.title)).toEqual(["Sätta ut kontroller"]);
    expect(tasksOf(await listMyPlanTasks(db, leader.proof, NOW))).toEqual([]);

    // Skapa träningen: ledaren som skapar äger den, den ansvarige blir administratör, uppgifterna får läsrätt.
    const race = await createPlannedRace(db, { ...leader.proof, clubId, sessionId }, NOW);
    if (race.status !== "ok") throw new Error(race.status);
    expect(await createPlannedRace(db, { ...leader.proof, clubId, sessionId }, NOW)).toEqual({ ...race, replayed: true });
    const [facts] = await db.select({ eventId: schema.races.eventId, raceType: schema.races.raceType, date: schema.races.raceDate,
      start: schema.races.firstStartTime, name: schema.events.name }).from(schema.races)
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, race.raceId));
    expect(facts).toMatchObject({ raceType: "TRAINING", date: "2027-01-12", start: "18:00", name: "Kurvbildsträning" });
    expect((await activeEventAdministrationGrant(db, { accountId: owner.accountId, eventId: facts!.eventId, roles: ["ADMIN"] }, "none"))?.role).toBe("ADMIN");
    expect((await activeEventAdministrationGrant(db, { accountId: leader.accountId, eventId: facts!.eventId, roles: ["OWNER"] }, "none"))?.role).toBe("OWNER");
    const access = async (accountId: string) => db.transaction(tx => requireCourseSettingForAccount(tx, accountId, race.raceId, "COMMENT", NOW));
    expect((await access(reader.accountId)).status).toBe("authenticated");
    expect((await access(parent.accountId)).status).toBe("authenticated");
    expect(tasksOf(await listMyPlanTasks(db, parent.proof, NOW))[0]?.raceId).toBe(race.raceId);

    // Klar: den som har uppgiften bockar av; en annan medlem får inte.
    expect(await setPlanTaskDone(db, { ...parent.proof, taskId: place.taskId, request: { formatVersion: 1, done: true } }, NOW)).toEqual({ status: "ok" });
    expect((await setPlanTaskDone(db, { ...reader.proof, taskId: place.taskId, request: { formatVersion: 1, done: false } }, NOW)).status).toBe("forbidden");

    // Uppgiften tas bort: läsrätten försvinner, en behörighet som någon gav för hand står kvar.
    expect(await removePlanTask(db, { ...leader.proof, clubId, sessionId, taskId: print.taskId }, NOW)).toEqual({ status: "ok" });
    expect((await access(reader.accountId)).status).toBe("unauthorized");
    await db.update(schema.courseSettingGrants).set({ requestId: randomUUID() })
      .where(and(eq(schema.courseSettingGrants.raceId, race.raceId), eq(schema.courseSettingGrants.accountId, parent.accountId)));
    expect(await removePlanTask(db, { ...leader.proof, clubId, sessionId, taskId: place.taskId }, NOW)).toEqual({ status: "ok" });
    expect((await access(parent.accountId)).status).toBe("authenticated");
  });
});
