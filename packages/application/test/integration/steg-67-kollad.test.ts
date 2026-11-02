import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { layoutOverprint, readPpen, writePpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importCourseSettingAsAdmin, previewCourseSettingTransferAsAdmin, readCourseSettingAsAdmin } from "../../src/course-setting";
import { listCourseSettingInspectionsAsAdmin, setCourseSettingInspectionAsAdmin } from "../../src/course-setting-inspections";
import { exportRaceAsAdmin } from "../../src/race-export";
import { readBackup } from "./backup";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { purgeRows } from "../../src/purge";
import { accountOnRace, grantRacePerson, raceAuth, registerTestAccount } from "./accounts";

/**
 * Steg 67 (ADR-0181 beslut 6): "kollad" per kontroll – sparad utanför dokumentet, så att den som läser och kommenterar
 * får bocka och dokumentet (version, .ppen, banpåtryck, överföringen) är orört; den senaste bocken vinner också när en
 * äldre kommer fram senare (kön utan nät); export ja, kopia nej, borttagen tävling tar bockarna med sig.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Kollad-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg67_kollad_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_steg67_kollad_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof & { eventId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `kollad.${suffix}@test.o-tid.se`, displayName: "Bea Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Kollad", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const [row] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, created.response.raceId));
  const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
  const imported = await importCourseSettingAsAdmin(db, { raceId: created.response.raceId, sessionToken: entered.sessionToken,
    csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken,
    request: { formatVersion: 1, expectedVersion: 0, document: readPpen(ppen).document, fileName: "kartfil.ppen", ppen } });
  if (imported.status !== "ok") throw new Error("Inläsningen misslyckades");
  return { raceId: created.response.raceId, eventId: row!.eventId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken,
    csrfHeader: entered.csrfToken };
}

async function current(proof: Proof) {
  const read = await readCourseSettingAsAdmin(db, proof);
  if (read.status !== "ok" || !read.response.setting) throw new Error("Läget saknas");
  return { version: read.response.setting.version, document: read.response.setting.document as unknown as CourseSettingDocument };
}
const normal = (document: CourseSettingDocument, code: string) => Object.values(document.controls).find(row => row.code === code)!;
const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const inspect = (proof: Proof, control: string, checked: boolean, at: string, now: Date, position: { x: number; y: number } | null = null) =>
  setCourseSettingInspectionAsAdmin(db, { ...proof, request: { formatVersion: 1, control, checked, at, position } }, now);

describe("steg 67: kollad per kontroll", { timeout: 180_000 }, () => {
  it("bockas av den som läser och kommenterar, den senaste vinner, dokumentet är orört", async () => {
    const owner = await race();
    const before = await current(owner);
    const c31 = normal(before.document, "31"), c32 = normal(before.document, "32");
    const commenter = await registerTestAccount(db);
    const granted = await grantRacePerson(db, owner, owner.raceId, commenter.email, "COURSE_COMMENT" as never);
    if (granted.status !== "granted") throw new Error("Behörigheten gavs inte");
    const comment = { raceId: owner.raceId, ...commenter.proof };
    const functionary = await raceAuth(db, owner.raceId, "FUNCTIONARY");
    const now = new Date();

    // Den som läser och kommenterar bockar 31 (tio minuter sedan, kön utan nät) med kontrollens läge då.
    const checked = await inspect(comment, c31.id, true, minutesAgo(now, 10), now, c31.at);
    expect(checked).toMatchObject({ status: "ok", changed: true, response: { inspections: [{ control: c31.id, checkedAt: minutesAgo(now, 10),
      checkedBy: { accountId: commenter.accountId }, at: c31.at }] } });
    // En äldre avbockning (från en annan telefon som var utan nät längre) ändrar inte den nyare bocken.
    expect(await inspect(owner, c31.id, false, minutesAgo(now, 20), now)).toMatchObject({ status: "ok", changed: false,
      response: { inspections: [{ control: c31.id }] } });
    // En nyare avbockning tar bort den; en äldre bock därefter kommer inte tillbaka.
    expect(await inspect(owner, c31.id, false, minutesAgo(now, 5), now)).toMatchObject({ status: "ok", changed: true, response: { inspections: [] } });
    expect(await inspect(comment, c31.id, true, minutesAgo(now, 8), now)).toMatchObject({ status: "ok", changed: false, response: { inspections: [] } });
    expect((await inspect(owner, c32.id, true, minutesAgo(now, 1), now, c32.at)).status).toBe("ok");
    expect((await inspect(owner, c31.id, true, now.toISOString(), now, c31.at)).status).toBe("ok");

    // Tiden: högst 2 minuter fram (sparas som serverns tid), högst 30 dagar bakåt.
    const later = new Date(now.getTime() + 60_000).toISOString();
    expect(await inspect(owner, c32.id, true, later, now, c32.at)).toMatchObject({ status: "ok" });
    const listed = await listCourseSettingInspectionsAsAdmin(db, comment, now);
    if (listed.status !== "ok") throw new Error("Bockarna kunde inte läsas");
    expect(listed.response.inspections.find(row => row.control === c32.id)?.checkedAt).toBe(now.toISOString());
    expect((await inspect(owner, c32.id, true, new Date(now.getTime() + 10 * 60_000).toISOString(), now)).status).toBe("invalid-request");
    expect((await inspect(owner, c32.id, true, minutesAgo(now, 31 * 24 * 60), now)).status).toBe("invalid-request");

    // Behörigheten: funktionären och den utan inloggning varken läser eller bockar; CSRF krävs.
    expect((await inspect(functionary, c32.id, true, now.toISOString(), now)).status).toBe("forbidden");
    expect((await listCourseSettingInspectionsAsAdmin(db, functionary)).status).toBe("forbidden");
    expect((await listCourseSettingInspectionsAsAdmin(db, { raceId: owner.raceId, sessionToken: null })).status).toBe("unauthorized");
    expect((await setCourseSettingInspectionAsAdmin(db, { ...comment, csrfHeader: "fel", request: { formatVersion: 1, control: c32.id, checked: true,
      at: now.toISOString(), position: null } }, now)).status).not.toBe("ok");

    // Dokumentet är orört: samma version, .ppen fram och tillbaka, banpåtrycket och överföringen.
    const after = await current(owner);
    expect(after.version).toBe(before.version);
    expect(after.document).toEqual(before.document);
    expect(writePpen(after.document)).toBe(writePpen(before.document));
    expect(readPpen(writePpen(after.document)).document).toEqual(readPpen(writePpen(before.document)).document);
    expect(after.document.courses.map(course => layoutOverprint(after.document, { course: course.id })))
      .toEqual(before.document.courses.map(course => layoutOverprint(before.document, { course: course.id })));
    const transfer = await previewCourseSettingTransferAsAdmin(db, { ...owner, request: { formatVersion: 1, version: after.version } });
    expect(JSON.stringify(transfer)).not.toMatch(/inspection|checkedAt/i);

    // Export ja (också avbockade), kopia nej; borttagen tävling tar dem med sig.
    const exported = await exportRaceAsAdmin(db, owner);
    if (exported.status !== "ok") throw new Error("Exporten misslyckades");
    const inspections = readBackup(exported.bytes).table<{ control_id: string; checked: boolean }>("course_setting_inspection");
    expect(inspections.map(row => [row.control_id, row.checked]).sort())
      .toEqual([[c31.id, true], [c32.id, true]].sort());
    const copied = await copyRaceAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), eventName: "Kollad v2",
      raceName: "Torsdag", raceDate: "2026-10-15", includePeople: false } });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    const copiedRows = await pool.query<{ n: number }>("select count(*)::int as n from course_setting_inspection where race_id = $1", [copied.response.raceId]);
    expect(copiedRows.rows[0]!.n).toBe(0);
    await db.transaction(tx => purgeRows(tx, "event", [owner.eventId]));
    const left = await pool.query<{ n: number }>("select count(*)::int as n from course_setting_inspection where race_id = $1", [owner.raceId]);
    expect(left.rows[0]!.n).toBe(0);
  });
});
