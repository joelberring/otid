import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { readMapBundlesAsAdmin } from "../../src/map-bundles";
import { accountOnRace } from "./accounts";

/**
 * ADR-0213: stafetten i Kartor till starten. En klass per sträcka med sträckans bana, lagen och deras löpare med lag och
 * sträcka, efter de individuella; tryckantalet räknar stafettens kartor.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0213-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0213_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 180_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0213_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
}, 60_000);

describe("stafetten i Kartor till starten (ADR-0213)", { timeout: 120_000 }, () => {
  it("en klass per sträcka med sträckans bana, löparna med lag och sträcka, i lagnummerordning; rogaining som ogafflad grupp", async () => {
    const account = await registerUserAccount(db, { formatVersion: 1, email: `adr0213.${randomUUID().slice(0, 8)}@test.o-tid.se`, displayName: "Arrangör",
      password: "hemligt-lösen" });
    if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
    const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
    const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Stafettdagen", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
    if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
    const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
    if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
    const proof = { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
    const course = async (name: string, controlCodes: number[]) => {
      const requestId = randomUUID();
      const made = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
        request: { formatVersion: 1, requestId, courseName: name, className: `Klass ${name}`, startRule: "PUNCH", controlCodes } });
      if (made.status !== "created") throw new Error(`Banan kunde inte skapas: ${made.status}`);
      return made.response.courseId;
    };
    const long = await course("Lång", [31, 32, 33]);
    const short = await course("Kort", [41, 42]);
    const requestId = randomUUID();
    const relay = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request: { formatVersion: 1, requestId,
      name: "H21 stafett", courseId: long, legs: [
        { leg: 1, startMethod: "MASS_START", startTime: "2026-10-08T09:00:00.000Z", variantCode: null, courseId: null, restartAfterMinutes: null },
        { leg: 2, startMethod: "CHANGEOVER", startTime: null, variantCode: null, courseId: short, restartAfterMinutes: null }] } });
    if (relay.status !== "saved") throw new Error(`Stafettklassen kunde inte skapas: ${relay.status}`);
    for (const name of ["OK Natt 1", "OK Natt 2"]) {
      const id = randomUUID();
      const team = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${id}`, request: { formatVersion: 1, requestId: id,
        classId: relay.response.classId, number: null, name, organisationName: "OK Natt",
        runners: [1, 2].map(leg => ({ givenName: `${name.at(-1)}${leg}`, familyName: "Löpare", organisationName: null, cardNumber: null })) } });
      if (team.status !== "saved") throw new Error(`Laget kunde inte anmälas: ${team.status}`);
    }
    const read = await readMapBundlesAsAdmin(db, proof);
    if (read.status !== "ok") throw new Error(read.status);
    const rows = read.response.rows.filter(row => row.team);
    expect(rows.map(row => [row.team!.name, row.leg, row.courseName])).toEqual([
      ["OK Natt 1", 1, "Lång"], ["OK Natt 2", 1, "Lång"], ["OK Natt 1", 2, "Kort"], ["OK Natt 2", 2, "Kort"]]);
    expect(rows[0]).toMatchObject({ className: "H21 stafett", startTime: "2026-10-08T09:00:00.000Z", startMode: "MASS" });
    expect(rows[2]).toMatchObject({ startTime: null, startMode: "FREE" });
    const kort = read.response.groups.find(group => group.courseName === "Kort")!;
    expect(kort.runnerCount).toBe(2);
    expect(kort.items[0]).toMatchObject({ kind: "RUNNER", team: { name: "OK Natt 1" }, leg: 2 });

    // Rogaining ingår som en ogafflad grupp (tryckantal och löparkartor), inte tyst utesluten.
    const score = await course("Poäng", [51, 52, 53]);
    const [scoreClass] = (await pool.query<{ id: string }>("select c.id from class c join course_version v on v.id = c.course_version_id where v.course_id = $1",
      [score])).rows;
    await pool.query("update class set rogaining_time_limit_seconds = 3600, rogaining_penalty_points_per_minute = 1, max_time_minutes = null where id = $1",
      [scoreClass!.id]);
    for (const given of ["Ada", "Bo"]) {
      await pool.query("insert into entry (race_id, class_id, given_name, family_name) values ($1, $2, $3, 'Poäng')", [proof.raceId, scoreClass!.id, given]);
    }
    const withScore = await readMapBundlesAsAdmin(db, proof);
    if (withScore.status !== "ok") throw new Error(withScore.status);
    const poang = withScore.response.groups.find(group => group.courseName === "Poäng")!;
    expect(poang).toMatchObject({ variantCode: null, runnerCount: 2 });
    expect(poang.printCount).toBeGreaterThanOrEqual(2);
    expect(withScore.response.rows.filter(row => row.className === "Klass Poäng").map(row => row.name)).toEqual(["Ada Poäng", "Bo Poäng"]);
    expect(withScore.response.classes.find(row => row.name === "Klass Poäng")).toMatchObject({ variantCodes: [] });
  });
});
