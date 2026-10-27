import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { loadEntryCardPunches } from "../../src/card-punches";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { getRelayOverviewAsAdmin } from "../../src/relay-results";
import { accountOnRace } from "./accounts";

/**
 * Steg 58 (ADR-0178): en tävling som börjar på kvällen och går över midnatt. Tävlingsdagen 2026-10-27 i Stockholm (CET,
 * UTC+1): 23:50 lokal tid = 22:50Z, 00:30 natten efter = 23:30Z.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 58-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg58_midnatt_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg58_midnatt_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
/** Ett ögonblick i UTC: tävlingskvällen den 27:e och natten efter den 28:e. */
const z = (day: 27 | 28, clock: string) => `2026-10-${day}T${clock}:00.000Z`;

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `steg58.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Natt-KM", raceName: "Natt", raceDate: "2026-10-27", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function courseClass(proof: Proof, className: string, startRule: "FIXED" | "PUNCH") {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: `Bana ${className}`, className, startRule, controlCodes: [31, 32, 33] } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response;
}

async function readout(proof: Proof, cardNumber: string, finish: string, punches: string[], readAt = finish) {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: finish,
    punches: punches.map((at, index) => ({ code: 31 + index, punchedAt: at })), untimedPunchCodes: [], frames: ["02ef8300"],
    stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(Date.parse(readAt) + 60_000).toISOString(), transport: "sportident",
      payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

const latest = async (entryId: string) => (await pool.query<{ status: string; evaluation: { elapsedMs?: number; startTime?: string } }>(
  "select status, evaluation from result_revision where entry_id = $1 order by revision desc limit 1", [entryId])).rows[0];

describe("steg 58: tävling över midnatt", () => {
  it("individuell klass: start 23:50, stämplingar och mål efter 00:00 räknas och varnas inte som annan dag", async () => {
    const proof = await race();
    const created = await courseClass(proof, "H21", "FIXED");
    const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
      formatVersion: 1, classId: created.classId!, expectedCourseVersionId: created.courseVersionId, expectedStartRule: "FIXED",
      givenName: "Eva", familyName: "Sjö", organisationName: null, cardNumber: "9001", fixedStartTime: z(27, "22:50") } });
    if (registered.status !== "registered") throw new Error(registered.status);
    const entryId = registered.response.entryId;
    await readout(proof, "9001", z(27, "23:12"), [z(27, "22:56"), z(27, "23:03"), z(27, "23:09")], z(27, "23:15"));
    expect(await latest(entryId)).toMatchObject({ status: "OK", evaluation: { elapsedMs: 22 * 60_000 } });
    const punches = await loadEntryCardPunches(db, proof.raceId, entryId, "Europe/Stockholm");
    expect(punches?.otherDates).toEqual([]);
    expect(punches?.punches.map(punch => punch.placement)).toEqual(["ON_COURSE", "ON_COURSE", "ON_COURSE"]);
  });

  it("stafett med masstart 22:00 och omstart 00:30: laget som växlar efter omstarten startar i den", async () => {
    const proof = await race();
    const created = await courseClass(proof, "Träning", "PUNCH");
    const requestId = randomUUID();
    const relay = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request: { formatVersion: 1,
      requestId, name: "Nattstafett", courseId: created.courseId, legs: [
        { leg: 1, startMethod: "MASS_START", startTime: z(27, "21:00"), variantCode: null },
        { leg: 2, startMethod: "CHANGEOVER", startTime: null, variantCode: null },
        { leg: 3, startMethod: "RESTART", startTime: z(27, "23:30"), variantCode: null }] } });
    if (relay.status !== "saved") throw new Error(relay.status);
    for (const [name, prefix] of [["Tidiga", "91"], ["Sena", "92"]] as const) {
      const teamRequest = randomUUID();
      const team = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${teamRequest}`, request: { formatVersion: 1,
        requestId: teamRequest, classId: relay.response.classId, number: null, name, organisationName: null,
        runners: [1, 2, 3].map(leg => ({ givenName: `L${leg}`, familyName: name, organisationName: null, cardNumber: `${prefix}0${leg}` })) } });
      if (team.status !== "saved") throw new Error(team.status);
    }
    // Tidiga växlar till sträcka 3 kl 00:20, före omstarten; Sena kl 00:45, efter den.
    await readout(proof, "9101", z(27, "22:00"), [z(27, "21:20"), z(27, "21:40"), z(27, "21:50")]);
    await readout(proof, "9102", z(27, "23:20"), [z(27, "22:20"), z(27, "22:40"), z(27, "23:00")]);
    await readout(proof, "9103", z(28, "00:00"), [z(27, "23:30"), z(27, "23:40"), z(27, "23:50")]);
    await readout(proof, "9201", z(27, "22:10"), [z(27, "21:20"), z(27, "21:40"), z(27, "22:00")]);
    await readout(proof, "9202", z(27, "23:45"), [z(27, "22:30"), z(27, "23:00"), z(27, "23:30")]);
    await readout(proof, "9203", z(28, "00:30"), [z(27, "23:50"), z(28, "00:05"), z(28, "00:15")]);
    const overview = await getRelayOverviewAsAdmin(db, proof);
    if (overview.status !== "ok") throw new Error(overview.status);
    const team = (name: string) => overview.response.teams.find(row => row.name === name)!;
    expect(team("Tidiga").legs[2]).toMatchObject({ startTime: z(27, "23:20"), restarted: false, status: "OK" });
    expect(team("Sena").legs[2]).toMatchObject({ startTime: z(27, "23:30"), restarted: true, status: "OK" });
    expect(team("Tidiga")).toMatchObject({ status: "OK", position: 1, restarted: false });
    // SOFT TR 5.8.2: laget i omstarten placeras efter laget med vanliga växlingar.
    expect(team("Sena")).toMatchObject({ status: "OK", position: 2, restarted: true });
  });
});
