import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { emptyDocument, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { mapPointToWgs84 } from "@o-tid/map-file";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { applySyncAsAdmin } from "../../src/source-sync";
import { saveRaceMapSourceAsAdmin } from "../../src/race-map-source";
import {
  importCourseSettingAsAdmin, listCourseSettingRevisionsAsAdmin, previewCourseSettingTransferAsAdmin, readCourseSettingAsAdmin,
  readCourseSettingOriginalAsAdmin, readCourseSettingRevisionAsAdmin, restoreCourseSettingRevisionAsAdmin, saveCourseSettingAsAdmin
} from "../../src/course-setting";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { exportRaceAsAdmin } from "../../src/race-export";
import { readBackup } from "./backup";
import { publicResults } from "../../src/results";
import { accountOnRace, raceAuth } from "./accounts";

/**
 * Steg 62 (ADR-0180): banläggningens dokument – spara med versionskontroll (två flikar), tidigare versioner, inläst .ppen
 * orörd, återställning, "Överför till tävlingen" (banor, kontroller med lägen, varianter som Purple Pens IOF-export och
 * klasserna) och banhemligheten (bara admin, med i adminexporten och kopian, aldrig publikt).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Banläggningstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg62_banlaggning_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_steg62_banlaggning_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `banlaggning.${suffix}@test.o-tid.se`, displayName: "Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Banläggning", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
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
const corner = (x: number, y: number) => {
  const geo = mapPointToWgs84(georeference, { x: render.originX + x / render.pxPerMm, y: render.originY - y / render.pxPerMm });
  return { pixelX: x, pixelY: y, latitude: geo.latitude, longitude: geo.longitude };
};
const metadata = (): RaceMapSourceMetadata => ({ formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference, render, summary: { objectCount: 11, warnings: [], simplifications: [] },
  tiePoints: [corner(0, 0), corner(991, 0), corner(0, 831)] });

async function saveMapFile(proof: Proof) {
  const bytes = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
  const saved = await saveRaceMapSourceAsAdmin(db, { ...proof, file: bytes, fileName: "kartfil.omap", image: png(992, 832), metadata: metadata() });
  if (saved.status !== "ok") throw new Error(`Kartfilen sparades inte: ${saved.status}`);
}

const ppenText = () => readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
const empty = () => emptyDocument({ title: "Träning", mapScale: 10_000 });
const save = (proof: Proof, document: CourseSettingDocument, expectedVersion: number) =>
  saveCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion, document } });
const moved = (document: CourseSettingDocument, x: number): CourseSettingDocument => {
  const [id, control] = Object.entries(document.controls).find(([, row]) => row.kind === "NORMAL")!;
  return { ...document, controls: { ...document.controls, [id]: { ...control, at: { x, y: control.at.y } } } };
};

describe("steg 62: banläggningen", { timeout: 120_000 }, () => {
  it("sparar med versionskontroll så att två flikar inte skriver över varandra, bara för admin", async () => {
    const proof = await race();
    const before = await readCourseSettingAsAdmin(db, proof);
    // Tävlingens typ följer med (rogaining och fest förklaras i editorn).
    expect(before).toMatchObject({ status: "ok", response: { setting: null, original: null, mapFile: null, raceType: "STANDARD" } });
    expect(await save(proof, empty(), 0)).toMatchObject({ status: "ok", response: { version: 1 } });
    // Den andra fliken läste innan det fanns något dokument.
    const clash = await save(proof, empty(), 0);
    expect(clash).toMatchObject({ status: "version-conflict", conflict: { error: "VERSION_CONFLICT",
      current: { version: 1, updatedBy: { displayName: "Banläggare" } } } });
    expect(await save(proof, empty(), 1)).toMatchObject({ status: "ok", response: { version: 2 } });
    const read = await readCourseSettingAsAdmin(db, proof);
    if (read.status !== "ok") throw new Error("Läget saknas");
    expect(read.response.setting).toMatchObject({ version: 2, document: { version: 1, event: { title: "Träning", mapScale: 10000 } } });

    // Ogiltigt dokument, fel CSRF, funktionär och inte inloggad.
    expect(await saveCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 2, document: { version: 2 } } }))
      .toEqual({ status: "invalid-request" });
    expect((await saveCourseSettingAsAdmin(db, { ...proof, csrfHeader: "x".repeat(43), request: { formatVersion: 1, expectedVersion: 2,
      document: empty() } })).status).not.toBe("ok");
    const functionary = await raceAuth(db, proof.raceId, "FUNCTIONARY");
    expect((await readCourseSettingAsAdmin(db, functionary)).status).toBe("forbidden");
    expect((await save(functionary, empty(), 2)).status).toBe("forbidden");
    expect((await readCourseSettingAsAdmin(db, { raceId: proof.raceId, sessionToken: null })).status).toBe("unauthorized");
  });

  it("läser in .ppen (filen orörd), behåller tidigare versioner och återställer", async () => {
    const proof = await race();
    expect(await save(proof, empty(), 0)).toMatchObject({ status: "ok", response: { version: 1 } });
    const ppen = await ppenText();
    const { document } = readPpen(ppen);
    const imported = await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 1, document,
      fileName: "kartfil.ppen", ppen } });
    expect(imported).toMatchObject({ status: "ok", response: { version: 2 } });
    expect(await readCourseSettingOriginalAsAdmin(db, proof)).toEqual({ status: "ok", fileName: "kartfil.ppen", ppen });
    // Autosparanden direkt efter varandra blir inte var sin tidigare version.
    expect((await save(proof, moved(document, 16), 2)).status).toBe("ok");
    expect((await save(proof, moved(document, 17), 3)).status).toBe("ok");
    let revisions = await listCourseSettingRevisionsAsAdmin(db, proof);
    if (revisions.status !== "ok") throw new Error("Versionerna saknas");
    expect(revisions.response.revisions.map(row => [row.version, row.kind, row.courses])).toEqual([[2, "SAVE", 2], [1, "IMPORT", 0]]);

    const restored = await restoreCourseSettingRevisionAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 4, revision: 1 } });
    expect(restored).toMatchObject({ status: "ok", response: { version: 5 } });
    const state = await readCourseSettingAsAdmin(db, proof);
    if (state.status !== "ok") throw new Error("Läget saknas");
    expect(state.response.setting?.document.courses).toEqual([]);
    expect(state.response.original).toMatchObject({ fileName: "kartfil.ppen" });
    const replaced = await readCourseSettingRevisionAsAdmin(db, { ...proof, version: 4 });
    expect(replaced).toMatchObject({ status: "ok", response: { kind: "RESTORE", document: { courses: [{ name: "Lång" }, { name: "Mellan" }] } } });
    expect(await restoreCourseSettingRevisionAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 5, revision: 99 } }))
      .toEqual({ status: "not-found" });
    expect((await restoreCourseSettingRevisionAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 4, revision: 1 } })).status)
      .toBe("version-conflict");

    // Högst 50 tidigare versioner.
    let version = 5;
    for (let index = 0; index < 52; index += 1) {
      const next = await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: version, document, fileName: "kartfil.ppen", ppen } });
      if (next.status !== "ok") throw new Error(next.status);
      version = next.response.version;
    }
    revisions = await listCourseSettingRevisionsAsAdmin(db, proof);
    if (revisions.status !== "ok") throw new Error("Versionerna saknas");
    expect(revisions.response.revisions).toHaveLength(50);
    expect(revisions.response.revisions[0]!.version).toBe(version - 1);
    const stored = await pool.query<{ count: string }>("select count(*)::text as count from course_setting_revision where race_id = $1", [proof.raceId]);
    expect(stored.rows[0]!.count).toBe("50");
  });

  it("för över till tävlingen som en banfil: banor, varianter som Purple Pen, kontroller med lägen och klasser", async () => {
    const proof = await race();
    await saveMapFile(proof);
    const ppen = await ppenText();
    const { document } = readPpen(ppen);
    expect((await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document, fileName: "kartfil.ppen",
      ppen } })).status).toBe("ok");
    expect(await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version: 7 } }))
      .toMatchObject({ status: "version-conflict" });
    const preview = await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version: 1 } });
    if (preview.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${preview.status}`);
    expect(preview.response).toMatchObject({ source: "COURSE_FILE", sourceName: "Banläggningen, version 1" });
    expect(preview.response.rows.map(row => [row.kind, row.subject, row.label]).sort()).toEqual([
      ["NEW", "CLASS", "D21"], ["NEW", "CLASS", "H21"], ["NEW", "COURSE", "Lång"], ["NEW", "COURSE", "Mellan"]]);
    const requestId = randomUUID();
    const applied = await applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId,
      snapshotId: preview.response.snapshotId, excludedRowIds: [], confirmResultChanges: true } });
    expect(applied.status).toBe("saved");

    const courses = await pool.query<{ name: string; external_id: string; length_meters: number | null; start_map_position: unknown }>(
      "select name, external_id, length_meters, start_map_position from course where race_id = $1 order by name", [proof.raceId]);
    expect(courses.rows).toEqual([
      { name: "Lång", external_id: "Lång", length_meters: 2400, start_map_position: { x: 4, y: 8 } },
      { name: "Mellan", external_id: "family:Mellan", length_meters: 2100, start_map_position: { x: 4, y: 8 } }]);
    const variants = await pool.query<{ code: string; codes: number[] }>(`select v.code, array_agg(c.code order by vc.sequence) as codes
      from course_variant v join course_version cv on cv.id = v.course_version_id join course k on k.id = cv.course_id
      join course_variant_control vc on vc.course_variant_id = v.id join control c on c.id = vc.control_id
      where k.race_id = $1 and k.name = 'Mellan' group by v.code order by v.code`, [proof.raceId]);
    expect(variants.rows).toEqual([{ code: "A", codes: [31, 32, 33, 36] }, { code: "B", codes: [31, 37, 33, 36] }]);
    const control = await pool.query<{ map_x: number; map_y: number; latitude: number; longitude: number }>(
      "select map_x, map_y, latitude, longitude from control where race_id = $1 and code = 31", [proof.raceId]);
    const expected = mapPointToWgs84(georeference, { x: 15, y: 42 });
    expect(control.rows[0]).toMatchObject({ map_x: 15, map_y: 42 });
    expect(control.rows[0]!.latitude).toBeCloseTo(expected.latitude, 6);
    expect(control.rows[0]!.longitude).toBeCloseTo(expected.longitude, 6);
    const classes = await pool.query<{ name: string; course: string }>(`select cl.name, k.name as course from class cl
      join course_version cv on cv.id = cl.course_version_id join course k on k.id = cv.course_id where cl.race_id = $1 order by cl.name`,
    [proof.raceId]);
    expect(classes.rows).toEqual([{ name: "D21", course: "Mellan" }, { name: "H21", course: "Lång" }]);

    // Samma dokument igen: inget att ändra.
    const again = await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version: 1 } });
    if (again.status !== "ok") throw new Error("Förhandsvisningen saknas");
    expect(again.response.rows).toEqual([]);

    // Ingen bana med start och mål, och kontroller utan kod på banorna.
    expect((await save(proof, empty(), 1)).status).toBe("ok");
    expect(await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version: 2 } }))
      .toEqual({ status: "problem", problem: { formatVersion: 1, error: "NO_COURSES", controls: [] } });
    const coded = { ...document, controls: { ...document.controls, "3": { ...document.controls["3"]!, code: "A1" } } };
    expect((await save(proof, coded, 2)).status).toBe("ok");
    expect(await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version: 3 } }))
      .toEqual({ status: "problem", problem: { formatVersion: 1, error: "INVALID_CODES", controls: ["3"] } });
  });

  it("banhemligheten: dokumentet finns i adminexporten och kopian men aldrig publikt", async () => {
    const proof = await race();
    const ppen = await ppenText();
    const { document } = readPpen(ppen);
    expect((await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document, fileName: "kartfil.ppen",
      ppen } })).status).toBe("ok");
    expect((await save(proof, moved(document, 16), 1)).status).toBe("ok");
    const exported = await exportRaceAsAdmin(db, proof);
    if (exported.status !== "ok") throw new Error("Exporten misslyckades");
    const backup = readBackup(exported.bytes);
    expect(backup.table("course_setting")[0]).toMatchObject({ version: 2, original_file_name: "kartfil.ppen" });
    expect(backup.table<{ version: number; kind: string }>("course_setting_revision").map(row => [row.version, row.kind])).toEqual([[1, "SAVE"]]);

    const copied = await copyRaceAsAdmin(db, { ...proof, request: { formatVersion: 1, requestId: randomUUID(), eventName: "Banläggning v2",
      raceName: "Torsdag", raceDate: "2026-10-15", includePeople: false } });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    const copy = await pool.query<{ version: number; title: string; original_ppen: string }>(
      "select version, document->'event'->>'title' as title, original_ppen from course_setting where race_id = $1", [copied.response.raceId]);
    expect(copy.rows).toEqual([{ version: 1, title: "Kvällsträning på kartfilen", original_ppen: ppen }]);
    expect((await pool.query("select 1 from course_setting_revision where race_id = $1", [copied.response.raceId])).rowCount).toBe(0);

    // Publikt: inga banor (dokumentet förs inte över av sig självt) och inget ur dokumentet.
    const listed = JSON.stringify(await publicResults(db, proof.raceId));
    expect(listed).not.toContain("Kvällsträning");
    expect(listed).not.toContain("Mellan");
  });
});
