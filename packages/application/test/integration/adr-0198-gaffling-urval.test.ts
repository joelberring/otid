import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { raceSnapshotSchema } from "@o-tid/contracts";
import { allCourseVariants, applyEdit, readPpen } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { applySyncAsAdmin } from "../../src/source-sync";
import { importCourseSettingAsAdmin, previewCourseSettingTransferAsAdmin } from "../../src/course-setting";
import { loadRaceSnapshot } from "../../src/snapshot";
import { accountOnRace } from "./accounts";

/**
 * ADR-0198 (migration 0064): bortvalda varianter förs inte över som varianter; de följer med banversionen i
 * `course_version.excluded_variants` och ögonblicksbilden (avläsningens besked). En ny överföring med andra bortval ger en
 * ny banversion med bara de behållna.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0198_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixture = new URL("../../../../fixtures/course-setting/gaffling-urval.ppen", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0198_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race() {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `urval.${suffix}@test.o-tid.se`, displayName: "Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Stockholm by Night", raceName: "Natt", raceDate: "2026-12-09",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

type Proof = Awaited<ReturnType<typeof race>>;

async function transfer(proof: Proof, version: number) {
  const preview = await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version } });
  if (preview.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${preview.status}`);
  const requestId = randomUUID();
  const applied = await applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId,
    snapshotId: preview.response.snapshotId, excludedRowIds: [], confirmResultChanges: true } });
  expect(applied.status).toBe("saved");
}

describe("ADR-0198: bortvalda varianter i tävlingen", () => {
  it("bara behållna blir varianter; de bortvalda följer med banversionen och ögonblicksbilden", async () => {
    const proof = await race();
    const ppen = await readFile(fixture, "utf8");
    const original = readPpen(ppen).document;
    const natt = original.courses.find(course => course.name === "Natt")!.id;
    const exclude = (codes: readonly string[]) => applyEdit(original, { type: "UPDATE_COURSE", course: natt, changes: {
      excludedVariants: allCourseVariants(original, natt).filter(row => codes.includes(row.code)).map(row => ({ code: row.code, controls: [...row.controlCodes] })) } }).document;

    expect((await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document: original,
      fileName: "gaffling-urval.ppen", ppen } })).status).toBe("ok");
    await transfer(proof, 1);
    const variantsOf = async () => (await pool.query<{ version: number; code: string; excluded: unknown }>(`select v.version, cv.code,
      v.excluded_variants as excluded from course_variant cv join course_version v on v.id = cv.course_version_id join course c on c.id = v.course_id
      where c.race_id = $1 and c.name = 'Natt' and v.version = (select max(version) from course_version where course_id = c.id) order by cv.sequence`,
    [proof.raceId])).rows;
    let rows = await variantsOf();
    expect(rows.map(row => row.code)).toEqual(["ACE", "ACF", "ADE", "ADF", "BCE", "BCF", "BDE", "BDF"]);
    expect(rows[0]!.excluded).toBeNull();

    // Banläggaren väljer bort fyra; en ny överföring ger version 2 med fyra varianter och de bortvalda i banversionen.
    expect((await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 1,
      document: exclude(["ADF", "BCF", "BDE", "BDF"]), fileName: "gaffling-urval.ppen", ppen } })).status).toBe("ok");
    await transfer(proof, 2);
    rows = await variantsOf();
    expect(rows.map(row => [row.version, row.code])).toEqual([[2, "ACE"], [2, "ACF"], [2, "ADE"], [2, "BCE"]]);
    const excluded = rows[0]!.excluded as { code: string; controlCodes: number[] }[];
    expect(excluded.map(row => row.code)).toEqual(["ADF", "BCF", "BDE", "BDF"]);
    expect(excluded.find(row => row.code === "BDF")!.controlCodes).toEqual([31, 42, 32, 44, 33, 46, 34]);

    const snapshot = await loadRaceSnapshot(db, proof.raceId);
    const version = snapshot.courses.find(course => course.name === "Natt")!.versions.at(-1)!;
    expect(version.variants!.map(variant => variant.code)).toEqual(["ACE", "ACF", "ADE", "BCE"]);
    expect(version.excludedVariants!.map(variant => variant.code)).toEqual(["ADF", "BCF", "BDE", "BDF"]);
    // Avläsningens paket godtar fältet.
    expect(() => raceSnapshotSchema.parse(snapshot)).not.toThrow();
    const kort = snapshot.courses.find(course => course.name === "Kort")!.versions.at(-1)!;
    expect(kort.excludedVariants).toBeUndefined();
  }, 120_000);
});
