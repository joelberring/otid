import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { COURSE_SETTING_SKETCH_MAX_POINTS } from "@o-tid/contracts";
import { layoutOverprint, readPpen, writePpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import {
  importCourseSettingAsAdmin, listCourseSettingRevisionsAsAdmin, previewCourseSettingTransferAsAdmin, readCourseSettingAsAdmin,
  readCourseSettingOriginalAsAdmin, readCourseSettingRevisionAsAdmin, saveCourseSettingAsAdmin
} from "../../src/course-setting";
import { listCourseSettingSuggestionsAsAdmin, saveCourseSettingEditsAsAdmin } from "../../src/course-setting-collaboration";
import { listCourseSettingInspectionsAsAdmin } from "../../src/course-setting-inspections";
import { readRaceMapSourceFileAsAdmin } from "../../src/race-map-source";
import { listMyEvents } from "../../src/organizer-events";
import { listEntryClassesAsAdmin } from "../../src/results";
import {
  createCourseSettingNoteAsAdmin, deleteCourseSettingNoteAsAdmin, deleteCourseSettingNoteReplyAsAdmin, listCourseSettingNotesAsAdmin,
  readCourseSettingNotePhotoAsAdmin, replyCourseSettingNoteAsAdmin, setCourseSettingNoteStatusAsAdmin
} from "../../src/course-setting-notes";
import { courseSettingProjection } from "../../src/course-setting-transfer";
import { exportRaceAsAdmin } from "../../src/race-export";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { accountOnRace, grantRacePerson, registerTestAccount } from "./accounts";

/**
 * ADR-0181 beslut 8 (ägarens synpunkter 2026-11-02): notiser med ritning (SKETCH) och kartfel, borttagning av notiser och
 * svar. Formen på ritningen prövas (punkter, ytor, slag), ett kartfel kan bara sitta på en punkt eller en ritning, den som
 * skrev och den som får ändra tar bort (svar och foto försvinner med), och ritningen når aldrig banpåtryck, .ppen eller
 * överföring men följer med export och kopia.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Notistestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_notiser_ritning_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_notiser_ritning_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof & { eventId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `notiser.${suffix}@test.o-tid.se`, displayName: "Huvudbanläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Notiser", raceName: "Rekognosering", raceDate: "2026-11-02",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const [row] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, created.response.raceId));
  return { raceId: created.response.raceId, eventId: row!.eventId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken,
    csrfHeader: entered.csrfToken };
}

async function courseSetter(owner: Proof, level: "COURSE_EDIT" | "COURSE_COMMENT" | "COURSE_MAP") {
  const account = await registerTestAccount(db);
  const granted = await grantRacePerson(db, owner, owner.raceId, account.email, level as never);
  if (granted.status !== "granted") throw new Error(`Behörigheten gavs inte: ${granted.status}`);
  return { raceId: owner.raceId, ...account.proof, accountId: account.accountId };
}

async function setUp(owner: Proof): Promise<CourseSettingDocument> {
  const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
  const { document } = readPpen(ppen);
  const imported = await importCourseSettingAsAdmin(db, { ...owner, request: { formatVersion: 1, expectedVersion: 0, document, fileName: "kartfil.ppen", ppen } });
  if (imported.status !== "ok") throw new Error("Inläsningen misslyckades");
  return document;
}

async function current(proof: Proof) {
  const read = await readCourseSettingAsAdmin(db, proof);
  if (read.status !== "ok" || !read.response.setting) throw new Error("Läget saknas");
  return { version: read.response.setting.version, document: read.response.setting.document as unknown as CourseSettingDocument };
}

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const stig = { kind: "LINE", style: "MAP_ERROR", intent: "WRONG", points: [{ x: 10, y: 10 }, { x: 14, y: 12 }, { x: 18, y: 11 }] } as const;
const ratt = { kind: "LINE", style: "MAP_ERROR", intent: "RIGHT", points: [{ x: 10, y: 12 }, { x: 18, y: 14 }] } as const;
const yta = { kind: "AREA", style: "MARKING", intent: null, points: [{ x: 30, y: 30 }, { x: 34, y: 30 }, { x: 32, y: 34 }] } as const;
const request = (target: unknown, extra: Record<string, unknown> = {}) => ({ formatVersion: 1, requestId: randomUUID(), target, at: null, course: null,
  text: "Stigen går söder om kullen", photo: null, ...extra });

describe("notiser med ritning, kartfel och borttagning (ADR-0181 beslut 8)", { timeout: 180_000 }, () => {
  it("en ritning sparas med slag och mitt; formen och antalet punkter prövas; kartfel bara på punkt eller ritning", async () => {
    const owner = await race();
    const document = await setUp(owner);
    const control = Object.values(document.controls).find(row => row.kind === "NORMAL")!;

    const created = await createCourseSettingNoteAsAdmin(db, { ...owner, request: request({ kind: "SKETCH", shapes: [stig, ratt, yta] },
      { kind: "MAP_ERROR" }) });
    if (created.status !== "ok") throw new Error(`Ritningen sparades inte: ${created.status}`);
    expect(created.note).toMatchObject({ kind: "MAP_ERROR", target: { kind: "SKETCH", shapes: [stig, ratt, yta] }, at: { x: 22, y: 22 } });
    // Utan slag: banläggning (köer i telefonen från tidigare).
    expect(await createCourseSettingNoteAsAdmin(db, { ...owner, request: request({ kind: "POINT", at: { x: 5, y: 5 } }) }))
      .toMatchObject({ status: "ok", note: { kind: "COURSE_SETTING" } });
    expect(await createCourseSettingNoteAsAdmin(db, { ...owner, request: request({ kind: "POINT", at: { x: 5, y: 5 } }, { kind: "MAP_ERROR" }) }))
      .toMatchObject({ status: "ok", note: { kind: "MAP_ERROR", target: { kind: "POINT" } } });

    const invalid = [
      // Ett kartfel på en kontroll, en sträcka eller en bana kan kopplas till banorna.
      request({ kind: "CONTROL", control: control.id }, { kind: "MAP_ERROR" }),
      request({ kind: "COURSE", course: document.courses[0]!.id }, { kind: "MAP_ERROR", course: document.courses[0]!.id }),
      // Tom ritning, en yta med två punkter, en linje med en punkt, okänt slag, för många punkter och för många delar.
      request({ kind: "SKETCH", shapes: [] }),
      request({ kind: "SKETCH", shapes: [{ ...yta, points: yta.points.slice(0, 2) }] }),
      request({ kind: "SKETCH", shapes: [{ ...stig, points: [{ x: 1, y: 1 }] }] }),
      request({ kind: "SKETCH", shapes: [{ ...stig, style: "PURPLE" }] }),
      request({ kind: "SKETCH", shapes: [{ ...stig, points: Array.from({ length: COURSE_SETTING_SKETCH_MAX_POINTS + 1 }, (_, i) => ({ x: i / 10, y: 1 })) }] }),
      request({ kind: "SKETCH", shapes: Array.from({ length: 2 }, () => ({ ...stig,
        points: Array.from({ length: COURSE_SETTING_SKETCH_MAX_POINTS / 2 + 1 }, (_, i) => ({ x: i / 10, y: 1 })) })) }),
      request({ kind: "SKETCH", shapes: Array.from({ length: 21 }, () => stig) }),
      request({ kind: "SKETCH", shapes: [{ ...stig, extra: true }] }),
      request({ kind: "SKETCH", shapes: [{ ...stig, points: [{ x: Number.NaN, y: 1 }, { x: 2, y: 2 }] }] })
    ];
    for (const [index, body] of invalid.entries()) {
      expect((await createCourseSettingNoteAsAdmin(db, { ...owner, request: body })).status, `ogiltig ${index}`).toBe("invalid-request");
    }
    // Databasen tål inte heller ett kartfel på en kontroll eller en ritning utan linjer.
    await expect(pool.query(`insert into course_setting_note (id, race_id, target, kind, control_id, text, created_at, created_by, request_id)
      values ($1, $2, 'CONTROL', 'MAP_ERROR', 'x', 'x', now(), $3, $4)`, [randomUUID(), owner.raceId, randomUUID(), randomUUID()])).rejects.toThrow();
    await expect(pool.query(`insert into course_setting_note (id, race_id, target, at_x, at_y, sketch, text, created_at, created_by, request_id)
      values ($1, $2, 'SKETCH', 1, 1, '[]', 'x', now(), $3, $4)`, [randomUUID(), owner.raceId, randomUUID(), randomUUID()])).rejects.toThrow();

    const list = await listCourseSettingNotesAsAdmin(db, owner);
    expect(list.status === "ok" && list.response.notes.map(note => note.kind)).toEqual(["MAP_ERROR", "COURSE_SETTING", "MAP_ERROR"]);
  });

  it("den som skrev och den som får ändra tar bort notiser och svar; svar och foto försvinner; andra får inte", async () => {
    const owner = await race();
    await setUp(owner);
    const kim = await courseSetter(owner, "COURSE_COMMENT");
    const lo = await courseSetter(owner, "COURSE_COMMENT");
    const editor = await courseSetter(owner, "COURSE_EDIT");

    const kimNote = await createCourseSettingNoteAsAdmin(db, { ...kim, request: request({ kind: "SKETCH", shapes: [stig] }, { kind: "MAP_ERROR",
      photo: { mediaType: "image/jpeg", base64: jpeg() } }) });
    if (kimNote.status !== "ok") throw new Error("Notisen sparades inte");
    const id = kimNote.note.id;
    const loReply = await replyCourseSettingNoteAsAdmin(db, { ...lo, noteId: id, request: { formatVersion: 1, requestId: randomUUID(), text: "Ritat in" } });
    const kimReply = await replyCourseSettingNoteAsAdmin(db, { ...kim, noteId: id, request: { formatVersion: 1, requestId: randomUUID(), text: "Tack" } });
    if (loReply.status !== "ok" || kimReply.status !== "ok") throw new Error("Svaren sparades inte");
    const [loReplyId, kimReplyId] = kimReply.note.replies.map(reply => reply.id) as [string, string];

    // Ett svar: bara den som skrev det eller den som får ändra.
    expect((await deleteCourseSettingNoteReplyAsAdmin(db, { ...kim, noteId: id, replyId: loReplyId })).status).toBe("forbidden");
    expect(await deleteCourseSettingNoteReplyAsAdmin(db, { ...kim, noteId: id, replyId: kimReplyId }))
      .toMatchObject({ status: "ok", note: { replies: [{ text: "Ritat in" }] } });
    expect((await deleteCourseSettingNoteReplyAsAdmin(db, { ...kim, noteId: id, replyId: kimReplyId })).status).toBe("not-found");
    expect((await deleteCourseSettingNoteReplyAsAdmin(db, { ...kim, noteId: id, replyId: "nej" })).status).toBe("invalid-request");

    // Notisen: Lo (läsa och kommentera, skrev den inte) får inte; utan inloggning eller CSRF inte heller.
    expect((await deleteCourseSettingNoteAsAdmin(db, { ...lo, noteId: id })).status).toBe("forbidden");
    expect((await deleteCourseSettingNoteAsAdmin(db, { ...kim, csrfHeader: "fel", noteId: id })).status).not.toBe("ok");
    expect((await deleteCourseSettingNoteAsAdmin(db, { raceId: owner.raceId, sessionToken: null, csrfCookie: null, csrfHeader: null, noteId: id } as never))
      .status).toBe("unauthorized");
    // Den som skrev den: borta med svar och foto.
    expect(await deleteCourseSettingNoteAsAdmin(db, { ...kim, noteId: id })).toEqual({ status: "ok", id });
    expect((await readCourseSettingNotePhotoAsAdmin(db, { ...owner, noteId: id })).status).toBe("not-found");
    expect((await pool.query<{ n: number }>("select count(*)::int as n from course_setting_note_reply where note_id = $1", [id])).rows[0]!.n).toBe(0);
    // Borta redan (t.ex. kön i telefonen skickar igen).
    expect((await deleteCourseSettingNoteAsAdmin(db, { ...kim, noteId: id })).status).toBe("not-found");

    // Den som får ändra (och ägaren) tar bort andras; en annan tävlings notis går inte att nå.
    const loNote = await createCourseSettingNoteAsAdmin(db, { ...lo, request: request({ kind: "POINT", at: { x: 3, y: 3 } }) });
    const ownerNote = await createCourseSettingNoteAsAdmin(db, { ...kim, request: request({ kind: "POINT", at: { x: 4, y: 4 } }) });
    if (loNote.status !== "ok" || ownerNote.status !== "ok") throw new Error("Notiserna sparades inte");
    const other = await race();
    expect((await deleteCourseSettingNoteAsAdmin(db, { ...other, noteId: loNote.note.id })).status).toBe("not-found");
    expect((await deleteCourseSettingNoteAsAdmin(db, { ...editor, noteId: loNote.note.id })).status).toBe("ok");
    expect((await deleteCourseSettingNoteAsAdmin(db, { ...owner, noteId: ownerNote.note.id })).status).toBe("ok");
    const left = await listCourseSettingNotesAsAdmin(db, owner);
    expect(left.status === "ok" && left.response.notes).toEqual([]);
  });

  it("ritningen når aldrig banpåtryck, .ppen eller överföring men följer med export och kopia", async () => {
    const owner = await race();
    await setUp(owner);
    const before = await current(owner);
    const output = (document: CourseSettingDocument) => JSON.stringify({ ppen: writePpen(document), projection: courseSettingProjection(document),
      overprint: document.courses.map(course => layoutOverprint(document, { course: course.id })) });
    const reference = output(before.document);
    const created = await createCourseSettingNoteAsAdmin(db, { ...owner, request: request({ kind: "SKETCH", shapes: [stig, yta] },
      { kind: "MAP_ERROR", text: "Beståndsgränsen ligger fel" }) });
    expect(created.status).toBe("ok");

    const after = await current(owner);
    expect(after.version).toBe(before.version);
    expect(output(after.document)).toBe(reference);
    const transfer = await previewCourseSettingTransferAsAdmin(db, { ...owner, request: { formatVersion: 1, version: after.version } });
    expect(transfer.status).toBe("ok");
    expect(JSON.stringify(transfer)).not.toContain("Beståndsgränsen");
    expect(JSON.stringify(transfer)).not.toContain("MAP_ERROR");

    const exported = await exportRaceAsAdmin(db, owner);
    if (exported.status !== "ok") throw new Error("Exporten misslyckades");
    const json = JSON.parse(new TextDecoder().decode(exported.bytes)) as { courseSettingNotes: { kind: string; target: string; sketch: unknown }[] };
    expect(json.courseSettingNotes).toMatchObject([{ kind: "MAP_ERROR", target: "SKETCH", sketch: [stig, yta] }]);

    const copied = await copyRaceAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), eventName: "Notiser v2",
      raceName: "Rekognosering", raceDate: "2026-11-09", includePeople: false } });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    const copy = await pool.query<{ kind: string; target: string; sketch: unknown }>(
      "select kind, target, sketch from course_setting_note where race_id = $1", [copied.response.raceId]);
    expect(copy.rows).toEqual([{ kind: "MAP_ERROR", target: "SKETCH", sketch: [stig, yta] }]);
  });

  it("kartritaren ser bara kartfelen (utan bana, kontroller och foto), svarar och markerar klart; aldrig banläggningens dokument", async () => {
    const owner = await race();
    const document = await setUp(owner);
    const mapMaker = await courseSetter(owner, "COURSE_MAP");
    const { version } = await current(owner);
    const control = Object.values(document.controls).find(row => row.kind === "NORMAL")!;
    const course = document.courses[0]!;
    const sketch = await createCourseSettingNoteAsAdmin(db, { ...owner, request: request({ kind: "SKETCH", shapes: [stig] }, { kind: "MAP_ERROR",
      text: "Stigen saknas", photo: { mediaType: "image/jpeg", base64: jpeg() } }) });
    const point = await createCourseSettingNoteAsAdmin(db, { ...owner, request: request({ kind: "POINT", at: { x: 40, y: 40 } }, { kind: "MAP_ERROR",
      text: "Sten saknas", course: course.id }) });
    const secret = await createCourseSettingNoteAsAdmin(db, { ...owner, request: request({ kind: "CONTROL", control: control.id },
      { text: "Flytta kontrollen närmare stenen", course: course.id }) });
    if (sketch.status !== "ok" || point.status !== "ok" || secret.status !== "ok") throw new Error("Notiserna sparades inte");

    // Banläggningens dokument och allt annat i banläggningen: nej.
    for (const [name, result] of Object.entries({
      state: await readCourseSettingAsAdmin(db, mapMaker), revisions: await listCourseSettingRevisionsAsAdmin(db, mapMaker),
      revision: await readCourseSettingRevisionAsAdmin(db, { ...mapMaker, version }), original: await readCourseSettingOriginalAsAdmin(db, mapMaker),
      suggestions: await listCourseSettingSuggestionsAsAdmin(db, mapMaker), inspections: await listCourseSettingInspectionsAsAdmin(db, mapMaker),
      transfer: await previewCourseSettingTransferAsAdmin(db, { ...mapMaker, request: { formatVersion: 1, version } }),
      save: await saveCourseSettingAsAdmin(db, { ...mapMaker, request: { formatVersion: 1, expectedVersion: version, document } }),
      edits: await saveCourseSettingEditsAsAdmin(db, { ...mapMaker, request: { formatVersion: 1, requestId: randomUUID(), baseVersion: version,
        edits: [{ type: "MOVE_CONTROL", control: control.id, at: { x: 1, y: 1 } }] } }),
      create: await createCourseSettingNoteAsAdmin(db, { ...mapMaker, request: request({ kind: "POINT", at: { x: 1, y: 1 } }, { kind: "MAP_ERROR" }) }),
      photo: await readCourseSettingNotePhotoAsAdmin(db, { ...mapMaker, noteId: sketch.note.id }),
      remove: await deleteCourseSettingNoteAsAdmin(db, { ...mapMaker, noteId: sketch.note.id })
    })) expect(result.status, name).toBe("forbidden");
    // Resten av tävlingen inte heller.
    expect((await listEntryClassesAsAdmin(db, mapMaker)).status).toBe("unauthorized");
    // Kartfilen (för utsnitten) får kartritaren; här finns ingen.
    expect((await readRaceMapSourceFileAsAdmin(db, mapMaker)).status).toBe("not-found");

    // Kartfelen: bara de två, utan bana och foto; inget om kontroller, sträckor eller banor i svaret.
    const list = await listCourseSettingNotesAsAdmin(db, mapMaker);
    if (list.status !== "ok") throw new Error(`Listan saknas: ${list.status}`);
    expect(list.response.notes.map(note => [note.text, note.course, note.photo])).toEqual([["Stigen saknas", null, null], ["Sten saknas", null, null]]);
    const text = JSON.stringify(list.response);
    for (const value of [`"${course.id}"`, course.name, ...Object.values(document.controls).flatMap(row => [`"${row.id}"`, ...(row.code ? [`"${row.code}"`] : [])]),
      "Flytta kontrollen", "CONTROL", "LEG", "COURSE\""]) expect(text, value).not.toContain(value);

    // Svara och markera klart på ett kartfel; inte på banläggarens notis.
    const answered = await replyCourseSettingNoteAsAdmin(db, { ...mapMaker, noteId: sketch.note.id, request: { formatVersion: 1, requestId: randomUUID(),
      text: "Rättat i kartfilen" } });
    expect(answered).toMatchObject({ status: "ok", note: { course: null, photo: null, replies: [{ text: "Rättat i kartfilen" }] } });
    expect(await setCourseSettingNoteStatusAsAdmin(db, { ...mapMaker, noteId: sketch.note.id, request: { formatVersion: 1, status: "DONE" } }))
      .toMatchObject({ status: "ok", note: { status: "DONE", photo: null } });
    expect((await replyCourseSettingNoteAsAdmin(db, { ...mapMaker, noteId: secret.note.id, request: { formatVersion: 1, requestId: randomUUID(),
      text: "x" } })).status).toBe("forbidden");
    expect((await setCourseSettingNoteStatusAsAdmin(db, { ...mapMaker, noteId: secret.note.id, request: { formatVersion: 1, status: "DONE" } })).status)
      .toBe("forbidden");
    if (answered.status !== "ok") throw new Error("Svaret saknas");
    expect((await deleteCourseSettingNoteReplyAsAdmin(db, { ...mapMaker, noteId: sketch.note.id, replyId: answered.note.replies[0]!.id })).status).toBe("ok");

    // Mina tävlingar: loppet med kartritarens behörighet.
    expect(await listMyEvents(db, mapMaker)).toMatchObject({ status: "ok", response: { events: [{ role: "COURSE_SETTER",
      races: [{ raceId: owner.raceId, courseSetting: "MAP" }] }] } });
  });
});
