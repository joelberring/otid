import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createClub, createClubImportToken, inviteClubMember } from "../../src/clubs";
import { readClubArchive, readClubArchiveEntry, setClubCourseFileMap, deleteClubArchiveEntry } from "../../src/club-archive";
import {
  readClubEntryThumbnail, readClubMapVersionThumbnail, refreshClubCourseSummaries, saveClubEntryThumbnail, saveClubMapVersionCheck
} from "../../src/club-archive-checks";
import { importBatch, importMapContent } from "../../src/club-archive-import";
import { updateClubMap } from "../../src/club-maps";
import { listMyClubs } from "../../src/clubs";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0196: kartversionernas kontroll och bilderna i klubbarkivet, banfilernas sammanfattning ur filen (också IOF XML 2.0.3) och
 * kartans rättigheter. Bilderna är syntetiska PNG-huvuden; kartorna är fixtures.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0196_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const NOW = new Date("2026-11-03T12:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0196_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunks(bytes: Uint8Array) { yield bytes; }

/** PNG-signatur och IHDR med bredd och höjd (servern läser bara huvudet). */
function png(width: number, height: number): string {
  const bytes = Buffer.alloc(45);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.write("IEND", 37, "latin1");
  return bytes.toString("base64");
}

const COURSE_DATA_203 = new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
<CourseData><IOFVersion version="2.0.3" /><Map><Scale>10000</Scale></Map>
  <StartPoint><StartPointCode>STA1</StartPointCode><MapPosition x="0" y="0" /></StartPoint>
  <Control><ControlCode>31</ControlCode><MapPosition x="30" y="40" /></Control>
  <Control><ControlCode>32</ControlCode><MapPosition x="0" y="40" /></Control>
  <FinishPoint><FinishPointCode>FIN1</FinishPointCode><MapPosition x="0" y="0" /></FinishPoint>
  <Course><CourseName>Gul</CourseName><CourseId>0</CourseId><CourseVariation><CourseVariationId>0</CourseVariationId><CourseLength>1200</CourseLength>
    <StartPointCode>STA1</StartPointCode><CourseControl><Sequence>1</Sequence><ControlCode>31</ControlCode></CourseControl>
    <CourseControl><Sequence>2</Sequence><ControlCode>32</ControlCode></CourseControl><FinishPointCode>FIN1</FinishPointCode></CourseVariation></Course>
</CourseData>`);

async function archive() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Älvsjö-Örby" } }, NOW);
  if (created.status !== "created") throw new Error("Ingen klubb");
  const clubId = created.club.clubId;
  const token = await createClubImportToken(db, { ...owner.proof, clubId }, NOW);
  if (token.status !== "created") throw new Error("Ingen nyckel");
  const map = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
  const ppen = new Uint8Array(await readFile(new URL("course-setting/kartfil.ppen", fixtures)));
  expect((await importMapContent(db, { token: token.token, clubId, sha256: sha(map), body: chunks(map) }, NOW)).status).toBe("ok");
  const imported = await importBatch(db, { token: token.token, clubId, request: { formatVersion: 1,
    maps: [{ importKey: "skogen", name: "Skogen", versions: [{ sha256: sha(map), fileName: "Skogen.omap", format: "OMAP", versionDate: "2019-04-02", sourcePath: null }] }],
    entries: [{ importKey: "2020/04-26 Skogen", trainingDate: "2020-04-26", year: 2020, place: "Skogen", title: "Skogen", leader: null, tags: [],
      sourcePath: "2020/04-26 Skogen", mapSha256: [sha(map)], courseFiles: [
        { fileName: "A banor.ppen", kind: "PPEN", sha256: sha(ppen), contentBase64: Buffer.from(ppen).toString("base64"), mapReference: "Skogen.omap",
          mapSha256: sha(map), resolution: "FOLDER" },
        { fileName: "B banor.xml", kind: "COURSE_DATA", sha256: sha(COURSE_DATA_203), contentBase64: Buffer.from(COURSE_DATA_203).toString("base64"),
          mapReference: null, mapSha256: null, resolution: "NONE" }] }] } }, NOW);
  expect(imported.status).toBe("ok");
  const reader = await registerTestAccount(db, undefined, NOW);
  await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READER" } }, NOW);
  await listMyClubs(db, reader.proof, NOW);
  const list = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
  if (list.status !== "ok") throw new Error("Inget arkiv");
  return { owner, reader, clubId, list: list.list };
}

describe("ADR-0196: kartornas kontroll och bilder i klubbarkivet", { timeout: 120_000 }, () => {
  it("kontrollen sparas av administratörer, syns i listan och bilden läses av läsare", async () => {
    const { owner, reader, clubId, list } = await archive();
    const version = list.maps[0]!.versions[0]!;
    expect(version.check).toBeNull();
    const ok = { formatVersion: 1, readerVersion: 2, status: "OK", detail: null, fileVersion: "Mapper v9", thumbnail: { pngBase64: png(40, 30), width: 40, height: 30 } };
    expect((await saveClubMapVersionCheck(db, { ...reader.proof, clubId, versionId: version.versionId, request: ok }, NOW)).status).toBe("forbidden");
    // Bilden måste vara en PNG av angiven storlek, och ett fel har ingen bild.
    expect((await saveClubMapVersionCheck(db, { ...owner.proof, clubId, versionId: version.versionId,
      request: { ...ok, thumbnail: { pngBase64: png(40, 30), width: 41, height: 30 } } }, NOW)).status).toBe("invalid-request");
    expect((await saveClubMapVersionCheck(db, { ...owner.proof, clubId, versionId: version.versionId,
      request: { ...ok, status: "UNSUPPORTED_VERSION" } }, NOW)).status).toBe("invalid-request");
    expect(await saveClubMapVersionCheck(db, { ...owner.proof, clubId, versionId: version.versionId, request: ok }, NOW)).toEqual({ status: "ok" });
    const thumbnail = await readClubMapVersionThumbnail(db, { ...reader.proof, clubId, versionId: version.versionId }, NOW);
    expect(thumbnail.status === "ok" && thumbnail.png.toString("base64")).toBe(png(40, 30));
    // Omkontroll: ett fel ersätter bilden.
    const later = new Date(NOW.getTime() + 60_000);
    expect(await saveClubMapVersionCheck(db, { ...owner.proof, clubId, versionId: version.versionId, request: { ...ok, status: "UNSUPPORTED_VERSION",
      detail: "OCAD 7 stöds inte. Öppna kartan och spara den i nyare OCAD eller i Mapper.", fileVersion: null, thumbnail: null } }, later)).toEqual({ status: "ok" });
    const after = await readClubArchive(db, { ...reader.proof, clubId }, later);
    expect(after.status === "ok" && after.list.maps[0]!.versions[0]!.check).toEqual({ status: "UNSUPPORTED_VERSION",
      detail: "OCAD 7 stöds inte. Öppna kartan och spara den i nyare OCAD eller i Mapper.", fileVersion: null, readerVersion: 2,
      checkedAt: later.toISOString(), thumbnail: false });
    expect((await readClubMapVersionThumbnail(db, { ...reader.proof, clubId, versionId: version.versionId }, later)).status).toBe("not-found");
  });

  it("träningens bild: ritas av första banfilen med karta, blir inaktuell när kartan byts och försvinner med träningen", async () => {
    const { owner, reader, clubId, list } = await archive();
    const entry = list.entries[0]!;
    const versionId = list.maps[0]!.versions[0]!.versionId;
    expect(entry.thumbnail).toBeNull();
    expect(entry.thumbnailSource).toMatchObject({ versionId, fileName: "Skogen.omap" });
    const view = await readClubArchiveEntry(db, { ...owner.proof, clubId, entryId: entry.entryId }, NOW);
    if (view.status !== "ok") throw new Error("Ingen träning");
    const ppen = view.view.courseFiles.find(file => file.kind === "PPEN")!;
    expect(entry.thumbnailSource?.courseFileId).toBe(ppen.courseFileId);
    const request = { formatVersion: 1, readerVersion: 2, status: "OK", detail: null, mapVersionId: versionId, courseName: "Lång",
      image: { pngBase64: png(360, 240), width: 360, height: 240 } };
    expect((await saveClubEntryThumbnail(db, { ...reader.proof, clubId, entryId: entry.entryId, request }, NOW)).status).toBe("forbidden");
    expect((await saveClubEntryThumbnail(db, { ...owner.proof, clubId, entryId: entry.entryId, request: { ...request, mapVersionId: randomUUID() } }, NOW)).status)
      .toBe("not-found");
    expect(await saveClubEntryThumbnail(db, { ...owner.proof, clubId, entryId: entry.entryId, request }, NOW)).toEqual({ status: "ok" });
    let listed = await readClubArchive(db, { ...reader.proof, clubId }, NOW);
    expect(listed.status === "ok" && listed.list.entries[0]!.thumbnail).toMatchObject({ status: "OK", courseName: "Lång", stale: false });
    expect((await readClubEntryThumbnail(db, { ...reader.proof, clubId, entryId: entry.entryId }, NOW)).status).toBe("ok");
    // Kartan för banfilen byts: bilden tas bort och ritas om.
    expect(await setClubCourseFileMap(db, { ...owner.proof, clubId, courseFileId: ppen.courseFileId, request: { formatVersion: 1, mapVersionId: null } }, NOW))
      .toEqual({ status: "ok" });
    listed = await readClubArchive(db, { ...reader.proof, clubId }, NOW);
    expect(listed.status === "ok" && [listed.list.entries[0]!.thumbnail, listed.list.entries[0]!.thumbnailSource]).toEqual([null,
      { versionId, fileName: "Skogen.omap", courseFileId: null }]);
    // Kartan kunde inte ritas: inget bildinnehåll, men skälet.
    expect(await saveClubEntryThumbnail(db, { ...owner.proof, clubId, entryId: entry.entryId, request: { ...request, status: "MAP_FAILED",
      detail: "OCAD 7 stöds inte.", image: null } }, NOW)).toEqual({ status: "ok" });
    expect(await deleteClubArchiveEntry(db, { ...owner.proof, clubId, entryId: entry.entryId }, NOW)).toEqual({ status: "deleted" });
    expect((await pool.query<{ n: number }>("select count(*)::int as n from club_archive_entry_thumbnail")).rows[0]?.n).toBe(0);
  });

  it("banfilens sammanfattning räknas ur filen (IOF XML 2.0.3) och sparas vid omkontrollen", async () => {
    const { owner, reader, clubId, list } = await archive();
    const entry = list.entries[0]!;
    expect(entry.courseNames).toContain("Gul");
    // En fil som importerades innan läsaren klarade 2.0.3 har en tom sammanfattning med felet.
    await pool.query(`update club_archive_course_file set summary = '{"scale":null,"courses":[],"problem":"Ogiltig IOF XML"}' where kind = 'COURSE_DATA' and club_id = $1`, [clubId]);
    const view = await readClubArchiveEntry(db, { ...reader.proof, clubId, entryId: entry.entryId }, NOW);
    const file = view.status === "ok" ? view.view.courseFiles.find(item => item.kind === "COURSE_DATA") : undefined;
    expect(file).toMatchObject({ courses: [{ name: "Gul", controls: 2, lengthM: 1200 }], scale: 10000, problem: null });
    expect(file?.courseData?.[0]?.points.map(point => point.kind)).toEqual(["START", "CONTROL", "CONTROL", "FINISH"]);
    expect((await refreshClubCourseSummaries(db, { ...reader.proof, clubId }, NOW)).status).toBe("forbidden");
    expect(await refreshClubCourseSummaries(db, { ...owner.proof, clubId }, NOW)).toEqual({ status: "ok", response: { formatVersion: 1, courseFiles: 2, updated: 1 } });
    const stored = await pool.query<{ summary: { courses: unknown[] } }>(`select summary from club_archive_course_file where kind = 'COURSE_DATA' and club_id = $1`, [clubId]);
    expect(stored.rows[0]?.summary.courses).toHaveLength(1);
    expect((await pool.query(`select 1 from club_journal where club_id = $1 and action = 'CLUB_ARCHIVE_RECHECKED'`, [clubId])).rowCount).toBe(1);
  });

  it("kartans rättigheter ändras av administratörer och journalförs", async () => {
    const { owner, reader, clubId, list } = await archive();
    const map = list.maps[0]!;
    const agreement = { ownership: "EXTERNAL", ownerKind: "MUNICIPALITY", ownerName: "Stockholms stad", agreement: "Avtal 2024", validUntil: "2027-12-31",
      contact: "Kartansvarig", trainingOnly: true, feePerPrint: false, noPublicDisplay: true };
    expect((await updateClubMap(db, { ...reader.proof, clubId, mapId: map.mapId, request: { formatVersion: 1, name: map.name, agreement } }, NOW)).status)
      .toBe("forbidden");
    expect(await updateClubMap(db, { ...owner.proof, clubId, mapId: map.mapId, request: { formatVersion: 1, name: map.name, agreement } }, NOW))
      .toEqual({ status: "ok" });
    const after = await readClubArchive(db, { ...reader.proof, clubId }, NOW);
    expect(after.status === "ok" && after.list.maps[0]).toMatchObject(agreement);
    expect((await pool.query(`select 1 from club_journal where club_id = $1 and action = 'CLUB_MAP_UPDATED'`, [clubId])).rowCount).toBe(1);
  });
});
