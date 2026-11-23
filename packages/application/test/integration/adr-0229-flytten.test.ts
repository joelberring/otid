import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, migrate } from "@o-tid/database";
import { localRaceDate, nextRaceDate } from "@o-tid/domain";
import { mapStorageQuota, readMapContent, storeMapContent } from "../../src/map-content";
import { streamMapContentParts } from "../../src/club-maps";
import { memoryArchiveStore, setMapArchiveStore, type ArchiveStore } from "../../src/map-archive-store";
import { setMapStoreMode } from "../../src/map-store";
import { cachePath, pinnedDir, setMapCacheDir } from "../../src/map-cache";
import { runMapMigration } from "../../src/map-store-migrate";
import { raceDayNow } from "../../src/map-archive";
import { mapMigrationStatus, migrateSettings, takeMapMigrationRequest, takeMigrateLease } from "../../src/map-store-migrate-settings";
import { createOrganizerEvent } from "../../src/organizer-events";
import { saveRaceMapAsAdmin } from "../../src/race-map";
import { performSuperadminAction, readSuperadminOverview, setSuperadmin } from "../../src/superadmin";
import { loginUserAccount } from "../../src/user-account";
import { accountOnRace, registerTestAccount } from "./accounts";

/**
 * PLAN.md steg M3 (ADR-0229, tillägg 2026-11-21 (M3)): befintligt innehåll flyttas ur databasen till förrådet. Uppladdat och
 * kontrollerat innan raden byts, arkiverat innehåll utan ny uppladdning, läsbart under och efter flytten, delarna borta först
 * efter fristen, tävlingskartor i fönstret spikade direkt, återkopplingen efter en återställning, mängden per varv, «Flytta
 * nu», nattfönstret och tävlingsdygnet (sist, eftersom tävlingen i dag stoppar resten).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0229m_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const STHLM = "Europe/Stockholm";
const MB = 1024 * 1024, HOUR = 60 * 60_000;
const quota = mapStorageQuota({ OTID_MAP_QUOTA_ACCOUNT_MB: "0", OTID_MAP_QUOTA_TOTAL_MB: "0" });
const settings = migrateSettings({});
let cacheDir = "";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  cacheDir = await mkdtemp(join(tmpdir(), "otid-flytten-"));
}, 60_000);
afterEach(() => { setMapStoreMode(undefined); setMapArchiveStore(undefined); setMapCacheDir(undefined); });
afterAll(async () => {
  await pool.end();
  await rm(cacheDir, { recursive: true, force: true });
  if (!/^otid_adr0229m_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const bytesOf = (seed: number, length: number) => Buffer.from(Uint8Array.from({ length }, (_, index) => (index * 13 + seed) % 251));
const hashOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const row = async (sha256: string) => (await db.execute<{ stored_in: string; content_id: string }>(sql`select stored_in, content_id
  from map_content where sha256 = ${sha256}`)).rows[0];
const parts = async (sha256: string) => Number((await db.execute<{ n: string }>(sql`select count(*)::text as n from map_content_part p
  join map_content c on c.content_id = p.content_id where c.sha256 = ${sha256}`)).rows[0]!.n);
const streamed = async (contentId: string) => { const chunks: Uint8Array[] = []; for await (const chunk of streamMapContentParts(db, contentId)) chunks.push(chunk); return Buffer.concat(chunks); };
const days = (date: string, count: number) => { let day = date; for (let i = 0; i < count; i++) day = nextRaceDate(day); return day; };

/** Ett förråd i minnet som räknar uppladdningarna. */
function countingStore() {
  const store = memoryArchiveStore();
  const counted = { ...store, objects: store.objects, uploads: 0,
    put: async (sha256: string, bytes: Uint8Array) => { counted.uploads += 1; await store.put(sha256, bytes); },
    putFile: async (sha256: string, path: string, byteLength: number) => { counted.uploads += 1; await store.putFile(sha256, path, byteLength); } };
  return counted;
}
function storeOn(store: ArchiveStore) { setMapArchiveStore(store); setMapStoreMode("on"); setMapCacheDir(cacheDir); }

/** Innehåll i databasen som förut (förrådet av). */
async function inDatabase(seed: number, length: number): Promise<{ sha256: string; bytes: Buffer }> {
  setMapStoreMode("off");
  const bytes = bytesOf(seed, length);
  const result = await db.transaction(tx => storeMapContent(tx, bytes, null, new Date(), quota));
  if (result.status !== "stored") throw new Error(result.status);
  return { sha256: result.sha256, bytes };
}

function png(salt: number): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 100); view.setUint32(20, 80);
  for (let index = 64; index < bytes.length; index++) bytes[index] = (index * 7 + salt) % 251;
  return bytes;
}

/** En tävling med karta i databasen (förrådet av när den laddades upp). */
async function raceMapInDatabase(raceDate: string, salt: number) {
  setMapStoreMode("off");
  const account = await registerTestAccount(db);
  const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Natt-KM", raceName: "Djurgården", raceDate, timeZone: STHLM, raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...account.proof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const bytes = png(salt);
  expect(await saveRaceMapAsAdmin(db, { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken,
    csrfHeader: entered.csrfToken, bytes, fileName: "karta.png" })).toEqual({ status: "ok" });
  return { raceId: created.response.raceId, bytes, sha256: hashOf(bytes) };
}

describe("ADR-0229 M3: flytten av befintligt innehåll till förrådet", () => {
  it("flyttar innehåll i databasen och redan arkiverat, läsbart under och efter flytten, delarna borta efter fristen", async () => {
    const fresh = await inDatabase(1, 2 * MB + 17);
    const cold = await inDatabase(2, MB + 3);
    const archived = await inDatabase(3, MB + 5);
    const store = countingStore();
    // Arkiverat (L5) och borttaget här: bara i förrådet. Arkiverat men inom arkivets frist: i båda.
    store.objects.set(cold.sha256, cold.bytes);
    store.objects.set(archived.sha256, archived.bytes);
    const now = new Date();
    await db.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at, cold_at) values (${cold.sha256}, ${cold.bytes.byteLength}, ${now}, ${now})`);
    await db.execute(sql`delete from map_content_part where content_id = ${(await row(cold.sha256))!.content_id}::uuid`);
    await db.execute(sql`insert into map_content_archive (sha256, byte_length, archived_at) values (${archived.sha256}, ${archived.bytes.byteLength}, ${now})`);
    storeOn(store);

    const lines: string[] = [];
    const first = await runMapMigration(db, store, settings, { trigger: "MANUAL", onProgress: line => lines.push(line) });
    expect(first).toMatchObject({ stopped: null, failed: 0 });
    expect(first.moved).toBeGreaterThanOrEqual(3);
    for (const content of [fresh, cold, archived]) expect((await row(content.sha256))?.stored_in).toBe("STORE");
    // Bara det nya laddades upp; det arkiverade kontrollerades i förrådet.
    expect(store.uploads).toBe(1);
    expect(first.uploadedBytes).toBe(fresh.bytes.byteLength);
    expect(store.objects.get(fresh.sha256)?.equals(fresh.bytes)).toBe(true);
    expect(lines.some(line => line.includes("uppladdat och kontrollerat"))).toBe(true);
    // Under fristen ligger delarna kvar, och läsningen fungerar.
    expect(await parts(fresh.sha256)).toBe(3);
    expect(await parts(archived.sha256)).toBe(2);
    expect((await readMapContent(db, fresh.sha256))?.equals(fresh.bytes)).toBe(true);
    expect((await streamed((await row(fresh.sha256))!.content_id)).equals(fresh.bytes)).toBe(true);
    expect(await mapMigrationStatus(db)).toMatchObject({ dbCount: 0, pendingCount: 2 });

    // Efter fristen: delarna borta, innehållet läses ur förrådet (och mellanlagret).
    const later = await runMapMigration(db, store, settings, { trigger: "MANUAL", now: new Date(now.getTime() + 25 * HOUR) });
    expect(later).toMatchObject({ freed: 2, failed: 0 });
    expect(await parts(fresh.sha256)).toBe(0);
    expect(await parts(archived.sha256)).toBe(0);
    for (const content of [fresh, cold, archived]) expect((await readMapContent(db, content.sha256))?.equals(content.bytes)).toBe(true);
    expect((await streamed((await row(cold.sha256))!.content_id)).equals(cold.bytes)).toBe(true);
    expect(await mapMigrationStatus(db)).toMatchObject({ dbCount: 0, pendingCount: 0, last: { freed: 2, trigger: "MANUAL" } });
  });

  it("strömmen fortsätter ur förrådet om fristen tar delarna mitt i läsningen", async () => {
    const content = await inDatabase(4, 3 * MB);
    const store = countingStore();
    storeOn(store);
    await runMapMigration(db, store, settings, { trigger: "MANUAL" });
    const contentId = (await row(content.sha256))!.content_id;
    const chunks: Uint8Array[] = [];
    for await (const chunk of streamMapContentParts(db, contentId)) {
      if (chunks.length === 0) await db.execute(sql`delete from map_content_part where content_id = ${contentId}::uuid`);
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).equals(content.bytes)).toBe(true);
  });

  it("ett objekt som saknas när fristen gått ut laddas upp igen och delarna ligger kvar en frist till", async () => {
    const content = await inDatabase(5, MB + 9);
    const store = countingStore();
    storeOn(store);
    await runMapMigration(db, store, settings, { trigger: "MANUAL" });
    store.objects.delete(content.sha256);
    const result = await runMapMigration(db, store, { ...settings, graceHours: 0 }, { trigger: "MANUAL" });
    expect(result.failed).toBe(1);
    expect(await parts(content.sha256)).toBe(2);
    expect(store.objects.get(content.sha256)?.equals(content.bytes)).toBe(true);
  });

  it("en tävlingskarta i fastspikningsfönstret hamnar i mellanlagret och spikas, och läses sedan utan förrådet", async () => {
    const map = await raceMapInDatabase(days(localRaceDate(new Date(), STHLM), 1), 11);
    const store = countingStore();
    storeOn(store);
    await runMapMigration(db, store, settings, { trigger: "MANUAL" });
    expect((await row(map.sha256))?.stored_in).toBe("STORE");
    expect(await readdir(pinnedDir(cacheDir))).toContain(map.sha256);
    expect((await stat(cachePath(cacheDir, map.sha256))).size).toBe(map.bytes.byteLength);
    await runMapMigration(db, store, { ...settings, graceHours: 0 }, { trigger: "MANUAL" });
    expect(await parts(map.sha256)).toBe(0);
    setMapArchiveStore({ ...store, get: async () => { throw new Error("nätet är borta"); }, download: async () => { throw new Error("nätet är borta"); } });
    expect((await readMapContent(db, map.sha256))?.equals(Buffer.from(map.bytes))).toBe(true);
  });

  it("återkopplar efter en återställning: en rad utan delar vars objekt finns i förrådet blir STORE", async () => {
    const content = await inDatabase(6, MB);
    const store = countingStore();
    store.objects.set(content.sha256, content.bytes);
    const contentId = (await row(content.sha256))!.content_id;
    await db.execute(sql`delete from map_content_part where content_id = ${contentId}::uuid`);
    await db.execute(sql`update map_content set created_at = ${new Date(Date.now() - 2 * HOUR)} where sha256 = ${content.sha256}`);
    storeOn(store);
    const result = await runMapMigration(db, store, settings, { trigger: "MANUAL" });
    expect(result.reconciled).toBe(1);
    expect((await row(content.sha256))?.stored_in).toBe("STORE");
    expect((await readMapContent(db, content.sha256))?.equals(content.bytes)).toBe(true);
  });

  it("högst mängden per varv, ett varv i taget, inte utanför nattfönstret", async () => {
    const big = await inDatabase(7, 2 * MB);
    const small = await inDatabase(8, MB);
    const store = countingStore();
    storeOn(store);
    const budget = await runMapMigration(db, store, settings, { trigger: "COMMAND", runBytes: MB / 2 });
    expect(budget.stopped).toBe("BUDGET");
    expect((await row(big.sha256))?.stored_in).toBe("STORE");
    expect((await row(small.sha256))?.stored_in).toBe("DB");

    expect(await takeMigrateLease(db, "en annan", new Date())).toBe(true);
    expect((await runMapMigration(db, store, settings, { trigger: "COMMAND" })).stopped).toBe("BUSY");
    await db.execute(sql`delete from installation_setting where key = 'map_migrate_lease'`);

    const year = new Date().getUTCFullYear() + 1;
    const noon = new Date(Date.UTC(year, 2, 10, 11));
    expect((await runMapMigration(db, store, settings, { trigger: "NIGHT", now: noon })).stopped).toBe("WINDOW");
    expect((await row(small.sha256))?.stored_in).toBe("DB");
    const night = new Date(Date.UTC(year, 2, 10, 2));
    expect((await runMapMigration(db, store, settings, { trigger: "NIGHT", now: night })).stopped).toBeNull();
    expect((await row(small.sha256))?.stored_in).toBe("STORE");
  });

  it("«Flytta nu» på superadminsidan beställer ett varv och visas i översikten", async () => {
    await inDatabase(9, MB);
    storeOn(countingStore());
    const account = await registerTestAccount(db);
    await setSuperadmin(db, { email: account.email, superadmin: true });
    const login = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: account.password });
    if (login.status !== "authenticated") throw new Error(login.status);
    const proof = { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "MIGRATE_MAP_CONTENT_NOW", reason: "Disken" }))
      .toEqual({ status: "done", action: "MIGRATE_MAP_CONTENT_NOW" });
    const overview = await readSuperadminOverview(db, proof, {}, new Date(), { OTID_STORE_MODE: "on" });
    if (overview.status !== "ok") throw new Error(overview.status);
    expect(overview.response.limits.installation.migration).toMatchObject({ enabled: true, window: "1–6", requested: true, dbCount: 1 });
    expect(await takeMapMigrationRequest(db)).toEqual({ megabytes: null });
    expect(await takeMapMigrationRequest(db)).toBeNull();
    setMapStoreMode("off");
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "MIGRATE_MAP_CONTENT_NOW", reason: "Av" }))
      .toEqual({ status: "invalid-request" });
  });

  it("gästdemons övningstävling med dagens datum gör inte dagen till tävlingsdygn", async () => {
    const demo = await raceMapInDatabase(localRaceDate(new Date(), STHLM), 13);
    await db.execute(sql`update user_account set guest_expires_at = now() + interval '1 hour' where id in (select g.account_id
      from event_administration_grant g join race r on r.event_id = g.event_id where r.id = ${demo.raceId})`);
    expect(await raceDayNow(db, new Date())).toBe(false);
  });

  it("tävlingsdygnet stoppar flytten, också den manuella", async () => {
    await raceMapInDatabase(localRaceDate(new Date(), STHLM), 12);
    const waiting = await inDatabase(10, MB);
    const store = countingStore();
    storeOn(store);
    const result = await runMapMigration(db, store, settings, { trigger: "MANUAL" });
    expect(result).toMatchObject({ stopped: "RACE_DAY", moved: 0 });
    expect((await row(waiting.sha256))?.stored_in).toBe("DB");
    expect(store.uploads).toBe(0);
  });
});
