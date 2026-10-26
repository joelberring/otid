import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { RESULT_ENGINE_VERSION } from "@o-tid/domain";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { changeRelayLegRunnerAsAdmin, createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { editRelayClassAsAdmin } from "../../src/relay-admin-edit";
import { getRelayOverviewAsAdmin } from "../../src/relay-results";
import { setEntryStatus } from "../../src/entry-status";
import { resolveUnknownReadoutAsAdmin } from "../../src/unknown-readout-resolution";
import { accountOnRace } from "./accounts";

/**
 * Steg 50 (ADR-0174 beslut 9): teamsprint med utläsning efter varje sträcka. A springer sträcka 1 och 3, B sträcka 2 och 4;
 * varje löpare stämplar mål och läser ut efter varje sträcka utan att tömma brickan.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 50-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg50_sprint_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg50_sprint_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const minutes = (value: number) => value * 60_000;
const CODES = [31, 32];

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `steg50.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Teamsprinten", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function course(proof: Proof): Promise<string> {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: "Sprint", className: "Träning", startRule: "PUNCH", controlCodes: CODES } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response.courseId;
}

const LEGS = [{ startMethod: "MASS_START", startTime: at("17:00") }, { startMethod: "CHANGEOVER" }, { startMethod: "CHANGEOVER" },
  { startMethod: "CHANGEOVER" }];

async function sprintClass(proof: Proof, courseId: string, name: string, extra: Record<string, unknown> = { readoutMode: "EACH_LEG" }) {
  const requestId = randomUUID();
  const created = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request: { formatVersion: 1,
    requestId, name, courseId, legs: LEGS.map((leg, index) => ({ leg: index + 1, startTime: null, variantCode: null, ...leg })), ...extra } });
  if (created.status !== "saved") throw new Error(`Stafettklassen kunde inte skapas: ${created.status}`);
  return created.response.classId;
}

async function sprintTeam(proof: Proof, classId: string, name: string, cardA: string, cardB: string) {
  const requestId = randomUUID();
  const runner = (given: string, leg: number, cardNumber: string | null, sameAsLeg?: number) =>
    ({ givenName: given, familyName: name, organisationName: null, leg, cardNumber, ...(sameAsLeg ? { sameAsLeg } : {}) });
  const saved = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: { formatVersion: 1,
    requestId, classId, number: null, name, organisationName: "OK Test",
    runners: [runner("A", 1, cardA), runner("B", 2, cardB), runner("A", 3, null, 1), runner("B", 4, null, 2)] } });
  if (saved.status !== "saved") throw new Error(`Laget kunde inte skapas: ${saved.status}`);
  return saved.response.teamId;
}

let sequence = 0;
async function readout(proof: Proof, cardNumber: string, finish: string, punches: { code: number; at: string }[]) {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: finish,
    punches: punches.map(punch => ({ code: punch.code, punchedAt: punch.at })), untimedPunchCodes: [], frames: ["02ef8300"],
    stationSerial: 999001, simulated: true };
  sequence += 1;
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(Date.parse(finish) + 30_000 + sequence).toISOString(), transport: "sportident",
      payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
  const acknowledged = ingested.response.acknowledgements[0]!;
  if (acknowledged.status === "rejected" || !acknowledged.serverResult) throw new Error("Avläsningen saknar serverns besked");
  return acknowledged.serverResult;
}

/** Stämplingar för en sträcka mellan två klockslag (båda kontrollerna). */
const run = (from: string, to: string, codes = CODES) => codes.map((code, index) =>
  ({ code, at: new Date(Date.parse(at(from)) + (index + 1) * (Date.parse(at(to)) - Date.parse(at(from))) / (codes.length + 1)).toISOString() }));

async function overview(proof: Proof) {
  const result = await getRelayOverviewAsAdmin(db, proof);
  if (result.status !== "ok") throw new Error(result.status);
  return result.response;
}

describe("steg 50: teamsprint med utläsning efter varje sträcka", () => {
  it("varje löpare läses ut efter varje sträcka; dubblett; omvänd ordning mellan lagkamraterna; felstämpling på andra sträckan", async () => {
    const proof = await race();
    const classId = await sprintClass(proof, await course(proof), "Teamsprint");
    expect((await overview(proof)).classes[0]).toMatchObject({ readoutMode: "EACH_LEG", changeoverCode: null });
    await sprintTeam(proof, classId, "Ek", "9101", "9102");
    await sprintTeam(proof, classId, "Al", "9201", "9202");
    await sprintTeam(proof, classId, "Asp", "9301", "9302");
    // Lag Ek: i tur och ordning. A:s andra utläsning har kvar sträcka 1:s stämplingar.
    const a1 = run("17:00", "17:10"), b2 = run("17:10", "17:20"), a3 = run("17:20", "17:30"), b4 = run("17:30", "17:40");
    await readout(proof, "9101", at("17:10"), a1);
    await readout(proof, "9102", at("17:20"), b2);
    await readout(proof, "9101", at("17:30"), [...a1, ...a3]);
    // Dubblett: samma utläsning igen är en omläsning av sträcka 3, inte en ny sträcka.
    await readout(proof, "9101", at("17:30"), [...a1, ...a3]);
    await readout(proof, "9102", at("17:40"), [...b2, ...b4]);
    // Lag Al: B:s utläsning efter sträcka 2 kommer före A:s efter sträcka 1 (två datorer), och B:s sista före A:s andra.
    await readout(proof, "9202", at("17:20"), b2);
    await readout(proof, "9201", at("17:10"), a1);
    await readout(proof, "9202", at("17:40"), [...b2, ...b4]);
    await readout(proof, "9201", at("17:30"), [...a1, ...a3]);
    // Lag Asp: A felstämplar på sin andra sträcka (sträcka 3) men sträcka 1 är godkänd.
    await readout(proof, "9301", at("17:10"), a1);
    await readout(proof, "9302", at("17:20"), b2);
    await readout(proof, "9301", at("17:30"), [...a1, a3[0]!]);
    await readout(proof, "9302", at("17:40"), [...b2, ...b4]);
    const view = await overview(proof);
    const team = (name: string) => view.teams.find(row => row.name === name)!;
    for (const name of ["Ek", "Al"]) {
      expect(team(name)).toMatchObject({ status: "OK", elapsedMs: minutes(40) });
      expect(team(name).legs.map(leg => leg.startTime)).toEqual([at("17:00"), at("17:10"), at("17:20"), at("17:30")]);
      expect(team(name).legs.map(leg => leg.status)).toEqual(["OK", "OK", "OK", "OK"]);
      // Lagkortet visar båda utläsningarna: sträcka 1 och 3 har var sin.
      expect(team(name).legs.map(leg => leg.readout?.finishTime)).toEqual([at("17:10"), at("17:20"), at("17:30"), at("17:40")]);
    }
    expect(team("Asp").legs.map(leg => leg.status)).toEqual(["OK", "OK", "MP", "OK"]);
    expect(team("Asp").status).toBe("MP");
    // En måltid före förra sträckans blir en okänd utläsning (tydligt besked), inget resultat skrivs över.
    const earlier = await readout(proof, "9101", at("17:05"), run("17:00", "17:05"));
    expect(earlier.status).toBe("UNKNOWN_CARD");
    expect(team("Ek").legs[0]!.status).toBe("OK");
  });

  it("glömd utläsning utan växlingskontroll: sträcka 3 får sitt resultat, sträcka 1 saknar utläsning tills manuell tid", async () => {
    const proof = await race();
    const classId = await sprintClass(proof, await course(proof), "Teamsprint glömd");
    await sprintTeam(proof, classId, "Gran", "9401", "9402");
    const a1 = run("17:00", "17:10"), b2 = run("17:10", "17:20"), a3 = run("17:20", "17:30"), b4 = run("17:30", "17:40");
    // A läser inte ut efter sträcka 1: den första utläsningen kommer efter sträcka 3.
    await readout(proof, "9402", at("17:20"), b2);
    await readout(proof, "9401", at("17:30"), [...a1, ...a3]);
    await readout(proof, "9402", at("17:40"), [...b2, ...b4]);
    let legs = (await overview(proof)).teams[0]!.legs;
    expect(legs[0]).toMatchObject({ status: null, readoutMissing: true });
    // Ingen felstämpling som bara beror på den glömda utläsningen: sträcka 2 väntar på växlingen, laget är ute.
    expect(legs[1]).toMatchObject({ status: null, readoutMissing: false });
    expect(legs[2]).toMatchObject({ status: "OK", elapsedMs: minutes(10) });
    expect((await overview(proof)).teams[0]!.status).toBe("RUNNING");
    // Funktionären sätter manuell tid för sträcka 1 (växlingen 17:10): laget blir godkänt.
    const requestId = randomUUID();
    const decided = await setEntryStatus(db, { ...proof, entryId: legs[0]!.entryId, idempotencyKey: `entry-status:${requestId}`,
      request: { formatVersion: 1, requestId, expectedRevision: 0, decision: { kind: "MANUAL_TIME", startTime: at("17:00"),
        finishTime: at("17:10"), status: "OK", note: "Glömde läsa ut efter sträcka 1" } } });
    expect(decided.status).toBe("decided");
    const after = (await overview(proof)).teams[0]!;
    expect(after.legs.map(leg => leg.status)).toEqual(["OK", "OK", "OK", "OK"]);
    expect(after).toMatchObject({ status: "OK", elapsedMs: minutes(40) });
    legs = after.legs;
    expect(legs[0]!.readoutMissing).toBe(false);
  });

  it("glömd utläsning med växlingskontroll: delas vid växlingsstämplingen och båda sträckorna får mål", async () => {
    const proof = await race();
    const classId = await sprintClass(proof, await course(proof), "Teamsprint växling", { changeoverCode: 100, readoutMode: "EACH_LEG" });
    await sprintTeam(proof, classId, "Lind", "9501", "9502");
    const a1 = [...run("17:00", "17:10"), { code: 100, at: at("17:10") }], b2 = run("17:10", "17:20"), a3 = run("17:20", "17:30");
    await readout(proof, "9502", at("17:20"), b2);
    await readout(proof, "9501", at("17:30"), [...a1, ...a3]);
    const legs = (await overview(proof)).teams[0]!.legs;
    expect(legs.map(leg => leg.status)).toEqual(["OK", "OK", "OK", null]);
    expect(legs[0]).toMatchObject({ finishTime: at("17:10"), readoutMissing: false });
  });

  it("efter sista sträckan (steg 48) som val, och ändra löpare, växlingskontroll och utläsningssätt när lagen finns", async () => {
    const proof = await race();
    const classId = await sprintClass(proof, await course(proof), "Teamsprint sist", { changeoverCode: 100, readoutMode: "LAST_LEG" });
    expect((await overview(proof)).classes[0]).toMatchObject({ readoutMode: "LAST_LEG" });
    await sprintTeam(proof, classId, "Ask", "9601", "9602");
    // Utan växlingskontroll går det inte att ha samma löpare på flera sträckor vid utläsning efter sista sträckan.
    const config = (await overview(proof)).classes[0]!;
    const edit = (changes: Record<string, unknown>) => {
      const requestId = randomUUID();
      return editRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class-edit:${requestId}`, request: { formatVersion: 1, requestId,
        classId, name: config.name, restartRanking: config.restartRanking, forking: config.forking, confirmResultChanges: false,
        changeoverCode: config.changeoverCode, legs: config.legs.map(leg => ({ leg: leg.leg, startMethod: leg.startMethod,
          startTime: leg.startTime, variantCode: leg.variantCode, courseId: leg.courseId, restartAfterMinutes: leg.restartAfterMinutes,
          runners: leg.runners, changeoverRule: leg.changeoverRule, approvalRule: leg.approvalRule })), ...changes } });
    };
    expect((await edit({ changeoverCode: null })).status).toBe("invalid-request");
    // Byt till utläsning efter varje sträcka och ta bort växlingskontrollen: lagen finns kvar.
    expect((await edit({ changeoverCode: null, readoutMode: "EACH_LEG" })).status).toBe("saved");
    const team = (await overview(proof)).teams[0]!;
    // Byt löpare: sträcka 4 blir en egen löpare med egen bricka (inga resultat än).
    const leg4 = team.legs[3]!;
    const requestId = randomUUID();
    const changed = await changeRelayLegRunnerAsAdmin(db, { ...proof, idempotencyKey: `relay-leg-runner:${requestId}`, request: { formatVersion: 1,
      requestId, teamId: team.id, leg: 4, legOrder: 1, expectedEntryVersion: leg4.entryVersion,
      runner: { givenName: "C", familyName: "Ask", organisationName: null, cardNumber: "9603", sameAsLeg: null } } });
    expect(changed.status).toBe("saved");
    const legs = (await overview(proof)).teams[0]!.legs;
    expect(legs.map(leg => leg.sameAsLeg)).toEqual([null, null, 1, null]);
    expect(legs[3]).toMatchObject({ givenName: "C", cardNumber: "9603" });
  });

  it("en utläsning som inte gick att lägga kopplas till vald sträcka", async () => {
    const proof = await race();
    const classId = await sprintClass(proof, await course(proof), "Teamsprint koppla");
    await sprintTeam(proof, classId, "Sälg", "9701", "9702");
    await readout(proof, "9701", at("17:10"), run("17:00", "17:10"));
    await readout(proof, "9702", at("17:20"), run("17:10", "17:20"));
    const old = await readout(proof, "9701", at("17:05"), run("17:00", "17:05"));
    expect(old.status).toBe("UNKNOWN_CARD");
    const [row] = (await pool.query<{ id: string }>("select id from card_readout where race_id = $1 and card_number = '9701' and finish_punched_at = $2",
      [proof.raceId, at("17:05")])).rows;
    const legs = (await overview(proof)).teams[0]!.legs;
    const target = legs[2]!;
    const requestId = randomUUID();
    const resolved = await resolveUnknownReadoutAsAdmin(db, { ...proof, idempotencyKey: `unknown-readout-resolution:${requestId}`,
      request: { formatVersion: 1, requestId, readoutId: row!.id, cardNumber: "9701", target: "EXISTING_ENTRY", entryId: target.entryId,
        expectedEntryVersion: target.entryVersion, expectedClassId: classId, expectedAssignment: null, expectedLatestResultRevision: null,
        expectedEngineVersion: RESULT_ENGINE_VERSION } });
    expect(resolved.status).toBe("resolved");
    expect((await overview(proof)).teams[0]!.legs[2]!.hasResult).toBe(true);
  });
});
