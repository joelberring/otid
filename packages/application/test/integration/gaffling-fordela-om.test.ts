import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { distributeClassVariantsAsAdmin, previewClassVariantRebalanceAsAdmin } from "../../src/course-variant-assignment";
import { listCoursesForEditAsAdmin } from "../../src/course-edit";
import { entryIds, forkedRace, readout } from "./anvandartest-block1-fixtures";

/**
 * Fel 2026-11-22: "Fördela om jämnt". En klass med ojämn fördelning vid gafflingspunkterna får beskedet med namn före och
 * efter; sparandet byter exakt de löparna, avlästa behåller sin variant, och en ändrad tävling ger konflikt.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_fordelaom_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_fordelaom_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function variants(classId: string): Promise<Record<string, string>> {
  const rows = (await pool.query<{ given_name: string; course_variant_code: string }>(
    "select given_name, course_variant_code from entry where class_id = $1 and struck_at is null", [classId])).rows;
  return Object.fromEntries(rows.map(row => [row.given_name, row.course_variant_code]));
}

describe("Fördela om jämnt", () => {
  it("visar vilka som byter, byter dem, rör inte avlästa och kräver samma version", async () => {
    const { proof, classes } = await forkedRace(db, pool);
    const people = await entryIds(pool, proof.raceId);
    // Alla sex i H21 springer A-slingan först: första gafflingen blir 6–0.
    const uneven: Record<string, string> = { Cia: "AD", Dan: "AC", Eva: "AC", Fia: "AD", Ada: "AC", Bo: "AD" };
    for (const [name, code] of Object.entries(uneven)) {
      await pool.query("update entry set course_variant_code = $1 where id = $2", [code, people[name]]);
    }
    await pool.query("update race set snapshot_version = snapshot_version + 1 where id = $1", [proof.raceId]);
    await readout(db, pool, proof, "8101003", "AD"); // Cia är avläst och behåller AD.

    const listed = await listCoursesForEditAsAdmin(db, proof);
    if (listed.status !== "ok") throw new Error("Banorna saknas");
    expect(listed.response.courses.find(course => course.name === "Lång")?.readiness?.uneven.length).toBeGreaterThan(0);

    const preview = await previewClassVariantRebalanceAsAdmin(db, { ...proof, classId: classes.H21 });
    if (preview.status !== "ok") throw new Error(`Beskedet saknas: ${preview.status}`);
    const changes = preview.response.changes;
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.length).toBeLessThanOrEqual(4);
    expect(changes.some(change => change.entryId === people.Cia)).toBe(false);
    for (const change of changes) expect(uneven[change.name.split(" ")[0]!]).toBe(change.from);

    // En annan ändring under tiden: konflikt, inget byts.
    const stale = randomUUID();
    await pool.query("update race set snapshot_version = snapshot_version + 1 where id = $1", [proof.raceId]);
    expect((await distributeClassVariantsAsAdmin(db, { ...proof, idempotencyKey: `variant-distribution:${stale}`, request: {
      formatVersion: 1, requestId: stale, classId: classes.H21, rebalance: { expectedSnapshotVersion: preview.response.snapshotVersion } } }))
      .status).toBe("conflict");
    expect(await variants(classes.H21)).toEqual(uneven);

    const fresh = await previewClassVariantRebalanceAsAdmin(db, { ...proof, classId: classes.H21 });
    if (fresh.status !== "ok") throw new Error("Beskedet saknas");
    const requestId = randomUUID();
    const saved = await distributeClassVariantsAsAdmin(db, { ...proof, idempotencyKey: `variant-distribution:${requestId}`, request: {
      formatVersion: 1, requestId, classId: classes.H21, rebalance: { expectedSnapshotVersion: fresh.response.snapshotVersion } } });
    if (saved.status !== "distributed") throw new Error(`Inte sparat: ${saved.status}`);
    expect(saved.response.assignedCount).toBe(fresh.response.changes.length);
    const after = await variants(classes.H21);
    expect(after.Cia).toBe("AD");
    for (const change of fresh.response.changes) expect(after[change.name.split(" ")[0]!]).toBe(change.to);
    const firstLoopA = Object.values(after).filter(code => code[0] === "A").length;
    const secondLoopC = Object.values(after).filter(code => code[1] === "C").length;
    expect(firstLoopA).toBe(3);
    expect(secondLoopC).toBe(3);

    const relisted = await listCoursesForEditAsAdmin(db, proof);
    if (relisted.status !== "ok") throw new Error("Banorna saknas");
    expect(relisted.response.courses.find(course => course.name === "Lång")?.readiness?.uneven).toEqual([]);
    // Nu finns inget mer att jämna ut.
    const nothing = await previewClassVariantRebalanceAsAdmin(db, { ...proof, classId: classes.H21 });
    expect(nothing).toMatchObject({ status: "ok", response: { changes: [] } });
  });
});
