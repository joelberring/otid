import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, RaceMapSourceMetadata, SportidentReadoutPayload } from "@o-tid/contracts";
import { mapPointToWgs84 } from "@o-tid/map-file";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { applySyncAsAdmin, previewCourseFileAsAdmin } from "../../src/source-sync";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { readPublicLegRoutes, saveParticipantRouteAsAdmin } from "../../src/race-map";
import { saveRaceMapSourceAsAdmin } from "../../src/race-map-source";
import { courseLegKeys, publishRouteChoiceAsAdmin, readRouteChoiceAsAdmin, readRouteChoiceCalibrationAsAdmin,
  saveRouteChoiceSettingsAsAdmin } from "../../src/route-choice";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { exportRaceAsAdmin } from "../../src/race-export";
import { accountOnRace, raceAuth } from "./accounts";

/**
 * Steg 60 (ADR-0179 beslut 7–13): vägvalsanalysens inställningar, "Visa bästa vägval publikt", banhemligheten för den
 * publika linjen, behörighet, kartfil som byts och GPS-rutternas delar för kalibreringen. Kartfilen och banfilen är de
 * syntetiska fixturerna från steg 59.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Vägvalstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg60_vagval_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_steg60_vagval_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `vagval.${suffix}@test.o-tid.se`, displayName: "Arrangör",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Vägval", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function importCourses(proof: Proof) {
  const xml = await readFile(new URL("iof/course-file-kartfil.xml", fixtures), "utf8");
  const preview = await previewCourseFileAsAdmin(db, { ...proof, xml, fileName: "course-file-kartfil.xml" });
  if (preview.status !== "ok") throw new Error(`Banfilen lästes inte in: ${preview.status}`);
  const requestId = randomUUID();
  const applied = await applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId,
    snapshotId: preview.response.snapshotId, excludedRowIds: [], confirmResultChanges: true } });
  if (applied.status !== "saved") throw new Error(`Banfilen sparades inte: ${applied.status}`);
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

const georeference = { scale: 10_000, crs: { kind: "EPSG" as const, code: 3006 }, refPoint: { easting: 675_000, northing: 6_580_000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const render = { pxPerMm: 8, originX: -2, originY: 102 };
const WIDTH = 992, HEIGHT = 832;
const corner = (x: number, y: number) => {
  const geo = mapPointToWgs84(georeference, { x: render.originX + x / render.pxPerMm, y: render.originY - y / render.pxPerMm });
  return { pixelX: x, pixelY: y, latitude: geo.latitude, longitude: geo.longitude };
};
const metadata = (): RaceMapSourceMetadata => ({ formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference, render, summary: { objectCount: 11, warnings: [], simplifications: [] },
  tiePoints: [corner(0, 0), corner(WIDTH - 1, 0), corner(0, HEIGHT - 1)] });

async function saveMapFile(proof: Proof, bytes: Uint8Array) {
  const saved = await saveRaceMapSourceAsAdmin(db, { ...proof, file: bytes, fileName: "kartfil.omap", image: png(WIDTH, HEIGHT), metadata: metadata() });
  if (saved.status !== "ok") throw new Error(`Kartfilen sparades inte: ${saved.status}`);
}

/** Start 18:00 svensk tid (16:00 UTC); sekunder efter start. */
const START = Date.UTC(2026, 9, 8, 16, 0, 0);
const at = (seconds: number) => new Date(START + seconds * 1_000).toISOString();
const snapshot = async (raceId: string) =>
  (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;

async function register(proof: Proof, givenName: string, cardNumber: string): Promise<string> {
  const [row] = (await pool.query<{ id: string; course_version_id: string; start_rule: "FIXED" | "PUNCH" }>(
    "select id, course_version_id, start_rule from class where race_id = $1 and name = 'H21'", [proof.raceId])).rows;
  const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: row!.id, expectedCourseVersionId: row!.course_version_id, expectedStartRule: row!.start_rule,
    givenName, familyName: "Vägval", organisationName: "OK Vägval", cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

async function readout(proof: Proof, cardNumber: string, punches: [number, number][], finish: number) {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", startPunchedAt: at(0), finishPunchedAt: at(finish),
    punches: punches.map(([code, seconds]) => ({ code, punchedAt: at(seconds) })), untimedPunchCodes: [], frames: ["02ef8300"],
    stationSerial: 999001, simulated: true };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at(finish + 60), transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

/** Fixturens GPX har tider från 2026-01-01 00:00 med starten 300 s in; flyttas så att starten blir loppets start. */
async function gpx(name: string): Promise<Uint8Array> {
  const source = await readFile(new URL(`routes/${name}.gpx`, fixtures), "utf8");
  const offset = START - 300_000 - Date.UTC(2026, 0, 1);
  return new TextEncoder().encode(source.replace(/<time>([^<]+)<\/time>/g, (_match, time: string) =>
    `<time>${new Date(Date.parse(time) + offset).toISOString()}</time>`));
}

const publicIdOf = async (entryId: string) =>
  (await pool.query<{ public_result_id: string }>("select public_result_id from entry where id = $1", [entryId])).rows[0]!.public_result_id;
const courseIdOf = async (raceId: string) =>
  (await pool.query<{ id: string }>("select id from course where race_id = $1 and name = 'Lång'", [raceId])).rows[0]!.id;
const PUNCHES: [number, number][] = [[31, 300], [32, 600], [33, 900], [34, 1200], [35, 1500], [36, 1800]];

describe("steg 60: vägvalsanalysen", () => {
  it("sträcknycklarna för en bana är samma som sträcktidstabellens", () => {
    expect(courseLegKeys([31, 32, 31])).toEqual(["S-31.1", "31.1-32.1", "32.1-31.2", "31.2-F"]);
  });

  it("sparar inställningarna, publicerar bästa vägar, följer banhemligheten och visar inga linjer från en annan kartfil", async () => {
    const proof = await race();
    await importCourses(proof);
    const functionary = await raceAuth(db, proof.raceId, "FUNCTIONARY");
    const courseId = await courseIdOf(proof.raceId);

    // Utan kartfil: läget finns men analysen kräver kartfilen; publicering avvisas.
    let state = await readRouteChoiceAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Läget saknas");
    expect(state.response).toMatchObject({ settings: { version: 1 }, mapFile: null, published: [], publishedMapSha256: null });
    const line: [number, number][] = [[15, 42], [30, 55], [42, 61]];
    const publish = (overrides: Record<string, unknown> = {}) => publishRouteChoiceAsAdmin(db, { ...proof, request: { formatVersion: 1,
      kind: "PUBLISH", mapSha256: "0".repeat(64), courseId, variantCode: null, legs: [{ key: "31.1-32.1", points: line }], ...overrides } });
    expect(await publish()).toEqual({ status: "problem", problem: "NO_MAP_FILE" });

    const omap = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
    await saveMapFile(proof, omap);
    state = await readRouteChoiceAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Läget saknas");
    const sha = state.response.mapFile!.sha256;
    expect(state.response.mapFile).toMatchObject({ scale: 10_000, render, placement: "PAPER", mismatch: false, image: { width: WIDTH, height: HEIGHT } });
    // Kontrollerna och starten på kartfilens mm (banfilens MapPosition).
    expect(state.response.controls.find(control => control.code === 32)!.at).toEqual({ x: 42, y: 61 });
    expect(state.response.courses.find(course => course.courseId === courseId)).toMatchObject({ start: { x: 4, y: 8 }, finish: { x: 12, y: 4 } });

    // Bara admin läser och skriver; fel CSRF ändrar inget.
    expect(await readRouteChoiceAsAdmin(db, functionary)).toEqual({ status: "forbidden" });
    const settings = { version: 1, classBySymbol: { "999": "IGNORE", "308": "SLOW" }, speedByClass: { SLOW: 0.7 }, contourIntervalMeters: 2.5,
      climbFactor: 10, referencePaceSecondsPerKm: 330 };
    expect(await saveRouteChoiceSettingsAsAdmin(db, { ...functionary, request: { formatVersion: 1, settings } })).toEqual({ status: "forbidden" });
    expect(["unauthorized", "forbidden"]).toContain((await saveRouteChoiceSettingsAsAdmin(db, { ...proof, csrfHeader: "fel",
      request: { formatVersion: 1, settings } })).status);
    expect(await saveRouteChoiceSettingsAsAdmin(db, { ...proof, request: { formatVersion: 1, settings: { version: 2 } } }))
      .toEqual({ status: "invalid-request" });
    expect(await saveRouteChoiceSettingsAsAdmin(db, { ...proof, request: { formatVersion: 1, settings: { ...settings, climbFactor: -1 } } }))
      .toEqual({ status: "invalid-request" });
    expect(await saveRouteChoiceSettingsAsAdmin(db, { ...proof, request: { formatVersion: 1, settings: { version: 1, classBySymbol: { "406": "TURBO" } } } }))
      .toEqual({ status: "invalid-request" });
    expect(await saveRouteChoiceSettingsAsAdmin(db, { ...proof, request: { formatVersion: 1, settings } })).toEqual({ status: "ok", settings });
    state = await readRouteChoiceAsAdmin(db, proof);
    expect(state.status === "ok" && state.response.settings).toEqual(settings);

    // Löpare med resultat och GPS-rutt; en till anmäld utan resultat gör banorna hemliga publikt.
    const anna = await register(proof, "Anna", "7201");
    const bo = await register(proof, "Bo", "7202");
    await readout(proof, "7201", PUNCHES, 2000);
    await readout(proof, "7202", PUNCHES.map(([code, seconds]) => [code, seconds + 20]), 2050);
    expect((await saveParticipantRouteAsAdmin(db, { ...proof, entryId: anna, bytes: await gpx("anna"), fileName: "anna.gpx" })).status).toBe("ok");
    const late = await register(proof, "Cia", "7203");

    // Publicering: fel kartfil, okänd sträcka och okänd bana avvisas; funktionären får inte.
    expect(await publish()).toEqual({ status: "problem", problem: "MAP_FILE_CHANGED" });
    expect(await publish({ mapSha256: sha, legs: [{ key: "31.1-33.1", points: line }] })).toEqual({ status: "problem", problem: "UNKNOWN_LEG" });
    expect(await publish({ mapSha256: sha, courseId: randomUUID() })).toEqual({ status: "problem", problem: "UNKNOWN_COURSE" });
    expect(await publish({ mapSha256: sha, variantCode: "AB" })).toEqual({ status: "problem", problem: "UNKNOWN_COURSE" });
    expect(await publish({ mapSha256: sha, legs: [{ key: "31.1-32.1", points: [[1, 1]] }] })).toEqual({ status: "invalid-request" });
    expect(await publishRouteChoiceAsAdmin(db, { ...functionary, request: { formatVersion: 1, kind: "PUBLISH", mapSha256: sha, courseId,
      variantCode: null, legs: [{ key: "31.1-32.1", points: line }] } })).toEqual({ status: "forbidden" });
    expect(await publish({ mapSha256: sha })).toEqual({ status: "ok", published: 1 });
    state = await readRouteChoiceAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Läget saknas");
    expect(state.response.published).toEqual([{ courseId, variantCode: null, legs: 1, publishedAt: expect.any(String) as unknown }]);
    expect(state.response.publishedMapSha256).toBe(sha);

    // Publikt: banorna är hemliga (Cia har inget resultat), så ingen linje; arrangören och funktionärerna ser den.
    const annaId = await publicIdOf(anna);
    expect((await readPublicLegRoutes(db, proof.raceId, annaId, "31.1-32.1"))!.bestRoute).toBeUndefined();
    const staff = await readPublicLegRoutes(db, proof.raceId, annaId, "31.1-32.1", { staff: true });
    // Kartfilens mm → kartbildens pixlar: ((x + 2)·8, (102 − y)·8).
    expect(staff!.bestRoute).toEqual({ points: [[136, 480], [256, 376], [352, 328]] });
    // Banorna publika (Cia struken): linjen visas, men bara för sträckor som löparen har i ett publicerat resultat.
    await pool.query("update entry set struck_at = now() where id = $1", [late]);
    expect((await readPublicLegRoutes(db, proof.raceId, annaId, "31.1-32.1"))!.bestRoute!.points).toHaveLength(3);
    expect((await readPublicLegRoutes(db, proof.raceId, annaId, "32.1-33.1"))!.bestRoute).toBeUndefined();
    expect(await readPublicLegRoutes(db, proof.raceId, await publicIdOf(bo), "31.1-32.1")).toBeUndefined();

    // Kalibreringen: rutternas delar per sträcka utan namn, bara för admin.
    expect(await readRouteChoiceCalibrationAsAdmin(db, { ...functionary, courseId })).toEqual({ status: "forbidden" });
    expect(await readRouteChoiceCalibrationAsAdmin(db, { ...proof, courseId: randomUUID() })).toEqual({ status: "not-found" });
    const calibration = await readRouteChoiceCalibrationAsAdmin(db, { ...proof, courseId });
    if (calibration.status !== "ok") throw new Error("Kalibreringen saknas");
    expect(calibration.response.runners).toHaveLength(1);
    expect(calibration.response.runners[0]!.legs.map(leg => [leg.key, leg.milliseconds])).toEqual([["S-31.1", 300_000], ["31.1-32.1", 300_000],
      ["32.1-33.1", 300_000], ["33.1-34.1", 300_000], ["34.1-35.1", 300_000], ["35.1-36.1", 300_000], ["36.1-F", 200_000]]);
    expect(JSON.stringify(calibration.response)).not.toMatch(/Anna|Vägval|7201/);

    // Exporten och kopian: inställningarna följer med, publiceringen bara i exporten.
    const exported = await exportRaceAsAdmin(db, proof);
    if (exported.status !== "ok") throw new Error("Exporten misslyckades");
    const json = JSON.parse(new TextDecoder().decode(exported.bytes)) as { routeChoice: { settings: unknown; published: { mapSha256: string } }[] };
    expect(json.routeChoice[0]).toMatchObject({ settings, published: { mapSha256: sha } });
    const copied0 = await copyRaceAsAdmin(db, { ...proof, request: { formatVersion: 1, requestId: randomUUID(), eventName: "Vägval v2",
      raceName: "Torsdag", raceDate: "2026-10-15", includePeople: false } });
    if (copied0.status !== "copied") throw new Error(`Kopian skapades inte: ${copied0.status}`);
    const copy = copied0.response.raceId;
    const copied = await pool.query<{ settings: unknown; published: unknown }>("select settings, published from race_route_choice where race_id = $1", [copy]);
    expect(copied.rows).toEqual([{ settings, published: null }]);

    // En ny kartfil (annan sha256): de gamla linjerna visas inte, och nästa publicering tar bort dem.
    const changed = new Uint8Array([...omap, ...new TextEncoder().encode("\n")]);
    await saveMapFile(proof, changed);
    expect((await readPublicLegRoutes(db, proof.raceId, annaId, "31.1-32.1", { staff: true }))!.bestRoute).toBeUndefined();
    state = await readRouteChoiceAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Läget saknas");
    expect(state.response.publishedMapSha256).toBe(sha);
    expect(state.response.mapFile!.sha256).not.toBe(sha);
    expect(await publish({ mapSha256: sha })).toEqual({ status: "problem", problem: "MAP_FILE_CHANGED" });
    expect(await publishRouteChoiceAsAdmin(db, { ...proof, request: { formatVersion: 1, kind: "WITHDRAW", courseId, variantCode: null } }))
      .toEqual({ status: "ok", published: 0 });
    state = await readRouteChoiceAsAdmin(db, proof);
    expect(state.status === "ok" && [state.response.published, state.response.publishedMapSha256]).toEqual([[], null]);

    const audit = await pool.query<{ action: string }>("select action from audit_event where race_id = $1 and entity_type = 'race_route_choice' order by created_at, id",
      [proof.raceId]);
    expect(audit.rows.map(row => row.action)).toEqual(["ROUTE_CHOICE_SETTINGS_SAVED", "ROUTE_CHOICE_PUBLISHED", "ROUTE_CHOICE_WITHDRAWN"]);
  });

  it("räknar om banfilens Position till kartfilens mm när kartlägena inte passar kartan", async () => {
    const proof = await race();
    // Banfilen utan kartlägen: lägena räknas ur WGS 84 med kartfilens georeferens.
    const xml = (await readFile(new URL("iof/course-file-kartfil.xml", fixtures), "utf8")).replace(/<MapPosition[^>]*\/>/g, "");
    const preview = await previewCourseFileAsAdmin(db, { ...proof, xml, fileName: "utan-kartlagen.xml" });
    if (preview.status !== "ok") throw new Error("Banfilen lästes inte in");
    const requestId = randomUUID();
    await applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId,
      snapshotId: preview.response.snapshotId, excludedRowIds: [], confirmResultChanges: true } });
    await saveMapFile(proof, new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures))));
    const state = await readRouteChoiceAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Läget saknas");
    expect(state.response.mapFile).toMatchObject({ placement: "GEO", mismatch: false });
    const at32 = state.response.controls.find(control => control.code === 32)!.at!;
    expect(at32.x).toBeCloseTo(42, 0);
    expect(at32.y).toBeCloseTo(61, 0);
  });
});
