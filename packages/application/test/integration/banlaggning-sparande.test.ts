import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import {
  applyEdit, courseControlOrder, courseVariants, createdIdsBetween, readPpen, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds
} from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importCourseSettingAsAdmin, readCourseSettingAsAdmin } from "../../src/course-setting";
import { saveCourseSettingEditsAsAdmin } from "../../src/course-setting-collaboration";
import { createCourseSettingNoteAsAdmin } from "../../src/course-setting-notes";
import { setCourseSettingInspectionAsAdmin } from "../../src/course-setting-inspections";
import { accountOnRace, grantRacePerson, registerTestAccount } from "./accounts";

/**
 * Översynen 2026-11-02: två som ändrar banornas struktur samtidigt. Konfliktloggen får det som åtgärderna faktiskt ändrade
 * (`diffTouches`), så en gaffling som tas bort medan någon annan lägger in en kontroll i en gren ger den andra ett besked
 * i stället för att kontrollen tyst försvinner. Notiser och bockar på en kontroll som inte finns avvisas.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_banlaggning_sparande_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_banlaggning_sparande_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `sparande.${suffix}@test.o-tid.se`, displayName: "Huvudbanläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Sparande", raceName: "Torsdag", raceDate: "2026-11-05",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
  const { document } = readPpen(ppen);
  const proof = { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const imported = await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion: 0, document, fileName: "kartfil.ppen", ppen } });
  if (imported.status !== "ok") throw new Error(`Inläsningen misslyckades: ${imported.status}`);
  return proof;
}

async function editor(owner: Proof): Promise<Proof> {
  const account = await registerTestAccount(db);
  const granted = await grantRacePerson(db, owner, owner.raceId, account.email, "COURSE_EDIT" as never);
  if (granted.status !== "granted") throw new Error(`Behörigheten gavs inte: ${granted.status}`);
  return { raceId: owner.raceId, ...account.proof };
}

async function current(proof: Proof) {
  const read = await readCourseSettingAsAdmin(db, proof);
  if (read.status !== "ok" || !read.response.setting) throw new Error("Läget saknas");
  return { version: read.response.setting.version, document: read.response.setting.document as unknown as CourseSettingDocument };
}

/** Åtgärderna som en editor gör dem: id som varje åtgärd skapade hos författaren. */
function authored(document: CourseSettingDocument, edits: readonly CourseSettingEdit[]): CreatedIds[] {
  const created: CreatedIds[] = [];
  let doc = document;
  for (const edit of edits) { const next = applyEdit(doc, edit).document; created.push(createdIdsBetween(doc, next)); doc = next; }
  return created;
}
const save = (proof: Proof, baseVersion: number, edits: readonly CourseSettingEdit[], created?: CreatedIds[]) =>
  saveCourseSettingEditsAsAdmin(db, { ...proof, request: { formatVersion: 1, requestId: randomUUID(), baseVersion, edits,
    ...(created ? { created } : {}) } });

const inCourse = (document: CourseSettingDocument, course: string, control: string) =>
  courseVariants(document, course).some(variant => courseControlOrder(document, course, variant.code)
    .some(id => document.courseControls[id]!.control === control));

describe("översynen 2026-11-02: samtidiga strukturändringar", { timeout: 120_000 }, () => {
  it("gaffling borttagen medan någon lägger in en kontroll i grenen: den andra avvisas och kontrollen finns kvar", async () => {
    const owner = await race();
    const anna = await editor(owner), bo = await editor(owner);
    // Ägaren gafflar banan vid andra kontrollen.
    const start = await current(owner);
    const course = start.document.courses[0]!.id;
    const order = courseControlOrder(start.document, course);
    const at = order[1]!;
    expect((await save(owner, start.version, [{ type: "ADD_SPLIT", course, at, kind: "FORK", branches: 2 }])).status).toBe("ok");
    const forked = await current(owner);
    const branchB = forked.document.courseControls[at]!.split!.branches[1]!;

    // Anna och Bo arbetar båda från samma version.
    const annaEdits: CourseSettingEdit[] = [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 33, y: 44 }, code: "199" }];
    const newControl = applyEdit(forked.document, annaEdits[0]!).created!;
    annaEdits.push({ type: "INSERT_COURSE_CONTROL", course, control: newControl, after: branchB });
    const bosEdits: CourseSettingEdit[] = [{ type: "REMOVE_SPLIT", course, at }];

    const first = await save(anna, forked.version, annaEdits, authored(forked.document, annaEdits));
    expect(first).toMatchObject({ status: "ok", response: { applied: 2, rejected: [] } });
    const second = await save(bo, forked.version, bosEdits, authored(forked.document, bosEdits));
    expect(second).toMatchObject({ status: "ok", response: { rebased: true, applied: 0, rejected: [{ index: 0, code: "CONFLICT" }] } });

    const after = await current(owner);
    expect(after.version).toBe(forked.version + 1);
    const saved = Object.values(after.document.controls).find(row => row.code === "199")!;
    expect(inCourse(after.document, course, saved.id)).toBe(true);

    // Konfliktloggen har det som ändrades i strukturen (inte bara åtgärdernas egna touches, som är tomma för dessa).
    const [change] = await db.select({ touches: schema.courseSettingChanges.touches }).from(schema.courseSettingChanges)
      .where(and(eq(schema.courseSettingChanges.raceId, owner.raceId), eq(schema.courseSettingChanges.version, forked.version + 1)));
    expect((change!.touches as string[]).some(touch => touch.startsWith(`courseControl:${branchB}:`) || touch === `courseControl:${branchB}`)).toBe(true);

    // Bo gör om det från den nya versionen: nu går det (han ser Annas kontroll).
    const retry = await save(bo, after.version, bosEdits);
    expect(retry).toMatchObject({ status: "ok", response: { applied: 1, rejected: [] } });
  });

  it("två som lägger in var sin ny kontroll på olika ställen samtidigt: båda finns kvar", async () => {
    const owner = await race();
    const anna = await editor(owner), bo = await editor(owner);
    const start = await current(owner);
    const course = start.document.courses[0]!.id;
    const order = courseControlOrder(start.document, course);
    const plan = (x: number, code: string, after: string): CourseSettingEdit[] => {
      const add: CourseSettingEdit = { type: "ADD_CONTROL", kind: "NORMAL", at: { x, y: 5 }, code };
      return [add, { type: "INSERT_COURSE_CONTROL", course, control: applyEdit(start.document, add).created!, after }];
    };
    const a = plan(11, "201", order[0]!), b = plan(22, "202", order.at(-2)!);
    expect(await save(anna, start.version, a, authored(start.document, a))).toMatchObject({ status: "ok", response: { applied: 2 } });
    expect(await save(bo, start.version, b, authored(start.document, b))).toMatchObject({ status: "ok", response: { applied: 2, rejected: [] } });
    const after = await current(owner);
    for (const code of ["201", "202"]) {
      const control = Object.values(after.document.controls).find(row => row.code === code)!;
      expect(inCourse(after.document, course, control.id)).toBe(true);
    }
  });

  it("notiser och bockar på en kontroll eller bana som inte finns avvisas", async () => {
    const owner = await race();
    const { document } = await current(owner);
    const control = Object.keys(document.controls)[0]!;
    const note = (target: unknown, course: string | null = null) => createCourseSettingNoteAsAdmin(db, { ...owner, request: { formatVersion: 1,
      requestId: randomUUID(), target, at: null, course, text: "Sten?", photo: null } });
    expect((await note({ kind: "CONTROL", control })).status).toBe("ok");
    expect((await note({ kind: "CONTROL", control: "9999" })).status).toBe("conflict");
    expect((await note({ kind: "LEG", from: control, to: "9999" })).status).toBe("conflict");
    expect((await note({ kind: "COURSE", course: "9999" }, "9999")).status).toBe("conflict");
    expect((await note({ kind: "POINT", at: { x: 1, y: 1 } }, "9999")).status).toBe("conflict");
    expect((await note({ kind: "POINT", at: { x: 1, y: 1 } })).status).toBe("ok");
    const inspect = (id: string) => setCourseSettingInspectionAsAdmin(db, { ...owner, request: { formatVersion: 1, control: id, checked: true,
      at: new Date().toISOString(), position: null } });
    expect((await inspect(control)).status).toBe("ok");
    expect((await inspect("9999")).status).toBe("conflict");
  });
});
