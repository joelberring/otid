import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { getRelayOverviewAsAdmin, publicRelayResults } from "../../src/relay-results";
import { exportCurrentStartListXmlAsAdmin } from "../../src/start-list-publication";
import { accountOnRace } from "./accounts";

/** Steg 48 (ADR-0174 beslut 6–7): parallella sträckor, teamsprint med delad bricka och IOF EntryList med Leg och LegOrder. */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 48-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg48_relay_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg48_relay_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-10-08T${clock}:00.000Z`;
const minutes = (value: number) => value * 60_000;
const CODES = [31, 32];

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `steg48.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Ungdomsstafetten", raceName: "Lördag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function course(proof: Proof): Promise<string> {
  const requestId = randomUUID();
  const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName: "Bana", className: "Träning", startRule: "PUNCH", controlCodes: CODES } });
  if (created.status !== "created") throw new Error(`Banan kunde inte skapas: ${created.status}`);
  return created.response.courseId;
}

async function relayClass(proof: Proof, courseId: string, legs: Record<string, unknown>[], name: string, changeoverCode: number | null = null) {
  const requestId = randomUUID();
  const created = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${requestId}`, request: { formatVersion: 1,
    requestId, name, courseId, changeoverCode, legs: legs.map((leg, index) => ({ leg: index + 1, startTime: null, variantCode: null, ...leg })) } });
  if (created.status !== "saved") throw new Error(`Stafettklassen kunde inte skapas: ${created.status}`);
  return created.response.classId;
}

async function team(proof: Proof, classId: string, name: string, runners: Record<string, unknown>[]) {
  const requestId = randomUUID();
  return registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${requestId}`, request: { formatVersion: 1, requestId, classId,
    number: null, name, organisationName: "OK Test", runners: runners.map(runner => ({ familyName: "Löpare", organisationName: null, cardNumber: null,
      ...runner })) } });
}

async function readout(proof: Proof, cardNumber: string, finish: string | undefined, punches: { code: number; at: string }[]) {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", ...(finish ? { finishPunchedAt: finish } : {}),
    punches: punches.map(punch => ({ code: punch.code, punchedAt: punch.at })), untimedPunchCodes: [], frames: ["02ef8300"],
    stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: new Date(Date.parse(finish ?? punches.at(-1)!.at) + 60_000).toISOString(), transport: "sportident",
      payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

const run = (from: string, to: string, codes = CODES) => codes.map((code, index) =>
  ({ code, at: new Date(Date.parse(from) + (index + 1) * (Date.parse(to) - Date.parse(from)) / (codes.length + 1)).toISOString() }));

async function overview(proof: Proof) {
  const result = await getRelayOverviewAsAdmin(db, proof);
  if (result.status !== "ok") throw new Error(result.status);
  return result.response;
}

describe("steg 48: flera löpare per sträcka", () => {
  it("parallell sträcka: växlar när första är i mål och godkänt när minst en är godkänd; sista i mål och alla godkända", async () => {
    const proof = await race();
    const courseId = await course(proof);
    const anyClass = await relayClass(proof, courseId, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "CHANGEOVER", runners: 2, changeoverRule: "FIRST", approvalRule: "ANY" }, { startMethod: "CHANGEOVER" }], "Ungdom minst en");
    const allClass = await relayClass(proof, courseId, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "CHANGEOVER", runners: 2, changeoverRule: "LAST", approvalRule: "ALL" }, { startMethod: "CHANGEOVER" }], "Ungdom alla");
    // Platserna i tur och ordning: sträcka 1, sträcka 2 löpare 1 och 2, sträcka 3.
    expect((await team(proof, anyClass, "Fel antal", [{ givenName: "A" }, { givenName: "B" }, { givenName: "C" }])).status).toBe("invalid-request");
    const cards = (prefix: string) => [`${prefix}1`, `${prefix}21`, `${prefix}22`, `${prefix}3`];
    for (const [classId, prefix] of [[anyClass, "91"], [allClass, "92"]] as const) {
      const saved = await team(proof, classId, `Lag ${prefix}`, cards(prefix).map((cardNumber, index) => ({ givenName: `L${index}`, cardNumber })));
      expect(saved.status).toBe("saved");
    }
    const legs = (await overview(proof)).teams[0]!.legs;
    expect(legs.map(leg => `${leg.leg}:${leg.legOrder}`)).toEqual(["1:1", "2:1", "2:2", "3:1"]);
    for (const prefix of ["91", "92"]) {
      await readout(proof, `${prefix}1`, at("17:20"), run(at("17:00"), at("17:20")));
      // Löpare 1 felstämplar och går i mål 17:40, löpare 2 är godkänd 17:50.
      await readout(proof, `${prefix}21`, at("17:40"), run(at("17:20"), at("17:40"), [31]));
      await readout(proof, `${prefix}22`, at("17:50"), run(at("17:20"), at("17:50")));
    }
    let view = await overview(proof);
    const teamOf = (name: string) => view.teams.find(row => row.name === name)!;
    // Första i mål: sträcka 3 startar 17:40; sista i mål: 17:50.
    expect(teamOf("Lag 91").legs[3]!.startTime).toBe(at("17:40"));
    expect(teamOf("Lag 92").legs[3]!.startTime).toBe(at("17:50"));
    for (const prefix of ["91", "92"]) await readout(proof, `${prefix}3`, at("18:20"), run(at("17:50"), at("18:20")));
    view = await overview(proof);
    expect(teamOf("Lag 91")).toMatchObject({ status: "OK", elapsedMs: minutes(20 + 20 + 40) });
    expect(teamOf("Lag 92")).toMatchObject({ status: "MP" });
    expect(teamOf("Lag 91").legs.find(leg => leg.leg === 2 && leg.changedOver)?.legOrder).toBe(1);
    const results = await publicRelayResults(db, proof.raceId);
    expect(results.classes.find(row => row.name === "Ungdom minst en")!.teams[0]!.legs.map(leg => `${leg.leg}:${leg.legOrder}:${leg.changedOver}`))
      .toEqual(["1:1:false", "2:1:true", "2:2:false", "3:1:false"]);
    const startList = await exportCurrentStartListXmlAsAdmin(db, proof);
    if (startList.status !== "exported") throw new Error(startList.status);
    expect(startList.xml.match(/<Leg>2<\/Leg>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("teamsprint: brickan delas vid växlingsstämplingarna; felstämplad del och saknad växling", async () => {
    const proof = await race();
    const courseId = await course(proof);
    const classId = await relayClass(proof, courseId, [{ startMethod: "MASS_START", startTime: at("17:00") }, { startMethod: "CHANGEOVER" },
      { startMethod: "CHANGEOVER" }, { startMethod: "CHANGEOVER" }], "Teamsprint", 100);
    const runner = (name: string, leg: number, cardNumber: string | null, sameAsLeg?: number) =>
      ({ givenName: name, leg, cardNumber, ...(sameAsLeg ? { sameAsLeg } : {}) });
    // Teamsprint utan växlingskontroll går inte; brickan sitter på löparens första sträcka.
    expect((await team(proof, classId, "Fel", [runner("A", 1, "9301"), runner("B", 2, "9302"), runner("A", 3, "9303", 1),
      runner("B", 4, null, 2)])).status).toBe("invalid-request");
    for (const [name, a, b] of [["Lag ok", "9311", "9312"], ["Lag fel", "9321", "9322"], ["Lag utan växling", "9331", "9332"]] as const) {
      expect((await team(proof, classId, name, [runner("A", 1, a), runner("B", 2, b), runner("A", 3, null, 1), runner("B", 4, null, 2)])).status)
        .toBe("saved");
    }
    const cardA = (prefix: string, legThree = CODES, withChangeover = true) => [...run(at("17:00"), at("17:10")), { code: 100, at: at("17:10") },
      ...run(at("17:20"), at("17:30"), legThree), ...(withChangeover ? [{ code: 100, at: at("17:30") }] : [])];
    const cardB = [...run(at("17:10"), at("17:20")), { code: 100, at: at("17:20") }, ...run(at("17:30"), at("17:40"))];
    // A läser ut efter sin sista sträcka (före B): sträcka 3 väntar på B:s växling.
    await readout(proof, "9311", undefined, cardA("ok"));
    await readout(proof, "9312", at("17:40"), cardB);
    await readout(proof, "9321", undefined, cardA("fel", [31]));
    await readout(proof, "9322", at("17:40"), cardB);
    await readout(proof, "9331", undefined, cardA("utan", CODES, false));
    await readout(proof, "9332", at("17:40"), cardB);
    const view = await overview(proof);
    const teamOf = (name: string) => view.teams.find(row => row.name === name)!;
    expect(teamOf("Lag ok")).toMatchObject({ status: "OK", elapsedMs: minutes(40) });
    expect(teamOf("Lag ok").legs.map(leg => leg.startTime)).toEqual([at("17:00"), at("17:10"), at("17:20"), at("17:30")]);
    expect(teamOf("Lag ok").legs[2]).toMatchObject({ sameAsLeg: 1, status: "OK", elapsedMs: minutes(10) });
    // En felstämplad del gör bara den sträckan felstämplad.
    expect(teamOf("Lag fel").legs.map(leg => leg.status)).toEqual(["OK", "OK", "MP", "OK"]);
    expect(teamOf("Lag fel").status).toBe("MP");
    // Saknad växlingsstämpling: sträcka 3 får inget mål och ett tydligt besked; sträcka 4 startar inte förrän växlingen finns.
    expect(teamOf("Lag utan växling").legs[2]).toMatchObject({ status: "MP", changeoverMissing: true });
    expect(teamOf("Lag utan växling").status).toBe("MP");
  });

  it("avläsning i omvänd ordning: varje sträcka räknas om när föregående sträckas mål blir känt", async () => {
    const proof = await race();
    const courseId = await course(proof);
    const classId = await relayClass(proof, courseId, [{ startMethod: "MASS_START", startTime: at("17:00") }, { startMethod: "CHANGEOVER" },
      { startMethod: "CHANGEOVER" }], "Baklänges");
    expect((await team(proof, classId, "Lag bak", ["9401", "9402", "9403"].map((cardNumber, index) => ({ givenName: `B${index}`, cardNumber }))))
      .status).toBe("saved");
    // Två avläsningsdatorer: sträcka 3 och 2 läses före sträcka 1.
    await readout(proof, "9403", at("17:45"), run(at("17:30"), at("17:45")));
    await readout(proof, "9402", at("17:30"), run(at("17:15"), at("17:30")));
    // Sträcka 2 saknar start (sträcka 1 är inte avläst) och väntar (steg 50: inte felstämplad); sträcka 3 startar vid sträcka
    // 2:s målstämpling.
    expect((await overview(proof)).teams[0]!.legs.map(leg => leg.status)).toEqual([null, null, "OK"]);
    await readout(proof, "9401", at("17:15"), run(at("17:00"), at("17:15")));
    const view = await overview(proof);
    expect(view.teams[0]!.legs.map(leg => leg.startTime)).toEqual([at("17:00"), at("17:15"), at("17:30")]);
    expect(view.teams[0]).toMatchObject({ status: "OK", elapsedMs: minutes(45) });
  });

  it("IOF EntryList: TeamEntry med Leg och LegOrder ger lag med flera löpare per sträcka", async () => {
    const proof = await race();
    const courseId = await course(proof);
    await relayClass(proof, courseId, [{ startMethod: "MASS_START", startTime: at("17:00") },
      { startMethod: "CHANGEOVER", runners: 2 }], "H12 stafett");
    const person = (given: string, leg: number, order: number, card: string) => `<TeamEntryPerson><Person><Name><Family>Ek</Family>
      <Given>${given}</Given></Name></Person><Leg>${leg}</Leg><LegOrder>${order}</LegOrder><ControlCard>${card}</ControlCard></TeamEntryPerson>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">
  <Event><Name>Ungdomsstafetten</Name></Event>
  <TeamEntry><Id>T1</Id><Name>OK Ek 1</Name><Organisation><Name>OK Ek</Name></Organisation>
    ${person("Ada", 1, 1, "9401")}${person("Bo", 2, 1, "9402")}${person("Cia", 2, 2, "9403")}
    <Class><Name>H12 stafett</Name></Class></TeamEntry>
</EntryList>`;
    const imported = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: new TextEncoder().encode(xml) });
    if (imported.status !== "stored") throw new Error(`Importen misslyckades: ${imported.status}`);
    expect(imported.response.report).toMatchObject({ kind: "EntryList", imported: { teams: 1 } });
    const view = await overview(proof);
    expect(view.teams[0]).toMatchObject({ name: "OK Ek 1", organisationName: "OK Ek" });
    expect(view.teams[0]!.legs.map(leg => `${leg.leg}:${leg.legOrder}:${leg.givenName}:${leg.cardNumber}`))
      .toEqual(["1:1:Ada:9401", "2:1:Bo:9402", "2:2:Cia:9403"]);
  });
});
