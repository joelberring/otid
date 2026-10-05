import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { publicResults } from "../../src/results";
import {
  georeferenceRaceMapAsAdministrator, readPublicLegRoutes, readPublicRaceMapImage, readPublicRouteIndex, readRaceMapStateAsAdministrator,
  removeParticipantRouteAsAdministrator, saveParticipantRouteAsAdministrator, saveRaceMapAsAdministrator
} from "../../src/race-map";

/**
 * ADR-0171 / PLAN.md steg 16: karta och vägval i PostgreSQL. Admin laddar upp kartan, georefererar den och laddar
 * upp GPX-rutter; rutterna kopplas till sträckorna med stämplingstiderna och det publika får bara ruttens del för
 * en sträcka, aldrig tiden före start eller efter mål.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Vägvalstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0171_routes_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0171_routes_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Race = { proof: Proof; raceId: string; classId: string };

const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
const courseVersionOf = async (classId: string) =>
  (await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId])).rows[0]!.course_version_id;

async function race(): Promise<Race> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, loginName: `vagval.${suffix}`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Vägval", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(raceId), courseName: "Lång",
      className: "H21", startRule: "PUNCH", controlCodes: [31, 32, 33] } });
  if (course.status !== "created") throw new Error(`Banan kunde inte skapas: ${course.status}`);
  return { proof, raceId, classId: course.response.classId };
}

async function register(f: Race, givenName: string, cardNumber: string): Promise<string> {
  const registered = await registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId), expectedStartRule: "PUNCH",
    expectedSnapshotVersion: await snapshot(f.raceId), givenName, familyName: "Löpare", organisationName: "OK Vägval",
    cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

/** Start 18:00 svensk tid (16:00 UTC); sekunder efter start. */
const START = Date.UTC(2026, 9, 8, 16, 0, 0);
const at = (seconds: number) => new Date(START + seconds * 1_000).toISOString();

async function readout(f: Race, cardNumber: string, punches: [number, number][], finish: number) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: at(0), finishPunchedAt: at(finish),
    punches: punches.map(([code, seconds]) => ({ code, punchedAt: at(seconds) })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at(finish + 60), transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...f.proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

/** Fixturens GPX har tider från 2026-01-01 00:00 med starten 300 s in; flyttas så att starten blir loppets start. */
async function gpx(name: string): Promise<Uint8Array> {
  const source = await readFile(new URL(`routes/${name}.gpx`, fixtures), "utf8");
  const offset = START - 300_000 - Date.UTC(2026, 0, 1);
  return new TextEncoder().encode(source.replace(/<time>([^<]+)<\/time>/g, (_match, time: string) =>
    `<time>${new Date(Date.parse(time) + offset).toISOString()}</time>`));
}

/** Tre punkter på fixturkartan (800 × 600 px, norr uppåt). */
const tiePoints = [
  { pixelX: 100, pixelY: 100, latitude: 59.31 - 0.01 / 6, longitude: 18.09 + 0.0035 },
  { pixelX: 700, pixelY: 100, latitude: 59.31 - 0.01 / 6, longitude: 18.09 + 0.0245 },
  { pixelX: 100, pixelY: 500, latitude: 59.31 - 0.05 / 6, longitude: 18.09 + 0.0035 }
];

const publicIdOf = async (entryId: string) =>
  (await pool.query<{ public_result_id: string }>("select public_result_id from entry where id = $1", [entryId])).rows[0]!.public_result_id;

describe("ADR-0171 karta och vägval", () => {
  it("laddar upp karta och rutter, georefererar och ger vägvalen per sträcka", async () => {
    const f = await race();
    const anna = await register(f, "Anna", "7201");
    const bo = await register(f, "Bo", "7202");
    const cia = await register(f, "Cia", "7203");
    // Anna och Bo följer fixturens tider (7:30 per sträcka). Cia missar 32 (felstämplad).
    await readout(f, "7201", [[31, 450], [32, 900], [33, 1350]], 1800);
    await readout(f, "7202", [[31, 440], [32, 910], [33, 1360]], 1790);
    await readout(f, "7203", [[31, 500], [33, 1400]], 1850);
    const png = new Uint8Array(await readFile(new URL("maps/strackanalys.png", fixtures)));

    // Utan karta: inget publikt, ingen bild.
    expect(await readPublicRaceMapImage(db, f.raceId)).toBeUndefined();
    expect(await readPublicRouteIndex(db, f.raceId)).toEqual({ legs: {} });

    // Bara admin skriver; fel fil ger begripligt fel.
    expect(await saveRaceMapAsAdministrator(db, { ...f.proof, sessionToken: "fel", bytes: png, fileName: "karta.png" }))
      .toEqual({ status: "unauthorized" });
    expect(await saveRaceMapAsAdministrator(db, { ...f.proof, bytes: new TextEncoder().encode("<svg/>"), fileName: "karta.svg" }))
      .toEqual({ status: "problem", problem: "INVALID_IMAGE" });
    expect(await saveRaceMapAsAdministrator(db, { ...f.proof, bytes: png, fileName: "karta.png" })).toEqual({ status: "ok" });
    let state = await readRaceMapStateAsAdministrator(db, f.proof);
    if (state.status !== "ok") throw new Error("Kartan saknas");
    expect(state.response.map).toMatchObject({ fileName: "karta.png", mediaType: "image/png", width: 800, height: 600, georeferencedAt: null });
    // Inte georefererad: fortfarande inget publikt.
    expect(await readPublicRaceMapImage(db, f.raceId)).toBeUndefined();

    // Tre punkter på en linje går inte; tre riktiga punkter ger georeferensen.
    const collinear = [tiePoints[0]!, tiePoints[1]!, { ...tiePoints[1]!, pixelX: 400, longitude: 18.104 }];
    expect(await georeferenceRaceMapAsAdministrator(db, { ...f.proof, request: { formatVersion: 1, tiePoints: collinear } }))
      .toEqual({ status: "problem", problem: "INVALID_GEOREFERENCE" });
    expect(await georeferenceRaceMapAsAdministrator(db, { ...f.proof, request: { formatVersion: 1, tiePoints } })).toEqual({ status: "ok" });
    const image = await readPublicRaceMapImage(db, f.raceId);
    expect(image?.mediaType).toBe("image/png");
    expect(Buffer.compare(image!.image, Buffer.from(png))).toBe(0);

    // GPX: utan tider eller trasig fil avvisas; Annas och Cias rutter sparas och täcker sina sträckor.
    const untimed = new TextEncoder().encode('<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">' +
      '<trk><trkseg><trkpt lat="59.30" lon="18.10"/><trkpt lat="59.31" lon="18.11"/></trkseg></trk></gpx>');
    expect(await saveParticipantRouteAsAdministrator(db, { ...f.proof, entryId: anna, bytes: untimed, fileName: "rutt.gpx" }))
      .toEqual({ status: "problem", problem: "ROUTE_WITHOUT_TIMES" });
    expect(await saveParticipantRouteAsAdministrator(db, { ...f.proof, entryId: anna, bytes: new TextEncoder().encode("<gpx"), fileName: "x.gpx" }))
      .toEqual({ status: "problem", problem: "INVALID_GPX" });
    const saved = await saveParticipantRouteAsAdministrator(db, { ...f.proof, entryId: anna, bytes: await gpx("anna"), fileName: "anna.gpx" });
    expect(saved).toMatchObject({ status: "ok", response: { entryId: anna, pointCount: 241, coveredLegs: 4, legs: 4 } });
    await saveParticipantRouteAsAdministrator(db, { ...f.proof, entryId: cia, bytes: await gpx("bo"), fileName: "cia.gpx" });
    state = await readRaceMapStateAsAdministrator(db, f.proof);
    if (state.status !== "ok") throw new Error("Tillståndet saknas");
    expect(state.response.routes.find(route => route.entryId === anna)).toMatchObject({ fileName: "anna.gpx", coveredLegs: 4, legs: 4 });
    // Cia: start–31, 33–mål och sin egen sträcka 31–33 (inte 32–33, som hon inte sprang).
    expect(state.response.routes.find(route => route.entryId === cia)).toMatchObject({ coveredLegs: 3, legs: 3 });

    // Publikt: index per löpare med samma sträcknycklar som sträcktidstabellen.
    const [annaId, boId, ciaId] = await Promise.all([publicIdOf(anna), publicIdOf(bo), publicIdOf(cia)]);
    const index = await readPublicRouteIndex(db, f.raceId);
    expect(index.legs[annaId]).toEqual(["S-31.1", "31.1-32.1", "32.1-33.1", "33.1-F"]);
    expect(index.legs[ciaId]).toEqual(["S-31.1", "31.1-33.1", "33.1-F"]);
    expect(index.legs[boId]).toBeUndefined();

    // Sträckan 31–32: Annas del från kontroll 31 (fixturkartans cirkel vid 260,330) till 32 (470,230).
    const leg = await readPublicLegRoutes(db, f.raceId, annaId, "31.1-32.1");
    expect(leg?.runners.map(runner => [runner.name, runner.selected, runner.legMs])).toEqual([["Anna Löpare", true, 450_000]]);
    const points = leg!.runners[0]!.points;
    expect(points[0]![0]).toBeCloseTo(260, -1);
    expect(points[0]![1]).toBeCloseTo(330, -1);
    expect(points.at(-1)![0]).toBeCloseTo(470, -1);
    expect(points.at(-1)![1]).toBeCloseTo(230, -1);
    expect(leg!.map).toEqual({ width: 800, height: 600, version: image!.sha256.slice(0, 16) });

    // Start–31 för Anna och Cia: den valda först, andra löpare på samma sträcka att jämföra med. Inget före start:
    // fixturen står still vid starten i fem minuter, så sträckan börjar vid starttriangeln (140,500).
    const first = await readPublicLegRoutes(db, f.raceId, ciaId, "S-31.1");
    expect(first?.runners.map(runner => [runner.name, runner.selected])).toEqual([["Cia Löpare", true], ["Anna Löpare", false]]);
    expect(first!.runners[1]!.points[0]![0]).toBeCloseTo(140, -1);
    expect(first!.runners[1]!.points[0]![1]).toBeCloseTo(500, -1);

    // Sträckor som löparen inte har, okänd löpare eller felaktig nyckel ger inget.
    expect(await readPublicLegRoutes(db, f.raceId, ciaId, "31.1-32.1")).toBeUndefined();
    expect(await readPublicLegRoutes(db, f.raceId, boId, "S-31.1")).toBeUndefined();
    expect(await readPublicLegRoutes(db, f.raceId, annaId, "drop table")).toBeUndefined();

    // Resultatlistan påverkas inte av kartan.
    expect((await publicResults(db, f.raceId)).results).toHaveLength(3);

    // Borttagen rutt syns inte längre; en ny kartbild måste georefereras igen.
    expect(await removeParticipantRouteAsAdministrator(db, { ...f.proof, entryId: cia })).toEqual({ status: "ok" });
    expect((await readPublicRouteIndex(db, f.raceId)).legs[ciaId]).toBeUndefined();
    expect(await saveRaceMapAsAdministrator(db, { ...f.proof, bytes: png, fileName: "ny.png" })).toEqual({ status: "ok" });
    expect(await readPublicRouteIndex(db, f.raceId)).toEqual({ legs: {} });
    const audit = await pool.query<{ action: string }>("select action from audit_event where race_id = $1 and entity_type = 'race_map' order by created_at",
      [f.raceId]);
    expect(audit.rows.map(row => row.action)).toEqual(["RACE_MAP_SAVED", "RACE_MAP_GEOREFERENCED", "PARTICIPANT_ROUTE_SAVED",
      "PARTICIPANT_ROUTE_SAVED", "PARTICIPANT_ROUTE_REMOVED", "RACE_MAP_SAVED"]);
  });
});
