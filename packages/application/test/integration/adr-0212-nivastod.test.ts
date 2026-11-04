import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { readPpen, writePpen, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importCourseSettingAsAdmin, readCourseSettingAsAdmin } from "../../src/course-setting";
import { saveCourseSettingEditsAsAdmin } from "../../src/course-setting-collaboration";
import { accountOnRace } from "./accounts";

/**
 * ADR-0212: nivåstödets målnivå per bana och valet "Visa avvikelser mot nivån i Varningar" sparas i banläggningens
 * dokument med åtgärderna (ingen migration), läses tillbaka, skrivs inte till .ppen och en okänd nivå avvisas.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Nivåstödets test kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0212_niva_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0212_niva_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race() {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `niva.${suffix}@test.o-tid.se`, displayName: "Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Nivå", raceName: "Ungdom", raceDate: "2026-11-12",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

describe("ADR-0212: nivåstödets inställningar i banläggningen", { timeout: 120_000 }, () => {
  it("målnivån och valet för Varningar sparas, läses tillbaka och skrivs inte till .ppen", async () => {
    const owner = await race();
    const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
    const { document } = readPpen(ppen);
    const imported = await importCourseSettingAsAdmin(db, { ...owner, request: { formatVersion: 1, expectedVersion: 0, document, fileName: "kartfil.ppen", ppen } });
    expect(imported.status).toBe("ok");
    const read = async () => {
      const result = await readCourseSettingAsAdmin(db, owner);
      if (result.status !== "ok" || !result.response.setting) throw new Error("Läget saknas");
      return { version: result.response.setting.version, document: result.response.setting.document as unknown as CourseSettingDocument };
    };
    const start = await read();
    const course = start.document.courses[0]!.id;
    const save = (version: number, edits: readonly unknown[]) => saveCourseSettingEditsAsAdmin(db, { ...owner, request: { formatVersion: 1,
      requestId: randomUUID(), baseVersion: version, edits: edits as CourseSettingEdit[] } });
    expect(await save(start.version, [{ type: "UPDATE_COURSE", course, changes: { level: "GUL" } }, { type: "SET_EVENT", changes: { levelNotices: true } }]))
      .toMatchObject({ status: "ok", response: { applied: 2, rejected: [] } });
    const after = await read();
    expect(after.document.courses.find(row => row.id === course)?.level).toBe("GUL");
    expect(after.document.event.levelNotices).toBe(true);
    // Purple Pen har inget fält för nivån.
    expect(writePpen(after.document)).not.toMatch(/GUL|levelNotices/);
    // En okänd nivå avvisas redan i formen.
    expect((await save(after.version, [{ type: "UPDATE_COURSE", course, changes: { level: "ROSA" } }])).status).toBe("invalid-request");
    expect(await save(after.version, [{ type: "UPDATE_COURSE", course, changes: { level: null } }])).toMatchObject({ status: "ok" });
    expect((await read()).document.courses.find(row => row.id === course)?.level).toBeUndefined();
  });
});
