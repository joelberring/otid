import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { ClubImportBatchRequest, RaceMapSourceMetadata } from "@o-tid/contracts";
import { createOrganizerEvent } from "../../src/organizer-events";
import { readRaceMapSourceFileAsAdmin } from "../../src/race-map-source";
import { listGroupLibraryMaps, readRaceMapAgreementAsAdmin } from "../../src/training-group-maps";
import { createTrainingGroup } from "../../src/training-groups";
import { purgeRows } from "../../src/purge";
import { acceptRacePersonInvitations } from "../../src/race-person-invitations";
import { createClub, createClubImportToken, inviteClubMember, listMyClubs, readClub, removeClubMember, revokeClubImportToken, setClubMemberRole } from "../../src/clubs";
import { readClubArchive, readClubArchiveEntry, readClubCourseFile, setClubCourseFileMap, updateClubArchiveEntry } from "../../src/club-archive";
import { importBatch, importCheck, importMapContent } from "../../src/club-archive-import";
import { moveClubMapVersion, readClubMapVersionHead, saveClubMapToGroupLibrary, saveClubMapVersionToRace, streamMapContentParts, updateClubMap, uploadClubMapVersion } from "../../src/club-maps";
import { mergeClubMaps } from "../../src/club-map-merge";
import { sweepMapContent } from "../../src/map-content";
import { registerTestAccount, verifyTestAccount } from "./accounts";

/**
 * ADR-0194: klubben och klubbarkivet mot PostgreSQL – roller och inbjudningar per adress, importnyckeln, importen (idempotent,
 * samma karta en gång, banfiler och kartornas referenser), kartornas versioner (slå ihop, flytta, ny version), originalen och
 * "Använd igen" (tävlingen pekar på samma innehåll). Kartorna är syntetiska (fixtures/maps).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0194_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const NOW = new Date("2026-11-02T20:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0194_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunks(bytes: Uint8Array, size = 1000) { for (let at = 0; at < bytes.byteLength; at += size) yield bytes.subarray(at, at + size); }
const fixture = async (path: string) => new Uint8Array(await readFile(new URL(path, fixtures)));

async function clubWithOwner() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Älvsjö-Örby" } }, NOW);
  if (created.status !== "created") throw new Error(`Klubben skapades inte: ${created.status}`);
  return { owner, clubId: created.club.clubId };
}

async function tokenFor(proof: { sessionToken: string | null; csrfCookie?: string | null; csrfHeader?: string | null }, clubId: string) {
  const created = await createClubImportToken(db, { ...proof, clubId }, NOW);
  if (created.status !== "created") throw new Error(`Ingen nyckel: ${created.status}`);
  return created.token;
}

function batchFor(maps: { skogen: Uint8Array; skogen2: Uint8Array }, ppen: Uint8Array, courseData: Uint8Array): ClubImportBatchRequest {
  return {
    formatVersion: 1,
    maps: [{ importKey: "skogen", name: "Skogen", versions: [
      { sha256: sha(maps.skogen), fileName: "Skogen.omap", format: "OMAP", versionDate: "2019-04-02", sourcePath: "2019/04-02 Skogen [Anna]/Skogen.omap" },
      { sha256: sha(maps.skogen2), fileName: "Skogen 2020-08-15 V2.omap", format: "OMAP", versionDate: "2020-08-15", sourcePath: null }] }],
    entries: [
      { importKey: "2019/04-02 Skogen [Anna]", trainingDate: "2019-04-02", year: 2019, place: "Skogen", title: "Skogen", leader: "Anna", tags: ["Rävorientering"],
        sourcePath: "2019/04-02 Skogen [Anna]", mapSha256: [sha(maps.skogen)],
        courseFiles: [{ fileName: "Skogen Rävorientering.ppen", kind: "PPEN", sha256: sha(ppen), contentBase64: Buffer.from(ppen).toString("base64"),
          mapReference: "C:\\OL\\Skogen.omap", mapSha256: sha(maps.skogen), resolution: "FOLDER" }] },
      { importKey: "2019/06-04 Ängen [Per]", trainingDate: "2019-06-04", year: 2019, place: "Ängen", title: "Ängen", leader: null, tags: ["Keps"],
        sourcePath: "2019/06-04 Ängen [Per]", mapSha256: [],
        courseFiles: [{ fileName: "KepsOL Ängen - Gul.ppen", kind: "PPEN", sha256: sha(ppen), contentBase64: Buffer.from(ppen).toString("base64"),
          mapReference: "C:\\Users\\per\\Skogen.omap", mapSha256: sha(maps.skogen), resolution: "NAME" },
        { fileName: "Banor.xml", kind: "COURSE_DATA", sha256: sha(courseData), contentBase64: Buffer.from(courseData).toString("base64"),
          mapReference: null, mapSha256: null, resolution: "NONE" }] }
    ]
  };
}

describe("ADR-0194: klubbarkivet", { timeout: 120_000 }, () => {
  it("ny klubb: tomt namn är fel, samma namn som en egen klubb finns redan (oavsett stora bokstäver)", async () => {
    const { owner } = await clubWithOwner();
    const create = (name: string) => createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name } }, NOW);
    expect((await create("   ")).status).toBe("invalid-request");
    expect((await create("x".repeat(121))).status).toBe("invalid-request");
    expect((await create("ok älvsjö-örby")).status).toBe("name-taken");
    // En annan person får ha en klubb med samma namn.
    const other = await registerTestAccount(db, undefined, NOW);
    expect((await createClub(db, { ...other.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Älvsjö-Örby" } }, NOW)).status).toBe("created");
  });

  it("roller och inbjudningar per adress: samma svar med och utan konto, läsaren ser men ändrar inte, sista ägaren står kvar", async () => {
    const { owner, clubId } = await clubWithOwner();
    const reader = await registerTestAccount(db, undefined, NOW);
    const invite = (email: string, role: string, by = owner.proof) =>
      inviteClubMember(db, { ...by, clubId, request: { formatVersion: 1, requestId: randomUUID(), email, role } }, NOW);
    const withAccount = await invite(reader.email, "READER");
    const withoutAccount = await invite(`ingen.${randomUUID().slice(0, 6)}@test.o-tid.se`, "ADMIN");
    expect(withAccount.status).toBe("invited");
    expect(withoutAccount.status).toBe("invited");
    expect(Object.keys(withAccount)).toEqual(Object.keys(withoutAccount));
    expect((await invite(reader.email, "READER")).status).toBe("conflict");
    // Före inloggningen är läsaren inte medlem; Mina klubbar tar inbjudan.
    expect((await readClubArchive(db, { ...reader.proof, clubId }, NOW)).status).toBe("ok");
    const mine = await listMyClubs(db, reader.proof, NOW);
    expect(mine.status === "ok" && mine.clubs.map(club => [club.name, club.role])).toEqual([["OK Älvsjö-Örby", "READER"]]);
    // Läsaren ändrar inget och bjuder inte in.
    expect((await invite("x@test.o-tid.se", "READER", reader.proof)).status).toBe("forbidden");
    expect((await createClubImportToken(db, { ...reader.proof, clubId }, NOW)).status).toBe("forbidden");
    // En obekräftad adress får inte medlemskapet.
    const unverified = await registerTestAccount(db, undefined, NOW, { verified: false });
    await invite(unverified.email, "ADMIN");
    expect((await readClub(db, { ...unverified.proof, clubId }, NOW)).status).toBe("not-found");
    await verifyTestAccount(db, unverified.accountId, NOW);
    await db.transaction(tx => acceptRacePersonInvitations(tx, unverified.accountId, NOW));
    const view = await readClub(db, { ...owner.proof, clubId }, NOW);
    if (view.status !== "ok") throw new Error("Ingen vy");
    expect(view.view.members.map(member => member.role).sort()).toEqual(["ADMIN", "OWNER", "READER"]);
    expect(view.view.members.filter(member => member.you).map(member => member.role)).toEqual(["OWNER"]);
    expect(view.view.invitations).toHaveLength(1);
    // ADR-0209 beslut 5–6: läsaren (och ledaren) får bara sin egen rad, utan konto-id och adresser.
    const readerView = await readClub(db, { ...reader.proof, clubId }, NOW);
    if (readerView.status !== "ok") throw new Error(readerView.status);
    expect(readerView.view.members).toEqual([expect.objectContaining({ role: "READER", you: true, email: "" })]);
    expect(JSON.stringify(readerView.view)).not.toContain(owner.accountId);
    expect(JSON.stringify(readerView.view)).not.toContain(unverified.accountId);
    expect(JSON.stringify(readerView.view.members)).not.toContain("accountId");
    // En administratör gör ingen till ägare; sista ägaren tas inte bort.
    const ownerMember = view.view.members.find(member => member.role === "OWNER")!;
    expect((await setClubMemberRole(db, { ...unverified.proof, clubId, request: { formatVersion: 1, memberId: ownerMember.memberId, role: "READER" } }, NOW))
      .status).toBe("forbidden");
    expect((await removeClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, memberId: ownerMember.memberId, invitationId: null } }, NOW))
      .status).toBe("conflict");
    // En främling ser inte att klubben finns.
    const stranger = await registerTestAccount(db, undefined, NOW);
    expect((await readClubArchive(db, { ...stranger.proof, clubId }, NOW)).status).toBe("not-found");
  });

  it("importen: nyckeln, samma karta en gång, banfiler, idempotent omkörning och kartornas referenser", async () => {
    const { owner, clubId } = await clubWithOwner();
    const token = await tokenFor(owner.proof, clubId);
    const skogen = await fixture("maps/kartfil.omap");
    const skogen2 = new TextEncoder().encode(new TextDecoder().decode(skogen).replace(/<notes>[^<]*<\/notes>/, "<notes>Revision 2</notes>"));
    const ppen = await fixture("course-setting/kartfil.ppen");
    const courseData = await fixture("iof/course-file-kartfil.xml");

    expect((await importCheck(db, { token: "otid-imp-fel", clubId, request: { formatVersion: 1, sha256: [] } }, NOW)).status).toBe("unauthorized");
    expect((await importCheck(db, { token, clubId: randomUUID(), request: { formatVersion: 1, sha256: [] } }, NOW)).status).toBe("unauthorized");
    const first = await importCheck(db, { token, clubId, request: { formatVersion: 1, sha256: [sha(skogen), sha(skogen2)] } }, NOW);
    expect(first).toMatchObject({ status: "ok", response: { clubName: "OK Älvsjö-Örby", known: [] } });

    // Fel hash och något som inte är en karta avvisas; inget blir kvar.
    expect(await importMapContent(db, { token, clubId, sha256: sha(skogen2), body: chunks(skogen) }, NOW)).toEqual({ status: "problem", problem: "HASH_MISMATCH" });
    const pdf = new TextEncoder().encode("%PDF-1.4 inte en karta");
    expect(await importMapContent(db, { token, clubId, sha256: sha(pdf), body: chunks(pdf) }, NOW)).toEqual({ status: "problem", problem: "INVALID_MAP_FILE" });
    expect((await pool.query<{ n: number }>("select count(*)::int as n from map_content_part")).rows[0]?.n).toBe(0);
    for (const bytes of [skogen, skogen2]) {
      expect(await importMapContent(db, { token, clubId, sha256: sha(bytes), body: chunks(bytes) }, NOW))
        .toMatchObject({ status: "ok", response: { stored: "new", byteLength: bytes.byteLength } });
    }
    // Samma innehåll igen kostar ingenting.
    expect(await importMapContent(db, { token, clubId, sha256: sha(skogen), body: chunks(skogen) }, NOW)).toMatchObject({ status: "ok", response: { stored: "existing" } });

    const batch = batchFor({ skogen, skogen2 }, ppen, courseData);
    const imported = await importBatch(db, { token, clubId, request: batch }, NOW);
    expect(imported).toEqual({ status: "ok", response: { formatVersion: 1, maps: { created: 1, versionsAdded: 2 },
      entries: { created: 2, existing: 0, courseFilesAdded: 3 }, missingContent: [] } });
    // Omkörning: inga dubbletter.
    expect(await importBatch(db, { token, clubId, request: batch }, NOW)).toEqual({ status: "ok", response: { formatVersion: 1,
      maps: { created: 0, versionsAdded: 0 }, entries: { created: 0, existing: 2, courseFilesAdded: 0 }, missingContent: [] } });
    expect((await importCheck(db, { token, clubId, request: { formatVersion: 1, sha256: [sha(skogen), sha(skogen2)] } }, NOW)))
      .toMatchObject({ response: { known: expect.arrayContaining([sha(skogen), sha(skogen2)]) as unknown } });

    const archive = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
    if (archive.status !== "ok") throw new Error("Inget arkiv");
    expect(archive.list.entries.map(entry => [entry.title, entry.status, entry.maps.map(map => map.name)])).toEqual([
      ["Ängen", "MAP_MISSING", ["Skogen"]], ["Skogen", "COMPLETE", ["Skogen"]]]);
    expect(archive.list.maps).toHaveLength(1);
    expect(archive.list.maps[0]!.versions.map(version => version.fileName)).toEqual(["Skogen 2020-08-15 V2.omap", "Skogen.omap"]);
    const usage = await readClub(db, { ...owner.proof, clubId }, NOW);
    expect(usage.status === "ok" && usage.view.usage).toMatchObject({ mapBytes: skogen.byteLength + skogen2.byteLength, maps: 1, versions: 2, entries: 2,
      courseFiles: 3 });

    // Träningen: banfilernas sammanfattning, kartan banan gjordes med (inte den senaste), originalet.
    const angen = archive.list.entries.find(entry => entry.title === "Ängen")!;
    const detail = await readClubArchiveEntry(db, { ...owner.proof, clubId, entryId: angen.entryId }, NOW);
    if (detail.status !== "ok") throw new Error("Ingen träning");
    const ppenFile = detail.view.courseFiles.find(file => file.kind === "PPEN")!;
    expect(ppenFile).toMatchObject({ resolution: "NAME", mapVersion: { fileName: "Skogen.omap", latest: false } });
    expect(ppenFile.courses.length).toBeGreaterThan(0);
    const cd = detail.view.courseFiles.find(file => file.kind === "COURSE_DATA")!;
    expect(cd).toMatchObject({ resolution: "NONE", mapVersion: null, scale: 10000 });
    const original = await readClubCourseFile(db, { ...owner.proof, clubId, courseFileId: ppenFile.courseFileId }, NOW);
    expect(original.status === "ok" && Buffer.compare(original.content, Buffer.from(ppen))).toBe(0);
    // Kartan väljs för hand för CourseData-filen.
    expect(await setClubCourseFileMap(db, { ...owner.proof, clubId, courseFileId: cd.courseFileId,
      request: { formatVersion: 1, mapVersionId: archive.list.maps[0]!.latestVersionId } }, NOW)).toEqual({ status: "ok" });
    expect(await updateClubArchiveEntry(db, { ...owner.proof, clubId, entryId: angen.entryId, request: { formatVersion: 1, trainingDate: "2019-06-04",
      place: "Ängen", title: "KepsOL på Ängen", leader: null, tags: ["Keps", "Ungdom"], notes: "Bra för ungdomar" } }, NOW)).toEqual({ status: "ok" });
    const after = await readClubArchiveEntry(db, { ...owner.proof, clubId, entryId: angen.entryId }, NOW);
    expect(after.status === "ok" && [after.view.entry.status, after.view.entry.title, after.view.entry.tags]).toEqual(["COURSES_ONLY", "KepsOL på Ängen", ["Keps", "Ungdom"]]);

    // Originalkartan strömmas del för del.
    const head = await readClubMapVersionHead(db, { ...owner.proof, clubId, versionId: archive.list.maps[0]!.versions[1]!.versionId }, NOW);
    if (head.status !== "ok") throw new Error("Ingen version");
    const parts: Uint8Array[] = [];
    for await (const part of streamMapContentParts(db, head.contentId)) parts.push(part);
    expect(sha(Buffer.concat(parts))).toBe(sha(skogen));

    // Arkivets innehåll tas inte bort av underhållet eller när en tävling som använde det tas bort.
    expect(await sweepMapContent(db, new Date(NOW.getTime() + 3 * 3_600_000))).toMatchObject({ contents: 0 });
    expect((await pool.query<{ n: number }>("select count(*)::int as n from map_content")).rows[0]?.n).toBe(2);

    // En återkallad nyckel fungerar inte; en administratör som blivit läsare kan inte importera med sin gamla nyckel.
    const tokens = await readClub(db, { ...owner.proof, clubId }, NOW);
    if (tokens.status !== "ok") throw new Error("Ingen vy");
    expect(await revokeClubImportToken(db, { ...owner.proof, clubId, tokenId: tokens.view.tokens[0]!.tokenId }, NOW)).toEqual({ status: "revoked" });
    expect((await importCheck(db, { token, clubId, request: { formatVersion: 1, sha256: [] } }, NOW)).status).toBe("unauthorized");
    // En nyckel som gått ut.
    const late = await tokenFor(owner.proof, clubId);
    expect((await importCheck(db, { token: late, clubId, request: { formatVersion: 1, sha256: [] } }, new Date(NOW.getTime() + 13 * 3_600_000))).status)
      .toBe("unauthorized");
  });

  it("kartornas versioner: ny version, flytta och slå ihop; rättigheterna och Använd igen pekar på samma innehåll", async () => {
    const { owner, clubId } = await clubWithOwner();
    const omap = await fixture("maps/kartfil.omap");
    const other = await fixture("maps/vagval.omap");
    const uploaded = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: null, newMapName: "Älvsjöskogen", fileName: "Älvsjöskogen V11.omap",
      versionDate: "2018-08-12", note: null, body: chunks(omap) }, NOW);
    if (uploaded.status !== "created") throw new Error(`Ingen karta: ${JSON.stringify(uploaded)}`);
    expect(await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: uploaded.mapId, newMapName: null, fileName: "igen.omap", versionDate: null,
      note: null, body: chunks(omap) }, NOW)).toEqual({ status: "problem", problem: "DUPLICATE" });
    const second = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: null, newMapName: "Älvsjöskogen (fel)", fileName: "Alvsjo.omap",
      versionDate: "2024-05-01", note: "Reviderad 2024", body: chunks(other) }, NOW);
    if (second.status !== "created") throw new Error("Ingen andra karta");
    expect(await mergeClubMaps(db, { ...owner.proof, clubId, request: { formatVersion: 1, keepMapId: uploaded.mapId,
      mapIds: [uploaded.mapId, second.mapId] } }, NOW)).toMatchObject({ status: "ok", response: { mapId: uploaded.mapId } });
    let list = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
    if (list.status !== "ok") throw new Error("Inget arkiv");
    expect(list.list.maps.map(map => [map.name, map.versions.map(version => version.versionDate)])).toEqual([["Älvsjöskogen", ["2024-05-01", "2018-08-12"]]]);
    // Dela ut versionen igen till en ny karta.
    const moved = await moveClubMapVersion(db, { ...owner.proof, clubId, versionId: second.versionId, request: { formatVersion: 1, targetMapId: null,
      newMapName: "Vinterviken" } }, NOW);
    expect(moved.status).toBe("ok");
    list = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
    expect(list.status === "ok" && list.list.maps.map(map => map.name)).toEqual(["Vinterviken", "Älvsjöskogen"]);
    expect(await updateClubMap(db, { ...owner.proof, clubId, mapId: uploaded.mapId, request: { formatVersion: 1, name: "Älvsjöskogen",
      agreement: { ownership: "EXTERNAL", ownerKind: "MUNICIPALITY", ownerName: "Stockholms stad", agreement: "Bara träning", validUntil: "2027-12-31",
        contact: null, trainingOnly: true, feePerPrint: false, noPublicDisplay: true } } }, NOW)).toEqual({ status: "ok" });

    // Använd igen: en läsare gör en egen träning; kartfilen laddas inte upp igen.
    const reader = await registerTestAccount(db, undefined, NOW);
    await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READER" } }, NOW);
    const created = await createOrganizerEvent(db, { ...reader.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Träning ur arkivet", raceName: "Träning", raceDate: "2026-11-10",
        timeZone: "Europe/Stockholm", raceType: "TRAINING" }) }, NOW);
    if (created.status !== "created") throw new Error("Ingen tävling");
    const raceId = created.response.raceId;
    const contentsBefore = (await pool.query<{ n: number }>("select count(*)::int as n from map_content")).rows[0]?.n ?? 0;
    const metadata: RaceMapSourceMetadata = { formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
      bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null, render: { pxPerMm: 8, originX: -2, originY: 102 },
      summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null };
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 992); new DataView(png.buffer).setUint32(20, 832);
    const proof = { ...reader.proof, clubId, versionId: list.status === "ok" ? list.list.maps.find(map => map.name === "Älvsjöskogen")!.latestVersionId! : "" };
    expect(await saveClubMapVersionToRace(db, { ...proof, raceId, image: png, metadata }, NOW)).toEqual({ status: "ok", georeferenced: false });
    expect((await pool.query<{ n: number }>("select count(*)::int as n from map_content")).rows[0]?.n).toBe(contentsBefore + 1);
    const raceProof = { raceId, sessionToken: reader.proof.sessionToken, csrfCookie: reader.proof.csrfCookie, csrfHeader: reader.proof.csrfHeader };
    const file = await readRaceMapSourceFileAsAdmin(db, raceProof, NOW);
    expect(file.status === "ok" && sha(file.file)).toBe(sha(omap));
    const agreement = await readRaceMapAgreementAsAdmin(db, raceProof, NOW);
    expect(agreement).toMatchObject({ status: "ok", agreement: { mapName: "Älvsjöskogen", ownerName: "Stockholms stad", noPublicDisplay: true } });
    // En främling kan inte lägga klubbens karta i sin tävling.
    const stranger = await registerTestAccount(db, undefined, NOW);
    expect((await saveClubMapVersionToRace(db, { ...stranger.proof, clubId, versionId: proof.versionId, raceId, image: png, metadata }, NOW)).status)
      .toBe("not-found");

    // Tävlingen tas bort: arkivets karta finns kvar.
    const [event] = (await pool.query<{ event_id: string }>("select event_id from race where id = $1", [raceId])).rows;
    await db.transaction(tx => purgeRows(tx, "event", [event!.event_id]));
    const head = await readClubMapVersionHead(db, { ...owner.proof, clubId, versionId: proof.versionId }, NOW);
    expect(head.status).toBe("ok");
    expect((await pool.query<{ n: number }>("select count(*)::int as n from map_content where sha256 = $1", [sha(omap)])).rows[0]?.n).toBe(1);
  });
  it("Använd igen: kartan och kartavtalet sparas tillsammans; misslyckas avtalet sparas ingenting", async () => {
    const { owner, clubId } = await clubWithOwner();
    const omap = await fixture("maps/kartfil.omap");
    const uploaded = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: null, newMapName: "Avtalsskogen", fileName: "Avtalsskogen.omap",
      versionDate: "2021-05-01", note: null, body: chunks(omap) }, NOW);
    if (uploaded.status !== "created") throw new Error("Ingen karta");
    const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Avtalsträning", raceName: "Träning", raceDate: "2026-11-11",
        timeZone: "Europe/Stockholm", raceType: "TRAINING" }) }, NOW);
    if (created.status !== "created") throw new Error("Ingen tävling");
    const raceId = created.response.raceId;
    const metadata: RaceMapSourceMetadata = { formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
      bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null, render: { pxPerMm: 8, originX: -2, originY: 102 },
      summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null };
    const png = new Uint8Array(80);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 992); new DataView(png.buffer).setUint32(20, 832);
    const input = { ...owner.proof, clubId, versionId: uploaded.versionId, raceId, image: png, metadata };
    const saved = async () => (await pool.query<{ maps: number; sources: number; agreements: number; contents: number }>(`select
      (select count(*)::int from race_map where race_id = $1) as maps, (select count(*)::int from race_map_source where race_id = $1) as sources,
      (select count(*)::int from race_map_agreement where race_id = $1) as agreements, (select count(*)::int from map_content) as contents`, [raceId])).rows[0]!;
    const before = await saved();
    await pool.query(`create function test_fail_agreement() returns trigger language plpgsql as $$ begin raise exception 'avtalet kunde inte sparas'; end $$`);
    await pool.query("create trigger test_fail_agreement before insert or update on race_map_agreement for each row execute function test_fail_agreement()");
    try {
      await expect(saveClubMapVersionToRace(db, input, NOW)).rejects.toThrow();
    } finally {
      await pool.query("drop trigger test_fail_agreement on race_map_agreement");
      await pool.query("drop function test_fail_agreement()");
    }
    expect(await saved()).toEqual(before);
    expect(before).toMatchObject({ maps: 0, sources: 0, agreements: 0 });
    // Utan felet sparas båda.
    expect(await saveClubMapVersionToRace(db, input, NOW)).toEqual({ status: "ok", georeferenced: false });
    expect(await saved()).toMatchObject({ maps: 1, sources: 1, agreements: 1 });
  });

  it("gruppens kartbibliotek pekar på klubbens karta: rättigheterna följer med och en ny version syns", async () => {
    const { owner, clubId } = await clubWithOwner();
    const omap = await fixture("maps/kartfil.omap");
    const uploaded = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: null, newMapName: "Skogen", fileName: "Skogen.omap",
      versionDate: "2019-04-02", note: null, body: chunks(omap) }, NOW);
    if (uploaded.status !== "created") throw new Error("Ingen karta");
    const group = await createTrainingGroup(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "Ungdom",
      code: `ungdom-${randomUUID().slice(0, 6)}` } }, NOW);
    if (group.status !== "created") throw new Error("Ingen grupp");
    const groupId = group.group.groupId;
    const metadata: RaceMapSourceMetadata = { formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
      bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null, render: { pxPerMm: 8, originX: -2, originY: 102 },
      summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null };
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 992); new DataView(png.buffer).setUint32(20, 832);
    expect(await saveClubMapToGroupLibrary(db, { ...owner.proof, clubId, versionId: uploaded.versionId, groupId, image: png, metadata }, NOW))
      .toMatchObject({ status: "saved", updated: false });
    const library = async () => db.transaction(tx => listGroupLibraryMaps(tx, groupId));
    expect((await library())[0]).toMatchObject({ name: "Skogen", clubMap: { clubName: "OK Älvsjö-Örby", latest: true }, source: { fileName: "Skogen.omap" } });
    // Rättigheterna ändras i klubben och följer med till gruppen.
    await updateClubMap(db, { ...owner.proof, clubId, mapId: uploaded.mapId, request: { formatVersion: 1, name: "Skogen",
      agreement: { ownership: "EXTERNAL", ownerKind: "MUNICIPALITY", ownerName: "Kommunen", agreement: null, validUntil: null, contact: null,
        trainingOnly: true, feePerPrint: false, noPublicDisplay: false } } }, NOW);
    expect((await library())[0]).toMatchObject({ ownership: "EXTERNAL", ownerName: "Kommunen", trainingOnly: true });
    // En ny version i klubben: gruppens karta är inte längre den senaste, tills den uppdateras.
    const revised = new TextEncoder().encode(new TextDecoder().decode(omap).replace(/<notes>[^<]*<\/notes>/, "<notes>Reviderad</notes>"));
    const second = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: uploaded.mapId, newMapName: null, fileName: "Skogen V2.omap",
      versionDate: "2024-05-01", note: "Reviderad", body: chunks(revised) }, NOW);
    if (second.status !== "created") throw new Error("Ingen ny version");
    expect((await library())[0]?.clubMap?.latest).toBe(false);
    expect(await saveClubMapToGroupLibrary(db, { ...owner.proof, clubId, versionId: second.versionId, groupId, image: png, metadata }, NOW))
      .toMatchObject({ status: "saved", updated: true });
    const after = await library();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ clubMap: { latest: true }, source: { fileName: "Skogen V2.omap" } });

    // ADR-0210: "senaste" som i arkivet, året först. En version med det inskrivna året 2026 (men ett äldre datum) är nyare än 2024-05-01.
    const third = await uploadClubMapVersion(db, { ...owner.proof, clubId, mapId: uploaded.mapId, newMapName: null, fileName: "Skogen ny.omap",
      versionDate: "2019-01-01", note: null, body: chunks(new TextEncoder().encode(new TextDecoder().decode(omap).replace(/<notes>[^<]*<\/notes>/, "<notes>2026</notes>"))) }, NOW);
    if (third.status !== "created") throw new Error("Ingen tredje version");
    await pool.query("update club_map_version set version_year = 2026 where id = $1", [third.versionId]);
    const archive = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
    expect(archive.status === "ok" && archive.list.maps.find(map => map.name === "Skogen")!.latestVersionId).toBe(third.versionId);
    expect((await library())[0]?.clubMap?.latest).toBe(false);
    expect(await saveClubMapToGroupLibrary(db, { ...owner.proof, clubId, versionId: third.versionId, groupId, image: png, metadata }, NOW))
      .toMatchObject({ status: "saved", updated: true });
    expect((await library())[0]?.clubMap?.latest).toBe(true);
  });
});
