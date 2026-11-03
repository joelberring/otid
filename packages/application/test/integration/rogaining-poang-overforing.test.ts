import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { applyEdit, readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { applySyncAsAdmin } from "../../src/source-sync";
import { importCourseSettingAsAdmin, previewCourseSettingTransferAsAdmin, saveCourseSettingAsAdmin } from "../../src/course-setting";
import { loadRaceSnapshot } from "../../src/snapshot";
import { accountOnRace } from "./accounts";

/**
 * Rogaining (ägaren 2026-11-03): poängen sätts i banläggningen och följer med "Överför till tävlingen". Ett tomt poängfält är
 * kodens tiotal, samma förval som tävlingen, så då ändras inget. Ändrade poäng är egna rader i granskningen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_rogpoang_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixture = new URL("../../../../fixtures/course-setting/kartfil.ppen", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_rogpoang_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race(raceType: "ROGAINING" | "STANDARD") {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `poang.${suffix}@test.o-tid.se`, displayName: "Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Poängjakt", raceName: "Kväll", raceDate: "2026-12-09",
      timeZone: "Europe/Stockholm", raceType }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}
type Proof = Awaited<ReturnType<typeof race>>;

/** Fixturens banor och en poängbana med 33, 35 och 37; 33 får 8 poäng, de andra förvalet. */
async function scoreDocument(): Promise<{ document: CourseSettingDocument; ppen: string; course: string; at: (code: string) => string }> {
  const ppen = await readFile(fixture, "utf8");
  let document = readPpen(ppen).document;
  const step = (edit: Parameters<typeof applyEdit>[1]) => { const result = applyEdit(document, edit); document = result.document; return result.created!; };
  const course = step({ type: "ADD_COURSE", name: "Poäng", kind: "SCORE" });
  const byCode = (code: string) => Object.values(document.controls).find(control => control.code === code)!.id;
  const placed = new Map<string, string>();
  for (const code of ["33", "35", "37"]) placed.set(code, step({ type: "INSERT_COURSE_CONTROL", course, control: byCode(code) }));
  step({ type: "SET_POINTS", course, courseControl: placed.get("33")!, points: 8 });
  return { document, ppen, course, at: code => placed.get(code)! };
}

async function preview(proof: Proof, version: number) {
  const result = await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version } });
  if (result.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${result.status}`);
  return result.response;
}

async function apply(proof: Proof, snapshotId: string) {
  const requestId = randomUUID();
  const applied = await applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId,
    snapshotId, excludedRowIds: [], confirmResultChanges: true } });
  expect(applied.status).toBe("saved");
}

const storedPoints = async (raceId: string) => Object.fromEntries((await pool.query<{ code: number; points: number | null }>(
  "select code, points from control where race_id = $1 and code in (33, 35, 37) order by code", [raceId])).rows.map(row => [row.code, row.points]));

describe("rogaining: poängen ur banläggningen", () => {
  it("följer med vid Överför till tävlingen, som egna rader; förvalet sparas som inget", { timeout: 120_000 }, async () => {
    const proof = await race("ROGAINING");
    const { document, ppen, course, at } = await scoreDocument();
    expect((await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document,
      fileName: "kartfil.ppen", ppen } })).status).toBe("ok");

    const first = await preview(proof, 1);
    const pointRows = first.rows.filter(row => row.subject === "CONTROL");
    // Bara 33 skiljer från förvalet (3); 35 och 37 har kodens tiotal i båda.
    expect(pointRows.map(row => [row.label, row.changes])).toEqual([["33", [{ field: "POINTS", from: "3", to: "8" }]]]);
    await apply(proof, first.snapshotId);
    expect(await storedPoints(proof.raceId)).toEqual({ 33: 8, 35: null, 37: null });
    // Ögonblicksbilden (avläsningens bedömning) har poängen.
    const snapshot = await loadRaceSnapshot(db, proof.raceId);
    const controls = snapshot.courses.find(row => row.name === "Poäng")!.versions.at(-1)!.controls;
    expect(controls.find(control => control.controlCode === 33)!.points).toBe(8);

    // Banläggaren ändrar: 33 tillbaka till förvalet, 37 får 12. En ny överföring ger två poängrader.
    const changed = applyEdit(applyEdit(document, { type: "SET_POINTS", course, courseControl: at("33"), points: null }).document,
      { type: "SET_POINTS", course, courseControl: at("37"), points: 12 }).document;
    expect((await saveCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 1, document: changed } })).status).toBe("ok");
    const second = await preview(proof, 2);
    expect(second.rows.filter(row => row.subject === "CONTROL").map(row => [row.label, row.changes[0]])).toEqual([
      ["33", { field: "POINTS", from: "8", to: "3" }], ["37", { field: "POINTS", from: "3", to: "12" }]]);
    await apply(proof, second.snapshotId);
    expect(await storedPoints(proof.raceId)).toEqual({ 33: null, 35: null, 37: 12 });
  });

  it("i en vanlig tävling följer inga poäng med", { timeout: 120_000 }, async () => {
    const proof = await race("STANDARD");
    const { document, ppen } = await scoreDocument();
    expect((await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document,
      fileName: "kartfil.ppen", ppen } })).status).toBe("ok");
    const result = await preview(proof, 1);
    expect(result.rows.some(row => row.subject === "CONTROL")).toBe(false);
  });
});
