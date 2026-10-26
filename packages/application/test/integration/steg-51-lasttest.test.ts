import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { setRacePublicationAsAdmin } from "../../src/race-publication";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { publicRaceContentVersion } from "../../src/public-race-version";
import { publicResultDetail, publicResultDetailFrom, publicResults } from "../../src/results";
import { readPublicLive, readPublicLiveFrom } from "../../src/public-live";
import { publicRelayResults } from "../../src/relay-results";
import { readPublicRadio } from "../../src/radio-standings";
import { applyRaceCorrectionAsAdmin, previewRaceCorrectionAsAdmin } from "../../src/race-corrections";
import { accountOnRace } from "./accounts";
import { ingest as ingestRuns, NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * Steg 51 (lasttest, docs/lasttest.md): stafettens starter räknas bara för det ändrade laget när klassen saknar
 * flygande omstart, och de publika listornas versionsnyckel ändras med innehållet.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 51-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg51_load_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg51_load_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const CODES = [31, 32, 33];

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `steg51.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Lastdagen", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function course(proof: Proof, name: string) {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: name, className: `Klass ${name}`, startRule: "PUNCH", controlCodes: CODES } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response;
}

async function relayClass(proof: Proof, courseId: string, second: "CHANGEOVER" | "FLYING_RESTART", name: string) {
  const requestId = randomUUID();
  const created = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request: { formatVersion: 1, requestId,
    name, courseId, legs: [
      { leg: 1, startMethod: "MASS_START", startTime: at("17:00"), variantCode: null },
      { leg: 2, startMethod: second, startTime: null, variantCode: null, ...(second === "FLYING_RESTART" ? { restartAfterMinutes: 30 } : {}) }] } });
  if (created.status !== "saved") throw new Error(`Stafettklassen kunde inte skapas: ${created.status}`);
  return created.response.classId;
}

async function team(proof: Proof, classId: string, name: string, cards: string[]) {
  const requestId = randomUUID();
  const registered = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: {
    formatVersion: 1, requestId, classId, number: null, name, organisationName: "OK Last",
    runners: cards.map((cardNumber, index) => ({ givenName: `${name}${index + 1}`, familyName: "Löpare", organisationName: null, cardNumber })) } });
  if (registered.status !== "saved") throw new Error(`Laget kunde inte anmälas: ${registered.status}`);
  return registered.response.teamId;
}

async function readout(proof: Proof, cardNumber: string, from: string, finish: string) {
  const fromMs = Date.parse(from), finishMs = Date.parse(finish);
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: finish,
    punches: CODES.map((code, index) => ({ code, punchedAt: new Date(fromMs + (index + 1) * (finishMs - fromMs) / (CODES.length + 1)).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(finishMs + 60_000).toISOString(), transport: "sportident", payload,
      contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok" || ingested.response.acknowledgements[0]?.status !== "stored") throw new Error("Avläsningen togs inte emot");
}

/** Sträcka 2:s start per lag, i lagens ordning. */
async function secondLegStarts(teamIds: string[]) {
  const rows = (await pool.query<{ team_id: string; fixed_start_time: Date | null }>(
    "select team_id, fixed_start_time from entry where team_id = any($1) and relay_leg = 2", [teamIds])).rows;
  return teamIds.map((id) => rows.find((row) => row.team_id === id)?.fixed_start_time?.toISOString() ?? null);
}

/** Ett lags sträcka 2 med en start som inte stämmer (som om den sparats av en äldre version). Används bara för att se vad som räknas om. */
async function skewSecondLeg(teamId: string, start: string) {
  await pool.query("update entry set fixed_start_time = $2 where team_id = $1 and relay_leg = 2", [teamId, start]);
}

describe("steg 51: lasttest", () => {
  it("utan flygande omstart räknas bara det avlästa lagets starter; med flygande omstart hela klassen", async () => {
    const proof = await race();
    const { courseId } = await course(proof, "Stafettbana");
    const changeover = await relayClass(proof, courseId, "CHANGEOVER", "Växling");
    const first = await team(proof, changeover, "Ask", ["7100001", "7100002"]);
    const other = await team(proof, changeover, "Björk", ["7100003", "7100004"]);
    await skewSecondLeg(other, at("09:00"));
    await readout(proof, "7100001", at("17:00"), at("17:40"));
    // Det avlästa laget får sin växling; det andra lagets sträcka rörs inte (den beror inte på någon annans växling).
    expect(await secondLegStarts([first, other])).toEqual([at("17:40"), at("09:00")]);

    const flying = await relayClass(proof, courseId, "FLYING_RESTART", "Flygande");
    const leader = await team(proof, flying, "Ceder", ["7100005", "7100006"]);
    const late = await team(proof, flying, "Dunge", ["7100007", "7100008"]);
    await skewSecondLeg(late, at("09:00"));
    await readout(proof, "7100005", at("17:00"), at("17:30"));
    // Ledarens växling 17:30 ger omstart 18:00 för alla som inte växlat: hela klassen räknas.
    expect(await secondLegStarts([leader, late])).toEqual([at("17:30"), at("18:00")]);
  });

  it("de publika listornas versionsnyckel följer resultat, anmälningar och publicering; listorna ur cachen är desamma", async () => {
    const proof = await race();
    const { classId, courseVersionId } = await course(proof, "Bana");
    const published = await setRacePublicationAsAdmin(db, { ...proof, published: true });
    if (published.status !== "saved") throw new Error("Tävlingen kunde inte publiceras");
    const keys = [await publicRaceContentVersion(db, proof.raceId)];
    const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`,
      request: { formatVersion: 1, classId, expectedCourseVersionId: courseVersionId, expectedStartRule: "PUNCH", givenName: "Alva",
        familyName: "Ask", organisationName: "OK Last", cardNumber: "7100101", fixedStartTime: null } });
    if (registered.status !== "registered") throw new Error("Anmälan misslyckades");
    keys.push(await publicRaceContentVersion(db, proof.raceId));
    await readout(proof, "7100101", at("17:00"), at("17:35"));
    keys.push(await publicRaceContentVersion(db, proof.raceId));
    keys.push(await publicRaceContentVersion(db, proof.raceId));
    expect(new Set(keys.slice(0, 3)).size).toBe(3);
    expect(keys[3]).toBe(keys[2]);
    expect(await publicRaceContentVersion(db, randomUUID())).toBeNull();
    expect(await publicRaceContentVersion(db, "inte-ett-id")).toBeNull();

    const results = await publicResults(db, proof.raceId);
    const row = results.results[0]!;
    if (!("publicResultId" in row)) throw new Error("Raden saknar publikt id");
    expect(publicResultDetailFrom(results, row.publicResultId)).toEqual(await publicResultDetail(db, proof.raceId, row.publicResultId));
    expect(publicResultDetailFrom(results, randomUUID())).toEqual({ status: "not-found" });
    const now = new Date("2026-10-08T18:00:00.000Z");
    const [relay, radio] = await Promise.all([publicRelayResults(db, proof.raceId), readPublicRadio(db, proof.raceId)]);
    expect(await readPublicLiveFrom(db, proof.raceId, { results, relay, radio }, now)).toEqual(await readPublicLive(db, proof.raceId, now));
  });

  it("flyttade starttider prövar och räknar om bara klassens avlästa, inte hela tävlingen", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    // Ada (lottad 10:02) i klassen med tilldelade tider och Dan i klassen med fri start är båda avlästa.
    await ingestRuns(db, ids.race, [run(cards.ada, "10:07:00", 30), run(cards.dan, "10:10:00", 40)]);
    const revisions = async (entryId: string) => Number((await pool.query<{ count: string }>(
      "select count(*) from result_revision where entry_id = $1", [entryId])).rows[0]!.count);
    const [adaBefore, danBefore] = [await revisions(ids.ada), await revisions(ids.dan)];
    const correction = { action: "SHIFT_START_TIMES" as const, classId: ids.fixed, offsetSeconds: 300, reason: "Starten kom igång sent" };
    const preview = await previewRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, correction } }, NOW);
    if (preview.status !== "ok") throw new Error(`Förhandsbeskedet saknas: ${preview.status}`);
    expect(preview.response.summary.readOutCount).toBe(1);
    const applied = await applyRaceCorrectionAsAdmin(db, { ...admin, request: { formatVersion: 1, requestId: randomUUID(),
      expectedPreviewHash: preview.response.previewHash, correction } }, NOW);
    if (applied.status !== "applied") throw new Error(`Rättningen sparades inte: ${applied.status}`);
    expect(applied.response.recalculatedCount).toBe(1);
    expect([await revisions(ids.ada), await revisions(ids.dan)]).toEqual([adaBefore + 1, danBefore]);
  });
});
