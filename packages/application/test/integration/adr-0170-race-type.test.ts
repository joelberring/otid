import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { RaceType } from "@o-tid/contracts";
import { createEventAsUserAccount, enterRaceAsUserAccount, listMyEventsAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { saveRaceSettingsAsAdministrator } from "../../src/race-settings";
import { registerEntryAsAdmin } from "../../src/entry-registration";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0170-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0170_type_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0170_type_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function account(): Promise<AccountProof> {
  const created = await registerUserAccount(db, { formatVersion: 1, loginName: `typ.${randomUUID().slice(0, 8)}`,
    displayName: "Arrangör", password: "hemligt-lösen" });
  if (created.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  return { sessionToken: created.sessionToken, csrfCookie: created.csrfToken, csrfHeader: created.csrfToken };
}

async function create(proof: AccountProof, body: Record<string, unknown>, requestId = randomUUID()) {
  return createEventAsUserAccount(db, { ...proof, idempotencyKey: `organizer-event-create:${requestId}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbtävling", raceName: "Lördag", raceDate: "2026-10-10",
      timeZone: "Europe/Stockholm", ...body }) });
}

async function enter(proof: AccountProof, raceId: string): Promise<Proof> {
  const entered = await enterRaceAsUserAccount(db, { ...proof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  return { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function settings(proof: Proof, values: { eventName?: string; raceName?: string; raceDate?: string; raceType: RaceType },
  requestId = randomUUID()) {
  const request = { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(proof.raceId), eventName: values.eventName ?? "Klubbtävling",
    raceName: values.raceName ?? "Lördag", raceDate: values.raceDate ?? "2026-10-10", raceType: values.raceType };
  return { request, result: await saveRaceSettingsAsAdministrator(db, { ...proof, idempotencyKey: `race-settings:${requestId}`, request }) };
}

describe("ADR-0170: tävlingstyp", () => {
  it("sparar vald typ när tävlingen skapas, visar den i listor och jämför den vid omsändning", async () => {
    const proof = await account();
    const requestId = randomUUID();
    const created = await create(proof, { raceType: "RELAY" }, requestId);
    if (created.status !== "created") throw new Error(created.status);
    expect(await create(proof, { raceType: "RELAY" }, requestId)).toMatchObject({ status: "created", response: { replayed: true } });
    expect(await create(proof, { raceType: "TRAINING" }, requestId)).toEqual({ status: "conflict" });
    expect(await create(proof, { raceType: "SPRINT" })).toEqual({ status: "invalid-request" });

    const mine = await listMyEventsAsUserAccount(db, proof);
    if (mine.status !== "ok") throw new Error(mine.status);
    expect(mine.response.events[0]!.races[0]).toMatchObject({ raceId: created.response.raceId, raceType: "RELAY" });

    const race = await enter(proof, created.response.raceId);
    const roster = await listEntryTransfersAsAdministrator(db, race);
    expect(roster).toMatchObject({ status: "ok", response: { raceType: "RELAY" } });
  });

  it("utan vald typ blir det Tävling", async () => {
    const created = await create(await account(), {});
    if (created.status !== "created") throw new Error(created.status);
    expect((await pool.query("select race_type from race where id = $1", [created.response.raceId])).rows[0]).toEqual({ race_type: "STANDARD" });
  });

  it("Inställningar byter namn och typ utan att data försvinner; datumet låses av starttider och avläsningar", async () => {
    const owner = await account();
    const created = await create(owner, { raceType: "TRAINING" });
    if (created.status !== "created") throw new Error(created.status);
    const race = await enter(owner, created.response.raceId);
    const courseRequestId = randomUUID();
    const course = await createManualCourseClassAsAdministrator(db, { ...race, idempotencyKey: `manual-course-class-create:${courseRequestId}`,
      request: { formatVersion: 1, requestId: courseRequestId, expectedSnapshotVersion: await snapshot(race.raceId), courseName: "Lång",
        className: "H21", startRule: "FIXED", controlCodes: [31, 32, 33] } });
    if (course.status !== "created") throw new Error(course.status);

    const before = await snapshot(race.raceId);
    const renamed = await settings(race, { eventName: "Höstträning", raceName: "Torsdag", raceDate: "2026-10-12", raceType: "SMALL" });
    expect(renamed.result).toMatchObject({ status: "saved", response: { replayed: false, snapshotVersionAfter: before + 1 } });
    const replay = await saveRaceSettingsAsAdministrator(db, { ...race, idempotencyKey: `race-settings:${renamed.request.requestId}`,
      request: renamed.request });
    expect(replay).toMatchObject({ status: "saved", response: { replayed: true } });
    const roster = await listEntryTransfersAsAdministrator(db, race);
    if (roster.status !== "ok") throw new Error(roster.status);
    expect(roster.response).toMatchObject({ eventName: "Höstträning", raceName: "Torsdag", raceDate: "2026-10-12", raceType: "SMALL" });
    expect(roster.response.classes.map(row => row.name)).toEqual(["H21"]);
    const event = await pool.query("select e.starts_on::text as starts_on from event e join race r on r.event_id = e.id where r.id = $1", [race.raceId]);
    expect(event.rows[0]).toEqual({ starts_on: "2026-10-12" });

    // Typbyte tar inte bort något: klassen finns kvar även som Stafett och tillbaka.
    expect((await settings(race, { eventName: "Höstträning", raceName: "Torsdag", raceDate: "2026-10-12", raceType: "RELAY" })).result)
      .toMatchObject({ status: "saved" });
    const relayRoster = await listEntryTransfersAsAdministrator(db, race);
    expect(relayRoster).toMatchObject({ status: "ok", response: { raceType: "RELAY" } });
    if (relayRoster.status !== "ok") throw new Error(relayRoster.status);
    expect(relayRoster.response.classes).toHaveLength(1);

    // Fel tävlingsversion ger konflikt och ändrar ingenting.
    const stale = await saveRaceSettingsAsAdministrator(db, { ...race, idempotencyKey: `race-settings:${courseRequestId}`,
      request: { ...renamed.request, requestId: courseRequestId, raceType: "ROGAINING" } });
    expect(stale).toEqual({ status: "conflict" });

    // En deltagare med fast starttid låser datumet, men namn och typ kan fortfarande ändras.
    const registered = await registerEntryAsAdmin(db, { ...race, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
      formatVersion: 1, classId: roster.response.classes[0]!.id, expectedCourseVersionId: roster.response.classes[0]!.courseVersionId,
      expectedStartRule: "FIXED", expectedSnapshotVersion: await snapshot(race.raceId), givenName: "Eva", familyName: "Ek",
      organisationName: null, cardNumber: null, fixedStartTime: "2026-10-12T16:00:00.000Z" } });
    expect(registered.status).toBe("registered");
    const moved = await settings(race, { eventName: "Höstträning", raceName: "Torsdag", raceDate: "2026-10-13", raceType: "RELAY" });
    expect(moved.result).toEqual({ status: "conflict" });
    expect((await settings(race, { eventName: "Höstträning", raceName: "Torsdag", raceDate: "2026-10-12", raceType: "STANDARD" })).result)
      .toMatchObject({ status: "saved" });
    const audit = await pool.query("select count(*)::int as n from audit_event where race_id = $1 and action = 'RACE_SETTINGS_SAVED_BY_ADMIN'", [race.raceId]);
    expect(audit.rows[0]).toEqual({ n: 3 });
  });
});
