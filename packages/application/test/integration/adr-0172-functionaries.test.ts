import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent, listMyEvents } from "../../src/organizer-events";
import { grantRacePersonAsAdmin, listRacePeopleAsAdmin, revokeRacePersonAsAdmin } from "../../src/race-people";
import { requireRaceRole } from "../../src/race-session";
import { loginUserAccount, logoutUserAccountSession } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdmin, readReadoutPackageAsAdmin } from "../../src/readout-station";
import { listUnknownReadoutResolutionCandidatesAsAdmin, resolveUnknownReadoutAsAdmin } from "../../src/unknown-readout-resolution";
import { listAdministratorForestWatch } from "../../src/start-checkin-roster";
import { correctAdministratorStart, registerAdministratorReturn } from "../../src/administrator-return";
import { listSpeakerBoardAsAdmin } from "../../src/speaker-board";
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { getRelayOverviewAsAdmin } from "../../src/relay-results";
import { listCoursesForEditAsAdmin } from "../../src/course-edit";
import { loadStartDrawSetupAsAdmin } from "../../src/start-draw";
import { listResultFinalizationCandidatesAsAdmin } from "../../src/result-finalization";
import { listEntryClassesAsAdmin } from "../../src/results";
import { getStartListPublicationPreviewAsAdmin } from "../../src/start-list-publication";
import { saveRaceSettingsAsAdmin } from "../../src/race-settings";
import { getEntryStatusAsAdmin } from "../../src/entry-status";
import { listCheckinHistoryAsAdmin } from "../../src/checkin-history";
import { registerTestAccount, accountOnRace } from "./accounts";

/**
 * ADR-0172 beslut 3 / PLAN.md steg 18: rollen Funktionär. Admin lägger till ett befintligt konto med e-post;
 * funktionären läser av, direktanmäler en okänd bricka, ser kvar i skogen, start och speaker men når inget annat.
 * Samma konto kan vara inloggat på flera enheter. En borttagen funktionär förlorar åtkomsten direkt.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Funktionärstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0172_staff_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0172_staff_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = AccountProof & { raceId: string };
const START = Date.UTC(2026, 9, 8, 16, 0, 0);
const at = (seconds: number) => new Date(START + seconds * 1_000).toISOString();
const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;

async function enter(account: AccountProof, raceId: string): Promise<Proof & { role: string }> {
  const entered = await accountOnRace(db, { ...account, raceId });
  if (entered.status !== "authenticated") throw new Error(`Kom inte in i tävlingen: ${entered.status}`);
  return { raceId, role: entered.role, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

function grant(proof: Proof, email: string, role: "ADMIN" | "FUNCTIONARY") {
  const requestId = randomUUID();
  return grantRacePersonAsAdmin(db, { ...proof, idempotencyKey: `race-person-grant:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, email, role }) });
}

function revoke(proof: Proof, grantId: string) {
  const requestId = randomUUID();
  return revokeRacePersonAsAdmin(db, { ...proof, idempotencyKey: `race-person-revoke:${requestId}`,
    readBody: async () => ({ formatVersion: 1, requestId, grantId }) });
}

function batch(version: number, cardNumber: string, punches: [number, number][], finish: number): DeviceBatch {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", startPunchedAt: at(0), finishPunchedAt: at(finish),
    punches: punches.map(([code, seconds]) => ({ code, punchedAt: at(seconds) })), untimedPunchCodes: [], frames: ["02ef8300"],
    stationSerial: 999001, simulated: true };
  return { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at(finish + 60), transport: "sportident", payload, contentHash: contentHash(payload) }] };
}

/** Ägare med en tävling, en bana/klass och två anmälda; en funktionär och en medadministratör. */
async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const owner = await registerTestAccount(db, `agare.${suffix}`);
  const staff = await registerTestAccount(db, `funk.${suffix}`);
  const coadmin = await registerTestAccount(db, `med.${suffix}`);
  const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: `Klubbträning ${suffix}`, raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const raceId = created.response.raceId;
  const ownerRace = await enter(owner.proof, raceId);
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdmin(db, { ...ownerRace, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: "Lång",
      className: "H21", startRule: "PUNCH", controlCodes: [31, 32, 33] } });
  if (course.status !== "created") throw new Error("Banan kunde inte skapas");
  const classId = course.response.classId;
  const courseVersionId = (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId]))
    .rows[0]!.course_version_id;
  const register = async (proof: Proof, givenName: string, cardNumber: string) => registerEntryAsAdmin(db, { ...proof,
    idempotencyKey: `entry-registration:${randomUUID()}`, request: { formatVersion: 1, classId, expectedCourseVersionId: courseVersionId,
      expectedStartRule: "PUNCH", givenName, familyName: "Löpare",
      organisationName: "OK Test", cardNumber, fixedStartTime: null } });
  for (const [name, card] of [["Anna", "7201"], ["Bo", "7202"]] as const) {
    expect((await register(ownerRace, name, card)).status).toBe("registered");
  }
  return { owner, staff, coadmin, raceId, eventId: created.response.eventId, ownerRace, classId, register };
}

describe("ADR-0172 funktionärer", () => {
  it("admin lägger till en funktionär med e-post; funktionären når bara avläsning, direktanmälan, kvar i skogen, start och speaker", async () => {
    const f = await setup();
    // Bara befintliga konton; ingen inbjudan.
    expect((await grant(f.ownerRace, "finns.inte@test.o-tid.se", "FUNCTIONARY")).status).toBe("not-found");
    const granted = await grant(f.ownerRace, f.staff.email.toUpperCase(), "FUNCTIONARY");
    if (granted.status !== "granted") throw new Error(`Funktionären lades inte till: ${granted.status}`);
    expect(granted.response.person).toMatchObject({ email: f.staff.email, role: "FUNCTIONARY" });
    expect((await grant(f.ownerRace, f.staff.email, "ADMIN")).status).toBe("conflict");

    // Listan: ägare och funktionär med roll per person.
    const people = await listRacePeopleAsAdmin(db, f.ownerRace);
    expect(people.status === "ok" && people.response.people.map(person => [person.email, person.role])).toEqual([
      [f.owner.email, "OWNER"], [f.staff.email, "FUNCTIONARY"]]);
    expect(people.status === "ok" && people.response.viewer.role).toBe("OWNER");

    // Mina tävlingar visar tävlingen med rollen Funktionär; kontot går in som funktionär.
    const mine = await listMyEvents(db, f.staff.proof);
    expect(mine.status === "ok" && mine.response.events.map(event => [event.eventId, event.role])).toEqual([[f.eventId, "FUNCTIONARY"]]);
    const device1 = await enter(f.staff.proof, f.raceId);
    expect(device1.role).toBe("FUNCTIONARY");
    const session = await requireRaceRole(db, { ...device1, role: "FUNCTIONARY" });
    expect(session.status === "authenticated" && session.principal).toMatchObject({ role: "FUNCTIONARY",
      accountId: f.staff.accountId, grantRole: "FUNCTIONARY" });

    // Får: avläsningspaket och avläsning (känd och okänd bricka).
    const pack = await readReadoutPackageAsAdmin(db, device1);
    expect(pack.status).toBe("ok");
    const version = await snapshot(f.raceId);
    expect((await ingestReadoutsAsAdmin(db, { ...device1, batch: batch(version, "7201", [[31, 450], [32, 900], [33, 1350]], 1800) })).status).toBe("ok");
    expect((await ingestReadoutsAsAdmin(db, { ...device1, batch: batch(version, "9999", [[31, 400], [32, 800], [33, 1200]], 1500) })).status).toBe("ok");

    // Får: okänd bricka som direktanmälan, men inte koppling till en befintlig deltagare.
    const candidates = await listUnknownReadoutResolutionCandidatesAsAdmin(db, device1);
    if (candidates.status !== "ok") throw new Error("Okända brickor saknas");
    const readout = candidates.response.readouts[0]!;
    const raceClass = candidates.response.classes[0]!;
    const bo = candidates.response.entries.find(entry => entry.givenName === "Bo")!;
    const common = { formatVersion: 1 as const, readoutId: readout.id, cardNumber: readout.cardNumber,
      expectedEngineVersion: candidates.response.engineVersion };
    const existingId = randomUUID();
    expect((await resolveUnknownReadoutAsAdmin(db, { ...device1, idempotencyKey: `unknown-readout-resolution:${existingId}`,
      request: { ...common, requestId: existingId, target: "EXISTING_ENTRY", entryId: bo.id, expectedEntryVersion: bo.entryVersion,
        expectedClassId: bo.classId, expectedAssignment: bo.activeAssignment, expectedLatestResultRevision: bo.latestResultRevision } })).status)
      .toBe("forbidden");
    const newId = randomUUID();
    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...device1, idempotencyKey: `unknown-readout-resolution:${newId}`,
      request: { ...common, requestId: newId, target: "NEW_ENTRY", classId: raceClass.id, expectedCourseVersionId: raceClass.courseVersionId,
        givenName: "Direkt", familyName: "Anmäld", organisationName: null } });
    expect(resolved.status === "resolved" && resolved.response).toMatchObject({ target: "NEW_ENTRY", status: "OK" });
    const [journal] = (await pool.query<{ role: string }>("select role from unknown_readout_resolution where request_id = $1",
      [newId])).rows;
    expect(journal?.role).toBe("FUNCTIONARY");
    // Databasen tillåter inte funktionärens behörighet på en koppling till befintlig deltagare.
    await expect(pool.query("update unknown_readout_resolution set target = 'EXISTING_ENTRY' where request_id = $1", [newId])).rejects.toThrow();

    // Får: kvar i skogen, startläge och återkomst, speaker, deltagarlistan och lagvyn.
    const forest = await listAdministratorForestWatch(db, device1);
    if (forest.status !== "ok") throw new Error("Kvar i skogen saknas");
    const bosRow = forest.response.entries.find(entry => entry.displayName.includes("Bo"))!;
    const request = { formatVersion: 1, entryId: bosRow.entryId, packageVersion: forest.response.snapshotVersion,
      expectedEntryVersion: bosRow.entryVersion, observedAt: at(10) };
    const started = await correctAdministratorStart(db, { ...device1, request: { ...request, requestId: randomUUID(),
      expectedRevision: bosRow.revision, targetStartState: "STARTED" } });
    expect(started.status === "stored" && started.response.receipt.effect.kind).toBe("APPLIED");
    const returned = await registerAdministratorReturn(db, { ...device1, request: { ...request, requestId: randomUUID(),
      expectedRevision: bosRow.revision + 1, expectedStartState: "STARTED" } });
    expect(returned.status === "stored" && returned.response.receipt.effect.kind).toBe("APPLIED");
    expect((await listSpeakerBoardAsAdmin(db, device1)).status).toBe("ok");
    expect((await listEntryTransfersAsAdmin(db, device1)).status).toBe("ok");
    expect((await getRelayOverviewAsAdmin(db, device1)).status).toBe("ok");

    // Får inte: banor, lottning, anmälda, resultat, fastställande, publicering, inställningar, behörigheter.
    for (const [name, read] of [
      ["banor", () => listCoursesForEditAsAdmin(db, device1)],
      ["lottning", () => loadStartDrawSetupAsAdmin(db, device1)],
      ["deltagare", () => listEntryClassesAsAdmin(db, device1)],
      ["status", () => getEntryStatusAsAdmin(db, { ...device1, entryId: bosRow.entryId })],
      ["fastställande", () => listResultFinalizationCandidatesAsAdmin(db, device1)],
      ["publicering", () => getStartListPublicationPreviewAsAdmin(db, device1)],
      ["journal", () => listCheckinHistoryAsAdmin(db, { ...device1, entryId: bosRow.entryId, limit: 10 })],
      ["behörigheter", () => listRacePeopleAsAdmin(db, device1)]
    ] as const) expect((await read()).status, name).toBe("forbidden");
    const courseId = randomUUID();
    expect((await createManualCourseClassAsAdmin(db, { ...device1, idempotencyKey: `manual-course-class-create:${courseId}`,
      request: { formatVersion: 1, requestId: courseId, courseName: "Kort",
        className: "D21", startRule: "PUNCH", controlCodes: [31, 33] } })).status).toBe("forbidden");
    expect((await f.register(device1, "Cia", "7203")).status).toBe("forbidden");
    const settingsId = randomUUID();
    expect((await saveRaceSettingsAsAdmin(db, { ...device1, idempotencyKey: `race-settings:${settingsId}`,
      request: { formatVersion: 1, requestId: settingsId, eventName: "Kapad",
        raceName: "Kapad", raceDate: "2026-10-08", raceType: "TRAINING" } })).status).toBe("forbidden");
    expect((await grant(device1, f.coadmin.email, "FUNCTIONARY")).status).toBe("forbidden");
    // Administratörens roll gäller inte funktionären.
    expect((await requireRaceRole(db, { ...device1, role: "ADMIN" })).status).toBe("forbidden");

    // Samma konto på en annan enhet: egen session, båda läser av samtidigt. Utloggning på den ena påverkar inte den andra.
    const second = await loginUserAccount(db, { formatVersion: 1, email: f.staff.email, password: f.staff.password });
    if (second.status !== "authenticated") throw new Error("Andra enhetens inloggning misslyckades");
    const device2 = await enter({ sessionToken: second.sessionToken, csrfCookie: second.csrfToken, csrfHeader: second.csrfToken }, f.raceId);
    expect(device2.sessionToken).not.toBe(device1.sessionToken);
    const now = await snapshot(f.raceId);
    expect((await ingestReadoutsAsAdmin(db, { ...device2, batch: batch(now, "7202", [[31, 440], [32, 880], [33, 1300]], 1700) })).status).toBe("ok");
    expect((await ingestReadoutsAsAdmin(db, { ...device1, batch: batch(now, "7202", [[31, 440], [32, 880], [33, 1300]], 1700) })).status).toBe("ok");
    expect((await logoutUserAccountSession(db, device2)).status).toBe("logged-out");
    expect((await readReadoutPackageAsAdmin(db, device2)).status).toBe("unauthorized");
    expect((await readReadoutPackageAsAdmin(db, device1)).status).toBe("ok");

    // Borttagen funktionär: öppna sessioner slutar gälla direkt och kontot kommer inte in igen.
    expect((await revoke(f.ownerRace, granted.response.person.grantId)).status).toBe("revoked");
    expect((await listAdministratorForestWatch(db, device1)).status).toBe("unauthorized");
    expect((await ingestReadoutsAsAdmin(db, { ...device1, batch: batch(now, "7201", [[31, 1]], 2) })).status).toBe("unauthorized");
    expect((await accountOnRace(db, { ...f.staff.proof, raceId: f.raceId })).status).toBe("unauthorized");
    const after = await listMyEvents(db, f.staff.proof);
    expect(after.status === "ok" && after.response.events).toEqual([]);
  });

  it("administratören har funktionärens rättigheter; bara ägaren hanterar administratörer", async () => {
    const f = await setup();
    const coadmin = await grant(f.ownerRace, f.coadmin.email, "ADMIN");
    if (coadmin.status !== "granted") throw new Error("Medadministratören lades inte till");
    const coadminRace = await enter(f.coadmin.proof, f.raceId);
    expect(coadminRace.role).toBe("ADMIN");

    // Administratören når funktionärens åtgärder.
    for (const read of [() => readReadoutPackageAsAdmin(db, coadminRace), () => listAdministratorForestWatch(db, coadminRace),
      () => listSpeakerBoardAsAdmin(db, coadminRace), () => listUnknownReadoutResolutionCandidatesAsAdmin(db, coadminRace)]) {
      expect((await read()).status).toBe("ok");
    }
    expect((await requireRaceRole(db, { ...coadminRace, role: "FUNCTIONARY" })).status).toBe("authenticated");

    // En administratör lägger till och tar bort funktionärer men inte administratörer.
    const functionary = await grant(coadminRace, f.staff.email, "FUNCTIONARY");
    if (functionary.status !== "granted") throw new Error("Funktionären lades inte till");
    const third = await registerTestAccount(db, `tredje.${randomUUID().slice(0, 8)}`);
    expect((await grant(coadminRace, third.email, "ADMIN")).status).toBe("forbidden");
    const owner = (await listRacePeopleAsAdmin(db, coadminRace));
    if (owner.status !== "ok") throw new Error("Listan saknas");
    expect(owner.response.viewer.role).toBe("ADMIN");
    const ownerGrant = owner.response.people.find(person => person.role === "OWNER")!;
    expect((await revoke(coadminRace, ownerGrant.grantId)).status).toBe("forbidden");
    expect((await revoke(coadminRace, coadmin.response.person.grantId)).status).toBe("forbidden");
    expect((await revoke(coadminRace, functionary.response.person.grantId)).status).toBe("revoked");
    // Ägaren tar bort medadministratören; dess session slutar gälla.
    expect((await revoke(f.ownerRace, coadmin.response.person.grantId)).status).toBe("revoked");
    expect((await listAdministratorForestWatch(db, coadminRace)).status).toBe("unauthorized");
    // Samma person kan läggas till igen, nu som funktionär.
    expect((await grant(f.ownerRace, f.coadmin.email, "FUNCTIONARY")).status).toBe("granted");
    expect((await enter(f.coadmin.proof, f.raceId)).role).toBe("FUNCTIONARY");
  });
});
