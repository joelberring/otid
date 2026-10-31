import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { mapPointToWgs84 } from "@o-tid/map-file";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { applySyncAsAdmin, previewCourseFileAsAdmin } from "../../src/source-sync";
import { readControlMapAsAdmin } from "../../src/control-map";
import { readRaceMapImageAsAdmin, readRaceMapStateAsAdmin, saveRaceMapAsAdmin, removeRaceMapAsAdmin, georeferenceRaceMapAsAdmin } from "../../src/race-map";
import { readRaceMapSourceFileAsAdmin, removeRaceMapSourceAsAdmin, saveRaceMapSourceAsAdmin } from "../../src/race-map-source";
import { exportRaceAsAdmin } from "../../src/race-export";
import { accountOnRace, raceAuth } from "./accounts";

/**
 * Steg 59 (ADR-0179): kartfilen. Uppladdning med bild och tre punkter ur filen i en transaktion, ersättning, borttagning,
 * behörighet, storlek och kontrollerna direkt på kartfilens mm (med kontroll mot banfilens Position). Kartfilen och banfilen
 * är syntetiska (fixtures/maps/kartfil.omap, fixtures/iof/course-file-kartfil.xml).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Kartfilstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg59_kartfil_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_steg59_kartfil_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `kartfil.${suffix}@test.o-tid.se`, displayName: "Arrangör",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Kartfil", raceName: "Torsdag", raceDate: "2026-10-29",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function importCourses(proof: Proof, name: string, transform?: (xml: string) => string) {
  const xml = await readFile(new URL(`iof/${name}`, fixtures), "utf8");
  const preview = await previewCourseFileAsAdmin(db, { ...proof, xml: transform ? transform(xml) : xml, fileName: name });
  if (preview.status !== "ok") throw new Error(`Banfilen lästes inte in: ${preview.status}`);
  const requestId = randomUUID();
  const applied = await applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId,
    snapshotId: preview.response.snapshotId, excludedRowIds: [], confirmResultChanges: true } });
  if (applied.status !== "saved") throw new Error(`Banfilen sparades inte: ${applied.status}`);
}

/** En minimal PNG (bara signatur och IHDR, servern avkodar aldrig bilden) med bildens storlek. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

/** Kartfilens yta 0–120 × 0–100 mm, ritad med 8 px/mm och 2 mm kant: 992 × 832 px, övre vänstra hörnet (−2, 102) mm. */
const georeference = { scale: 10_000, crs: { kind: "EPSG" as const, code: 3006 }, refPoint: { easting: 675_000, northing: 6_580_000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const render = { pxPerMm: 8, originX: -2, originY: 102 };
const WIDTH = 992, HEIGHT = 832;
const corner = (x: number, y: number) => {
  const geo = mapPointToWgs84(georeference, { x: render.originX + x / render.pxPerMm, y: render.originY - y / render.pxPerMm })!;
  return { pixelX: x, pixelY: y, latitude: geo.latitude, longitude: geo.longitude };
};

function metadata(overrides: Partial<RaceMapSourceMetadata> = {}): RaceMapSourceMetadata {
  return { formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000, bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 },
    georeference, render, summary: { objectCount: 11, warnings: [], simplifications: ["Text ritas med standardtypsnitt och vänsterställd"] },
    tiePoints: [corner(0, 0), corner(WIDTH - 1, 0), corner(0, HEIGHT - 1)], ...overrides };
}

describe("steg 59: kartfilen", () => {
  it("sparar kartfilen, bilden och georeferensen tillsammans och placerar kontrollerna på kartfilens mm", async () => {
    const proof = await race();
    await importCourses(proof, "course-file-kartfil.xml");
    const omap = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
    const image = png(WIDTH, HEIGHT);

    // Bara admin; en funktionär och fel session får inget sparat.
    const functionary = await raceAuth(db, proof.raceId, "FUNCTIONARY");
    expect(await saveRaceMapSourceAsAdmin(db, { ...functionary, file: omap, fileName: "kartfil.omap", image, metadata: metadata() }))
      .toEqual({ status: "forbidden" });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, csrfHeader: "fel", file: omap, fileName: "kartfil.omap", image, metadata: metadata() }))
      .toMatchObject({ status: expect.stringMatching(/unauthorized|forbidden/) });
    // Filen måste se ut som det format som anges, bilden vara en PNG och täcka kartans yta.
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "karta.ocd", image, metadata: metadata({ format: "OCD" }) }))
      .toEqual({ status: "problem", problem: "INVALID_MAP_FILE" });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: new TextEncoder().encode("<?xml version=\"1.0\"?><svg/>"), fileName: "x.omap",
      image, metadata: metadata() })).toEqual({ status: "problem", problem: "INVALID_MAP_FILE" });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "kartfil.omap", image: new Uint8Array([0xff, 0xd8, 0xff]),
      metadata: metadata() })).toEqual({ status: "problem", problem: "INVALID_IMAGE" });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "kartfil.omap", image: png(500, 500), metadata: metadata() }))
      .toEqual({ status: "invalid-request" });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "kartfil.omap", image, metadata: { formatVersion: 2 } }))
      .toEqual({ status: "invalid-request" });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: new Uint8Array(60 * 1024 * 1024 + 1), fileName: "stor.ocd", image,
      metadata: metadata({ format: "OCD" }) })).toEqual({ status: "problem", problem: "MAP_FILE_TOO_LARGE" });
    expect((await pool.query("select 1 from race_map where race_id = $1 union all select 1 from race_map_source where race_id = $1",
      [proof.raceId])).rowCount).toBe(0);

    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "kartfil.omap", image, metadata: metadata() }))
      .toEqual({ status: "ok", georeferenced: true });
    const state = await readRaceMapStateAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Kartan saknas");
    expect(state.response.map).toMatchObject({ fileName: "kartfil.png", mediaType: "image/png", width: WIDTH, height: HEIGHT });
    expect(state.response.map!.georeferencedAt).not.toBeNull();
    expect(state.response.source).toMatchObject({ fileName: "kartfil.omap", format: "OMAP", version: "Mapper v9", scale: 10_000,
      byteLength: omap.byteLength, crs: { kind: "EPSG", code: 3006 }, georeferencedFromFile: true, summary: { objectCount: 11 } });
    const original = await readRaceMapSourceFileAsAdmin(db, proof);
    expect(original.status === "ok" && Buffer.compare(original.file, Buffer.from(omap))).toBe(0);
    expect(await readRaceMapSourceFileAsAdmin(db, functionary)).toEqual({ status: "forbidden" });

    // Kontrollerna: kartlägena direkt i bildens pixlar ((x + 2)·8, (102 − y)·8).
    const map = await readControlMapAsAdmin(db, proof);
    if (map.status !== "ok") throw new Error("Kontrollkartan saknas");
    expect(map.response).toMatchObject({ frame: "MAP", mapFile: "USED", map: { width: WIDTH, height: HEIGHT } });
    expect(map.response.metersPerUnit).toBeCloseTo(1.25);
    expect(map.response.controls.find(control => control.code === 32)!.position).toEqual({ x: 352, y: 328 });
    expect(map.response.courses[0]!.start).toEqual({ x: 48, y: 752 });

    // Banfilen gjord på en annan karta (Position 30 m österut): dagens ordning och beskedet.
    const other = await race();
    await importCourses(other, "course-file-kartfil.xml", xml => xml.replace(/lng="([0-9.]+)"/g, (_m, lng: string) =>
      `lng="${(Number(lng) + 30 / (111_320 * Math.cos(59.33 * Math.PI / 180))).toFixed(7)}"`));
    expect((await saveRaceMapSourceAsAdmin(db, { ...other, file: omap, fileName: "kartfil.omap", image, metadata: metadata() })).status).toBe("ok");
    const shifted = await readControlMapAsAdmin(db, other);
    if (shifted.status !== "ok") throw new Error("Kontrollkartan saknas");
    expect(shifted.response.mapFile).toBe("MISMATCH");
    // Via WGS 84: 30 m = 24 px åt höger om kartläget.
    expect(shifted.response.controls.find(control => control.code === 32)!.position!.x).toBeCloseTo(376, -1);

    // Exporten har kartfilen i base64.
    const exported = await exportRaceAsAdmin(db, proof);
    if (exported.status !== "ok") throw new Error("Exporten misslyckades");
    const json = JSON.parse(new TextDecoder().decode(exported.bytes)) as { mapSources: { file_base64: string; format: string }[] };
    expect(json.mapSources).toHaveLength(1);
    expect(Buffer.from(json.mapSources[0]!.file_base64, "base64").byteLength).toBe(omap.byteLength);
  });

  it("utan georeferens i filen sparas bilden ogeorefererad; tre punkter för hand fungerar som förut", async () => {
    const proof = await race();
    const omap = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "kartfil.omap", image: png(WIDTH, HEIGHT),
      metadata: metadata({ georeference: null, tiePoints: null }) })).toEqual({ status: "ok", georeferenced: false });
    let state = await readRaceMapStateAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Kartan saknas");
    expect(state.response.map!.georeferencedAt).toBeNull();
    expect(state.response.source).toMatchObject({ crs: null, georeferencedFromFile: false });
    const tiePoints = metadata().tiePoints!;
    expect(await georeferenceRaceMapAsAdmin(db, { ...proof, request: { formatVersion: 1, tiePoints } })).toEqual({ status: "ok" });
    state = await readRaceMapStateAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Kartan saknas");
    // Satt för hand efteråt, inte ur filen.
    expect(state.response.source).toMatchObject({ georeferencedFromFile: false });
    expect(state.response.map!.georeferencedAt).not.toBeNull();
  });

  it("en ny kartfil ersätter bilden, en vanlig kartbild tar bort kartfilen och borttagningen är atomär", async () => {
    const proof = await race();
    const omap = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
    await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "första.omap", image: png(WIDTH, HEIGHT), metadata: metadata() });
    // Ersättning: ny bild, ny georeferens och ny kartfil i samma transaktion.
    const second = metadata({ version: "Mapper v9 (ny)", render: { pxPerMm: 4, originX: -2, originY: 102 },
      tiePoints: null, georeference: null });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "andra.omap", image: png(496, 416), metadata: second }))
      .toEqual({ status: "ok", georeferenced: false });
    let state = await readRaceMapStateAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Kartan saknas");
    expect(state.response.map).toMatchObject({ fileName: "andra.png", width: 496, height: 416, tiePoints: null, georeferencedAt: null });
    expect(state.response.source).toMatchObject({ fileName: "andra.omap", version: "Mapper v9 (ny)" });
    expect((await pool.query("select count(*)::int as n from race_map_source where race_id = $1", [proof.raceId])).rows[0]).toEqual({ n: 1 });

    // Ett fel efter att kartbilden skrivits rullar tillbaka allt (CHECK på kartfilens skala).
    await expect(saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "trasig.omap", image: png(WIDTH, HEIGHT),
      metadata: { ...metadata(), scale: 50 } as RaceMapSourceMetadata })).resolves.toEqual({ status: "invalid-request" });
    await pool.query("alter table race_map_source add constraint steg59_test_check check (file_name <> 'trasig.omap')");
    await expect(saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "trasig.omap", image: png(WIDTH, HEIGHT), metadata: metadata() }))
      .rejects.toThrow();
    await pool.query("alter table race_map_source drop constraint steg59_test_check");
    state = await readRaceMapStateAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Kartan saknas");
    expect(state.response.map).toMatchObject({ fileName: "andra.png", width: 496 });

    // En vanlig kartbild: kartfilen tas bort.
    const fixturePng = new Uint8Array(await readFile(new URL("maps/strackanalys.png", fixtures)));
    expect(await saveRaceMapAsAdmin(db, { ...proof, bytes: fixturePng, fileName: "skannad.png" })).toEqual({ status: "ok" });
    state = await readRaceMapStateAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Kartan saknas");
    expect(state.response.source).toBeNull();
    expect(await readRaceMapSourceFileAsAdmin(db, proof)).toEqual({ status: "not-found" });

    // Ta bort kartfilen behåller bilden; ta bort kartan tar båda.
    await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "tredje.omap", image: png(WIDTH, HEIGHT), metadata: metadata() });
    expect(await removeRaceMapSourceAsAdmin(db, proof)).toEqual({ status: "ok" });
    expect(await removeRaceMapSourceAsAdmin(db, proof)).toEqual({ status: "not-found" });
    expect((await readRaceMapImageAsAdmin(db, proof)).status).toBe("ok");
    await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "fjärde.omap", image: png(WIDTH, HEIGHT), metadata: metadata() });
    expect(await removeRaceMapAsAdmin(db, proof)).toEqual({ status: "ok" });
    expect((await pool.query("select 1 from race_map_source where race_id = $1", [proof.raceId])).rowCount).toBe(0);

    const audit = await pool.query<{ action: string }>("select action from audit_event where race_id = $1 and entity_type = 'race_map' order by created_at, id",
      [proof.raceId]);
    expect(audit.rows.map(row => row.action)).toEqual(["RACE_MAP_SOURCE_SAVED", "RACE_MAP_SOURCE_SAVED", "RACE_MAP_SAVED",
      "RACE_MAP_SOURCE_SAVED", "RACE_MAP_SOURCE_REMOVED", "RACE_MAP_SOURCE_SAVED", "RACE_MAP_REMOVED"]);
  });

  it("tas med i pg_dump", async () => {
    const proof = await race();
    const omap = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
    await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "dump.omap", image: png(WIDTH, HEIGHT), metadata: metadata() });
    const { stdout } = await promisify(execFile)("pg_dump", ["--data-only", "--table=race_map_source", url.href], { maxBuffer: 64 * 1024 * 1024 });
    expect(stdout).toContain("COPY public.race_map_source");
    expect(stdout).toContain("dump.omap");
  });
});
