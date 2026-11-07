import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { clubUsage, createClub, createClubImportToken, inviteClubMember, listMyClubs } from "../../src/clubs";
import { readClubArchive, readClubArchiveEntry } from "../../src/club-archive";
import { saveClubMapVersionCheck } from "../../src/club-archive-checks";
import { importBatch, importMapContent } from "../../src/club-archive-import";
import { copyClubMapVersionFields, dismissClubMapDuplicates, readClubMapDuplicates } from "../../src/club-map-duplicates";
import { mergeClubMaps, undoClubMapMerge } from "../../src/club-map-merge";
import { listUsableClubMaps } from "../../src/club-map-picker";
import { setClubAccessSettings } from "../../src/club-affiliations";
import { mayUseClubMap } from "../../src/club-map-use";
import { updateClubMap, updateClubMapVersion } from "../../src/club-maps";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0210: dubbletter och versioner av klubbarkivets kartor. Tre filer av samma syntetiska karta under olika namn och en
 * annan karta; fingeravtrycken är påhittade (ytorna i SWEREF 99 TM) och kartfilerna är fixturens Mapper-fil med en kommentar
 * sist, så att innehållet blir olika.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0210_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const NOW = new Date("2026-11-03T12:00:00Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0210_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunks(bytes: Uint8Array) { yield bytes; }
const SYMBOLS = ["101.0", "201.0", "301.0", "401.0", "406.0"];
const fingerprint = (x: number) => ({ scale: 10000, bounds: { minX: 0, minY: 0, maxX: 120, maxY: 80 }, symbols: SYMBOLS, symbolHash: "0a1b2c3d",
  objectCount: 120, projected: { epsg: 3006, extent: { minX: 666000 + x, minY: 6574000, maxX: 667200 + x, maxY: 6574800 } } });

async function archive() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Syntet" } }, NOW);
  if (created.status !== "created") throw new Error("Ingen klubb");
  const clubId = created.club.clubId;
  const token = await createClubImportToken(db, { ...owner.proof, clubId }, NOW);
  if (token.status !== "created") throw new Error("Ingen nyckel");
  const omap = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
  const ppen = new Uint8Array(await readFile(new URL("course-setting/kartfil.ppen", fixtures)));
  const variant = (n: number) => new Uint8Array([...omap, ...new TextEncoder().encode(`\n<!-- variant ${n} -->\n`)]);
  const files = [variant(1), variant(2), variant(3), variant(4)];
  for (const file of files) expect((await importMapContent(db, { token: token.token, clubId, sha256: sha(file), body: chunks(file) }, NOW)).status).toBe("ok");
  const map = (key: string, name: string, file: Uint8Array, fileName: string, sourcePath: string | null) =>
    ({ importKey: key, name, versions: [{ sha256: sha(file), fileName, format: "OMAP" as const, versionDate: null, sourcePath }] });
  const course = (file: Uint8Array) => ({ fileName: "Banor.ppen", kind: "PPEN" as const, sha256: sha(ppen), contentBase64: Buffer.from(ppen).toString("base64"),
    mapReference: "karta.omap", mapSha256: sha(file), resolution: "FOLDER" as const });
  const entry = (key: string, title: string, maps: Uint8Array[], courseFiles: ReturnType<typeof course>[]) => ({ importKey: key, trainingDate: null, year: 2020,
    place: title, title, leader: null, tags: [], sourcePath: key, mapSha256: maps.map(sha), courseFiles });
  const imported = await importBatch(db, { token: token.token, clubId, request: { formatVersion: 1,
    maps: [map("a", "Älvsjöskogen 2019", files[0]!, "Älvsjöskogen 2019.omap", null), map("b", "alvsjoskogen_ny", files[1]!, "alvsjoskogen_ny.omap",
      "2020/05-12 Skogen/alvsjoskogen_ny.omap"), map("c", "Älvsjöskogen rev 2021", files[2]!, "Älvsjöskogen rev 2021.omap", null),
      map("d", "Solberga", files[3]!, "Solberga.omap", null)],
    entries: [entry("2019/04-01 A", "Skogen A", [files[0]!], [course(files[0]!)]), entry("2020/05-12 Skogen", "Skogen B", [files[1]!], [course(files[1]!)]),
      entry("2020/06-01 C", "Skogen C", [files[1]!], []), entry("2021/09-01 D", "Två kartor", [files[2]!, files[3]!], [])] } }, NOW);
  expect(imported.status).toBe("ok");
  const adminAccount = await registerTestAccount(db, undefined, NOW);
  const reader = await registerTestAccount(db, undefined, NOW);
  for (const [account, role] of [[adminAccount, "ADMIN"], [reader, "READER"]] as const) {
    await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: account.email, role } }, NOW);
    await listMyClubs(db, account.proof, NOW);
  }
  const list = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
  if (list.status !== "ok") throw new Error("Inget arkiv");
  const byName = (name: string) => list.list.maps.find(item => item.name === name)!;
  const maps = { a: byName("Älvsjöskogen 2019"), b: byName("alvsjoskogen_ny"), c: byName("Älvsjöskogen rev 2021"), d: byName("Solberga") };
  // Kontrollen i webbläsaren har sparat fingeravtrycken: a–c är samma område, d ett annat.
  for (const [item, x] of [[maps.a, 0], [maps.b, 40], [maps.c, 90], [maps.d, 9000]] as const) {
    expect(await saveClubMapVersionCheck(db, { ...owner.proof, clubId, versionId: item.versions[0]!.versionId, request: { formatVersion: 1, readerVersion: 2,
      status: "OK", detail: null, fileVersion: "Mapper v9", thumbnail: null, fingerprint: fingerprint(x) } }, NOW)).toEqual({ status: "ok" });
  }
  return { owner, admin: adminAccount, reader, clubId, maps };
}

const contentCount = async () => Number((await pool.query<{ count: string }>("select count(*) from map_content")).rows[0]!.count);
const journal = async (clubId: string) => (await pool.query<{ action: string; details: Record<string, unknown> }>(
  "select action, details from club_journal where club_id = $1 order by created_at, id", [clubId])).rows;

describe("ADR-0210: dubbletter och versioner av klubbarkivets kartor", { timeout: 120_000 }, () => {
  it("föreslår de tre filerna som troligen samma karta, bara för ägare och administratörer, och Inte samma karta består", async () => {
    const { owner, admin: adminAccount, reader, clubId, maps } = await archive();
    expect((await readClubMapDuplicates(db, { ...reader.proof, clubId }, NOW)).status).toBe("forbidden");
    const found = await readClubMapDuplicates(db, { ...adminAccount.proof, clubId }, NOW);
    if (found.status !== "ok") throw new Error(found.status);
    expect(found.response.clusters).toHaveLength(1);
    const [cluster] = found.response.clusters;
    expect(new Set(cluster!.mapIds)).toEqual(new Set([maps.a.mapId, maps.b.mapId, maps.c.mapId]));
    expect(cluster!.level).toBe("HIGH");
    expect(cluster!.reasons[0]).toMatchObject({ kind: "AREA" });
    expect(cluster!.reasons.map(reason => reason.kind)).toEqual(expect.arrayContaining(["SAME_NAME", "SAME_SYMBOLS"]));
    // Förvalet: flest träningar (b används i två).
    expect(cluster!.keepMapId).toBe(maps.b.mapId);
    expect(cluster!.extents.find(extent => extent.mapId === maps.a.mapId)).toEqual({ mapId: maps.a.mapId, ground: { width: 1200, height: 800 },
      paper: { width: 120, height: 80, scale: 10000 } });

    const ids = [maps.a.mapId, maps.b.mapId, maps.c.mapId];
    expect((await dismissClubMapDuplicates(db, { ...reader.proof, clubId, request: { formatVersion: 1, mapIds: ids } }, NOW)).status).toBe("forbidden");
    expect(await dismissClubMapDuplicates(db, { ...owner.proof, clubId, request: { formatVersion: 1, mapIds: ids } }, NOW)).toEqual({ status: "ok", pairs: 3 });
    // Samma val en gång till skapar inget nytt.
    expect(await dismissClubMapDuplicates(db, { ...owner.proof, clubId, request: { formatVersion: 1, mapIds: ids } }, later(1))).toEqual({ status: "ok", pairs: 3 });
    const after = await readClubMapDuplicates(db, { ...owner.proof, clubId }, later(2));
    expect(after.status === "ok" && after.response.clusters).toEqual([]);
    expect((await journal(clubId)).filter(row => row.action === "CLUB_MAP_DUPLICATE_DISMISSED")).toHaveLength(2);
  });

  it("Slå ihop till en karta flyttar versionerna i årsordning, behåller träningarnas versioner och kan ångras", async () => {
    const { owner, admin: adminAccount, reader, clubId, maps } = await archive();
    const usageBefore = await clubUsage(db, clubId);
    const contents = await contentCount();
    const entries = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
    if (entries.status !== "ok") throw new Error("Inget arkiv");
    const entryB = entries.list.entries.find(item => item.title === "Skogen B")!;
    const request = { formatVersion: 1, keepMapId: maps.b.mapId, mapIds: [maps.a.mapId, maps.b.mapId, maps.c.mapId] };

    expect((await mergeClubMaps(db, { ...reader.proof, clubId, request }, NOW)).status).toBe("forbidden");
    expect((await mergeClubMaps(db, { ...owner.proof, clubId, request: { ...request, keepMapId: maps.d.mapId } }, NOW)).status).toBe("invalid-request");
    const merged = await mergeClubMaps(db, { ...adminAccount.proof, clubId, request }, later(1));
    if (merged.status !== "ok") throw new Error(merged.status);
    expect(merged.response).toMatchObject({ mapId: maps.b.mapId, versionsMoved: 2 });

    const list = await readClubArchive(db, { ...reader.proof, clubId }, later(1));
    if (list.status !== "ok") throw new Error("Inget arkiv");
    expect(list.list.maps.map(item => item.name)).toEqual(["alvsjoskogen_ny", "Solberga"]);
    const kept = list.list.maps[0]!;
    // Nyaste först: 2021 ur filnamnet, 2020 ur årsmappen, 2019 ur filnamnet.
    expect(kept.versions.map(version => [version.fileName, version.year, version.yearSource])).toEqual([
      ["Älvsjöskogen rev 2021.omap", 2021, "FILE_NAME"], ["alvsjoskogen_ny.omap", 2020, "YEAR_FOLDER"], ["Älvsjöskogen 2019.omap", 2019, "FILE_NAME"]]);
    expect(kept.years).toEqual({ from: 2019, to: 2021 });
    expect(kept.latestVersionId).toBe(maps.c.versions[0]!.versionId);
    expect(kept.merges).toHaveLength(1);
    expect(kept.merges[0]).toMatchObject({ mergeId: merged.response.mergeId, versions: 2, undoable: true, undoneAt: null });
    expect([...kept.merges[0]!.absorbedNames].sort()).toEqual(["Älvsjöskogen 2019", "Älvsjöskogen rev 2021"]);
    // Banfilerna pekar på sina exakta versioner, nu under kartan som behölls.
    const entry = await readClubArchiveEntry(db, { ...reader.proof, clubId, entryId: entryB.entryId }, later(1));
    if (entry.status !== "ok") throw new Error("Ingen träning");
    expect(entry.view.courseFiles[0]!.mapVersion).toMatchObject({ versionId: maps.b.versions[0]!.versionId, mapId: maps.b.mapId, mapName: "alvsjoskogen_ny" });
    const entryA = await readClubArchiveEntry(db, { ...reader.proof, clubId, entryId: entries.list.entries.find(item => item.title === "Skogen A")!.entryId }, later(1));
    expect(entryA.status === "ok" && entryA.view.courseFiles[0]!.mapVersion).toMatchObject({ versionId: maps.a.versions[0]!.versionId, mapId: maps.b.mapId,
      latest: false });
    // Innehållet och kvoten är orörda; inga förslag kvar.
    expect(await contentCount()).toBe(contents);
    expect({ ...(await clubUsage(db, clubId)), maps: usageBefore.maps }).toEqual(usageBefore);
    expect((await clubUsage(db, clubId)).maps).toBe(usageBefore.maps - 2);
    const left = await readClubMapDuplicates(db, { ...owner.proof, clubId }, later(1));
    expect(left.status === "ok" && left.response.clusters).toEqual([]);
    expect((await journal(clubId)).find(row => row.action === "CLUB_MAP_MERGED")?.details).toMatchObject({ mergeId: merged.response.mergeId,
      into: maps.b.mapId, versionsMoved: 2 });

    // Ångra: kartorna kommer tillbaka med samma id, namn och versioner.
    expect((await undoClubMapMerge(db, { ...reader.proof, clubId, mergeId: merged.response.mergeId }, later(2))).status).toBe("forbidden");
    const undone = await undoClubMapMerge(db, { ...owner.proof, clubId, mergeId: merged.response.mergeId }, later(2));
    expect(undone.status).toBe("ok");
    const restored = await readClubArchive(db, { ...owner.proof, clubId }, later(2));
    if (restored.status !== "ok") throw new Error("Inget arkiv");
    for (const original of [maps.a, maps.b, maps.c, maps.d]) {
      const back = restored.list.maps.find(item => item.mapId === original.mapId)!;
      expect([back.name, back.versions.map(version => version.versionId)]).toEqual([original.name, original.versions.map(version => version.versionId)]);
    }
    expect(restored.list.maps.find(item => item.mapId === maps.b.mapId)!.merges[0]).toMatchObject({ undoable: false, undoneAt: later(2).toISOString() });
    expect((await undoClubMapMerge(db, { ...owner.proof, clubId, mergeId: merged.response.mergeId }, later(3))).status).toBe("conflict");
    expect((await journal(clubId)).filter(row => row.action === "CLUB_MAP_MERGE_UNDONE")).toHaveLength(1);
    // Förslaget är tillbaka.
    const again = await readClubMapDuplicates(db, { ...owner.proof, clubId }, later(3));
    expect(again.status === "ok" && again.response.clusters).toHaveLength(1);
  });

  it("en ändring av kartan efter sammanslagningen gör att den inte längre går att ångra", async () => {
    const { owner, clubId, maps } = await archive();
    const merged = await mergeClubMaps(db, { ...owner.proof, clubId, request: { formatVersion: 1, keepMapId: maps.a.mapId, mapIds: [maps.a.mapId, maps.c.mapId] } },
      later(1));
    if (merged.status !== "ok") throw new Error(merged.status);
    const agreement = { ownership: "CLUB", ownerKind: "CLUB", ownerName: null, agreement: null, validUntil: null, contact: null, trainingOnly: false,
      feePerPrint: false, noPublicDisplay: false };
    expect(await updateClubMap(db, { ...owner.proof, clubId, mapId: maps.a.mapId, request: { formatVersion: 1, name: "Älvsjöskogen", agreement,
      description: "Skogen söder om stationen", maker: "Kim Kartritare" } }, later(2))).toEqual({ status: "ok" });
    const list = await readClubArchive(db, { ...owner.proof, clubId }, later(2));
    const kept = list.status === "ok" ? list.list.maps.find(item => item.mapId === maps.a.mapId)! : undefined;
    expect(kept).toMatchObject({ name: "Älvsjöskogen", description: "Skogen söder om stationen", maker: "Kim Kartritare" });
    expect(kept!.merges[0]!.undoable).toBe(false);
    expect((await undoClubMapMerge(db, { ...owner.proof, clubId, mergeId: merged.response.mergeId }, later(3))).status).toBe("conflict");
  });

  it("C5: en karta som tagit emot en sammanslagning kan själv gå upp i en annan, och båda kan ångras i tur och ordning", async () => {
    // Därför har club_map_merge inga främmande nycklar till kartan (städrundan 2026-11-07): målet tas bort och kommer tillbaka.
    const { owner, clubId, maps } = await archive();
    const first = await mergeClubMaps(db, { ...owner.proof, clubId, request: { formatVersion: 1, keepMapId: maps.a.mapId,
      mapIds: [maps.a.mapId, maps.c.mapId] } }, later(1));
    if (first.status !== "ok") throw new Error(first.status);
    const second = await mergeClubMaps(db, { ...owner.proof, clubId, request: { formatVersion: 1, keepMapId: maps.b.mapId,
      mapIds: [maps.a.mapId, maps.b.mapId] } }, later(2));
    if (second.status !== "ok") throw new Error(second.status);
    const merged = await readClubArchive(db, { ...owner.proof, clubId }, later(2));
    expect(merged.status === "ok" && merged.list.maps.map(item => item.name)).toEqual(["alvsjoskogen_ny", "Solberga"]);

    expect((await undoClubMapMerge(db, { ...owner.proof, clubId, mergeId: second.response.mergeId }, later(3))).status).toBe("ok");
    const back = await readClubArchive(db, { ...owner.proof, clubId }, later(3));
    if (back.status !== "ok") throw new Error("Inget arkiv");
    const a = back.list.maps.find(item => item.mapId === maps.a.mapId)!;
    expect(a.merges.map(merge => [merge.mergeId, merge.undoable])).toEqual([[first.response.mergeId, true]]);
    expect((await undoClubMapMerge(db, { ...owner.proof, clubId, mergeId: first.response.mergeId }, later(4))).status).toBe("ok");
    const restored = await readClubArchive(db, { ...owner.proof, clubId }, later(4));
    if (restored.status !== "ok") throw new Error("Inget arkiv");
    for (const original of [maps.a, maps.b, maps.c, maps.d]) {
      const map = restored.list.maps.find(item => item.mapId === original.mapId)!;
      expect([map.name, map.versions.map(version => version.versionId)]).toEqual([original.name, original.versions.map(version => version.versionId)]);
    }
  });

  it("året går att skriva in, och Kopiera till alla versioner och Från kartan sätter uppgifterna med journal", async () => {
    const { owner, reader, clubId, maps } = await archive();
    const merged = await mergeClubMaps(db, { ...owner.proof, clubId, request: { formatVersion: 1, keepMapId: maps.b.mapId,
      mapIds: [maps.a.mapId, maps.b.mapId, maps.c.mapId] } }, NOW);
    if (merged.status !== "ok") throw new Error(merged.status);
    const [v1, v2, v3] = [maps.a.versions[0]!.versionId, maps.b.versions[0]!.versionId, maps.c.versions[0]!.versionId];
    expect(await updateClubMapVersion(db, { ...owner.proof, clubId, versionId: v1, request: { formatVersion: 1, versionDate: null, note: "Ritad efter laserdata",
      versionYear: 2014, maker: "Åsa Ö" } }, later(1))).toEqual({ status: "ok" });
    const copy = { formatVersion: 1, fromVersionId: v1, fields: ["maker"], versionIds: [v2, v3] };
    expect((await copyClubMapVersionFields(db, { ...reader.proof, clubId, mapId: maps.b.mapId, request: copy }, later(2))).status).toBe("forbidden");
    expect((await copyClubMapVersionFields(db, { ...owner.proof, clubId, mapId: maps.d.mapId, request: copy }, later(2))).status).toBe("not-found");
    expect(await copyClubMapVersionFields(db, { ...owner.proof, clubId, mapId: maps.b.mapId, request: copy }, later(2))).toEqual({ status: "ok", updated: 2 });
    let list = await readClubArchive(db, { ...owner.proof, clubId }, later(2));
    let kept = list.status === "ok" ? list.list.maps.find(item => item.mapId === maps.b.mapId)! : undefined;
    expect(kept!.versions.map(version => [version.year, version.yearSource, version.maker, version.note])).toEqual([
      [2021, "FILE_NAME", "Åsa Ö", null], [2020, "YEAR_FOLDER", "Åsa Ö", null], [2014, "MANUAL", "Åsa Ö", "Ritad efter laserdata"]]);
    expect(kept!.years).toEqual({ from: 2014, to: 2021 });
    // Versionernas uppgifter hindrar inte att sammanslagningen ångras.
    expect(kept!.merges[0]!.undoable).toBe(true);
    // Från kartan: kartans kartritare till en version (bara kartritaren finns på kartan).
    const agreement = { ownership: "CLUB", ownerKind: "CLUB", ownerName: null, agreement: null, validUntil: null, contact: null, trainingOnly: false,
      feePerPrint: false, noPublicDisplay: false };
    await updateClubMap(db, { ...owner.proof, clubId, mapId: maps.b.mapId, request: { formatVersion: 1, name: "Älvsjöskogen", agreement, maker: "Kim K" } }, later(3));
    expect((await copyClubMapVersionFields(db, { ...owner.proof, clubId, mapId: maps.b.mapId, request: { formatVersion: 1, fromVersionId: null,
      fields: ["note"], versionIds: [v3] } }, later(4))).status).toBe("invalid-request");
    expect(await copyClubMapVersionFields(db, { ...owner.proof, clubId, mapId: maps.b.mapId, request: { formatVersion: 1, fromVersionId: null,
      fields: ["maker"], versionIds: [v3] } }, later(4))).toEqual({ status: "ok", updated: 1 });
    list = await readClubArchive(db, { ...owner.proof, clubId }, later(4));
    kept = list.status === "ok" ? list.list.maps.find(item => item.mapId === maps.b.mapId)! : undefined;
    expect(kept!.versions.find(version => version.versionId === v3)!.maker).toBe("Kim K");
    const copied = (await journal(clubId)).filter(row => row.action === "CLUB_MAP_VERSIONS_COPIED");
    expect(copied).toHaveLength(2);
    expect(copied[0]!.details).toMatchObject({ mapId: maps.b.mapId, from: v1, fields: ["maker"] });
    expect(copied[0]!.details.versions).toContainEqual({ versionId: v2, before: { maker: null } });
    // Ett år går att gissa igen.
    expect(await updateClubMapVersion(db, { ...owner.proof, clubId, versionId: v1, request: { formatVersion: 1, versionDate: null, note: null,
      versionYear: null } }, later(5))).toEqual({ status: "ok" });
    list = await readClubArchive(db, { ...owner.proof, clubId }, later(5));
    expect(list.status === "ok" && list.list.maps.find(item => item.mapId === maps.b.mapId)!.versions.find(version => version.versionId === v1))
      .toMatchObject({ year: 2019, yearSource: "FILE_NAME", maker: "Åsa Ö" });
  });

  it("Välj karta från klubbarkivet: medlemmarnas kartor med versionerna, ingenting för andra", async () => {
    const { owner, reader, clubId, maps } = await archive();
    await mergeClubMaps(db, { ...owner.proof, clubId, request: { formatVersion: 1, keepMapId: maps.b.mapId, mapIds: [maps.a.mapId, maps.b.mapId, maps.c.mapId] } }, NOW);
    const listed = await listUsableClubMaps(db, reader.proof, NOW);
    if (listed.status !== "ok") throw new Error(listed.status);
    const mine = listed.response.maps.filter(item => item.clubId === clubId);
    expect(mine.map(item => [item.map.name, item.map.versions.length, item.map.years, item.clubName])).toEqual([
      ["alvsjoskogen_ny", 3, { from: 2019, to: 2021 }, "OK Syntet"], ["Solberga", 1, { from: 2026, to: 2026 }, "OK Syntet"]]);
    expect(mine[0]!.issues).toEqual([]);
    const stranger = await registerTestAccount(db, undefined, NOW);
    const none = await listUsableClubMaps(db, stranger.proof, NOW);
    expect(none.status === "ok" && none.response.maps).toEqual([]);
    expect(mayUseClubMap(undefined, maps.a)).toBe(false);
    // ADR-0209: medlemmar bara när klubben valt "Alla medlemmar"; ledare, administratörer och ägare annars också.
    expect(mayUseClubMap({ role: "READER", clubId, mapBank: "LEADERS" }, maps.a)).toBe(false);
    expect(mayUseClubMap({ role: "READER", clubId, mapBank: "MEMBERS" }, maps.a)).toBe(true);
    expect(mayUseClubMap({ role: "LEADER", clubId, mapBank: "LEADERS" }, maps.a)).toBe(true);
    for (const role of ["ADMIN", "OWNER"] as const) expect(mayUseClubMap({ role, clubId, mapBank: "LEADERS" }, maps.a)).toBe(true);
  });

  it("B5: Välj karta från klubbarkivet frågar databasen lika många gånger med en klubb som med sju", async () => {
    const { reader, clubId } = await archive();
    // En egen anslutning som räknar frågorna (varje ny klient i poolen räknas från början).
    const counted = createDatabase(url.href, { max: 1 });
    let queries = 0;
    counted.pool.on("connect", client => {
      const query = client.query.bind(client) as (...args: unknown[]) => unknown;
      (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => { queries += 1; return query(...args); };
    });
    try {
      const count = async () => {
        queries = 0;
        const listed = await listUsableClubMaps(counted.db, reader.proof, NOW);
        if (listed.status !== "ok") throw new Error(listed.status);
        return { queries, clubs: new Set(listed.response.maps.map(item => item.clubId)) };
      };
      const one = await count();
      expect(one.clubs).toEqual(new Set([clubId]));
      for (let index = 0; index < 6; index += 1) {
        const created = await createClub(db, { ...reader.proof, request: { formatVersion: 1, requestId: randomUUID(), name: `OK Extra ${index}` } }, NOW);
        expect(created.status).toBe("created");
      }
      const seven = await count();
      // Förut två till fem frågor till per klubb (inställningarna och kartorna).
      expect(seven.queries - one.queries).toBeLessThanOrEqual(1);
    } finally { await counted.pool.end(); }
  });

  it("ändrat 2026-11-07: en bekräftad medlem (utan uttryckligt medlemskap) ser kartorna, men inte när kartbanken är för ledare", async () => {
    const { owner, clubId } = await archive();
    const runner = await registerTestAccount(db, undefined, NOW);
    // "Vilken klubb tillhör du?" (fritext) som arkivet har bekräftat (ADR-0209 beslut 3), som när Eventors medlemslista bekräftar.
    await pool.query(`insert into account_club_membership (id, account_id, organisation_id, free_text, club_id, status, origin, confirmed_via, created_at,
      decided_by, decided_at) values ($1, $2, null, 'OK Syntet', $3, 'CONFIRMED', 'ACCOUNT', 'MANUAL', $4, $5, $4)`,
    [randomUUID(), runner.accountId, clubId, NOW, owner.accountId]);
    expect((await pool.query("select 1 from club_member where club_id = $1 and account_id = $2", [clubId, runner.accountId])).rowCount).toBe(0);
    // Förval: alla medlemmar får använda kartbanken.
    const listed = await listUsableClubMaps(db, runner.proof, NOW);
    if (listed.status !== "ok") throw new Error(listed.status);
    expect(listed.response.maps.map(item => [item.clubId, item.map.name])).toEqual([[clubId, "alvsjoskogen_ny"], [clubId, "Solberga"],
      [clubId, "Älvsjöskogen 2019"], [clubId, "Älvsjöskogen rev 2021"]]);
    expect(listed.response.maps.every(item => item.map.merges.length === 0)).toBe(true);
    await setClubAccessSettings(db, { ...owner.proof, clubId, request: { formatVersion: 1, archive: "MEMBERS", mapBank: "LEADERS" } }, NOW);
    const closed = await listUsableClubMaps(db, runner.proof, NOW);
    expect(closed.status === "ok" && closed.response.maps).toEqual([]);
  });
});
