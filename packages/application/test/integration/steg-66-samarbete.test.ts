import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import {
  applyEdit, courseSummaries, createdIdsBetween, layoutDescription, layoutOverprint, readPpen, writePpen, type CourseSettingDocument,
  type CourseSettingEdit, type CreatedIds
} from "@o-tid/course-setting";
import { mapPointToWgs84 } from "@o-tid/map-file";
import { createOrganizerEvent } from "../../src/organizer-events";
import { listMyEvents } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { saveRaceMapSourceAsAdmin, readRaceMapSourceFileAsAdmin } from "../../src/race-map-source";
import {
  importCourseSettingAsAdmin, listCourseSettingRevisionsAsAdmin, previewCourseSettingTransferAsAdmin, readCourseSettingAsAdmin,
  readCourseSettingOriginalAsAdmin, saveCourseSettingAsAdmin
} from "../../src/course-setting";
import {
  createCourseSettingSuggestionAsAdmin, decideCourseSettingSuggestionAsAdmin, listCourseSettingSuggestionsAsAdmin, saveCourseSettingEditsAsAdmin,
  setCourseSettingModeAsAdmin
} from "../../src/course-setting-collaboration";
import {
  createCourseSettingNoteAsAdmin, listCourseSettingNotesAsAdmin, readCourseSettingNotePhotoAsAdmin, replyCourseSettingNoteAsAdmin,
  setCourseSettingNoteStatusAsAdmin
} from "../../src/course-setting-notes";
import { courseSettingProjection } from "../../src/course-setting-transfer";
import { exportRaceAsAdmin } from "../../src/race-export";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { listEntryClassesAsAdmin } from "../../src/results";
import { listRacePeopleAsAdmin, revokeRacePersonAsAdmin } from "../../src/race-people";
import { purgeRows } from "../../src/purge";
import { accountOnRace, grantRacePerson, raceAuth, registerTestAccount } from "./accounts";

/**
 * Steg 66 (ADR-0181 beslut 1–5): samarbete i banläggningen – behörigheten ändra/föreslå/läsa och kommentera på alla
 * banläggningens tjänster och kartfilen men inget annat i tävlingen, notiser som aldrig når banpåtryck, beskrivningar,
 * .ppen eller överföringen, sparande med åtgärder (uppspelning, avvisade åtgärder, samma svar igen), förslag som godkänns
 * helt, delvis eller avböjs, arbetssättet och banhemligheten.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Samarbetstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg66_samarbete_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixtures = new URL("../../../../fixtures/", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg66_samarbete_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof & { eventId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `samarbete.${suffix}@test.o-tid.se`, displayName: "Huvudbanläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Samarbete", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const [row] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, created.response.raceId));
  return { raceId: created.response.raceId, eventId: row!.eventId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken,
    csrfHeader: entered.csrfToken };
}

/** Ett nytt konto med banläggningens behörighet, given av admin som under Inställningar → Personer. */
async function courseSetter(owner: Proof, level: "COURSE_EDIT" | "COURSE_SUGGEST" | "COURSE_COMMENT") {
  const account = await registerTestAccount(db);
  const granted = await grantRacePerson(db, owner, owner.raceId, account.email, level as never);
  if (granted.status !== "granted") throw new Error(`Behörigheten gavs inte: ${granted.status}`);
  return { raceId: owner.raceId, ...account.proof, accountId: account.accountId, grantId: granted.response.person.grantId };
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
const georeference = { scale: 10_000, crs: { kind: "EPSG" as const, code: 3006 }, refPoint: { easting: 675_000, northing: 6_580_000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
const render = { pxPerMm: 8, originX: -2, originY: 102 };
const corner = (x: number, y: number) => {
  const geo = mapPointToWgs84(georeference, { x: render.originX + x / render.pxPerMm, y: render.originY - y / render.pxPerMm });
  return { pixelX: x, pixelY: y, latitude: geo.latitude, longitude: geo.longitude };
};
const metadata = (): RaceMapSourceMetadata => ({ formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference, render, summary: { objectCount: 11, warnings: [], simplifications: [] },
  tiePoints: [corner(0, 0), corner(991, 0), corner(0, 831)] });

/** Kartfil och .ppen som admin läser in; ger dokumentet. */
async function setUp(owner: Proof): Promise<CourseSettingDocument> {
  const bytes = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
  const saved = await saveRaceMapSourceAsAdmin(db, { ...owner, file: bytes, fileName: "kartfil.omap", image: png(992, 832), metadata: metadata() });
  if (saved.status !== "ok") throw new Error(`Kartfilen sparades inte: ${saved.status}`);
  const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
  const { document } = readPpen(ppen);
  const imported = await importCourseSettingAsAdmin(db, { ...owner, request: { formatVersion: 1, expectedVersion: 0, document, fileName: "kartfil.ppen", ppen } });
  if (imported.status !== "ok") throw new Error("Inläsningen misslyckades");
  return document;
}

async function current(proof: Proof) {
  const read = await readCourseSettingAsAdmin(db, proof);
  if (read.status !== "ok" || !read.response.setting) throw new Error("Läget saknas");
  return { version: read.response.setting.version, document: read.response.setting.document as unknown as CourseSettingDocument, access: read.response.access };
}

const normal = (document: CourseSettingDocument, code: string) => Object.values(document.controls).find(row => row.code === code)!;
const edits = (proof: Proof, baseVersion: number, list: readonly CourseSettingEdit[], extra: { requestId?: string; created?: CreatedIds[] } = {}) =>
  saveCourseSettingEditsAsAdmin(db, { ...proof, request: { formatVersion: 1, requestId: extra.requestId ?? randomUUID(), baseVersion, edits: list,
    ...(extra.created ? { created: extra.created } : {}) } });
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");

describe("steg 66: samarbete i banläggningen", { timeout: 180_000 }, () => {
  it("behörigheten: läsa och kommentera, föreslå, ändra – bara banläggningen och kartfilen, inget annat i tävlingen", async () => {
    const owner = await race();
    await setUp(owner);
    const comment = await courseSetter(owner, "COURSE_COMMENT");
    const suggest = await courseSetter(owner, "COURSE_SUGGEST");
    const editor = await courseSetter(owner, "COURSE_EDIT");
    const functionary = await raceAuth(db, owner.raceId, "FUNCTIONARY");

    // Personerna: de nya rollerna i samma lista, en per tävling.
    const people = await listRacePeopleAsAdmin(db, owner);
    if (people.status !== "ok") throw new Error("Listan saknas");
    expect(people.response.people.map(row => row.role)).toEqual(expect.arrayContaining(["COURSE_COMMENT", "COURSE_SUGGEST", "COURSE_EDIT"]));
    const again = await grantRacePerson(db, owner, owner.raceId, (await db.select({ email: schema.userAccounts.email }).from(schema.userAccounts)
      .where(eq(schema.userAccounts.id, comment.accountId)))[0]!.email, "COURSE_EDIT" as never);
    expect(again.status).toBe("conflict");

    // Läsa: alla tre (med sin nivå), inte funktionären, inte utan inloggning.
    for (const [proof, level, isAdmin] of [[owner, "EDIT", true], [comment, "COMMENT", false], [suggest, "SUGGEST", false], [editor, "EDIT", false]] as const) {
      expect((await current(proof)).access).toMatchObject({ level, admin: isAdmin });
      expect((await listCourseSettingRevisionsAsAdmin(db, proof)).status).toBe("ok");
      expect((await readCourseSettingOriginalAsAdmin(db, proof)).status).toBe("ok");
      expect((await listCourseSettingNotesAsAdmin(db, proof)).status).toBe("ok");
      expect((await listCourseSettingSuggestionsAsAdmin(db, proof)).status).toBe("ok");
      // Kartfilen för att rita och räkna vägval.
      expect((await readRaceMapSourceFileAsAdmin(db, proof)).status).toBe("ok");
    }
    expect((await readCourseSettingAsAdmin(db, functionary)).status).toBe("forbidden");
    expect((await readRaceMapSourceFileAsAdmin(db, functionary)).status).toBe("forbidden");
    expect((await readCourseSettingAsAdmin(db, { raceId: owner.raceId, sessionToken: null })).status).toBe("unauthorized");
    expect((await listCourseSettingNotesAsAdmin(db, { raceId: owner.raceId, sessionToken: null })).status).toBe("unauthorized");

    // Resten av tävlingen: banläggningens behörighet ger ingenting där.
    for (const proof of [comment, suggest, editor]) {
      expect((await listEntryClassesAsAdmin(db, proof)).status).toBe("unauthorized");
      expect((await exportRaceAsAdmin(db, proof)).status).toBe("unauthorized");
      expect((await listRacePeopleAsAdmin(db, proof)).status).toBe("unauthorized");
      expect((await accountOnRace(db, proof)).status).toBe("unauthorized");
    }

    // Skriva: COMMENT notiser, SUGGEST förslag, EDIT åtgärder och hela dokumentet; överföring och arbetssätt bara admin.
    const { version, document } = await current(owner);
    const move: CourseSettingEdit = { type: "MOVE_CONTROL", control: normal(document, "31").id, at: { x: 10, y: 10 } };
    expect((await edits(comment, version, [move])).status).toBe("forbidden");
    expect((await edits(suggest, version, [move])).status).toBe("forbidden");
    const suggestion = { formatVersion: 1, requestId: randomUUID(), baseVersion: version, edits: [move], created: [createdIdsBetween(document, document)], comment: "" };
    expect((await createCourseSettingSuggestionAsAdmin(db, { ...comment, request: suggestion })).status).toBe("forbidden");
    expect((await createCourseSettingSuggestionAsAdmin(db, { ...suggest, request: suggestion })).status).toBe("ok");
    const note = { formatVersion: 1, requestId: randomUUID(), target: { kind: "POINT", at: { x: 5, y: 5 } }, at: null, course: null, text: "Sten?", photo: null };
    expect((await createCourseSettingNoteAsAdmin(db, { ...comment, request: note })).status).toBe("ok");
    expect((await saveCourseSettingAsAdmin(db, { ...suggest, request: { formatVersion: 1, expectedVersion: version, document } })).status).toBe("forbidden");
    expect(await edits(editor, version, [move])).toMatchObject({ status: "ok", response: { version: version + 1, applied: 1 } });
    expect((await previewCourseSettingTransferAsAdmin(db, { ...editor, request: { formatVersion: 1, version: version + 1 } })).status).toBe("forbidden");
    expect((await previewCourseSettingTransferAsAdmin(db, { ...owner, request: { formatVersion: 1, version: version + 1 } })).status).toBe("ok");
    expect((await setCourseSettingModeAsAdmin(db, { ...editor, request: { formatVersion: 1, mode: "SHARED" } })).status).toBe("forbidden");
    expect(await setCourseSettingModeAsAdmin(db, { ...owner, request: { formatVersion: 1, mode: "SHARED" } })).toEqual({ status: "ok", mode: "SHARED" });
    expect((await readCourseSettingAsAdmin(db, comment))).toMatchObject({ response: { setting: { mode: "SHARED" } } });

    // Mina tävlingar visar loppet med banläggningen; borttagen behörighet gäller direkt.
    const mine = await listMyEvents(db, comment);
    expect(mine).toMatchObject({ status: "ok", response: { events: [{ role: "COURSE_SETTER", races: [{ raceId: owner.raceId, courseSetting: "COMMENT" }] }] } });
    const requestId = randomUUID();
    const revoked = await revokeRacePersonAsAdmin(db, { ...owner, idempotencyKey: `race-person-revoke:${requestId}`,
      readBody: async () => ({ formatVersion: 1, requestId, grantId: comment.grantId }) });
    expect(revoked.status).toBe("revoked");
    expect((await readCourseSettingAsAdmin(db, comment)).status).toBe("unauthorized");
  });

  it("notiserna når aldrig banpåtrycket, beskrivningarna, .ppen eller överföringen; de följer med export och kopia och tas bort med tävlingen", async () => {
    const owner = await race();
    await setUp(owner);
    const before = await current(owner);
    const output = (document: CourseSettingDocument) => JSON.stringify({
      overprint: document.courses.map(course => layoutOverprint(document, { course: course.id })),
      all: layoutOverprint(document, { course: "ALL_CONTROLS" }),
      descriptions: document.courses.map(course => layoutDescription(document, { course: course.id, kind: "SYMBOLS", language: "sv" })),
      ppen: writePpen(document), projection: courseSettingProjection(document), summaries: courseSummaries(document)
    });
    const reference = output(before.document);
    const control = normal(before.document, "32");
    const course = before.document.courses[0]!;
    const targets = [{ kind: "POINT", at: { x: 20, y: 20 } }, { kind: "CONTROL", control: control.id }, { kind: "LEG", from: control.id,
      to: normal(before.document, "33").id }, { kind: "COURSE", course: course.id }];
    const ids: string[] = [];
    for (const [index, target] of targets.entries()) {
      const created = await createCourseSettingNoteAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), target,
        at: target.kind === "COURSE" ? null : { x: 1, y: 1 }, course: target.kind === "COURSE" ? course.id : null, text: `Notis ${index}`,
        photo: index === 1 ? { mediaType: "image/jpeg", base64: jpeg() } : null } });
      if (created.status !== "ok") throw new Error(`Notisen sparades inte: ${created.status}`);
      ids.push(created.note.id);
    }
    expect((await replyCourseSettingNoteAsAdmin(db, { ...owner, noteId: ids[1]!, request: { formatVersion: 1, requestId: randomUUID(),
      text: "Flaggan på norra sidan" } }))).toMatchObject({ status: "ok", note: { replies: [{ text: "Flaggan på norra sidan" }] } });
    expect(await setCourseSettingNoteStatusAsAdmin(db, { ...owner, noteId: ids[0]!, request: { formatVersion: 1, status: "DONE" } }))
      .toMatchObject({ status: "ok", note: { status: "DONE", resolvedBy: { displayName: "Huvudbanläggare" } } });
    const photo = await readCourseSettingNotePhotoAsAdmin(db, { ...owner, noteId: ids[1]! });
    expect(photo).toMatchObject({ status: "ok", mediaType: "image/jpeg" });
    // Ett foto som inte är en bild, och ett för stort.
    expect((await createCourseSettingNoteAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), target: targets[0], at: null,
      course: null, text: "x", photo: { mediaType: "image/png", base64: jpeg() } } })).status).toBe("invalid-request");
    expect((await createCourseSettingNoteAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), target: targets[0], at: null,
      course: null, text: "x", photo: { mediaType: "image/jpeg", base64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.alloc(2 * 1024 * 1024)]).toString("base64") } } })).status).not.toBe("ok");

    // Dokumentet är orört (samma version och innehåll) och utdata är identiska med och utan notiser.
    const after = await current(owner);
    expect(after.version).toBe(before.version);
    expect(after.document).toEqual(before.document);
    expect(output(after.document)).toBe(reference);
    const transfer = await previewCourseSettingTransferAsAdmin(db, { ...owner, request: { formatVersion: 1, version: after.version } });
    expect(transfer.status).toBe("ok");
    expect(JSON.stringify(transfer)).not.toContain("Notis");
    expect(JSON.stringify(transfer)).not.toContain("Flaggan");

    // Adminexporten och kopian har notiserna (med fotot); borttagen tävling tar dem med sig.
    const exported = await exportRaceAsAdmin(db, owner);
    if (exported.status !== "ok") throw new Error("Exporten misslyckades");
    const json = JSON.parse(new TextDecoder().decode(exported.bytes)) as { courseSettingNotes: { text: string; photo_base64: string | null }[];
      courseSettingNoteReplies: unknown[] };
    expect(json.courseSettingNotes.map(row => row.text).sort()).toEqual(["Notis 0", "Notis 1", "Notis 2", "Notis 3"]);
    expect(json.courseSettingNotes.find(row => row.text === "Notis 1")!.photo_base64!.replace(/\s/g, "")).toBe(jpeg());
    expect(json.courseSettingNoteReplies).toHaveLength(1);
    const copied = await copyRaceAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), eventName: "Samarbete v2",
      raceName: "Torsdag", raceDate: "2026-10-15", includePeople: false } });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    const copiedNotes = await pool.query("select count(*)::int as n from course_setting_note where race_id = $1", [copied.response.raceId]);
    expect(copiedNotes.rows[0].n).toBe(4);
    await db.transaction(tx => purgeRows(tx, "event", [owner.eventId]));
    for (const table of ["course_setting_note", "course_setting_note_reply", "course_setting_suggestion", "course_setting_change", "course_setting_grant"]) {
      const left = await pool.query(`select count(*)::int as n from ${table} where race_id = $1`, [owner.raceId]);
      expect(left.rows[0].n, table).toBe(0);
    }
  });

  it("åtgärder spelas upp på den aktuella versionen: olika kontroller båda kvar, samma kontroll den förste vinner, samma sparning ger samma svar", async () => {
    const owner = await race();
    await setUp(owner);
    const other = await courseSetter(owner, "COURSE_EDIT");
    const start = await current(owner);
    const a = normal(start.document, "31").id, b = normal(start.document, "32").id;
    const first = await edits(owner, start.version, [{ type: "MOVE_CONTROL", control: a, at: { x: 11, y: 12 } }]);
    expect(first).toMatchObject({ status: "ok", response: { version: start.version + 1, rebased: false, applied: 1, rejected: [] } });
    // Den andra byggde på samma version: flyttar samma kontroll (avvisas) och en annan (görs).
    const requestId = randomUUID();
    const second = await edits(other, start.version, [{ type: "MOVE_CONTROL", control: a, at: { x: 50, y: 50 } },
      { type: "MOVE_CONTROL", control: b, at: { x: 21, y: 22 } }], { requestId });
    expect(second).toMatchObject({ status: "ok", response: { version: start.version + 2, rebased: true, applied: 1,
      rejected: [{ index: 0, code: "CONFLICT" }] } });
    expect(await edits(other, start.version, [{ type: "MOVE_CONTROL", control: a, at: { x: 50, y: 50 } },
      { type: "MOVE_CONTROL", control: b, at: { x: 21, y: 22 } }], { requestId })).toEqual(second);
    const now = await current(owner);
    expect(now.version).toBe(start.version + 2);
    expect(now.document.controls[a]!.at).toEqual({ x: 11, y: 12 });
    expect(now.document.controls[b]!.at).toEqual({ x: 21, y: 22 });

    // Nya kontroller hos båda samtidigt: id översätts, så att den andres flytt träffar hans egen nya kontroll.
    const mine = applyEdit(now.document, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 1, y: 1 }, code: "77" }).document;
    const added = createdIdsBetween(now.document, mine);
    expect((await edits(owner, now.version, [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 2, y: 2 }, code: "88" }])).status).toBe("ok");
    const third = await edits(other, now.version, [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 1, y: 1 }, code: "77" },
      { type: "MOVE_CONTROL", control: added.controls[0]!, at: { x: 3, y: 3 } }], { created: [added, createdIdsBetween(mine, mine)] });
    if (third.status !== "ok") throw new Error("Sparningen misslyckades");
    expect(third.response.rejected).toEqual([]);
    const final = await current(owner);
    expect(normal(final.document, "77").at).toEqual({ x: 3, y: 3 });
    expect(normal(final.document, "88").at).toEqual({ x: 2, y: 2 });
    // En borttagen kontroll: åtgärden avvisas med NOT_FOUND och inget sparas.
    expect((await edits(owner, final.version, [{ type: "DELETE_CONTROL", control: "999" }]))).toMatchObject({ status: "ok",
      response: { version: final.version, applied: 0, rejected: [{ index: 0, code: "NOT_FOUND" }] } });
    expect((await edits(owner, final.version + 5, [{ type: "DELETE_CONTROL", control: a }])).status).toBe("invalid-request");
  });

  it("förslag: godkänn helt, delvis (det som bygger på det överhoppade görs inte) och avböj med kommentar", async () => {
    const owner = await race();
    await setUp(owner);
    const helper = await courseSetter(owner, "COURSE_SUGGEST");
    const start = await current(helper);
    const c31 = normal(start.document, "31").id, c32 = normal(start.document, "32").id;
    const suggest = async (list: CourseSettingEdit[], comment: string) => {
      let document = start.document;
      const created: CreatedIds[] = [];
      for (const edit of list) { const next = applyEdit(document, edit).document; created.push(createdIdsBetween(document, next)); document = next; }
      const result = await createCourseSettingSuggestionAsAdmin(db, { ...helper, request: { formatVersion: 1, requestId: randomUUID(),
        baseVersion: start.version, edits: list, created, comment } });
      if (result.status !== "ok") throw new Error(`Förslaget sparades inte: ${result.status}`);
      return result.suggestion;
    };
    const whole = await suggest([{ type: "MOVE_CONTROL", control: c31, at: { x: 30, y: 31 } }], "Bättre läge");
    const decide = (id: string, request: Record<string, unknown>, proof: Proof = owner) =>
      decideCourseSettingSuggestionAsAdmin(db, { ...proof, suggestionId: id, request: { formatVersion: 1, requestId: randomUUID(), ...request } });
    expect((await decide(whole.id, { decision: "APPROVE" }, helper)).status).toBe("forbidden");
    const approved = await decide(whole.id, { decision: "APPROVE" });
    expect(approved).toMatchObject({ status: "ok", response: { suggestion: { status: "APPROVED", result: { applied: [0], rejected: [] } },
      saved: { version: start.version + 1, applied: 1 } } });
    expect((await decide(whole.id, { decision: "DECLINE" })).status).toBe("conflict");

    // Delvis: ny kontroll (hoppas över) och flytt av den (bygger på den) och en flytt av 32 (görs).
    const fresh = applyEdit(start.document, { type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 5 }, code: "90" });
    const newId = createdIdsBetween(start.document, fresh.document).controls[0]!;
    const partial = await suggest([{ type: "ADD_CONTROL", kind: "NORMAL", at: { x: 5, y: 5 }, code: "90" },
      { type: "MOVE_CONTROL", control: newId, at: { x: 6, y: 6 } }, { type: "MOVE_CONTROL", control: c32, at: { x: 40, y: 41 } },
      { type: "MOVE_CONTROL", control: c31, at: { x: 1, y: 1 } }], "");
    const result = await decide(partial.id, { decision: "APPROVE", skip: [0] });
    expect(result).toMatchObject({ status: "ok", response: { suggestion: { status: "PARTIAL", result: { applied: [2] } } } });
    if (result.status !== "ok") throw new Error();
    // 31 flyttades av det första förslaget efter förslagets version: den första vinner.
    expect(result.response.saved!.rejected.map(row => [row.index, row.code])).toEqual([[1, "DEPENDS"], [3, "CONFLICT"]]);
    const now = await current(owner);
    expect(now.document.controls[c32]!.at).toEqual({ x: 40, y: 41 });
    expect(now.document.controls[c31]!.at).toEqual({ x: 30, y: 31 });
    expect(Object.values(now.document.controls).some(row => row.code === "90")).toBe(false);

    const declined = await suggest([{ type: "DELETE_CONTROL", control: c32 }], "Ta bort?");
    expect(await decide(declined.id, { decision: "DECLINE", comment: "Den behövs" })).toMatchObject({ status: "ok", response: {
      suggestion: { status: "DECLINED", decisionComment: "Den behövs", decidedBy: { displayName: "Huvudbanläggare" } }, saved: null } });
    expect((await current(owner)).document.controls[c32]).toBeDefined();
    const list = await listCourseSettingSuggestionsAsAdmin(db, helper);
    expect(list).toMatchObject({ status: "ok" });
    if (list.status === "ok") expect(list.response.suggestions.map(row => row.status).sort()).toEqual(["APPROVED", "DECLINED", "PARTIAL"]);
  });
});
