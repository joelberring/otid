import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, migrate } from "@o-tid/database";
import { mapStorageQuota, readMapContent, stageMapContent, storeMapContent, discardStagedMapContent } from "../../src/map-content";
import { streamMapContentParts } from "../../src/club-maps";
import { memoryArchiveStore, setMapArchiveStore } from "../../src/map-archive-store";
import { setMapStoreMode } from "../../src/map-store";
import { cachePath, forgetMapCacheCap, mapCacheCapBytes, readStoredMapContentHead, setMapCacheDir } from "../../src/map-cache";
import { removeArchiveOrphans } from "../../src/map-archive";
import { performSuperadminAction, readSuperadminOverview, setSuperadmin } from "../../src/superadmin";
import { loginUserAccount } from "../../src/user-account";
import { createOrganizerEvent } from "../../src/organizer-events";
import { saveRaceMapSourceAsAdmin } from "../../src/race-map-source";
import { exportRaceAsAdmin } from "../../src/race-export";
import { accountOnRace, registerTestAccount } from "./accounts";

/**
 * ADR-0229 (PLAN.md steg M1): förrådet och mellanlagret. Med läget på laddas nytt innehåll upp och kontrolleras innan det
 * räknas som sparat, inga delar skrivs i databasen, läsningen går via mellanlagret och hämtar ur förrådet när filen saknas.
 * Innehåll i databasen läses som förut, och med läget av skrivs allt som förut. Superadmin sätter installationens gränser
 * och kontots gräns för återskapbart.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0229_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-21T12:00:00Z");
const MB = 1024 * 1024;
let cacheDir = "";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  cacheDir = await mkdtemp(join(tmpdir(), "otid-forradet-"));
}, 60_000);
afterEach(() => { setMapStoreMode(undefined); setMapArchiveStore(undefined); setMapCacheDir(undefined); });
afterAll(async () => {
  await pool.end();
  await rm(cacheDir, { recursive: true, force: true });
  if (!/^otid_adr0229_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const bytesOf = (seed: number, length: number) => Buffer.from(Uint8Array.from({ length }, (_, index) => (index * 13 + seed) % 251));
const hashOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function* chunked(bytes: Uint8Array, size = 300_000) { for (let at = 0; at < bytes.byteLength; at += size) yield bytes.subarray(at, at + size); }
const row = async (sha256: string) => (await db.execute<{ stored_in: string; content_id: string; last_used_at: Date | null }>(sql`select stored_in,
  content_id, last_used_at from map_content where sha256 = ${sha256}`)).rows[0];
const parts = async (sha256: string) => Number((await db.execute<{ n: string }>(sql`select count(*)::text as n from map_content_part p
  join map_content c on c.content_id = p.content_id where c.sha256 = ${sha256}`)).rows[0]!.n);
const quota = mapStorageQuota({ OTID_MAP_QUOTA_ACCOUNT_MB: "0", OTID_MAP_QUOTA_TOTAL_MB: "0" });

function storeOn() {
  const store = memoryArchiveStore();
  setMapArchiveStore(store);
  setMapStoreMode("on");
  setMapCacheDir(cacheDir);
  return store;
}

describe("ADR-0229 M1: förrådet och mellanlagret", () => {
  it("en strömmad uppladdning hamnar i förrådet och mellanlagret, inte i databasen, och läses därifrån", async () => {
    const store = storeOn();
    const owner = await registerTestAccount(db, undefined, NOW);
    const bytes = bytesOf(1, 2_500_000);
    const staged = await stageMapContent(db, chunked(bytes), { maxBytes: 10 * MB });
    if (staged.kind !== "staged") throw new Error(staged.kind);
    expect(staged.file).toBeDefined();
    expect(staged.sha256).toBe(hashOf(bytes));
    expect((await db.execute(sql`select 1 from map_content_part where content_id = ${staged.contentId}`)).rows).toHaveLength(0);

    const stored = await db.transaction(tx => storeMapContent(tx, staged, owner.accountId, NOW, quota));
    expect(stored).toEqual({ status: "stored", sha256: staged.sha256 });
    expect(await row(staged.sha256)).toMatchObject({ stored_in: "STORE" });
    expect(await parts(staged.sha256)).toBe(0);
    expect(store.objects.get(staged.sha256)?.equals(bytes)).toBe(true);
    // Den strömmade filen ligger nu i mellanlagret. Granskningen runda 2 (A): transaktionen raderar inga filer; den strömmade
    // filen finns kvar tills anroparen tar bort den efter transaktionen, och mellanlagrets fil är kvar efter det.
    expect((await stat(cachePath(cacheDir, staged.sha256))).size).toBe(bytes.byteLength);
    expect(await readdir(join(cacheDir, ".staging"))).toEqual([staged.contentId]);
    await discardStagedMapContent(db, staged.contentId);
    expect(await readdir(join(cacheDir, ".staging"))).toEqual([]);
    expect((await stat(cachePath(cacheDir, staged.sha256))).size).toBe(bytes.byteLength);
    expect(await row(staged.sha256)).toBeDefined();
    // Arkivets rad gör att städningen gäller också förrådets objekt.
    expect((await db.execute(sql`select 1 from map_content_archive where sha256 = ${staged.sha256} and cold_at is not null`)).rows).toHaveLength(1);

    // Läsning ur mellanlagret; utan filen hämtas den ur förrådet (räknas) och läggs där igen.
    expect((await readMapContent(db, staged.sha256))?.equals(bytes)).toBe(true);
    await rm(cachePath(cacheDir, staged.sha256));
    expect((await readMapContent(db, staged.sha256))?.equals(bytes)).toBe(true);
    expect((await stat(cachePath(cacheDir, staged.sha256))).size).toBe(bytes.byteLength);
    const fetches = (await db.execute<{ fetches: number; bytes: string }>(sql`select fetches, bytes::text from map_store_fetch_day`)).rows;
    expect(fetches).toEqual([{ fetches: 1, bytes: String(bytes.byteLength) }]);
    expect((await row(staged.sha256))?.last_used_at).not.toBeNull();

    // Strömmad läsning (nedladdning) ur mellanlagret, och efter att filen trängts undan.
    const content = (await row(staged.sha256))!.content_id;
    await rm(cachePath(cacheDir, staged.sha256));
    const streamed: Buffer[] = [];
    for await (const part of streamMapContentParts(db, content)) streamed.push(Buffer.from(part));
    expect(Buffer.concat(streamed).equals(bytes)).toBe(true);

    // Läget av: läsningen avgörs av raden, så innehållet i förrådet läses fortfarande; nytt innehåll går till databasen.
    setMapStoreMode("off");
    await rm(cachePath(cacheDir, staged.sha256));
    expect((await readMapContent(db, staged.sha256))?.equals(bytes)).toBe(true);
    const plain = bytesOf(2, 5000);
    const off = await db.transaction(tx => storeMapContent(tx, plain, owner.accountId, NOW, quota));
    expect(await row(hashOf(plain))).toMatchObject({ stored_in: "DB" });
    expect(await parts(hashOf(plain))).toBe(1);
    expect(off.status).toBe("stored");
  });

  it("innehåll i databasen läses som förut med läget på, och bytes i minnet går till förrådet", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const old = bytesOf(3, 4000);
    await db.transaction(tx => storeMapContent(tx, old, owner.accountId, NOW, quota));
    const store = storeOn();
    expect((await readMapContent(db, hashOf(old)))?.equals(old)).toBe(true);
    expect(await row(hashOf(old))).toMatchObject({ stored_in: "DB", last_used_at: null });
    // Samma innehåll igen kostar ingenting och laddas inte upp.
    expect(await db.transaction(tx => storeMapContent(tx, old, owner.accountId, NOW, quota))).toMatchObject({ status: "stored" });
    expect(store.objects.size).toBe(0);
    const fresh = bytesOf(4, 7000);
    await db.transaction(tx => storeMapContent(tx, fresh, owner.accountId, NOW, quota));
    expect(await row(hashOf(fresh))).toMatchObject({ stored_in: "STORE" });
    expect(store.objects.has(hashOf(fresh))).toBe(true);
  });

  it("en kopia som inte stämmer sparar ingenting, och kvoten stoppar före uppladdningen", async () => {
    const store = storeOn();
    const owner = await registerTestAccount(db, undefined, NOW);
    const bytes = bytesOf(5, 9000);
    // Ägaren 2026-11-22: kontrollen är längden i en HEAD (innehållet kontrollerar objektlagringen mot den signerade sha256).
    setMapArchiveStore({ ...store, size: async () => bytes.byteLength - 1 });
    const staged = await stageMapContent(db, chunked(bytes), { maxBytes: MB });
    if (staged.kind !== "staged") throw new Error(staged.kind);
    await expect(db.transaction(tx => storeMapContent(tx, staged, owner.accountId, NOW, quota))).rejects.toThrow("stämmer inte");
    expect(await row(hashOf(bytes))).toBeUndefined();
    await discardStagedMapContent(db, staged.contentId);
    expect(await readdir(join(cacheDir, ".staging"))).toEqual([]);

    setMapArchiveStore(store);
    const small = mapStorageQuota({ OTID_MAP_QUOTA_ACCOUNT_MB: "0", OTID_MAP_QUOTA_TOTAL_MB: "0" });
    await db.update((await import("@o-tid/database")).schema.userAccounts).set({ mapQuotaMb: 1 })
      .where(sql`id = ${owner.accountId}`);
    const big = await stageMapContent(db, chunked(bytesOf(6, MB + 10)), { maxBytes: 10 * MB });
    if (big.kind !== "staged") throw new Error(big.kind);
    expect(await db.transaction(tx => storeMapContent(tx, big, owner.accountId, NOW, small))).toMatchObject({ status: "quota", quota: { scope: "ACCOUNT" } });
    expect(store.objects.has(big.sha256)).toBe(false);
    await discardStagedMapContent(db, big.contentId);
    expect(await readdir(join(cacheDir, ".staging"))).toEqual([]);
    expect(await stageMapContent(db, chunked(bytesOf(7, 5000)), { maxBytes: 1000 })).toEqual({ kind: "too-large" });
    expect(await readdir(join(cacheDir, ".staging"))).toEqual([]);
  });

  it("ett släppt innehåll tas bort ur förrådet först efter backupens tid, och sparas det igen laddas det upp igen", async () => {
    const store = storeOn();
    const owner = await registerTestAccount(db, undefined, NOW);
    const bytes = bytesOf(8, 6000), sha = hashOf(bytes);
    await db.transaction(tx => storeMapContent(tx, bytes, owner.accountId, NOW, quota));
    await db.execute(sql`select otid_map_content_release(${sha})`);
    expect(await row(sha)).toBeUndefined();
    expect(await removeArchiveOrphans(db, store, 35, NOW)).toEqual({ removed: 0, errors: [] });
    expect(store.objects.has(sha)).toBe(true);
    // (Också objektet från fallet ovan vars kontroll misslyckades: det reserverades före uppladdningen och städas nu.)
    expect((await removeArchiveOrphans(db, store, 35, new Date(NOW.getTime() + 36 * 24 * 3600_000))).removed).toBe(2);
    expect(store.objects.has(sha)).toBe(false);
    await db.transaction(tx => storeMapContent(tx, bytes, owner.accountId, NOW, quota));
    expect(store.objects.has(sha)).toBe(true);
    await rm(cachePath(cacheDir, sha));
    expect((await readMapContent(db, sha))?.equals(bytes)).toBe(true);
  });

  it("granskningen runda 2 (A): uppladdningen sker utan öppen transaktion, och ett nytt försök eller en återrullning förlorar ingenting", async () => {
    const store = storeOn();
    const owner = await registerTestAccount(db, undefined, NOW);
    const openTransactions = async () => Number((await db.execute<{ n: string }>(sql`select count(*)::text as n from pg_stat_activity
      where datname = current_database() and state like 'idle in transaction%'`)).rows[0]!.n);
    const uploads: number[] = [];
    setMapArchiveStore({ ...store,
      putFile: async (sha, path, length) => { uploads.push(await openTransactions()); await store.putFile(sha, path, length); },
      put: async (sha, bytes) => { uploads.push(await openTransactions()); await store.put(sha, bytes); } });

    // Ett nytt försök (40001) efter att innehållet registrerats: filen finns kvar och laddas inte upp igen.
    const bytes = bytesOf(11, 400_000);
    const staged = await stageMapContent(db, chunked(bytes), { maxBytes: MB });
    if (staged.kind !== "staged") throw new Error(staged.kind);
    let attempts = 0, conflicted = false;
    const stored = await db.transaction(async tx => {
      attempts += 1;
      const result = await storeMapContent(tx, staged, owner.accountId, NOW, quota);
      if (!conflicted) { conflicted = true; throw Object.assign(new Error("konflikt"), { code: "40001" }); }
      return result;
    });
    expect(stored).toEqual({ status: "stored", sha256: staged.sha256 });
    expect(attempts).toBe(3);
    expect(uploads).toEqual([0]);
    expect(await row(staged.sha256)).toMatchObject({ stored_in: "STORE" });
    expect(await readdir(join(cacheDir, ".staging"))).toContain(staged.contentId);
    await discardStagedMapContent(db, staged.contentId);
    expect((await readMapContent(db, staged.sha256))?.equals(bytes)).toBe(true);

    // Samma innehåll igen, med ett nytt försök: inget laddas upp och den strömmade filen tas inte bort i transaktionen.
    const again = await stageMapContent(db, chunked(bytes), { maxBytes: MB });
    if (again.kind !== "staged") throw new Error(again.kind);
    let retried = false;
    await db.transaction(async tx => {
      const result = await storeMapContent(tx, again, owner.accountId, NOW, quota);
      if (!retried) { retried = true; throw Object.assign(new Error("dödläge"), { code: "40P01" }); }
      return result;
    });
    expect(uploads).toHaveLength(1);
    expect(await readdir(join(cacheDir, ".staging"))).toContain(again.contentId);
    await discardStagedMapContent(db, again.contentId);

    // En återrullning efter uppladdningen: inget innehåll, objektet ligger kvar som släppt och tas bort först efter fristen.
    const lost = bytesOf(12, 5000), lostSha = hashOf(lost);
    await expect(db.transaction(async tx => {
      await storeMapContent(tx, lost, owner.accountId, NOW, quota);
      throw new Error("något annat gick fel");
    })).rejects.toThrow("något annat gick fel");
    expect(uploads).toEqual([0, 0]);
    expect(await row(lostSha)).toBeUndefined();
    expect(store.objects.has(lostSha)).toBe(true);
    expect((await db.execute(sql`select 1 from map_content_archive where sha256 = ${lostSha} and orphaned_at = ${NOW}`)).rows).toHaveLength(1);
    expect((await removeArchiveOrphans(db, store, 35, new Date(NOW.getTime() + 34 * 24 * 3600_000))).removed).toBe(0);
    // Sparas det i tid registreras samma objekt (reservationen står kvar) utan ny uppladdning.
    expect(await db.transaction(tx => storeMapContent(tx, lost, owner.accountId, NOW, quota))).toMatchObject({ status: "stored" });
    expect(uploads).toHaveLength(2);
    expect((await db.execute(sql`select orphaned_at from map_content_archive where sha256 = ${lostSha}`)).rows).toEqual([{ orphaned_at: null }]);
  });

  it("indata som byggs på nytt i varje försök (en ny karta) laddas upp en gång och sparas, utan att fastna", async () => {
    storeOn();
    const owner = await registerTestAccount(db, undefined, NOW);
    const original = bytesOf(41, 120_000);
    let attempts = 0;
    const stored = await db.transaction(async tx => {
      attempts += 1;
      return storeMapContent(tx, Buffer.from(original), owner.accountId, NOW, quota);
    });
    expect(stored).toEqual({ status: "stored", sha256: hashOf(original) });
    expect(attempts).toBe(2);
    expect((await row(hashOf(original)))?.stored_in).not.toBe("DB");
  });

  it("granskningen runda 2 (A): filens början läses ur mellanlagret eller med en avgränsad hämtning, aldrig hela filen", async () => {
    const store = storeOn();
    const owner = await registerTestAccount(db, undefined, NOW);
    const bytes = bytesOf(13, 600_000), sha = hashOf(bytes);
    await db.transaction(tx => storeMapContent(tx, bytes, owner.accountId, NOW, quota));
    const heads: number[] = [];
    setMapArchiveStore({ ...store, get: async () => { throw new Error("hela filen"); }, download: async () => { throw new Error("hela filen"); },
      readHead: async (key, max) => { heads.push(max); return store.readHead(key, max); } });
    expect((await readStoredMapContentHead(db, sha, bytes.byteLength, 1000)).equals(bytes.subarray(0, 1000))).toBe(true);
    expect(heads).toEqual([]);
    await rm(cachePath(cacheDir, sha));
    expect((await readStoredMapContentHead(db, sha, bytes.byteLength, 1000)).equals(bytes.subarray(0, 1000))).toBe(true);
    expect(heads).toEqual([1000]);
  });

  it("granskningen runda 2 (A, B): tävlingens kartfil och bild laddas upp utanför transaktionen, och säkerhetskopian hämtar dem efter sin", async () => {
    const store = storeOn();
    const account = await registerTestAccount(db, undefined, NOW);
    const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Förrådet", raceName: "Torsdag", raceDate: "2026-12-29",
        timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
    if (created.status !== "created") throw new Error(created.status);
    const entered = await accountOnRace(db, { ...account.proof, raceId: created.response.raceId });
    if (entered.status !== "authenticated") throw new Error(entered.status);
    const proof = { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
    const omap = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
    const image = new Uint8Array(64);
    image.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(image.buffer).setUint32(16, 992); new DataView(image.buffer).setUint32(20, 832);
    const openTransactions = async () => Number((await db.execute<{ n: string }>(sql`select count(*)::text as n from pg_stat_activity
      where datname = current_database() and state like 'idle in transaction%'`)).rows[0]!.n);
    const during: number[] = [];
    setMapArchiveStore({ ...store,
      put: async (sha, bytes) => { during.push(await openTransactions()); await store.put(sha, bytes); },
      download: async (sha, path) => { during.push(await openTransactions()); return store.download(sha, path); } });
    expect(await saveRaceMapSourceAsAdmin(db, { ...proof, file: omap, fileName: "kartfil.omap", image, metadata: { formatVersion: 1, format: "OMAP",
      version: "Mapper v9", scale: 10_000, bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null,
      render: { pxPerMm: 8, originX: -2, originY: 102 }, summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null },
      quota })).toEqual({ status: "ok", georeferenced: false });
    expect(during).toEqual([0, 0]);
    expect(await row(hashOf(omap))).toMatchObject({ stored_in: "STORE" });
    expect(await row(hashOf(image))).toMatchObject({ stored_in: "STORE" });

    // Utan filerna i mellanlagret hämtar säkerhetskopian dem ur förrådet, efter sin transaktion.
    await rm(cachePath(cacheDir, hashOf(omap)));
    await rm(cachePath(cacheDir, hashOf(image)));
    const exported = await exportRaceAsAdmin(db, proof, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    expect(during).toEqual([0, 0, 0, 0]);
    expect(exported.manifest.files.map(entry => entry.sha256).sort()).toEqual([hashOf(omap), hashOf(image)].sort());
  });

  it("superadmin sätter installationens gränser och kontots gräns för återskapbart, också för sitt eget konto", async () => {
    storeOn();
    const account = await registerTestAccount(db, `super.${randomUUID().slice(0, 8)}`, NOW);
    await setSuperadmin(db, { email: account.email, superadmin: true });
    const login = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: account.password });
    if (login.status !== "authenticated") throw new Error(login.status);
    const proof = { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_INSTALLATION_LIMITS", reason: "Fler användare",
      cacheMaxMb: 20_000, mapQuotaTotalMb: 0 })).toEqual({ status: "done", action: "SET_INSTALLATION_LIMITS" });
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_INSTALLATION_LIMITS", reason: "För litet",
      cacheMaxMb: 10, mapQuotaTotalMb: null })).toEqual({ status: "invalid-request" });
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_ACCOUNT_LIMITS", accountId: account.accountId,
      reason: "Eget konto", mapQuotaMb: 8000, geoTilesPerMonth: null, regenerableQuotaMb: 30_000 })).toEqual({ status: "done", action: "SET_ACCOUNT_LIMITS" });
    // En äldre sida utan fältet lämnar gränsen för återskapbart orörd.
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_ACCOUNT_LIMITS", accountId: account.accountId,
      reason: "Äldre sida", mapQuotaMb: 9000, geoTilesPerMonth: null })).toEqual({ status: "done", action: "SET_ACCOUNT_LIMITS" });
    forgetMapCacheCap();
    expect(await mapCacheCapBytes(db)).toBe(20_000 * MB);

    // Inloggningen sker med verklig tid, så översikten läses med verklig tid (med NOW blev sessionen ogiltig efter kl. 12 UTC).
    const overview = await readSuperadminOverview(db, proof, { accounts: account.email }, new Date(), { OTID_STORE_MODE: "on" });
    if (overview.status !== "ok") throw new Error(overview.status);
    expect(overview.response.accounts[0]).toMatchObject({ mapQuotaMb: 9000, regenerableQuotaMb: 30_000 });
    expect(overview.response.limits.installation).toMatchObject({ storeMode: "on", cacheMaxMb: 20_000, cacheMaxMbDefault: 10_240,
      mapQuotaTotalMb: 0, mapQuotaTotalDefaultMb: 1_048_576 });
    // Hämtningarna ur förrådet i de tidigare fallen (läsningarna sker med dagens datum).
    expect(overview.response.limits.installation.storeFetchesToday + overview.response.limits.installation.storeFetchesYesterday).toBeGreaterThan(0);
    expect(overview.response.limits).toMatchObject({ defaultMapQuotaMb: 5120, defaultRegenerableQuotaMb: 10_240, totalLimitBytes: null });
    expect(overview.response.limits.installation.cacheUsedBytes).toBeGreaterThan(0);
    expect(overview.response.log.find(entry => entry.action === "SET_INSTALLATION_LIMITS")).toMatchObject({ targetType: "INSTALLATION",
      reason: "Fler användare (Mellanlager förval → 20000 MB, total kartlagring förval → ingen gräns)" });
    expect(overview.response.log[0]?.reason).toBe("Äldre sida (Lagring 8000 MB → 9000 MB, laserrutor förval → förval)");

    // Installationens totalgräns från superadmin går före miljöns.
    await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_INSTALLATION_LIMITS", reason: "Tak", cacheMaxMb: null, mapQuotaTotalMb: 1 });
    const result = await db.transaction(tx => storeMapContent(tx, bytesOf(9, MB + 1), account.accountId, NOW, quota));
    expect(result).toMatchObject({ status: "quota", quota: { scope: "INSTALLATION", limitBytes: MB } });
    await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_INSTALLATION_LIMITS", reason: "Förval", cacheMaxMb: null, mapQuotaTotalMb: null });
  });
});
