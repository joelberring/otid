import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createClub, inviteClubMember } from "../../src/clubs";
import { createOrganizerEvent } from "../../src/organizer-events";
import { grantRacePersonAsAdmin } from "../../src/race-people";
import { addGroupMember, createTrainingGroup } from "../../src/training-groups";
import { requireRaceRole } from "../../src/race-session";
import { requireCourseSettingAccess } from "../../src/course-setting-access";
import { acceptAllInvitations } from "../../src/account-arrival";
import { signInWithGoogle } from "../../src/google-login";
import { moveGoogleLinkByCommand } from "../../src/google-link";
import { registerTestAccount } from "./accounts";

/**
 * Städrundan C4: begrepp och "två sanningar" mot PostgreSQL. Inbjudningar tas på ett ställe (account-arrival.ts), och en
 * behörighetskontroll tar bara inbjudningar som gäller det den kontrollerar.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("C4-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_c4begrepp_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-07T12:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_c4begrepp_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Natt-KM", raceName: "", raceDate: "2027-10-07", timeZone: "Europe/Stockholm" }) }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { owner, raceId: created.response.raceId };
}

describe("C4: en acceptansväg för inbjudningar", () => {
  it("en tävlingsbehörighetskoll tar tävlingens inbjudan men inte klubbens eller en annan grupps; ankomsten tar alla", async () => {
    const person = await registerTestAccount(db, undefined, NOW);
    // Klubbinbjudan.
    const clubOwner = await registerTestAccount(db, undefined, NOW);
    const club = await createClub(db, { ...clubOwner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Påhitt" } }, NOW);
    if (club.status !== "created") throw new Error(club.status);
    const invited = await inviteClubMember(db, { ...clubOwner.proof, clubId: club.club.clubId,
      request: { formatVersion: 1, requestId: randomUUID(), email: person.email, role: "READER" } }, NOW);
    if (invited.status !== "invited") throw new Error(invited.status);
    // Gruppinbjudan i en grupp som inte har med tävlingen att göra.
    const leader = await registerTestAccount(db, undefined, NOW);
    const group = await createTrainingGroup(db, { ...leader.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Torsdag",
      code: `torsdag-${randomUUID().slice(0, 6)}` } }, NOW);
    if (group.status !== "created") throw new Error(group.status);
    const added = await addGroupMember(db, { ...leader.proof, groupId: group.group.groupId,
      request: { formatVersion: 1, requestId: randomUUID(), email: person.email, role: "MEMBER" } }, NOW);
    if (added.status !== "added") throw new Error(added.status);
    // Tävlingens inbjudan (administratör).
    const theRace = await race();
    const requestId = randomUUID();
    const granted = await grantRacePersonAsAdmin(db, { ...theRace.owner.proof, raceId: theRace.raceId, idempotencyKey: `race-person-grant:${requestId}`,
      readBody: async () => ({ formatVersion: 1, requestId, email: person.email, role: "ADMIN" }) }, NOW);
    if (granted.status !== "granted") throw new Error(granted.status);

    const openClub = async () => (await db.select({ acceptedAt: schema.clubInvitations.acceptedAt }).from(schema.clubInvitations)
      .where(eq(schema.clubInvitations.email, person.email)))[0]?.acceptedAt;
    const openGroup = async () => (await db.select({ acceptedAt: schema.trainingGroupInvitations.acceptedAt }).from(schema.trainingGroupInvitations)
      .where(eq(schema.trainingGroupInvitations.email, person.email)))[0]?.acceptedAt;

    const role = await requireRaceRole(db, { ...person.proof, raceId: theRace.raceId, role: "ADMIN" }, NOW);
    expect(role.status).toBe("authenticated");
    const course = await requireCourseSettingAccess(db, { ...person.proof, raceId: theRace.raceId, required: "EDIT" }, NOW);
    expect(course.status).toBe("authenticated");
    // Kontrollerna hade ingen bieffekt utanför tävlingen.
    expect(await openClub()).toBeNull();
    expect(await openGroup()).toBeNull();

    // Ankomsten (inloggning, Mina tävlingar) tar resten.
    expect(await db.transaction(tx => acceptAllInvitations(tx, person.accountId, NOW))).toBe(2);
    expect(await openClub()).toEqual(NOW);
    expect(await openGroup()).toEqual(NOW);
  });
});

describe("C4: en funktion kopplar Google-kontot", () => {
  it("inloggningen och flytten skriver samma kolumner; senaste inloggningen följer inte med till ett annat Google-konto", async () => {
    const tag = randomUUID().slice(0, 8);
    const first = { sub: `sub-a-${tag}`, email: `a.${tag}@gmail.example`, emailVerified: true, name: "Anna" };
    const second = { sub: `sub-b-${tag}`, email: `b.${tag}@gmail.example`, emailVerified: true, name: "Anna B" };
    const T1 = new Date(NOW.getTime() + 60_000);
    const T2 = new Date(NOW.getTime() + 120_000);
    const a = await signInWithGoogle(db, first, { now: NOW });
    const b = await signInWithGoogle(db, second, { now: T1 });
    if (a.status !== "authenticated" || b.status !== "authenticated") throw new Error("Ingen inloggning");
    const row = async () => (await db.select().from(schema.userAccountGoogleIdentities)
      .where(eq(schema.userAccountGoogleIdentities.accountId, a.response.accountId)))[0];
    expect(await row()).toMatchObject({ googleSub: first.sub, googleEmail: first.email, linkedAt: NOW, lastLoginAt: NOW });
    expect(await moveGoogleLinkByCommand(db, { source: second.email, target: first.email, deleteSourceIfEmpty: false }, T2))
      .toMatchObject({ status: "moved", replacedTargetLink: true });
    // Kopplingen är nu det andra Google-kontot: linkedAt står kvar, senaste inloggningen gällde det förra.
    expect(await row()).toMatchObject({ googleSub: second.sub, googleEmail: second.email, linkedAt: NOW, lastLoginAt: null });
    const again = await signInWithGoogle(db, second, { now: T2 });
    expect(again.status === "authenticated" && again.response.accountId).toBe(a.response.accountId);
    expect(await row()).toMatchObject({ googleSub: second.sub, lastLoginAt: T2 });
  });
});
