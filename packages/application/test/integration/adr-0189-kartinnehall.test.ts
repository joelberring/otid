import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { createOrganizerEvent } from "../../src/organizer-events";
import { readRaceMapImageAsAdmin, removeRaceMapAsAdmin, saveRaceMapAsAdmin } from "../../src/race-map";
import { readRaceMapSourceFileAsAdmin, saveRaceMapSourceAsAdmin } from "../../src/race-map-source";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { exportRaceAsAdmin } from "../../src/race-export";
import { restoreRaceBackup } from "../../src/race-restore";
import { purgeRows } from "../../src/purge";
import {
  discardStagedMapContent, inlineMapContentRows, MAP_CONTENT_PART_BYTES, mapStorageUsage, moveInlineMapContent, readMapContent,
  stageMapContent, sweepMapContent
} from "../../src/map-content";
import { accountOnRace, registerTestAccount } from "./accounts";

/**
 * ADR-0189 beslut 1–4: kartbilder och kartfiler lagras en gång (sha256) och tävlingar, kopior och återställda tävlingar pekar på
 * samma innehåll; innehållet tas bort med sista referensen; gamla rader läses som förut och flyttas i steg två; kvoten; den
 * strömmade uppladdningen. Kartfilen är syntetisk (fixtures/maps/kartfil.omap).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0189_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);
const NO_QUOTA = { accountBytes: null, totalBytes: null };

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0189_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race(owner?: Awaited<ReturnType<typeof registerTestAccount>>) {
  const account = owner ?? await registerTestAccount(db);
  const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Kartlagret", raceName: "Torsdag", raceDate: "2026-10-29",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...account.proof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { account, eventId: created.response.eventId, proof: { raceId: created.response.raceId, sessionToken: entered.sessionToken,
    csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken } };
}

function png(width: number, height: number, salt = 0): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  bytes[63] = salt;
  return bytes;
}

const metadata = (): RaceMapSourceMetadata => ({ formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null, render: { pxPerMm: 8, originX: -2, originY: 102 },
  summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null });

const counts = async () => (await pool.query<{ contents: number; parts: number }>(`select (select count(*)::int from map_content) as contents,
  (select count(*)::int from map_content_part) as parts`)).rows[0]!;

async function* chunksOf(bytes: Uint8Array, size: number) {
  for (let offset = 0; offset < bytes.byteLength; offset += size) yield bytes.subarray(offset, offset + size);
}

describe("ADR-0189: kartinnehållet lagras en gång", () => {
  it("en kopia och en återställd tävling pekar på samma innehåll, som tas bort med sista referensen", async () => {
    const source = await race();
    const omap = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
    const image = png(992, 832);
    expect(await saveRaceMapSourceAsAdmin(db, { ...source.proof, file: omap, fileName: "kartfil.omap", image, metadata: metadata(),
      quota: NO_QUOTA })).toEqual({ status: "ok", georeferenced: false });
    const after = await counts();
    expect(after.contents).toBe(2);
    const columns = (await pool.query<{ moved: boolean }>(`select (image is null) as moved from race_map where race_id = $1`,
      [source.proof.raceId])).rows[0];
    expect(columns?.moved).toBe(true);

    // Kopian (som ett träningstillfälle) får ingen ny kartfil.
    const copied = await copyRaceAsAdmin(db, { ...source.account.proof, raceId: source.proof.raceId, request: { formatVersion: 1,
      requestId: randomUUID(), eventName: "Kopia", raceName: "Torsdag", raceDate: "2026-11-05", includePeople: false } });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    expect(await counts()).toEqual(after);
    const copyProof = await accountOnRace(db, { ...source.account.proof, raceId: copied.response.raceId });
    if (copyProof.status !== "authenticated") throw new Error("Kom inte in i kopian");
    const copy = { raceId: copied.response.raceId, sessionToken: copyProof.sessionToken, csrfCookie: copyProof.csrfToken,
      csrfHeader: copyProof.csrfToken };
    const file = await readRaceMapSourceFileAsAdmin(db, copy);
    expect(file.status === "ok" && Buffer.compare(file.file, Buffer.from(omap))).toBe(0);

    // Säkerhetskopian har filen som förut; återställningen lagrar den inte igen.
    const exported = await exportRaceAsAdmin(db, source.proof);
    if (exported.status !== "ok") throw new Error("Ingen säkerhetskopia");
    expect(exported.manifest.files.map(entry => entry.bytes).sort((a, b) => a - b)).toEqual([image.byteLength, omap.byteLength].sort((a, b) => a - b));
    const restorer = await registerTestAccount(db);
    const restored = await restoreRaceBackup(db, { ...restorer.proof, bytes: exported.bytes, options: { requestId: randomUUID(), people: "skip" },
      quota: NO_QUOTA });
    if (restored.status !== "restored") throw new Error(`Återställningen misslyckades: ${JSON.stringify(restored)}`);
    expect(await counts()).toEqual(after);
    expect((await pool.query(`select m.image is null and m.content_sha256 is not null and s.file is null and s.content_sha256 is not null as stored
      from race_map_source s join race_map m using (race_id)
      where race_id = $1`, [restored.response.raceId])).rows).toEqual([{ stored: true }]);

    // Borttagning: kvar så länge någon pekar på innehållet.
    expect(await removeRaceMapAsAdmin(db, source.proof)).toEqual({ status: "ok" });
    expect(await counts()).toEqual(after);
    await db.transaction(async tx => purgeRows(tx, "event", [copied.response.eventId]));
    expect(await counts()).toEqual(after);
    await db.transaction(async tx => purgeRows(tx, "event", [restored.response.eventId]));
    expect(await counts()).toEqual({ contents: 0, parts: 0 });
  });

  it("gamla rader läses som förut och flyttas i steg två; dubbletter blir ett innehåll", async () => {
    const first = await race(), second = await race();
    const bytes = new Uint8Array(MAP_CONTENT_PART_BYTES * 2 + 17).map((_, index) => index % 251);
    bytes.set(png(10, 10), 0);
    for (const proof of [first.proof, second.proof]) {
      // Som den gamla versionen skrev: bilden i kolumnen.
      await pool.query(`insert into race_map (race_id, file_name, media_type, image, sha256, byte_length, width, height, uploaded_at)
        values ($1, 'gammal.png', 'image/png', $2, encode(sha256($2), 'hex'), $3, 10, 10, now())`, [proof.raceId, Buffer.from(bytes), bytes.byteLength]);
    }
    const before = await counts();
    const read = await readRaceMapImageAsAdmin(db, first.proof);
    expect(read.status === "ok" && Buffer.compare(read.image, Buffer.from(bytes))).toBe(0);
    expect(await inlineMapContentRows(db)).toBe(2);

    expect(await moveInlineMapContent(db)).toMatchObject({ race_map: 2 });
    expect(await inlineMapContentRows(db)).toBe(0);
    expect(await counts()).toEqual({ contents: before.contents + 1, parts: before.parts + 3 });
    for (const proof of [first.proof, second.proof]) {
      const moved = await readRaceMapImageAsAdmin(db, proof);
      expect(moved.status === "ok" && Buffer.compare(moved.image, Buffer.from(bytes))).toBe(0);
    }
    // Omkörning gör ingenting.
    expect(await moveInlineMapContent(db)).toMatchObject({ race_map: 0 });
  });

  it("kvoten per konto och installation; samma innehåll kostar ingenting", async () => {
    const owner = await race(), other = await race();
    const image = png(20, 20, 7);
    const quota = { accountBytes: 100, totalBytes: null };
    expect(await saveRaceMapAsAdmin(db, { ...owner.proof, bytes: image, fileName: "a.png", quota })).toEqual({ status: "ok" });
    const second = png(20, 20, 8);
    expect(await saveRaceMapAsAdmin(db, { ...owner.proof, bytes: second, fileName: "b.png", quota })).toEqual({ status: "problem",
      problem: "STORAGE_QUOTA_EXCEEDED", quota: { scope: "ACCOUNT", usedBytes: 64, limitBytes: 100, neededBytes: 64 } });
    // Samma bild som redan finns: ingen ny kostnad, inte ens för ett annat konto.
    expect(await saveRaceMapAsAdmin(db, { ...other.proof, bytes: image, fileName: "a.png", quota: { accountBytes: 1, totalBytes: 1 } }))
      .toEqual({ status: "ok" });
    const total = (await mapStorageUsage(db, null)).totalBytes;
    const installation = await saveRaceMapAsAdmin(db, { ...other.proof, bytes: second, fileName: "b.png",
      quota: { accountBytes: null, totalBytes: total + 10 } });
    expect(installation).toMatchObject({ status: "problem", problem: "STORAGE_QUOTA_EXCEEDED", quota: { scope: "INSTALLATION" } });
    // Kontot som byter bild får tillbaka utrymmet när den gamla inte längre används.
    expect(await saveRaceMapAsAdmin(db, { ...owner.proof, bytes: second, fileName: "b.png", quota: { accountBytes: 200, totalBytes: null } }))
      .toEqual({ status: "ok" });
  });

  it("den strömmade uppladdningen skrivs i delar, avbryts över gränsen och städas", async () => {
    const owner = await race();
    const bytes = new Uint8Array(MAP_CONTENT_PART_BYTES + 500).map((_, index) => (index * 7) % 256);
    bytes.set(png(30, 30), 0);
    const staged = await stageMapContent(db, chunksOf(bytes, 64 * 1024), { maxBytes: bytes.byteLength });
    if (staged.kind !== "staged") throw new Error("Uppladdningen strömmades inte");
    expect(staged.byteLength).toBe(bytes.byteLength);
    expect((await pool.query<{ n: number }>("select count(*)::int as n from map_content_part where content_id = $1", [staged.contentId])).rows[0]?.n).toBe(2);
    expect(await saveRaceMapAsAdmin(db, { ...owner.proof, bytes: staged, fileName: "strom.png", quota: NO_QUOTA })).toEqual({ status: "ok" });
    await discardStagedMapContent(db, staged.contentId);
    expect(Buffer.compare((await readMapContent(db, staged.sha256))!, Buffer.from(bytes))).toBe(0);

    // Samma fil igen: de nya delarna tas bort, innehållet finns redan.
    const again = await stageMapContent(db, chunksOf(bytes, 300_000), { maxBytes: bytes.byteLength });
    if (again.kind !== "staged") throw new Error("Uppladdningen strömmades inte");
    expect(await saveRaceMapAsAdmin(db, { ...owner.proof, bytes: again, fileName: "strom.png", quota: NO_QUOTA })).toEqual({ status: "ok" });
    expect((await pool.query<{ n: number }>("select count(*)::int as n from map_content_part where content_id = $1", [again.contentId])).rows[0]?.n).toBe(0);

    // För stor: inget blir kvar.
    const before = await counts();
    expect(await stageMapContent(db, chunksOf(bytes, 64 * 1024), { maxBytes: MAP_CONTENT_PART_BYTES })).toEqual({ kind: "too-large" });
    expect(await counts()).toEqual(before);

    // En avbruten uppladdning (inget innehåll) tas bort av underhållet efter ett dygn.
    const orphan = await stageMapContent(db, chunksOf(bytes, 64 * 1024), { maxBytes: bytes.byteLength, now: new Date("2026-01-01T00:00:00Z") });
    if (orphan.kind !== "staged") throw new Error("Uppladdningen strömmades inte");
    const swept = await db.transaction(tx => sweepMapContent(tx, new Date()));
    expect(swept.parts).toBe(2);
    expect(await counts()).toEqual(before);
  });
});
