import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { ClubImportBatchRequest } from "@o-tid/contracts";
import { createClub, createClubImportToken, inviteClubMember, listMyClubs } from "../../src/clubs";
import { readClubArchive } from "../../src/club-archive";
import { importBatch, importCheck, importMapContent } from "../../src/club-archive-import";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0204: importen i webbläsaren med inloggningen i stället för importnyckeln. Samma tjänster och samma idempotens; bara ägare
 * och administratörer importerar, CSRF krävs, en läsare och en främling avvisas, och importnyckelns väg är oförändrad.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0204_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const NOW = new Date("2026-11-03T20:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0204_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunks(bytes: Uint8Array, size = 1000) { for (let at = 0; at < bytes.byteLength; at += size) yield bytes.subarray(at, at + size); }
const fixture = async (path: string) => new Uint8Array(await readFile(new URL(path, fixtures)));

function batchFor(map: Uint8Array, ppen: Uint8Array): ClubImportBatchRequest {
  return {
    formatVersion: 1,
    maps: [{ importKey: "skogen", name: "Skogen", versions: [{ sha256: sha(map), fileName: "Skogen.omap", format: "OMAP", versionDate: "2021-03-14",
      sourcePath: "2021/03-14 Skogen/Skogen.omap" }] }],
    entries: [{ importKey: "2021/03-14 Skogen", trainingDate: "2021-03-14", year: 2021, place: "Skogen", title: "Skogen", leader: null, tags: [],
      sourcePath: "2021/03-14 Skogen", mapSha256: [sha(map)], courseFiles: [{ fileName: "Skogen.ppen", kind: "PPEN", sha256: sha(ppen),
        contentBase64: Buffer.from(ppen).toString("base64"), mapReference: "C:\\OL\\Skogen.omap", mapSha256: sha(map), resolution: "FOLDER" }] }]
  };
}

describe("ADR-0204: importen med inloggningen", { timeout: 120_000 }, () => {
  it("behörigheten: ägare och administratör importerar, läsare och främling avvisas, CSRF krävs", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Webbimport" } }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const clubId = created.club.clubId;
    const reader = await registerTestAccount(db, undefined, NOW);
    const adminAccount = await registerTestAccount(db, undefined, NOW);
    for (const [account, role] of [[reader, "READER"], [adminAccount, "ADMIN"]] as const) {
      expect((await inviteClubMember(db, { ...owner.proof, clubId, request: { formatVersion: 1, requestId: randomUUID(), email: account.email, role } }, NOW))
        .status).toBe("invited");
      await listMyClubs(db, account.proof, NOW);
    }
    const stranger = await registerTestAccount(db, undefined, NOW);
    const check = (session: { sessionToken: string | null; csrfCookie: string | null; csrfHeader: string | null }) => importCheck(db, { session, clubId, request: { formatVersion: 1, sha256: [] } }, NOW);

    expect(await check(owner.proof)).toMatchObject({ status: "ok", response: { clubId, clubName: "OK Webbimport", known: [] } });
    expect((await check(adminAccount.proof)).status).toBe("ok");
    expect((await check(reader.proof)).status).toBe("forbidden");
    expect((await check(stranger.proof)).status).toBe("not-found");
    expect((await check({ ...owner.proof, csrfHeader: "fel" })).status).toBe("forbidden");
    expect((await check({ sessionToken: null, csrfCookie: null, csrfHeader: null })).status).toBe("unauthorized");
    // En annan klubbs id med samma inloggning: finns inte för kontot.
    expect((await importCheck(db, { session: owner.proof, clubId: randomUUID(), request: { formatVersion: 1, sha256: [] } }, NOW)).status).toBe("not-found");

    // Läsaren laddar inte upp och skriver inga träningar.
    const map = await fixture("maps/kartfil.omap");
    const ppen = await fixture("course-setting/kartfil.ppen");
    expect((await importMapContent(db, { session: reader.proof, clubId, sha256: sha(map), body: chunks(map) }, NOW)).status).toBe("forbidden");
    expect((await importBatch(db, { session: reader.proof, clubId, request: batchFor(map, ppen) }, NOW)).status).toBe("forbidden");
    expect((await pool.query<{ n: number }>("select count(*)::int as n from map_content where sha256 = $1", [sha(map)])).rows[0]?.n).toBe(0);
  });

  it("hela importen och omkörningen: inget laddas upp två gånger, träningarna känns igen; nyckelns väg är densamma", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: "OK Omkörning" } }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const clubId = created.club.clubId;
    const session = owner.proof;
    const map = await fixture("maps/kartfil.omap");
    const ppen = await fixture("course-setting/kartfil.ppen");
    const keys = ["2021/03-14 Skogen", "2021/05-01 Ängen"];

    expect(await importCheck(db, { session, clubId, request: { formatVersion: 1, sha256: [sha(map)], importKeys: keys } }, NOW))
      .toMatchObject({ status: "ok", response: { known: [], knownEntries: [] } });
    expect(await importMapContent(db, { session, clubId, sha256: sha(map), body: chunks(map) }, NOW))
      .toMatchObject({ status: "ok", response: { stored: "new", byteLength: map.byteLength } });
    const batch = batchFor(map, ppen);
    expect(await importBatch(db, { session, clubId, request: batch }, NOW)).toEqual({ status: "ok", response: { formatVersion: 1,
      maps: { created: 1, versionsAdded: 1 }, entries: { created: 1, existing: 0, courseFilesAdded: 1 }, missingContent: [] } });

    // Omkörningen (t.ex. efter en stängd flik): servern har kartan och träningen; inget nytt skapas.
    const again = await importCheck(db, { session, clubId, request: { formatVersion: 1, sha256: [sha(map)], importKeys: keys } }, NOW);
    expect(again).toMatchObject({ status: "ok", response: { known: [sha(map)], knownEntries: ["2021/03-14 Skogen"] } });
    expect(await importMapContent(db, { session, clubId, sha256: sha(map), body: chunks(map) }, NOW)).toMatchObject({ response: { stored: "existing" } });
    expect(await importBatch(db, { session, clubId, request: batch }, NOW)).toEqual({ status: "ok", response: { formatVersion: 1,
      maps: { created: 0, versionsAdded: 0 }, entries: { created: 0, existing: 1, courseFilesAdded: 0 }, missingContent: [] } });
    const archive = await readClubArchive(db, { ...owner.proof, clubId }, NOW);
    expect(archive.status === "ok" && [archive.list.entries.length, archive.list.maps.length]).toEqual([1, 1]);

    // Importnyckelns väg: samma svar som förut (utan träningarnas nycklar ingen `knownEntries`), och samma idempotens.
    const token = await createClubImportToken(db, { ...owner.proof, clubId }, NOW);
    if (token.status !== "created") throw new Error(token.status);
    const byToken = await importCheck(db, { token: token.token, clubId, request: { formatVersion: 1, sha256: [sha(map)] } }, NOW);
    expect(byToken).toEqual({ status: "ok", response: { formatVersion: 1, clubId, clubName: "OK Omkörning", known: [sha(map)] } });
    expect((await importBatch(db, { token: token.token, clubId, request: batch }, NOW))).toMatchObject({ response: { entries: { created: 0, existing: 1 } } });
    // Journalen säger vem som importerade (bara den första omgången ändrade något).
    expect((await pool.query<{ n: number }>("select count(*)::int as n from club_journal where club_id = $1 and action = 'CLUB_ARCHIVE_IMPORTED'", [clubId]))
      .rows[0]?.n).toBe(1);
  });
});
