import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { deleteClubArchiveEntry } from "../../src/club-archive";
import { copyArchivePeopleToSession, copyTermPlan, createPlanSessionFromArchive } from "../../src/club-plan-copy";
import { createPlannedRace, createPlanTask } from "../../src/club-plan-tasks";
import { createClubTerm, createPlanSessions } from "../../src/club-planning";
import { liftRaceToClubArchive, removeRaceFromClubArchive } from "../../src/race-club-archive";
import { createTrainingGroup } from "../../src/training-groups";
import { registerTestAccount } from "./accounts";
import { clubHelpers, ledarDatabase, type TestAccount } from "./ledarflode-fixtures";

/**
 * Ägaren 2026-11-12 (docs/plan-ledarflode-2026-11-12.md): personerna följer med när en träning kopieras (G (ii)), Hämta ur
 * arkivet i terminsplanens vecka och Kopiera upplägg från termin. Personregeln: ledare (också den ansvarige) följer med om de
 * är ledare när kopian görs; övriga uppgifter kopieras utan person. Inga mejl: tjänsterna tar ingen mejlare.
 */
const db = ledarDatabase("planering");
const NOW = new Date("2026-11-12T12:00:00Z");
const { member, linkedClub } = clubHelpers(db, NOW);

let club: Awaited<ReturnType<typeof linkedClub>>;
let responsible: TestAccount, setter: TestAccount, former: TestAccount, reader: TestAccount, outsider: TestAccount;
let autumn: string, spring: string, entryId: string, raceId: string;

const tasksOf = (sessionId: string) => db.select({ title: schema.clubPlanTasks.title, accountId: schema.clubPlanTasks.assigneeAccountId,
  email: schema.clubPlanTasks.assigneeEmail }).from(schema.clubPlanTasks).where(eq(schema.clubPlanTasks.sessionId, sessionId))
  .orderBy(asc(schema.clubPlanTasks.createdAt));
const sessionOf = async (sessionId: string) =>
  (await db.select().from(schema.clubPlanSessions).where(eq(schema.clubPlanSessions.id, sessionId)))[0]!;
const personsOf = (entry: string) => db.select().from(schema.clubArchiveEntryPersons).where(eq(schema.clubArchiveEntryPersons.entryId, entry))
  .orderBy(asc(schema.clubArchiveEntryPersons.position));

async function term(name: string, startsOn: string, endsOn: string) {
  const created = await createClubTerm(db, { ...club.owner.proof, clubId: club.clubId, request: { formatVersion: 1, requestId: randomUUID(), name,
    startsOn, endsOn } }, NOW);
  if (created.status !== "ok") throw new Error(created.status);
  return created.termId;
}

async function planned(termId: string, sessionDate: string, extra: Record<string, unknown> = {}) {
  const created = await createPlanSessions(db, { ...club.owner.proof, clubId: club.clubId, request: { formatVersion: 1, requestId: randomUUID(), termId,
    sessionDate, startTime: "18:00", title: "Kurvbild i Älvsjöskogen", place: "Älvsjöskogen", note: "Två slingor", clubMapId: null,
    trainingGroupId: null, responsibleAccountId: null, weekly: false, ...extra } }, NOW);
  if (created.status !== "ok") throw new Error(created.status);
  return created.sessionIds[0]!;
}

async function task(sessionId: string, title: string, assignee: { kind: "MEMBER"; accountId: string } | { kind: "EMAIL"; email: string } | { kind: "NONE" }) {
  const created = await createPlanTask(db, { ...club.owner.proof, clubId: club.clubId, sessionId, request: { formatVersion: 1, requestId: randomUUID(),
    title, assignee } }, new Date(NOW.getTime() + ++tick * 1000));
  if (created.status !== "ok") throw new Error(created.status);
}
/** Uppgifterna får var sin tid, så att ordningen är den de lades till i. */
let tick = 0;

beforeAll(async () => {
  club = await linkedClub("OK Kopiera");
  responsible = await member(club.clubId, "LEADER", club.owner.accountId);
  setter = await member(club.clubId, "LEADER", club.owner.accountId);
  former = await member(club.clubId, "LEADER", club.owner.accountId);
  reader = await member(club.clubId, "READER", club.owner.accountId);
  outsider = await registerTestAccount(db, undefined, NOW);
  autumn = await term("HT 2026", "2026-08-17", "2026-12-20");
  spring = await term("VT 2027", "2027-01-04", "2027-03-31");

  // En planerad träning med ansvarig, fyra uppgifter, moment och nivå; träningen skapas ur planen och läggs i arkivet.
  const sessionId = await planned(autumn, "2026-11-03", { responsibleAccountId: responsible.accountId, moments: ["KURVBILD"], levels: ["GUL"],
    tags: ["Ungdom"] });
  await task(sessionId, "Sätta ut kontroller", { kind: "MEMBER", accountId: setter.accountId });
  await task(sessionId, "Fika", { kind: "MEMBER", accountId: reader.accountId });
  await task(sessionId, "Ta in kontroller", { kind: "EMAIL", email: "forälder@exempel.se" });
  await task(sessionId, "Kartor", { kind: "MEMBER", accountId: former.accountId });
  const race = await createPlannedRace(db, { ...club.owner.proof, clubId: club.clubId, sessionId }, NOW);
  if (race.status !== "ok") throw new Error(race.status);
  raceId = race.raceId;
  const lifted = await liftRaceToClubArchive(db, { ...club.owner.proof, raceId, request: { formatVersion: 1, confirmSecrecy: false } }, NOW);
  if (lifted.status !== "ok") throw new Error(lifted.status);
  entryId = lifted.view.lifted!.entryId;
  // Kartledaren slutar vara ledare efter träningen.
  await db.update(schema.clubMembers).set({ role: "READER" }).where(and(eq(schema.clubMembers.clubId, club.clubId),
    eq(schema.clubMembers.accountId, former.accountId)));
}, 60_000);

describe("G (ii): personerna i arkivposten", () => {
  it("inlyftet sparar den ansvarige och uppgifterna med kontona, utan adresser", async () => {
    expect((await personsOf(entryId)).map(row => [row.kind, row.title, row.accountId])).toEqual([
      ["RESPONSIBLE", null, responsible.accountId],
      ["TASK", "Sätta ut kontroller", setter.accountId],
      ["TASK", "Fika", reader.accountId],
      ["TASK", "Ta in kontroller", null],
      ["TASK", "Kartor", former.accountId]
    ]);
  });
});

describe("Hämta ur arkivet", () => {
  it("arkivträningen blir en planerad träning med moment, nivåer, egna ord och ledarna; övriga uppgifter utan person", async () => {
    const requestId = randomUUID();
    const request = { formatVersion: 1, requestId, entryId, sessionDate: "2027-01-12", startTime: "18:30", withMoments: true, withPeople: true };
    const created = await createPlanSessionFromArchive(db, { ...setter.proof, clubId: club.clubId, termId: spring, request }, NOW);
    if (created.status !== "ok") throw new Error(created.status);
    const session = await sessionOf(created.sessionId);
    expect(session).toMatchObject({ title: "Kurvbild i Älvsjöskogen", sessionDate: "2027-01-12", startTime: "18:30", raceId: null,
      responsibleAccountId: responsible.accountId, moments: ["KURVBILD"], levels: ["GUL"], tags: ["Ungdom"], createdBy: setter.accountId });
    expect(await tasksOf(created.sessionId)).toEqual([
      { title: "Sätta ut kontroller", accountId: setter.accountId, email: null },
      { title: "Fika", accountId: null, email: null },
      { title: "Ta in kontroller", accountId: null, email: null },
      { title: "Kartor", accountId: null, email: null }
    ]);
    // Samma begäran igen: samma rad.
    expect(await createPlanSessionFromArchive(db, { ...setter.proof, clubId: club.clubId, termId: spring, request }, NOW))
      .toEqual({ status: "ok", sessionId: created.sessionId });

    const bare = await createPlanSessionFromArchive(db, { ...setter.proof, clubId: club.clubId, termId: spring, request: { ...request,
      requestId: randomUUID(), withMoments: false, withPeople: false } }, NOW);
    if (bare.status !== "ok") throw new Error(bare.status);
    expect(await sessionOf(bare.sessionId)).toMatchObject({ moments: [], levels: [], tags: [], responsibleAccountId: null });
    expect(await tasksOf(bare.sessionId)).toEqual([]);
    expect((await createPlanSessionFromArchive(db, { ...setter.proof, clubId: club.clubId, termId: spring, request: { ...request,
      requestId: randomUUID(), sessionDate: "2027-05-04" } }, NOW)).status).toBe("outside");
  });

  it("bara ledare och mer; utloggad, medlem och utomstående nekas; en annan klubbs arkivträning finns inte", async () => {
    const request = () => ({ formatVersion: 1, requestId: randomUUID(), entryId, sessionDate: "2027-01-19", startTime: null, withMoments: true,
      withPeople: true });
    const input = (proof: TestAccount["proof"]) => ({ ...proof, clubId: club.clubId, termId: spring, request: request() });
    expect((await createPlanSessionFromArchive(db, { ...input(reader.proof), sessionToken: "ingen" }, NOW)).status).toBe("unauthorized");
    expect((await createPlanSessionFromArchive(db, input(reader.proof), NOW)).status).toBe("forbidden");
    expect((await createPlanSessionFromArchive(db, input(outsider.proof), NOW)).status).toBe("not-found");
    // Behörigheten före kroppen.
    expect((await createPlanSessionFromArchive(db, { ...input(reader.proof), request: { trasig: true } }, NOW)).status).toBe("forbidden");
    const other = await linkedClub("OK Annan");
    const otherTerm = await createClubTerm(db, { ...other.owner.proof, clubId: other.clubId, request: { formatVersion: 1, requestId: randomUUID(),
      name: "VT 2027", startsOn: "2027-01-01", endsOn: "2027-06-30" } }, NOW);
    if (otherTerm.status !== "ok") throw new Error(otherTerm.status);
    expect((await createPlanSessionFromArchive(db, { ...other.owner.proof, clubId: other.clubId, termId: otherTerm.termId, request: request() }, NOW))
      .status).toBe("not-found");
  });
});

describe("Använd igen → Till terminsplanen: personerna till en planerad rad", () => {
  it("den ansvarige bara om raden saknar en och uppgifterna en gång, också när träningen redan finns", async () => {
    const sessionId = await planned(spring, "2027-02-02");
    await task(sessionId, "Fika", { kind: "NONE" });
    const race = await createPlannedRace(db, { ...club.owner.proof, clubId: club.clubId, sessionId }, NOW);
    if (race.status !== "ok") throw new Error(race.status);
    const input = { ...setter.proof, clubId: club.clubId, sessionId, request: { formatVersion: 1, entryId } };
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await copyArchivePeopleToSession(db, input, later)).toEqual({ status: "ok", responsible: true, tasks: 3 });
    expect(await copyArchivePeopleToSession(db, input, later)).toEqual({ status: "ok", responsible: false, tasks: 0 });
    expect((await sessionOf(sessionId)).responsibleAccountId).toBe(responsible.accountId);
    expect((await tasksOf(sessionId)).map(row => row.title)).toEqual(["Fika", "Sätta ut kontroller", "Ta in kontroller", "Kartor"]);
    // Ledarna är redan administratörer i en träning i klubbens plan (ägaren 2026-11-10), så inga nya behörighetsrader behövs.
    expect(await db.select().from(schema.courseSettingGrants).where(eq(schema.courseSettingGrants.raceId, race.raceId))).toEqual([]);

    expect((await copyArchivePeopleToSession(db, { ...input, ...reader.proof }, NOW)).status).toBe("forbidden");
    expect((await copyArchivePeopleToSession(db, { ...input, sessionToken: "ingen" }, NOW)).status).toBe("unauthorized");
    expect((await copyArchivePeopleToSession(db, { ...input, ...outsider.proof }, NOW)).status).toBe("not-found");
  });
});

describe("Kopiera upplägg från termin", () => {
  it("samma veckodag i motsvarande vecka, personregeln, gruppen bara för gruppens ledare, ingen träning, och bara till en tom termin", async () => {
    const group = await createTrainingGroup(db, { ...setter.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Ungdom",
      code: `ungdom-${randomUUID().slice(0, 8)}` } }, NOW);
    if (group.status !== "created") throw new Error(group.status);
    const source = await term("HT 2027", "2027-08-16", "2027-12-19");
    const first = await createPlanSessions(db, { ...setter.proof, clubId: club.clubId, request: { formatVersion: 1, requestId: randomUUID(),
      termId: source, sessionDate: "2027-08-17", startTime: "18:00", title: "Gruppträning", place: "Skogen", note: "", clubMapId: null,
      trainingGroupId: group.group.groupId, responsibleAccountId: responsible.accountId, moments: ["KOMPASS"], levels: [], tags: [], weekly: false } }, NOW);
    if (first.status !== "ok") throw new Error(first.status);
    await task(first.sessionIds[0]!, "Sätta ut kontroller", { kind: "MEMBER", accountId: setter.accountId });
    await task(first.sessionIds[0]!, "Fika", { kind: "MEMBER", accountId: reader.accountId });
    await planned(source, "2027-09-02", { responsibleAccountId: responsible.accountId });
    await planned(source, "2027-12-14");
    const target = await term("VT 2028", "2028-01-03", "2028-03-31");

    const copied = await copyTermPlan(db, { ...club.owner.proof, clubId: club.clubId, termId: target, request: { formatVersion: 1, fromTermId: source } }, NOW);
    expect(copied).toEqual({ status: "ok", copied: 2, outside: 1 });
    const rows = await db.select().from(schema.clubPlanSessions).where(eq(schema.clubPlanSessions.termId, target))
      .orderBy(asc(schema.clubPlanSessions.sessionDate));
    // Tisdag i första veckan och torsdag i tredje veckan.
    expect(rows.map(row => [row.sessionDate, row.title, row.raceId, row.responsibleAccountId])).toEqual([
      ["2028-01-04", "Gruppträning", null, responsible.accountId], ["2028-01-20", "Kurvbild i Älvsjöskogen", null, responsible.accountId]]);
    // Ägaren är inte ledare i gruppen: gruppen följer inte med (som när en rad skapas).
    expect(rows[0]).toMatchObject({ trainingGroupId: null, moments: ["KOMPASS"], startTime: "18:00", place: "Skogen", createdBy: club.owner.accountId });
    expect(await tasksOf(rows[0]!.id)).toEqual([{ title: "Sätta ut kontroller", accountId: setter.accountId, email: null },
      { title: "Fika", accountId: null, email: null }]);
    expect((await copyTermPlan(db, { ...club.owner.proof, clubId: club.clubId, termId: target, request: { formatVersion: 1, fromTermId: source } }, NOW))
      .status).toBe("not-empty");

    // Gruppens ledare får med gruppen.
    const other = await term("VT 2029", "2029-01-01", "2029-03-31");
    expect((await copyTermPlan(db, { ...setter.proof, clubId: club.clubId, termId: other, request: { formatVersion: 1, fromTermId: source } }, NOW)).status)
      .toBe("ok");
    const [grouped] = await db.select().from(schema.clubPlanSessions).where(and(eq(schema.clubPlanSessions.termId, other),
      eq(schema.clubPlanSessions.title, "Gruppträning")));
    expect(grouped?.trainingGroupId).toBe(group.group.groupId);
  });

  it("bara ledare och mer; samma termin är ogiltig", async () => {
    const empty = await term("HT 2029", "2029-08-13", "2029-12-16");
    const input = (proof: TestAccount["proof"]) => ({ ...proof, clubId: club.clubId, termId: empty, request: { formatVersion: 1, fromTermId: autumn } });
    expect((await copyTermPlan(db, { ...input(reader.proof), sessionToken: "ingen" }, NOW)).status).toBe("unauthorized");
    expect((await copyTermPlan(db, input(reader.proof), NOW)).status).toBe("forbidden");
    expect((await copyTermPlan(db, input(outsider.proof), NOW)).status).toBe("not-found");
    expect((await copyTermPlan(db, { ...input(club.owner.proof), request: { formatVersion: 1, fromTermId: empty } }, NOW)).status).toBe("invalid-request");
  });
});

describe("G (ii): personerna tas bort med arkivposten", () => {
  it("Ta ur klubbarkivet och Ta bort träningen ur arkivet tar personerna med sig", async () => {
    expect((await removeRaceFromClubArchive(db, { ...club.owner.proof, raceId }, NOW)).status).toBe("ok");
    expect(await personsOf(entryId)).toEqual([]);
    const again = await liftRaceToClubArchive(db, { ...club.owner.proof, raceId, request: { formatVersion: 1, confirmSecrecy: false } }, NOW);
    if (again.status !== "ok") throw new Error(again.status);
    const second = again.view.lifted!.entryId;
    // Kartledaren är medlem nu, men sparas ändå (regeln gäller när någon kopierar).
    expect(await personsOf(second)).toHaveLength(5);
    expect((await deleteClubArchiveEntry(db, { ...club.owner.proof, clubId: club.clubId, entryId: second }, NOW)).status).toBe("deleted");
    expect(await personsOf(second)).toEqual([]);
  });
});
