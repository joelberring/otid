import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readPpen } from "@o-tid/course-setting";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import {
  addAccountClub, answerAccountClubStep, decideClubAffiliation, readAccountClubs, readClubAffiliation, removeAccountClub, setClubAccessSettings
} from "../../src/club-affiliations";
import { clubsOfMember } from "../../src/club-affiliation-access";
import { readClubArchive, readClubArchiveEntry, readClubCourseFile } from "../../src/club-archive";
import { linkClubToEventor, syncClubEventorMembers, syncClubEventorMembersAsAdmin, unlinkClubFromEventor } from "../../src/club-eventor";
import { readClubMapVersionHead } from "../../src/club-maps";
import { createClub, inviteClubMember, listMyClubs, readClub } from "../../src/clubs";
import { eventorConfigurationFromEnvironment } from "../../src/eventor-secret";
import { createOrganizerEvent } from "../../src/organizer-events";
import { importOrganisationsFromXml, refreshOrganisationsFromEventor, searchOrganisations } from "../../src/organisations";
import { liftRaceToClubArchive, readRaceClubArchiveAsAdmin, removeRaceFromClubArchive, setRaceOrganiserAsAdmin } from "../../src/race-club-archive";
import { inviteFromClub, readClubPicker } from "../../src/club-invite";
import { acceptRacePersonInvitations } from "../../src/race-person-invitations";
import { listRacePeopleAsAdmin } from "../../src/race-people";
import { registerTestAccount } from "./accounts";
import { registerUserAccountWithVerification } from "../../src/email-verification";
import { completePasswordReset, requestPasswordReset } from "../../src/password-reset";
import { signInWithGoogle } from "../../src/google-login";

/**
 * ADR-0209 mot PostgreSQL: klubblistan, Mina klubbar, kopplingen med klubbens Eventor-nyckel (falsk Eventor via fetch-attrapp),
 * medlemslistan som HMAC, bekräftelser, Vem ser vad, och tävlingen i klubbarkivet. Inga riktiga anrop till Eventor.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
process.env.OTID_EVENTOR_MASTER_KEY = randomBytes(32).toString("base64");
const configuration = eventorConfigurationFromEnvironment(process.env);
const admin = createDatabase(base);
const databaseName = `otid_adr0209_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const NOW = new Date("2026-11-03T20:00:00Z");
const CLUB_KEY = "okao0club0key0abcdefghij0123wxyz";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  await importOrganisationsFromXml(db, await readFile(new URL("eventor/organisations-directory.xml", fixtures), "utf8"), NOW);
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0209_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const xml = (body: string) => new Response(body, { headers: { "content-type": "text/xml; charset=utf-8" } });
const organisationXml = `<Organisation><OrganisationId>9901</OrganisationId><Name>OK Älvsjö-Örby</Name><OrganisationTypeId>3</OrganisationTypeId></Organisation>`;
const personsXml = (emails: readonly string[]) => `<PersonList>${emails.map((email, index) => `<Person><PersonName><Family>Påhitt</Family>
  <Given>Person ${index}</Given></PersonName><PersonId>${800000 + index}</PersonId><Tele mailAddress="${email}" mobilePhoneNumber="070-1"/></Person>`).join("")}</PersonList>`;

/** Falsk Eventor: nyckeln → OK Älvsjö-Örby; medlemslistan går att byta. */
function fakeEventor(members: { emails: string[] }) {
  return vi.fn(async (target: string, init?: RequestInit) => {
    const { pathname } = new URL(target);
    if ((init?.headers as Record<string, string>).ApiKey !== CLUB_KEY) return new Response("", { status: 401 });
    if (pathname === "/api/organisation/apiKey") return xml(organisationXml);
    if (pathname === "/api/persons/organisations/9901") return xml(personsXml(members.emails));
    if (pathname === "/api/organisations") return xml(await readFile(new URL("eventor/organisations-directory.xml", fixtures), "utf8"));
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

async function okao() {
  const [row] = await db.select().from(schema.organisations).where(eq(schema.organisations.eventorId, "9901"));
  return row!;
}

async function space(name = "OK Älvsjö-Örby") {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name } }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { owner, clubId: created.club.clubId };
}

/** Ett klubbarkiv kopplat till OK Älvsjö-Örby med en falsk Eventor (en kopplad klubb per test: kopplingen frigörs efteråt). */
async function linkedSpace(members: { emails: string[] }) {
  const s = await space();
  const fetch = fakeEventor(members);
  const linked = await linkClubToEventor(db, { ...s.owner.proof, clubId: s.clubId, apiKey: CLUB_KEY, configuration, fetch }, NOW);
  expect(linked).toEqual({ status: "linked", organisationName: "OK Älvsjö-Örby" });
  return { ...s, fetch, unlink: () => unlinkClubFromEventor(db, { ...s.owner.proof, clubId: s.clubId }, NOW) };
}

describe("ADR-0209: klubblistan", () => {
  it("söker utan accenter och på kortnamn och initialer", async () => {
    // Början av namnet först.
    expect((await searchOrganisations(db, "älvsjö")).map(row => row.name)).toEqual(["Älvsjö Friluftsklubb", "OK Älvsjö-Örby"]);
    expect((await searchOrganisations(db, "okäö")).map(row => row.name)).toEqual(["OK Älvsjö-Örby"]);
    expect((await searchOrganisations(db, "OKAO"))[0]?.name).toBe("OK Älvsjö-Örby");
    expect(await searchOrganisations(db, "stockholm")).toEqual([]);
    expect((await searchOrganisations(db, "stockholm", { types: ["DISTRICT"] }))[0]?.name).toBe("Stockholms Orienteringsförbund");
  });

  it("hämtar från Eventor högst en gång per dygn; en fil kan läsas in när som helst", async () => {
    const fetch = fakeEventor({ emails: [] });
    const first = await refreshOrganisationsFromEventor(db, { apiKey: CLUB_KEY, fetch, now: NOW });
    expect(first).toMatchObject({ status: "done", report: { organisations: 8, added: 0 } });
    expect(await refreshOrganisationsFromEventor(db, { apiKey: CLUB_KEY, fetch, now: new Date(NOW.getTime() + 3_600_000) }))
      .toMatchObject({ status: "too-soon" });
    expect(fetch.mock.calls).toHaveLength(1);
    expect(await refreshOrganisationsFromEventor(db, { apiKey: CLUB_KEY, fetch, force: true, now: new Date(NOW.getTime() + 7_200_000) }))
      .toMatchObject({ status: "done" });
    expect(await importOrganisationsFromXml(db, "<OrganisationList/>", NOW)).toEqual({ status: "empty" });
  });
});

describe("ADR-0209: Mina klubbar och bekräftelser", { timeout: 60_000 }, () => {
  it("en egen anmälan ger ingenting; en icke-medlem ser ingen lista; bekräftad ger läsare, borttagen tar bort den", async () => {
    const { owner, clubId, unlink } = await linkedSpace({ emails: [] });
    const runner = await registerTestAccount(db, undefined, NOW);
    const stranger = await registerTestAccount(db, undefined, NOW);
    const added = await addAccountClub(db, { ...runner.proof, request: { formatVersion: 1, organisationId: (await okao()).id, freeText: null } }, NOW);
    expect(added).toMatchObject({ status: "added", response: { memberships: [{ status: "PENDING", spaceExists: true, clubName: null }] } });
    // Väntar: inget i arkivet, och arkivets namn röjs inte.
    expect((await readClub(db, { ...runner.proof, clubId }, NOW)).status).toBe("not-found");
    expect((await readClubAffiliation(db, { ...stranger.proof, clubId }, NOW)).status).toBe("not-found");
    expect((await readClubAffiliation(db, { ...runner.proof, clubId }, NOW)).status).toBe("not-found");
    const view = await readClubAffiliation(db, { ...owner.proof, clubId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.pending.map(person => person.displayName)).toEqual([`Arrangör ${runner.email.split("@")[0]}`]);
    expect(JSON.stringify(view.view)).not.toContain(runner.email);

    const membershipId = view.view.pending[0]!.membershipId;
    expect((await decideClubAffiliation(db, { ...owner.proof, clubId, request: { formatVersion: 1, membershipId, decision: "CONFIRM" } }, NOW)).status).toBe("ok");
    const member = await readClub(db, { ...runner.proof, clubId }, NOW);
    expect(member).toMatchObject({ status: "ok", view: { viewer: { role: "READER" }, eventorClub: "OK Älvsjö-Örby" } });
    expect((await listMyClubs(db, runner.proof, NOW))).toMatchObject({ status: "ok", clubs: [{ clubId, role: "READER" }] });
    expect(await readAccountClubs(db, runner.proof, NOW)).toMatchObject({ status: "ok", response: { memberships: [{ status: "CONFIRMED", via: "MANUAL",
      clubName: "OK Älvsjö-Örby", clubId }] } });
    // En läsare får inte se bekräftelserna.
    expect((await readClubAffiliation(db, { ...runner.proof, clubId }, NOW)).status).toBe("forbidden");

    // Kontot tar bort klubben: läsarrätten följer med.
    expect((await removeAccountClub(db, { ...runner.proof, request: { formatVersion: 1, membershipId } }, NOW)).status).toBe("removed");
    expect((await readClub(db, { ...runner.proof, clubId }, NOW)).status).toBe("not-found");
    const journal = await db.select({ action: schema.clubJournal.action }).from(schema.clubJournal).where(eq(schema.clubJournal.clubId, clubId));
    expect(journal.map(row => row.action)).toEqual(expect.arrayContaining(["CLUB_EVENTOR_LINKED", "CLUB_AFFILIATION_CONFIRMED", "CLUB_AFFILIATION_LEFT"]));
    await unlink();
  });

  it("administratören tar bort en bekräftad medlem; fritext matchas till arkivet; kontot tas bort med sina klubbar", async () => {
    const { owner, clubId, unlink } = await linkedSpace({ emails: [] });
    const runner = await registerTestAccount(db, undefined, NOW);
    await answerAccountClubStep(db, { ...runner.proof, request: { formatVersion: 1, organisationIds: [], freeText: "ok älvsjö-örby" } }, NOW);
    const view = await readClubAffiliation(db, { ...owner.proof, clubId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    const free = view.view.pending.find(person => person.freeText === "ok älvsjö-örby")!;
    await decideClubAffiliation(db, { ...owner.proof, clubId, request: { formatVersion: 1, membershipId: free.membershipId, decision: "CONFIRM" } }, NOW);
    expect((await readClub(db, { ...runner.proof, clubId }, NOW)).status).toBe("ok");
    expect(await clubsOfMember(db, runner.accountId)).toEqual([clubId]);
    await decideClubAffiliation(db, { ...owner.proof, clubId, request: { formatVersion: 1, membershipId: free.membershipId, decision: "REMOVE" } }, NOW);
    expect((await readClub(db, { ...runner.proof, clubId }, NOW)).status).toBe("not-found");
    expect(await readAccountClubs(db, runner.proof, NOW)).toMatchObject({ response: { memberships: [{ status: "DECLINED" }] } });

    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, runner.accountId, NOW));
    expect(await db.select().from(schema.accountClubMemberships).where(eq(schema.accountClubMemberships.accountId, runner.accountId))).toEqual([]);
    await unlink();
  });
});

describe("ADR-0209: kopplingen med klubbens Eventor-nyckel och medlemslistan", { timeout: 60_000 }, () => {
  it("nyckeln bevisar klubben, sparas krypterad och når aldrig svaren eller loggen; en klubb kopplas till ett arkiv", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map(level => vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    }));
    try {
      const { owner, clubId, unlink } = await linkedSpace({ emails: [] });
      const [setting] = await db.select().from(schema.clubSettings).where(eq(schema.clubSettings.clubId, clubId));
      expect(setting?.organisationId).toBe((await okao()).id);
      expect(setting?.eventorKeyHint).toBe("wxyz");
      expect(JSON.stringify(setting)).not.toContain(CLUB_KEY);
      const view = await readClubAffiliation(db, { ...owner.proof, clubId }, NOW);
      expect(JSON.stringify(view)).not.toContain(CLUB_KEY);
      expect(view).toMatchObject({ view: { eventor: { linked: true, keyHint: "wxyz" } } });
      expect(JSON.stringify(await readClub(db, { ...owner.proof, clubId }, NOW))).not.toContain(CLUB_KEY);

      // Ett annat arkiv kan inte kopplas till samma klubb.
      const other = await space("Älvsjö-Örby igen");
      expect(await linkClubToEventor(db, { ...other.owner.proof, clubId: other.clubId, apiKey: CLUB_KEY, configuration, fetch: fakeEventor({ emails: [] }) }, NOW))
        .toEqual({ status: "problem", problem: "ALREADY_LINKED" });
      // Fel nyckel: Eventor avvisar, inget sparas.
      expect(await linkClubToEventor(db, { ...other.owner.proof, clubId: other.clubId, apiKey: "fel0nyckel0000000000000000000000", configuration,
        fetch: fakeEventor({ emails: [] }) }, NOW)).toEqual({ status: "problem", problem: "REJECTED" });
      // Bara administratörer kopplar.
      const reader = await registerTestAccount(db, undefined, NOW);
      await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READER" } }, NOW);
      await readClub(db, { ...reader.proof, clubId }, NOW);
      expect((await linkClubToEventor(db, { ...reader.proof, clubId, apiKey: CLUB_KEY, configuration, fetch: fakeEventor({ emails: [] }) }, NOW)).status)
        .toBe("forbidden");
      await unlink();
      expect(logs.join("\n")).not.toContain(CLUB_KEY);
    } finally { for (const spy of spies) spy.mockRestore(); }
  });

  it("adressen i medlemslistan bekräftar automatiskt (HMAC); slutar personen tas det bort; bekräftelser för hand står kvar", async () => {
    const maja = await registerTestAccount(db, `maja.${randomUUID().slice(0, 6)}`, NOW);
    const manual = await registerTestAccount(db, undefined, NOW);
    const unverified = await registerTestAccount(db, undefined, NOW, { verified: false });
    const members = { emails: [maja.email.toUpperCase(), unverified.email, "inte.i.otid@exempel.se"] };
    const { owner, clubId, fetch, unlink } = await linkedSpace(members);
    // Bara Eventors id och en hash; inga namn eller adresser.
    const stored = await db.select().from(schema.clubEventorMembers).where(eq(schema.clubEventorMembers.clubId, clubId));
    expect(stored).toHaveLength(3);
    expect(stored.every(row => /^[a-f0-9]{64}$/.test(row.emailHmac))).toBe(true);
    expect(JSON.stringify(stored)).not.toMatch(/exempel|Påhitt|070-1/);
    // Maja är bekräftad direkt (hon behöver inte ens ha valt klubben); den obekräftade adressen ger inget.
    expect(await readAccountClubs(db, maja.proof, NOW)).toMatchObject({ response: { memberships: [{ status: "CONFIRMED", via: "EVENTOR" }] } });
    expect((await readClub(db, { ...maja.proof, clubId }, NOW)).status).toBe("ok");
    expect((await readClub(db, { ...unverified.proof, clubId }, NOW)).status).not.toBe("ok");
    const status = await readClubAffiliation(db, { ...owner.proof, clubId }, NOW);
    expect(status).toMatchObject({ view: { eventor: { members: 3, confirmedViaEventor: 1 } } });

    // Någon vars adress skiljer sig bekräftas för hand.
    await addAccountClub(db, { ...manual.proof, request: { formatVersion: 1, organisationId: (await okao()).id, freeText: null } }, NOW);
    const pending = await readClubAffiliation(db, { ...owner.proof, clubId }, NOW);
    if (pending.status !== "ok") throw new Error(pending.status);
    await decideClubAffiliation(db, { ...owner.proof, clubId, request: { formatVersion: 1, membershipId: pending.view.pending[0]!.membershipId,
      decision: "CONFIRM" } }, NOW);

    // Maja slutar i klubben: nästa hämtning tar bort det Eventor gav. Den manuella står kvar. "Hämta medlemmar nu" högst en gång i timmen.
    members.emails = ["inte.i.otid@exempel.se"];
    expect(await syncClubEventorMembersAsAdmin(db, { ...owner.proof, clubId, configuration, fetch }, new Date(NOW.getTime() + 60_000)))
      .toEqual({ status: "problem", problem: "TOO_SOON" });
    expect(await syncClubEventorMembers(db, { clubId, configuration, fetch }, new Date(NOW.getTime() + 2 * 3_600_000)))
      .toEqual({ status: "synced", members: 1, confirmed: 0, withdrawn: 1 });
    expect((await readClub(db, { ...maja.proof, clubId }, NOW)).status).toBe("not-found");
    expect(await readAccountClubs(db, maja.proof, NOW)).toMatchObject({ response: { memberships: [] } });
    expect((await readClub(db, { ...manual.proof, clubId }, NOW)).status).toBe("ok");
    await unlink();
  });
});

describe("ADR-0209: Vem ser vad", { timeout: 60_000 }, () => {
  it("medlemmar ser arkivet men inte kartbanken (förval); ledare båda; ägare och administratörer alltid allt", async () => {
    const { owner, clubId } = await space("Vem ser vad-klubben");
    const people = Object.fromEntries(await Promise.all((["READER", "LEADER", "ADMIN"] as const).map(async role => {
      const account = await registerTestAccount(db, undefined, NOW);
      await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: account.email, role } }, NOW);
      await readClub(db, { ...account.proof, clubId }, NOW);
      return [role, account] as const;
    })));
    const access = async (proof: typeof owner.proof) => {
      const list = await readClubArchive(db, { ...proof, clubId }, NOW);
      return list.status === "ok" ? list.list.viewer.access : list.status;
    };
    const fakeVersion = randomUUID();
    const mapBank = async (proof: typeof owner.proof) => (await readClubMapVersionHead(db, { ...proof, clubId, versionId: fakeVersion }, NOW)).status;
    expect(await access(people.READER!.proof)).toEqual({ archive: true, mapBank: false });
    expect(await mapBank(people.READER!.proof)).toBe("forbidden");
    expect(await mapBank(people.LEADER!.proof)).toBe("not-found");
    expect(await access(people.LEADER!.proof)).toEqual({ archive: true, mapBank: true });

    // Strängast: arkivet bara för ledare och admin.
    expect((await setClubAccessSettings(db, { ...people.LEADER!.proof, clubId, request: { formatVersion: 1, archive: "LEADERS", mapBank: "LEADERS" } }, NOW))
      .status).toBe("forbidden");
    await setClubAccessSettings(db, { ...owner.proof, clubId, request: { formatVersion: 1, archive: "LEADERS", mapBank: "LEADERS" } }, NOW);
    const hidden = await readClubArchive(db, { ...people.READER!.proof, clubId }, NOW);
    expect(hidden).toMatchObject({ status: "ok", list: { entries: [], maps: [], viewer: { access: { archive: false, mapBank: false } } } });
    expect((await readClubArchiveEntry(db, { ...people.READER!.proof, clubId, entryId: randomUUID() }, NOW)).status).toBe("forbidden");
    expect((await readClubCourseFile(db, { ...people.READER!.proof, clubId, courseFileId: randomUUID() }, NOW)).status).toBe("forbidden");
    // Ägare och administratörer: allt, oavsett inställningarna.
    for (const proof of [owner.proof, people.ADMIN!.proof]) {
      expect(await access(proof)).toEqual({ archive: true, mapBank: true });
      expect(await mapBank(proof)).toBe("not-found");
      expect((await readClubAffiliation(db, { ...proof, clubId }, NOW)).status).toBe("ok");
    }
    // Alla medlemmar får kartbanken.
    await setClubAccessSettings(db, { ...owner.proof, clubId, request: { formatVersion: 1, archive: "MEMBERS", mapBank: "MEMBERS" } }, NOW);
    expect(await access(people.READER!.proof)).toEqual({ archive: true, mapBank: true });
  });

  it("klubbar från före ADR-0209 behåller kartbanken för sina inbjudna läsare (migrationens rad)", async () => {
    const rows = (await pool.query<{ n: number }>("select count(*)::int as n from club_setting where map_bank_access = 'MEMBERS'")).rows;
    expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
  });
});

describe("ADR-0209: tävlingen i klubbarkivet", { timeout: 60_000 }, () => {
  async function race(proof: { sessionToken: string; csrfCookie: string; csrfHeader: string }, raceDate: string) {
    const created = await createOrganizerEvent(db, { ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Höstsprinten", raceName: "Final", raceDate, timeZone: "Europe/Stockholm", raceType: "STANDARD" }) }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    return created.response.raceId;
  }

  it("bara den som är administratör i båda lägger in och tar ur; inga personuppgifter; banhemligheten kräver bekräftelse", async () => {
    const { owner, clubId, unlink } = await linkedSpace({ emails: [] });
    // Ägaren av arkivet är bekräftad medlem: tävlingen får arrangörsklubben förvald.
    const ownerMembership = await addAccountClub(db, { ...owner.proof, request: { formatVersion: 1, organisationId: (await okao()).id, freeText: null } }, NOW);
    const view = await readClubAffiliation(db, { ...owner.proof, clubId }, NOW);
    if (view.status !== "ok" || ownerMembership.status !== "added") throw new Error("ingen tillhörighet");
    await decideClubAffiliation(db, { ...owner.proof, clubId, request: { formatVersion: 1, membershipId: view.view.pending[0]!.membershipId,
      decision: "CONFIRM" } }, NOW);
    const raceId = await race(owner.proof, "2026-11-10");
    const raceProof = { ...owner.proof, raceId };
    expect(await readRaceClubArchiveAsAdmin(db, raceProof, NOW)).toMatchObject({ status: "ok", view: { organiser: { name: "OK Älvsjö-Örby" },
      space: "ADMIN", finished: false, lifted: null } });
    const document = readPpen(await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8")).document;
    await db.insert(schema.courseSettings).values({ raceId, document: document as never, version: 1, updatedAt: NOW, updatedBy: owner.accountId });

    // Före tävlingen: bekräftelse krävs.
    expect((await liftRaceToClubArchive(db, { ...raceProof, request: { formatVersion: 1, confirmSecrecy: false } }, NOW)).status).toBe("secret");
    // En tävlingsadministratör som inte är administratör i arkivet får inte (och ser inte att arkivet finns).
    const coAdmin = await registerTestAccount(db, undefined, NOW);
    const { grantRacePerson } = await import("./accounts");
    await grantRacePerson(db, owner.proof, raceId, coAdmin.email, "ADMIN", NOW);
    expect((await liftRaceToClubArchive(db, { ...coAdmin.proof, raceId, request: { formatVersion: 1, confirmSecrecy: true } }, NOW)).status).toBe("no-space");
    expect(await readRaceClubArchiveAsAdmin(db, { ...coAdmin.proof, raceId }, NOW)).toMatchObject({ view: { space: "NONE", spaceName: null } });
    // En medlem i arkivet (läsare) som är tävlingsadministratör: förbjudet.
    await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: coAdmin.email, role: "READER" } }, NOW);
    await readClub(db, { ...coAdmin.proof, clubId }, NOW);
    expect((await liftRaceToClubArchive(db, { ...coAdmin.proof, raceId, request: { formatVersion: 1, confirmSecrecy: true } }, NOW)).status).toBe("forbidden");

    const after = new Date("2026-11-11T08:00:00Z");
    const lifted = await liftRaceToClubArchive(db, { ...raceProof, request: { formatVersion: 1, confirmSecrecy: false } }, after);
    if (lifted.status !== "ok") throw new Error(lifted.status);
    const entryId = lifted.view.lifted!.entryId;
    const entry = await readClubArchiveEntry(db, { ...owner.proof, clubId, entryId }, after);
    if (entry.status !== "ok") throw new Error(entry.status);
    expect(entry.view.entry).toMatchObject({ title: "Höstsprinten · Final", trainingDate: "2026-11-10", leader: null });
    expect(entry.view.sourceRace).toMatchObject({ raceId, name: "Höstsprinten · Final", exists: true });
    expect(entry.view.courseFiles.map(file => file.kind).sort()).toEqual(["COURSE_DATA", "PPEN"]);
    const contents = (await db.select({ content: schema.clubArchiveCourseFiles.content }).from(schema.clubArchiveCourseFiles)
      .where(eq(schema.clubArchiveCourseFiles.entryId, entryId))).map(row => row.content.toString("utf8")).join("\n");
    for (const personal of [owner.email, coAdmin.email, `Arrangör ${owner.email.split("@")[0]}`]) expect(contents).not.toContain(personal);
    expect(JSON.stringify(entry.view)).not.toContain(owner.email);
    expect((await liftRaceToClubArchive(db, { ...raceProof, request: { formatVersion: 1, confirmSecrecy: false } }, after)).status).toBe("already");
    expect((await removeRaceFromClubArchive(db, { ...coAdmin.proof, raceId }, after)).status).toBe("forbidden");

    // Ta ur: träningen borta, tävlingen orörd.
    const removed = await removeRaceFromClubArchive(db, raceProof, after);
    expect(removed).toMatchObject({ status: "ok", view: { lifted: null } });
    expect((await readClubArchiveEntry(db, { ...owner.proof, clubId, entryId }, after)).status).toBe("not-found");
    const [stillThere] = await db.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, raceId));
    expect(stillThere?.id).toBe(raceId);
    expect((await removeRaceFromClubArchive(db, raceProof, after)).status).toBe("not-lifted");

    // Arrangörsklubben kan ändras och tas bort av tävlingens administratör.
    expect(await setRaceOrganiserAsAdmin(db, { ...raceProof, request: { formatVersion: 1, organisationId: null } }, after))
      .toMatchObject({ status: "ok", view: { organiser: null, space: "NONE" } });
    await unlink();
  });
});

describe("ADR-0209: Från klubben", { timeout: 60_000 }, () => {
  it("väljaren har namnen på bekräftade medlemmar i mina klubbar; inbjudan går till adressen som aldrig syns", async () => {
    const { owner, clubId, unlink } = await linkedSpace({ emails: [] });
    const other = await space("Mossbergets OK");
    const confirm = async (account: Awaited<ReturnType<typeof registerTestAccount>>, spaceOwner: typeof owner, spaceId: string, text: string) => {
      await addAccountClub(db, { ...account.proof, request: { formatVersion: 1, organisationId: null, freeText: text } }, NOW);
      const view = await readClubAffiliation(db, { ...spaceOwner.proof, clubId: spaceId }, NOW);
      if (view.status !== "ok") throw new Error(view.status);
      const row = view.view.pending.find(person => person.displayName === `Arrangör ${account.email.split("@")[0]}`)!;
      await decideClubAffiliation(db, { ...spaceOwner.proof, clubId: spaceId, request: { formatVersion: 1, membershipId: row.membershipId, decision: "CONFIRM" } }, NOW);
    };
    const inviterAccount = await registerTestAccount(db, undefined, NOW);
    const clubmate = await registerTestAccount(db, undefined, NOW);
    const outsider = await registerTestAccount(db, undefined, NOW);
    await confirm(inviterAccount, owner, clubId, "OK Älvsjö-Örby");
    await confirm(clubmate, owner, clubId, "OKÄÖ");
    await confirm(outsider, other.owner, other.clubId, "Mossbergets OK");

    const created = await createOrganizerEvent(db, { ...inviterAccount.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Klubbkväll", raceName: "", raceDate: "2026-11-20", timeZone: "Europe/Stockholm",
        raceType: "TRAINING" }) }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const raceId = created.response.raceId;
    const context = { kind: "RACE" as const, id: raceId };
    const picker = await readClubPicker(db, { ...inviterAccount.proof, context }, NOW);
    if (picker.status !== "ok") throw new Error(picker.status);
    expect(picker.response.members.map(member => member.displayName)).toEqual(expect.arrayContaining([`Arrangör ${clubmate.email.split("@")[0]}`]));
    expect(picker.response.members.map(member => member.displayName)).not.toContain(`Arrangör ${outsider.email.split("@")[0]}`);
    expect(JSON.stringify(picker.response)).not.toMatch(/@test\.o-tid\.se/);
    // Den som inte är med i klubben ser ingen lista; utan behörighet i sammanhanget ingenting alls.
    expect(await readClubPicker(db, { ...other.owner.proof, context: { kind: "CLUB", id: other.clubId } }, NOW))
      .toMatchObject({ status: "ok", response: { members: [expect.objectContaining({ displayName: `Arrangör ${outsider.email.split("@")[0]}` })] } });
    expect((await readClubPicker(db, { ...outsider.proof, context }, NOW)).status).toBe("unauthorized");
    expect((await readClubPicker(db, { ...outsider.proof, context: { kind: "CLUB", id: clubId } }, NOW)).status).toBe("not-found");

    const ref = picker.response.members.find(member => member.displayName.endsWith(clubmate.email.split("@")[0]!))!.ref;
    const invited = await inviteFromClub(db, { ...inviterAccount.proof, request: { formatVersion: 1, requestId: randomUUID(), context, refs: [ref],
      role: "FUNCTIONARY" } }, NOW);
    expect(invited).toEqual({ status: "ok", response: { formatVersion: 1, invited: 1, already: 0, failed: 0 } });
    expect(JSON.stringify(invited)).not.toContain(clubmate.email);
    const [invitation] = await db.select().from(schema.racePersonInvitations).where(eq(schema.racePersonInvitations.raceId, raceId));
    expect(invitation).toMatchObject({ email: clubmate.email, role: "FUNCTIONARY" });
    const people = await listRacePeopleAsAdmin(db, { ...inviterAccount.proof, raceId }, NOW);
    if (people.status !== "ok") throw new Error(people.status);
    expect(people.response.invitations).toEqual([expect.objectContaining({ email: "", displayName: `Arrangör ${clubmate.email.split("@")[0]}` })]);
    expect(JSON.stringify(people.response)).not.toContain(clubmate.email);
    // Personen tar inbjudan som vanligt; adressen syns ändå inte i listan.
    await db.transaction(tx => acceptRacePersonInvitations(tx, clubmate.accountId, NOW, raceId));
    const after = await listRacePeopleAsAdmin(db, { ...inviterAccount.proof, raceId }, NOW);
    expect(JSON.stringify(after)).not.toContain(clubmate.email);
    if (after.status !== "ok") throw new Error(after.status);
    expect(after.response.people.find(person => person.accountId === clubmate.accountId)).toMatchObject({ role: "FUNCTIONARY", email: "", fromClub: true });
    // Igen: redan med. En person utanför listan: hela begäran avvisas.
    expect(await inviteFromClub(db, { ...inviterAccount.proof, request: { formatVersion: 1, requestId: randomUUID(), context, refs: [ref],
      role: "FUNCTIONARY" } }, NOW)).toMatchObject({ response: { invited: 0, already: 1 } });
    const outsiderRef = (await db.select({ id: schema.accountClubMemberships.id }).from(schema.accountClubMemberships)
      .where(eq(schema.accountClubMemberships.accountId, outsider.accountId)))[0]!.id;
    expect((await inviteFromClub(db, { ...inviterAccount.proof, request: { formatVersion: 1, requestId: randomUUID(), context, refs: [outsiderRef],
      role: "FUNCTIONARY" } }, NOW)).status).toBe("not-found");
    expect((await inviteFromClub(db, { ...inviterAccount.proof, request: { formatVersion: 1, requestId: randomUUID(), context, refs: [ref],
      role: "OWNER" } }, NOW)).status).toBe("invalid-request");

    // I klubbytan: inbjudan till klubben, och listan visar namnet.
    const clubPicker = await readClubPicker(db, { ...owner.proof, context: { kind: "CLUB", id: clubId } }, NOW);
    if (clubPicker.status !== "ok") throw new Error(clubPicker.status);
    expect(clubPicker.response.members.every(member => !member.already)).toBe(true);
    await inviteFromClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), context: { kind: "CLUB", id: clubId },
      refs: [clubPicker.response.members[0]!.ref], role: "LEADER" } }, NOW);
    const clubView = await readClub(db, { ...owner.proof, clubId }, NOW);
    if (clubView.status !== "ok") throw new Error(clubView.status);
    expect(clubView.view.invitations).toEqual([expect.objectContaining({ email: "", role: "LEADER" })]);
    await unlink();
  });
});

describe("ADR-0205: medlemslistan vid inloggning med Google och med återställningslänken", { timeout: 60_000 }, () => {
  it("bekräftar tillhörigheten direkt när adressen blir bekräftad, också för ett konto som aldrig bekräftades", async () => {
    const google = `google.${randomUUID().slice(0, 8)}@test.o-tid.se`;
    const reset = `reset.${randomUUID().slice(0, 8)}@test.o-tid.se`;
    const { clubId, unlink } = await linkedSpace({ emails: [google, reset] });
    const confirmed = async (accountId: string) => (await db.select().from(schema.accountClubMemberships)
      .where(eq(schema.accountClubMemberships.accountId, accountId))).filter(row => row.status === "CONFIRMED" && row.clubId === clubId);

    const signed = await signInWithGoogle(db, { sub: `sub-${randomUUID().slice(0, 8)}`, email: google, emailVerified: true, name: "G" }, { now: NOW });
    if (signed.status !== "authenticated") throw new Error(signed.status);
    expect(await confirmed(signed.response.accountId)).toHaveLength(1);

    const registered = await registerUserAccountWithVerification(db, { formatVersion: 1, email: reset, displayName: "R", password: "skrevs-fel-1" },
      { now: NOW });
    expect(registered.delivery?.kind).toBe("VERIFY");
    const requested = await requestPasswordReset(db, { formatVersion: 1, email: reset }, { now: NOW });
    if (requested.status !== "accepted" || !requested.delivery) throw new Error("Återställningslänken saknas");
    const done = await completePasswordReset(db, { formatVersion: 1, token: requested.delivery.token, password: "tankt-losen-1" }, { now: NOW });
    if (done.status !== "authenticated") throw new Error(done.status);
    expect(await confirmed(done.response.accountId)).toHaveLength(1);
    await unlink();
  });
});
