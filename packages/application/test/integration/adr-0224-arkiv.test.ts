import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDatabase, migrate } from "@o-tid/database";
import { createMapProjectFromUpload } from "../../src/map-projects";
import { readMapContent, storeMapContent } from "../../src/map-content";
import { streamMapContentParts } from "../../src/club-maps";
import { archiveSettings, planMapArchive, runMapArchive, type ArchiveSettings } from "../../src/map-archive";
import { memoryArchiveStore, setMapArchiveStore } from "../../src/map-archive-store";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0224, PLAN.md steg L5: laserkörningars resultatfiler flyttas till arkivet enligt reglerna (ersatt, vilande, tryck),
 * delarna tas bort först efter fristen, läsningen hämtar tillbaka, en trasig kopia stoppar flytten och ett släppt innehåll
 * raderas i arkivet först efter backupens tid.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0224_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-10T12:00:00Z"), HOUR = 60 * 60_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const SETTINGS: ArchiveSettings = { ...archiveSettings({}, "on"), minBytes: 1000, accountHotBytes: null, totalHotBytes: null };

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  setMapArchiveStore(undefined);
  await pool.end();
  if (!/^otid_adr0224_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const bytesOf = (seed: number, length = 3000) => Uint8Array.from({ length }, (_, index) => (index * 7 + seed) % 251);

async function project(name: string) {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name, fileName: `${name}.omap` },
    file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { accountId: owner.accountId, projectId: created.projectId };
}

/** En laserkörning med en resultatfil; ger filens sha256. */
async function run(target: { accountId: string; projectId: string }, seed: number, finished: Date | null, status = "DONE", length = 3000) {
  const jobId = randomUUID();
  await db.execute(sql`insert into map_project_geo_job (id, project_id, account_id, kind, status, request, created_at, finished_at, request_id)
    values (${jobId}, ${target.projectId}, ${target.accountId}, 'PULLAUTIN', ${status}, '{}'::jsonb, ${finished ?? NOW}, ${finished}, ${randomUUID()})`);
  const stored = await db.transaction(tx => storeMapContent(tx, bytesOf(seed, length), target.accountId, NOW));
  if (stored.status !== "stored") throw new Error(stored.status);
  await db.execute(sql`insert into map_project_geo_output (job_id, name, content_sha256, media_type, byte_size, created_at)
    values (${jobId}, 'hojd.png', ${stored.sha256}, 'image/png', ${length}, ${NOW})`);
  return { jobId, sha256: stored.sha256 };
}
const opened = (projectId: string, when: Date) => db.execute(sql`update map_project set last_opened_at = ${when} where id = ${projectId}`);
const parts = async (sha256: string) => Number((await db.execute<{ n: string }>(sql`select count(*)::text as n from map_content_part p
  join map_content c on c.content_id = p.content_id where c.sha256 = ${sha256}`)).rows[0]!.n);
const rules = async (now: Date, settings = SETTINGS) => Object.fromEntries((await planMapArchive(db, settings, now)).candidates.map(c => [c.sha256, c.rule]));

describe("ADR-0224 L5: arkivet för laserkörningars filer", () => {
  it("ersatt efter ett dygn, vilande efter tre; pågående och nyss klara rörs inte; frist, återhämtning och städning", async () => {
    const store = memoryArchiveStore();
    setMapArchiveStore(store);
    const target = await project("Arkiv");
    await opened(target.projectId, at(0));
    const old = await run(target, 1, at(-30)), latest = await run(target, 2, at(-2)), running = await run(target, 3, null, "RUNNING");
    // Två timmar efter den nya körningen: ingenting (den gamla är ersatt sedan två timmar, inte ett dygn).
    expect(await rules(at(0))).toEqual({});
    // Ett dygn efter den nya körningen flyttas den ersatta; den senaste och den pågående ligger kvar.
    expect(await rules(at(23))).toEqual({ [old.sha256]: "SUPERSEDED" });
    // Bara logg: ingenting laddas upp.
    expect(await runMapArchive(db, store, { ...SETTINGS, mode: "log" }, at(23))).toMatchObject({ planned: { count: 1, rules: { SUPERSEDED: 1 } }, uploaded: 0 });
    expect(store.objects.size).toBe(0);
    const first = await runMapArchive(db, store, SETTINGS, at(23));
    expect(first).toMatchObject({ uploaded: 1, cooled: 0, failed: 0 });
    expect(store.objects.get(old.sha256)?.byteLength).toBe(3000);
    expect(await parts(old.sha256)).toBe(1);
    // Efter fristen (ett dygn) tas delarna bort här; ingen ny uppladdning.
    const second = await runMapArchive(db, store, SETTINGS, at(48));
    expect(second).toMatchObject({ uploaded: 0, cooled: 1, freedBytes: 3000 });
    expect(await parts(old.sha256)).toBe(0);
    // Läsningen hämtar tillbaka, och det hämtade räknas inte längre som ersatt.
    expect((await readMapContent(db, old.sha256))?.equals(Buffer.from(bytesOf(1)))).toBe(true);
    expect(await parts(old.sha256)).toBe(1);
    await db.execute(sql`update map_content_archive set restored_at = ${at(48)} where sha256 = ${old.sha256}`);
    expect(await rules(at(60))).toEqual({});
    // Projektet oöppnat i tre dygn: allt klart flyttas (det redan uppladdade behöver ingen ny uppladdning), det pågående aldrig.
    expect(await rules(at(73))).toEqual({ [old.sha256]: "IDLE", [latest.sha256]: "IDLE" });
    const third = await runMapArchive(db, store, { ...SETTINGS, graceHours: 0 }, at(73));
    expect(third).toMatchObject({ uploaded: 1, cooled: 2 });
    expect(await parts(running.sha256)).toBe(1);
    // Strömmad läsning hämtar också tillbaka.
    const [content] = (await db.execute<{ content_id: string }>(sql`select content_id from map_content where sha256 = ${latest.sha256}`)).rows;
    let total = 0;
    for await (const part of streamMapContentParts(db, content!.content_id)) total += part.byteLength;
    expect(total).toBe(3000);
    // Körningen tas bort: innehållet släpps, objektet ligger kvar i arkivet tills backupens tid har gått.
    await db.execute(sql`delete from map_project_geo_job where id = ${old.jobId}`);
    expect((await db.execute(sql`select 1 from map_content where sha256 = ${old.sha256}`)).rows).toHaveLength(0);
    await runMapArchive(db, store, SETTINGS, at(80));
    expect(store.objects.has(old.sha256)).toBe(true);
    expect(await runMapArchive(db, store, SETTINGS, at(80 + 36 * 24))).toMatchObject({ orphansRemoved: 1 });
    expect(store.objects.has(old.sha256)).toBe(false);
  });

  it("tryck: kontots laserfiler över gränsen flyttas direkt, äldst först, men inte i ett projekt som nyss öppnats", async () => {
    const store = memoryArchiveStore();
    setMapArchiveStore(store);
    const heavy = await project("Mycket"), active = await project("Aktivt");
    await opened(heavy.projectId, at(-5));
    await opened(active.projectId, at(-1));
    const a = await run(heavy, 11, at(-20)), b = await run({ ...heavy, projectId: heavy.projectId }, 12, at(-10));
    const c = await run(active, 13, at(-20), "DONE", 9000);
    const settings = { ...SETTINGS, accountHotBytes: 4000, supersededHours: 1000 };
    // 6000 byte mot gränsen 4000: den äldsta räcker. Det aktiva projektets konto är också över, men öppnades för en timme sedan.
    expect(await rules(at(0), settings)).toEqual({ [a.sha256]: "PRESSURE" });
    const result = await runMapArchive(db, store, settings, at(0));
    expect(result).toMatchObject({ uploaded: 1, cooled: 1, freedBytes: 3000 });
    expect(await parts(a.sha256)).toBe(0);
    expect(await parts(b.sha256)).toBe(1);
    expect(await parts(c.sha256)).toBeGreaterThan(0);
    // Gränsen för hela servern tar det aktiva projektets fil när det inte öppnats på tre timmar.
    expect(await rules(at(3), { ...settings, accountHotBytes: null, totalHotBytes: 5000 })).toMatchObject({ [c.sha256]: "PRESSURE" });
  });

  it("en kopia som inte stämmer stoppar flytten, och innehåll som något annat pekar på flyttas aldrig", async () => {
    const store = memoryArchiveStore();
    const broken = { ...store, get: async (sha256: string) => { const bytes = await store.get(sha256); return bytes ? Buffer.concat([bytes.subarray(1), Buffer.from([0])]) : undefined; } };
    const target = await project("Trasigt");
    await opened(target.projectId, at(-100));
    const only = await run(target, 21, at(-100));
    const result = await runMapArchive(db, broken, { ...SETTINGS, graceHours: 0 }, at(0));
    expect(result).toMatchObject({ uploaded: 0, cooled: 0 });
    expect(result.failed).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("stämmer inte");
    expect(await parts(only.sha256)).toBe(1);
    // Projektets grundfil (som bara kartprojektet pekar på) står aldrig i planen.
    const [base] = (await db.execute<{ base_sha256: string }>(sql`select base_sha256 from map_project where id = ${target.projectId}`)).rows;
    expect((await planMapArchive(db, { ...SETTINGS, minBytes: 1 }, at(1000))).candidates.map(c => c.sha256)).not.toContain(base!.base_sha256);
    // Utan arkiv inställt ger läsningen av arkiverat innehåll ett tydligt fel.
    await runMapArchive(db, store, { ...SETTINGS, graceHours: 0 }, at(0));
    expect(await parts(only.sha256)).toBe(0);
    setMapArchiveStore(null);
    await expect(readMapContent(db, only.sha256)).rejects.toThrow("arkivet är inte inställt");
    setMapArchiveStore(store);
    expect((await readMapContent(db, only.sha256))?.byteLength).toBe(3000);
  });
});
