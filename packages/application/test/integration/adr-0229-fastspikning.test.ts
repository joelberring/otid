import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, migrate } from "@o-tid/database";
import { localRaceDate, nextRaceDate } from "@o-tid/domain";
import { createOrganizerEvent } from "../../src/organizer-events";
import { saveRaceMapAsAdmin } from "../../src/race-map";
import { readMapContent } from "../../src/map-content";
import { memoryArchiveStore, setMapArchiveStore, type ArchiveStore } from "../../src/map-archive-store";
import { setMapStoreMode } from "../../src/map-store";
import { cachePath, pinnedDir, setMapCacheDir, sweepMapCache } from "../../src/map-cache";
import { pinnedContentNow, pinStatus, runPinRound } from "../../src/map-pin";
import { performSuperadminAction, readSuperadminOverview, setSuperadmin } from "../../src/superadmin";
import { loginUserAccount } from "../../src/user-account";
import { accountOnRace, registerTestAccount } from "./accounts";

/**
 * PLAN.md steg M2 (ADR-0229, tillägg 2026-11-21): tävlingars och träningars kartor spikas fast i mellanlagret från dagen före
 * till dagen efter. Löparens varv hämtar det som saknas, städningen tar aldrig det spikade, en karta som laddas upp i fönstret
 * spikas vid skrivningen, och på tävlingsdagen läses det spikade utan förrådet (som här kastar fel).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0229p_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const STHLM = "Europe/Stockholm";
let cacheDir = "";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  cacheDir = await mkdtemp(join(tmpdir(), "otid-fastspik-"));
}, 60_000);
afterEach(() => { setMapStoreMode(undefined); setMapArchiveStore(undefined); setMapCacheDir(undefined); });
afterAll(async () => {
  await pool.end();
  await rm(cacheDir, { recursive: true, force: true });
  if (!/^otid_adr0229p_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const days = (date: string, count: number) => { let day = date; for (let i = 0; i < count; i++) day = nextRaceDate(day); return day; };
const today = () => localRaceDate(new Date(), STHLM);

function png(salt: number): Uint8Array {
  const bytes = new Uint8Array(4096);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 100); view.setUint32(20, 80);
  for (let index = 64; index < bytes.length; index++) bytes[index] = (index * 7 + salt) % 251;
  return bytes;
}

async function raceOn(raceDate: string) {
  const account = await registerTestAccount(db);
  const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Stockholm by Night", raceName: "Högdalen", raceDate, timeZone: STHLM, raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...account.proof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function mapOn(raceDate: string, salt: number) {
  const proof = await raceOn(raceDate);
  const bytes = png(salt);
  expect(await saveRaceMapAsAdmin(db, { ...proof, bytes, fileName: "karta.png" })).toEqual({ status: "ok" });
  const [row] = (await db.execute<{ sha256: string; stored_in: string }>(sql`select c.sha256, c.stored_in from race_map m
    join map_content c on c.sha256 = m.content_sha256 where m.race_id = ${proof.raceId}`)).rows;
  expect(row?.stored_in).toBe("STORE");
  return { proof, bytes, sha256: row!.sha256 };
}

const markers = async () => { try { return await readdir(pinnedDir(cacheDir)); } catch { return []; } };
const cached = async (sha256: string) => stat(cachePath(cacheDir, sha256)).then(() => true, () => false);
const offline = (store: ArchiveStore): ArchiveStore => ({ ...store,
  get: async () => { throw new Error("nätet är borta"); }, download: async () => { throw new Error("nätet är borta"); },
  size: async () => { throw new Error("nätet är borta"); } });

describe("ADR-0229 M2: fastspikning av tävlingars kartor", () => {
  it("spikar vid skrivningen i fönstret, hämtar det som saknas, skyddar mot städningen och läser utan nätet", async () => {
    const store = memoryArchiveStore();
    setMapArchiveStore(store); setMapStoreMode("on"); setMapCacheDir(cacheDir);
    const tomorrow = await mapOn(days(today(), 1), 1);
    // Uppladdningen i fönstret: markeringen finns direkt, och filen ligger i mellanlagret.
    expect(await markers()).toContain(tomorrow.sha256);
    expect(await cached(tomorrow.sha256)).toBe(true);
    // Långt fram i tiden: ingen markering.
    const later = await mapOn(days(today(), 10), 2);
    expect(await markers()).not.toContain(later.sha256);
    expect((await pinnedContentNow(db)).map(content => content.sha256)).toEqual([tomorrow.sha256]);

    // Städningen med ett litet tak tar det ospikade men aldrig det spikade.
    const swept = await sweepMapCache(cacheDir, 100);
    expect(swept.pinnedFiles).toBe(1);
    expect(await cached(tomorrow.sha256)).toBe(true);
    expect(await cached(later.sha256)).toBe(false);

    // Det spikade har trängts undan på annat sätt: varvet hämtar det (kontrollerat) och status visar det.
    await rm(cachePath(cacheDir, tomorrow.sha256));
    expect(await pinStatus(db, cacheDir)).toMatchObject({ count: 1, missing: 1, missingRaceDay: false, overLimit: false });
    const round = await runPinRound(db, store, cacheDir);
    expect(round).toMatchObject({ pinned: 1, fetched: 1, failed: 0 });
    expect(await cached(tomorrow.sha256)).toBe(true);
    expect(await pinStatus(db, cacheDir)).toMatchObject({ count: 1, missing: 0 });

    // Förrådet nås inte: läsningen av det spikade fungerar ändå; det ospikade som trängts ut går inte att läsa.
    setMapArchiveStore(offline(store));
    expect((await readMapContent(db, tomorrow.sha256))?.equals(Buffer.from(tomorrow.bytes))).toBe(true);
    await expect(readMapContent(db, later.sha256)).rejects.toThrow("nätet är borta");

    // Ett misslyckat varv kastar inte; det räknas och prövas igen.
    await rm(cachePath(cacheDir, tomorrow.sha256));
    const failed = await runPinRound(db, offline(store), cacheDir);
    expect(failed).toMatchObject({ pinned: 1, fetched: 0, failed: 1, failedBytes: tomorrow.bytes.byteLength });
    expect(failed.errors[0]).toContain("nätet är borta");
    expect((await runPinRound(db, store, cacheDir)).fetched).toBe(1);
  });

  it("på tävlingsdagen: saknat innehåll är rött på superadminsidan; gränsen varnar men stoppar inget; efter fönstret släpps det", async () => {
    const store = memoryArchiveStore();
    setMapArchiveStore(store); setMapStoreMode("on"); setMapCacheDir(cacheDir);
    const race = await mapOn(today(), 3);
    expect(await markers()).toContain(race.sha256);
    await rm(cachePath(cacheDir, race.sha256));
    const status = await pinStatus(db, cacheDir);
    expect(status).toMatchObject({ missingRaceDay: true });

    const account = await registerTestAccount(db, `super.${randomUUID().slice(0, 8)}`);
    await setSuperadmin(db, { email: account.email, superadmin: true });
    const login = await loginUserAccount(db, { formatVersion: 1, email: account.email, password: account.password });
    if (login.status !== "authenticated") throw new Error(login.status);
    const proof = { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
    const env = { OTID_STORE_MODE: "on", OTID_CACHE_DIR: cacheDir };
    const before = await readSuperadminOverview(db, proof, {}, new Date(), env);
    if (before.status !== "ok") throw new Error(before.status);
    expect(before.response.limits.installation).toMatchObject({ pinMaxMb: null, pinMaxMbDefault: 3072,
      pinned: { missing: 1, missingRaceDay: true, overLimit: false } });

    // Gränsen sänks under det spikade (sidan tillåter minst 100 MB; för testet sätts 0 MB direkt i databasen).
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_INSTALLATION_LIMITS", reason: "Liten disk",
      cacheMaxMb: null, mapQuotaTotalMb: null, pinMaxMb: 100 })).toEqual({ status: "done", action: "SET_INSTALLATION_LIMITS" });
    await db.execute(sql`update installation_setting set value = '0'::jsonb where key = 'pin_max_mb'`);
    const round = await runPinRound(db, store, cacheDir);
    expect(round).toMatchObject({ fetched: 1, overLimit: true });
    expect(await cached(race.sha256)).toBe(true);
    const after = await readSuperadminOverview(db, proof, {}, new Date(), env);
    if (after.status !== "ok") throw new Error(after.status);
    expect(after.response.limits.installation).toMatchObject({ pinMaxMb: 0, pinned: { missing: 0, overLimit: true } });
    expect(after.response.log.find(entry => entry.action === "SET_INSTALLATION_LIMITS")?.reason).toContain("fastspikat förval → 100 MB");
    // En äldre sida utan fältet lämnar gränsen orörd.
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_INSTALLATION_LIMITS", reason: "Äldre sida",
      cacheMaxMb: null, mapQuotaTotalMb: null })).toEqual({ status: "done", action: "SET_INSTALLATION_LIMITS" });
    expect((await db.execute(sql`select 1 from installation_setting where key = 'pin_max_mb'`)).rows).toHaveLength(1);
    await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_INSTALLATION_LIMITS", reason: "Förval",
      cacheMaxMb: null, mapQuotaTotalMb: null, pinMaxMb: null });

    // Tre dagar senare är fönstret slut: markeringen släpps (efter fristen) och städningen får ta filen.
    const later = new Date(Date.now() + 3 * 24 * 3600_000);
    const released = await runPinRound(db, store, cacheDir, later);
    expect(released.released).toBeGreaterThan(0);
    expect(await markers()).not.toContain(race.sha256);
  });

  it("med förrådet av ändras ingenting: inga markeringar och inget mellanlager", async () => {
    setMapStoreMode("off");
    const emptyDir = await mkdtemp(join(tmpdir(), "otid-fastspik-av-"));
    setMapCacheDir(join(emptyDir, "finns-inte"));
    const race = await raceOn(today());
    expect(await saveRaceMapAsAdmin(db, { ...race, bytes: png(4), fileName: "karta.png" })).toEqual({ status: "ok" });
    const [row] = (await db.execute<{ stored_in: string }>(sql`select c.stored_in from race_map m join map_content c on c.sha256 = m.content_sha256
      where m.race_id = ${race.raceId}`)).rows;
    expect(row?.stored_in).toBe("DB");
    expect(await readdir(emptyDir)).toEqual([]);
    await rm(emptyDir, { recursive: true, force: true });
  });
});
