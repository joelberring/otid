import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createClub, readClub } from "../../src/clubs";
import { uploadClubMapVersion } from "../../src/club-maps";
import { clubStorageUsage, mapStorageUsage, storeMapContent } from "../../src/map-content";
import { performSuperadminAction, readSuperadminOverview, setSuperadmin } from "../../src/superadmin";
import { loginUserAccount } from "../../src/user-account";
import { registerTestAccount } from "./accounts";

/**
 * PLAN.md steg M7: klubbarkivet räknas mot klubben, inte mot den som laddade upp. Kopior räknas inte dubbelt (samma sha256),
 * ändringar räknas mot kontot, klubbens gräns (förval 2 048 MB, superadmin ändrar) stoppar nytt i arkivet, och
 * ledare och uppåt ser lagringen med besked vid 80 %.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_m7_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-22T10:00:00Z");
const MB = 1024 * 1024;

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_m7_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const omap = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
/** En Mapper-fil med fyllnad på slutet: formatet känns igen på början, storleken och innehållet styrs här. */
function mapOf(bytes: number, seed: number): Uint8Array {
  const out = new Uint8Array(bytes).fill(32);
  out.set(omap.subarray(0, Math.min(omap.byteLength, bytes)));
  out[bytes - 1] = 48 + seed;
  return out;
}
async function* chunks(bytes: Uint8Array) { for (let at = 0; at < bytes.byteLength; at += 64 * 1024) yield bytes.subarray(at, at + 64 * 1024); }

async function clubWithOwner() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createClub(db, { ...owner.proof, request: { formatVersion: 1, requestId: randomUUID(), name: `Klubben ${randomUUID().slice(0, 6)}` } }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { owner, clubId: created.club.clubId };
}
const upload = (proof: { sessionToken: string; csrfCookie: string; csrfHeader: string }, clubId: string, bytes: Uint8Array, name: string) =>
  uploadClubMapVersion(db, { ...proof, clubId, mapId: null, newMapName: name, fileName: `${name}.omap`, versionDate: null, note: null,
    body: chunks(bytes) }, NOW);

describe("PLAN.md steg M7: klubbens kvot", () => {
  it("klubbarkivet räknas mot klubben; en kopia kostar kontot ingenting, en ändring räknas mot kontot", async () => {
    const { owner, clubId } = await clubWithOwner();
    const map = mapOf(MB, 1);
    expect(await upload(owner.proof, clubId, map, "Skogen")).toMatchObject({ status: "created" });
    expect((await clubStorageUsage(db, clubId)).mapBytes).toBe(MB);
    expect((await mapStorageUsage(db, owner.accountId)).accountBytes).toBe(0);

    // En kopia ur arkivet (samma innehåll) i ett eget projekt: sparas inte igen och räknas inte mot kontot.
    expect(await db.transaction(tx => storeMapContent(tx, map, owner.accountId, NOW))).toMatchObject({ status: "stored" });
    expect((await mapStorageUsage(db, owner.accountId)).accountBytes).toBe(0);
    // En ändring i kopian är nytt innehåll och räknas mot kontot.
    await db.transaction(tx => storeMapContent(tx, mapOf(MB / 2, 2), owner.accountId, NOW));
    expect((await mapStorageUsage(db, owner.accountId)).accountBytes).toBe(MB / 2);
    expect((await clubStorageUsage(db, clubId)).mapBytes).toBe(MB);
    // Installationens totala användning omfattar båda.
    expect((await mapStorageUsage(db, null)).totalBytes).toBeGreaterThanOrEqual(MB + MB / 2);
  });

  it("eget material som läggs i arkivet byter till klubben", async () => {
    const { owner, clubId } = await clubWithOwner();
    const map = mapOf(MB, 3);
    await db.transaction(tx => storeMapContent(tx, map, owner.accountId, NOW));
    expect((await mapStorageUsage(db, owner.accountId)).accountBytes).toBe(MB);
    expect(await upload(owner.proof, clubId, map, "Ängen")).toMatchObject({ status: "created" });
    expect((await mapStorageUsage(db, owner.accountId)).accountBytes).toBe(0);
    expect((await clubStorageUsage(db, clubId)).mapBytes).toBe(MB);
  });

  it("vid klubbens tak kan inget nytt läggas i arkivet förrän superadmin höjt; besked vid 80 % på klubbsidan", async () => {
    const { owner, clubId } = await clubWithOwner();
    await db.execute(sql`update club set map_quota_mb = 2 where id = ${clubId}::uuid`);
    expect(await upload(owner.proof, clubId, mapOf(MB, 4), "Första")).toMatchObject({ status: "created" });
    let view = await readClub(db, { ...owner.proof, clubId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.storage).toMatchObject({ usedBytes: MB, limitBytes: 2 * MB, warning: false, full: false });
    expect(await upload(owner.proof, clubId, mapOf(Math.floor(MB * 0.7), 5), "Andra")).toMatchObject({ status: "created" });
    view = await readClub(db, { ...owner.proof, clubId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.storage).toMatchObject({ warning: true, full: false });
    expect(view.view.storage?.maps.map(map => map.name)).toEqual(["Första", "Andra"]);

    const refused = await upload(owner.proof, clubId, mapOf(MB, 6), "Tredje");
    expect(refused).toMatchObject({ status: "quota", quota: { scope: "CLUB", limitBytes: 2 * MB } });
    // Kontots egen gräns påverkas inte: kontot kan fortfarande spara eget material.
    expect(await db.transaction(tx => storeMapContent(tx, mapOf(MB, 7), owner.accountId, NOW))).toMatchObject({ status: "stored" });

    // Superadmin höjer klubbens gräns; sedan går det.
    const boss = await registerTestAccount(db, `super.${randomUUID().slice(0, 8)}`, NOW);
    await setSuperadmin(db, { email: boss.email, superadmin: true });
    const login = await loginUserAccount(db, { formatVersion: 1, email: boss.email, password: boss.password });
    if (login.status !== "authenticated") throw new Error(login.status);
    const proof = { sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_CLUB_LIMITS", clubId, reason: "Stort arkiv",
      mapQuotaMb: 10 })).toEqual({ status: "done", action: "SET_CLUB_LIMITS" });
    const overview = await readSuperadminOverview(db, proof, {}, new Date());
    if (overview.status !== "ok") throw new Error(overview.status);
    expect(overview.response.limits.defaultClubMapQuotaMb).toBe(2048);
    expect(overview.response.limits.clubs.find(club => club.clubId === clubId)).toMatchObject({ mapQuotaMb: 10, limitBytes: 10 * MB,
      usedBytes: MB + Math.floor(MB * 0.7) });
    expect(overview.response.log[0]).toMatchObject({ action: "SET_CLUB_LIMITS", targetType: "CLUB" });
    expect(await upload(owner.proof, clubId, mapOf(MB, 6), "Tredje")).toMatchObject({ status: "created" });

    // Tomt = förvalet.
    expect(await performSuperadminAction(db, proof, { formatVersion: 1, action: "SET_CLUB_LIMITS", clubId, reason: "Tillbaka",
      mapQuotaMb: null })).toEqual({ status: "done", action: "SET_CLUB_LIMITS" });
    view = await readClub(db, { ...owner.proof, clubId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view.storage?.limitBytes).toBe(2048 * MB);
  });
});
