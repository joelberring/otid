import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { RaceInvitationRole } from "@o-tid/contracts";
import { createOrganizerEvent } from "../../src/organizer-events";
import { grantRacePersonAsAdmin, listRacePeopleAsAdmin } from "../../src/race-people";
import { changeRacePersonRoleAsAdmin } from "../../src/race-person-role";
import { requireCourseSettingAccess } from "../../src/course-setting-access";
import { registerTestAccount, accountOnRace } from "./accounts";

/**
 * Ägaren 2026-11-17: rollen byts i listan under Personer med behörighet. Samma regler som för Lägg till och Ta bort:
 * administratörer byter mellan funktionär och banläggningens roller, bara ägaren rör administratörer, ägaren och den egna
 * raden byts aldrig. Bytet gäller direkt och står i journalen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_byta_roll_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_byta_roll_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = AccountProof & { raceId: string };

async function enter(account: AccountProof, raceId: string) {
  const entered = await accountOnRace(db, { ...account, raceId });
  if (entered.status !== "authenticated") return { status: entered.status } as const;
  return { status: "ok", role: entered.role, proof: { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken } } as const;
}
async function proofOf(account: AccountProof, raceId: string): Promise<Proof> {
  const entered = await enter(account, raceId);
  if (entered.status !== "ok") throw new Error(`Kom inte in i tävlingen: ${entered.status}`);
  return entered.proof;
}
async function grant(proof: Proof, email: string, role: RaceInvitationRole) {
  const requestId = randomUUID();
  const result = await grantRacePersonAsAdmin(db, { ...proof, idempotencyKey: `race-person-grant:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, email, role }) });
  if (result.status !== "granted") throw new Error(`Behörigheten gavs inte: ${result.status}`);
  return result.response.invitation.invitationId;
}
function change(proof: Proof, grantId: string, role: RaceInvitationRole, requestId = randomUUID()) {
  return changeRacePersonRoleAsAdmin(db, { ...proof, idempotencyKey: `race-person-role:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, grantId, role }) });
}
async function rows(proof: Proof) {
  const list = await listRacePeopleAsAdmin(db, proof);
  if (list.status !== "ok") throw new Error(`Listan: ${list.status}`);
  return { people: list.response.people, invitations: list.response.invitations,
    roleOf: (accountId: string) => list.response.people.filter(person => person.accountId === accountId).map(person => person.role),
    rowOf: (accountId: string) => list.response.people.find(person => person.accountId === accountId && person.role !== "OWNER")! };
}
const courseLevel = async (proof: AccountProof, raceId: string) => {
  const access = await requireCourseSettingAccess(db, { ...proof, raceId, required: "MAP" });
  return access.status === "authenticated" ? access.principal.level : access.status;
};

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const [owner, coadmin, staff, setter] = await Promise.all(["agare", "med", "funk", "ban"].map(name => registerTestAccount(db, `${name}.${suffix}`)));
  const created = await createOrganizerEvent(db, { ...owner!.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: `Rollbyte ${suffix}`, raceName: "Tisdag", raceDate: "2026-11-17",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const raceId = created.response.raceId, ownerRace = await proofOf(owner!.proof, raceId);
  await grant(ownerRace, coadmin!.email, "ADMIN");
  await grant(ownerRace, staff!.email, "FUNCTIONARY");
  await grant(ownerRace, setter!.email, "COURSE_SUGGEST");
  // Personerna loggar in och tar sina behörigheter.
  const adminRace = await proofOf(coadmin!.proof, raceId);
  expect((await enter(staff!.proof, raceId)).status).toBe("ok");
  expect(await courseLevel(setter!.proof, raceId)).toBe("SUGGEST");
  return { owner: owner!, coadmin: coadmin!, staff: staff!, setter: setter!, raceId, ownerRace, adminRace };
}

describe("byta roll under Personer med behörighet", () => {
  it("en administratör gör en funktionär till banläggare och tillbaka; åtkomsten följer med direkt", async () => {
    const f = await setup();
    const before = (await rows(f.adminRace)).rowOf(f.staff.accountId);
    expect(before.role).toBe("FUNCTIONARY");
    const toCourse = await change(f.adminRace, before.grantId, "COURSE_EDIT");
    expect(toCourse.status).toBe("changed");
    expect((await rows(f.adminRace)).roleOf(f.staff.accountId)).toEqual(["COURSE_EDIT"]);
    // Funktionärens åtkomst till tävlingen är borta; banläggningen öppnas med nivån ändra.
    expect((await enter(f.staff.proof, f.raceId)).status).not.toBe("ok");
    expect(await courseLevel(f.staff.proof, f.raceId)).toBe("EDIT");

    const row = (await rows(f.adminRace)).rowOf(f.staff.accountId);
    expect((await change(f.adminRace, row.grantId, "COURSE_COMMENT")).status).toBe("changed");
    expect(await courseLevel(f.staff.proof, f.raceId)).toBe("COMMENT");
    const same = (await rows(f.adminRace)).rowOf(f.staff.accountId);
    expect(same.grantId).toBe(row.grantId);

    expect((await change(f.adminRace, same.grantId, "FUNCTIONARY")).status).toBe("changed");
    expect((await rows(f.adminRace)).roleOf(f.staff.accountId)).toEqual(["FUNCTIONARY"]);
    const back = await enter(f.staff.proof, f.raceId);
    expect(back.status === "ok" && back.role).toBe("FUNCTIONARY");
    // Funktionären ser inte banorna (banhemligheten).
    expect(await courseLevel(f.staff.proof, f.raceId)).toBe("forbidden");
  });

  it("bara ägaren gör någon till administratör eller tar ifrån någon den rollen", async () => {
    const f = await setup();
    const list = await rows(f.adminRace);
    const staff = list.rowOf(f.staff.accountId), coadmin = list.rowOf(f.coadmin.accountId), setter = list.rowOf(f.setter.accountId);
    expect((await change(f.adminRace, staff.grantId, "ADMIN")).status).toBe("forbidden");
    expect((await change(f.adminRace, setter.grantId, "ADMIN")).status).toBe("forbidden");
    // Den egna raden och en annan administratör byts inte av en administratör.
    expect((await change(f.adminRace, coadmin.grantId, "FUNCTIONARY")).status).toBe("forbidden");
    expect((await rows(f.ownerRace)).roleOf(f.staff.accountId)).toEqual(["FUNCTIONARY"]);

    expect((await change(f.ownerRace, staff.grantId, "ADMIN")).status).toBe("changed");
    const promoted = await enter(f.staff.proof, f.raceId);
    expect(promoted.status === "ok" && promoted.role).toBe("ADMIN");
    expect((await rows(f.ownerRace)).roleOf(f.staff.accountId)).toEqual(["ADMIN"]);

    expect((await change(f.ownerRace, coadmin.grantId, "FUNCTIONARY")).status).toBe("changed");
    const demoted = await enter(f.coadmin.proof, f.raceId);
    expect(demoted.status === "ok" && demoted.role).toBe("FUNCTIONARY");
    // Den tidigare administratörens session når inte längre listan.
    expect((await listRacePeopleAsAdmin(db, f.adminRace)).status).not.toBe("ok");
  });

  it("ägaren och den egna raden byts aldrig; samma roll och okänd rad nekas", async () => {
    const f = await setup();
    const list = await rows(f.ownerRace);
    const ownerRow = list.people.find(person => person.role === "OWNER")!;
    expect((await change(f.ownerRace, ownerRow.grantId, "FUNCTIONARY")).status).toBe("forbidden");
    expect((await change(f.adminRace, ownerRow.grantId, "FUNCTIONARY")).status).toBe("forbidden");
    expect((await change(f.ownerRace, list.rowOf(f.staff.accountId).grantId, "FUNCTIONARY")).status).toBe("conflict");
    expect((await change(f.ownerRace, randomUUID(), "FUNCTIONARY")).status).toBe("not-found");
    expect((await rows(f.ownerRace)).people.map(person => person.role).sort()).toEqual(["ADMIN", "COURSE_SUGGEST", "FUNCTIONARY", "OWNER"]);
  });

  it("en funktionär som redan har banläggning får inte två behörigheter av samma slag", async () => {
    const f = await setup();
    // Funktionären får också banläggning (två rader, olika slag).
    await grant(f.ownerRace, f.staff.email, "COURSE_COMMENT");
    expect(await courseLevel(f.staff.proof, f.raceId)).toBe("COMMENT");
    const list = await rows(f.ownerRace);
    expect(list.roleOf(f.staff.accountId).sort()).toEqual(["COURSE_COMMENT", "FUNCTIONARY"]);
    const event = list.people.find(person => person.accountId === f.staff.accountId && person.role === "FUNCTIONARY")!;
    const course = list.people.find(person => person.accountId === f.staff.accountId && person.role === "COURSE_COMMENT")!;
    expect((await change(f.ownerRace, event.grantId, "COURSE_EDIT")).status).toBe("conflict");
    expect((await change(f.ownerRace, course.grantId, "FUNCTIONARY")).status).toBe("conflict");
    expect((await change(f.ownerRace, course.grantId, "COURSE_EDIT")).status).toBe("changed");
    expect((await rows(f.ownerRace)).roleOf(f.staff.accountId).sort()).toEqual(["COURSE_EDIT", "FUNCTIONARY"]);
  });

  it("en väntande inbjudan får den nya rollen, som gäller när personen loggar in", async () => {
    const f = await setup();
    const suffix = randomUUID().slice(0, 8), email = `ny.${suffix}@test.o-tid.se`;
    const invitationId = await grant(f.adminRace, email, "FUNCTIONARY");
    expect((await change(f.adminRace, invitationId, "ADMIN")).status).toBe("forbidden");
    const changed = await change(f.adminRace, invitationId, "COURSE_MAP");
    expect(changed.status === "changed" && changed.response.grantId).toBe(invitationId);
    expect((await rows(f.adminRace)).invitations.filter(row => row.email === email).map(row => row.role)).toEqual(["COURSE_MAP"]);
    // Adressen har redan en inbjudan till eventet: banläggningens inbjudan kan inte byta till samma slag.
    const second = await grant(f.adminRace, email, "FUNCTIONARY");
    expect((await change(f.adminRace, invitationId, "FUNCTIONARY")).status).toBe("conflict");
    expect((await change(f.ownerRace, second, "ADMIN")).status).toBe("changed");
    const account = await registerTestAccount(db, `ny.${suffix}`);
    const entered = await enter(account.proof, f.raceId);
    expect(entered.status === "ok" && entered.role).toBe("ADMIN");
  });

  it("samma begäran två gånger ger samma kvitto; annan rad med samma id är en konflikt", async () => {
    const f = await setup();
    const staff = (await rows(f.ownerRace)).rowOf(f.staff.accountId), requestId = randomUUID();
    const first = await change(f.ownerRace, staff.grantId, "COURSE_SUGGEST", requestId);
    const again = await change(f.ownerRace, staff.grantId, "COURSE_SUGGEST", requestId);
    if (first.status !== "changed" || again.status !== "changed") throw new Error("Bytet gick inte igenom");
    expect(again.response).toEqual({ ...first.response, replayed: true });
    expect((await change(f.ownerRace, staff.grantId, "COURSE_EDIT", requestId)).status).toBe("conflict");
    const journal = await pool.query<{ after: { from: string; to: string } }>(
      "select after from audit_event where request_id = $1 and action = 'RACE_PERSON_ROLE_CHANGED'", [requestId]);
    expect(journal.rows.map(row => [row.after.from, row.after.to])).toEqual([["FUNCTIONARY", "COURSE_SUGGEST"]]);
  });
});
