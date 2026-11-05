import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { readPpen, type CourseSettingDocument } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importCourseSettingAsAdmin } from "../../src/course-setting";
import {
  createCourseSettingNoteAsAdmin, deleteCourseSettingNoteAsAdmin, deleteCourseSettingNoteReplyAsAdmin, editCourseSettingNoteAsAdmin,
  listCourseSettingNotesAsAdmin, replyCourseSettingNoteAsAdmin
} from "../../src/course-setting-notes";
import {
  createMapLinkAsAdmin, readMapLinkAsAdmin, readMapLinkMapFile, readMapLinkView, replyViaMapLink, revokeMapLinkAsAdmin, setVerdictViaMapLink
} from "../../src/course-setting-map-link";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { accountOnRace, grantRacePerson, registerTestAccount } from "./accounts";

/**
 * ADR-0214: länken till kartritaren. Den som får ändra skapar och stänger av länken; kartritaren läser bara kartfelen (ingen
 * bana, kontroll, notis av annat slag, foto eller namn på den som skrev kartfelet), svarar och ger besked utan konto, och
 * banläggaren ser det i notiserna. Ogiltig, avstängd, utgången och ersatt länk avvisas likadant, spärren räknar per IP och
 * per länk, journalen får posterna och bara nyckelns hash sparas. Beslut 9: bara den som skrev en notis redigerar den.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_kartritarlank_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_kartritarlank_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(raceDate = "2026-11-20"): Promise<Proof & { accountId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `lank.${suffix}@test.o-tid.se`, displayName: "Bea Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Syntetiska skogen", raceName: "Kartritartest", raceDate, timeZone: "Europe/Stockholm",
      raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken,
    accountId: account.response.accountId };
}

async function person(owner: Proof, level: "COURSE_EDIT" | "COURSE_COMMENT" | "COURSE_MAP") {
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

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const stig = { kind: "LINE", style: "MAP_ERROR", intent: "WRONG", points: [{ x: 10, y: 10 }, { x: 14, y: 12 }, { x: 18, y: 11 }] } as const;
const note = (target: unknown, extra: Record<string, unknown> = {}) => ({ formatVersion: 1, requestId: randomUUID(), target, at: null, course: null,
  text: "Stigen saknas", photo: null, ...extra });

async function created<T extends { status: string }>(value: Promise<T>): Promise<Extract<T, { status: "ok" }>> {
  const result = await value;
  if (result.status !== "ok") throw new Error(`Misslyckades: ${result.status}`);
  return result as Extract<T, { status: "ok" }>;
}

async function newLink(owner: Proof, request: Record<string, unknown> = {}, now?: Date) {
  const result = await created(createMapLinkAsAdmin(db, { ...owner, request: { formatVersion: 1, lastDay: null, showRaceName: false, ...request } }, now));
  return result.response.token;
}

const link = (token: string, clientKey = "203.0.113.7") => ({ token, clientKey });

describe("kartritarens länk (ADR-0214)", { timeout: 180_000 }, () => {
  it("visar bara kartfelen: inga banor, kontroller, andra notiser, foton eller vem som skrev kartfelet", async () => {
    const owner = await race();
    const document = await setUp(owner);
    const control = Object.values(document.controls).find(row => row.kind === "NORMAL")!;
    const course = document.courses[0]!;
    const sketch = await created(createCourseSettingNoteAsAdmin(db, { ...owner, request: note({ kind: "SKETCH", shapes: [stig] },
      { kind: "MAP_ERROR", photo: { mediaType: "image/jpeg", base64: jpeg() } }) }));
    const point = await created(createCourseSettingNoteAsAdmin(db, { ...owner, request: note({ kind: "POINT", at: { x: 40, y: 30 } },
      { kind: "MAP_ERROR", text: "Sten saknas" }) }));
    const secret = await created(createCourseSettingNoteAsAdmin(db, { ...owner, request: note({ kind: "CONTROL", control: control.id },
      { text: "Flytta kontrollen", course: course.id }) }));
    await created(replyCourseSettingNoteAsAdmin(db, { ...owner, noteId: sketch.note.id, request: { formatVersion: 1, requestId: randomUUID(),
      text: "Gäller den gamla stigen" } }));

    const token = await newLink(owner);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const view = await readMapLinkView(db, link(token));
    if (view.status !== "ok") throw new Error(`Länken gick inte att läsa: ${view.status}`);
    expect(view.response).toMatchObject({ raceName: null, map: null, mapErrors: [
      { id: sketch.note.id, number: 1, text: "Stigen saknas", status: "OPEN", point: null, shapes: [stig],
        replies: [{ text: "Gäller den gamla stigen", author: "Bea Banläggare", mapMaker: false, verdict: null }] },
      { id: point.note.id, number: 2, text: "Sten saknas", point: { x: 40, y: 30 }, shapes: null, replies: [] }] });
    const json = JSON.stringify(view.response);
    for (const value of [secret.note.id, "Flytta kontrollen", course.name, `"${course.id}"`, "photo", "image/jpeg", "createdBy", "Syntetiska",
      "Kartritartest", "2026-11-20", ...Object.values(document.controls).flatMap(row => [`"${row.id}"`, ...(row.code ? [`"${row.code}"`] : [])])]) {
      expect(json, value).not.toContain(value);
    }
    // Tävlingens namn bara när banläggaren valt det.
    const named = await newLink(owner, { showRaceName: true });
    expect(await readMapLinkView(db, link(named))).toMatchObject({ status: "ok", response: { raceName: "Syntetiska skogen · Kartritartest" } });
    // Kartfilen finns inte här; med en ogiltig nyckel svarar den som allt annat.
    expect((await readMapLinkMapFile(db, link(named))).status).toBe("not-found");
    expect((await readMapLinkMapFile(db, link("x".repeat(43)))).status).toBe("invalid");
    // Banläggarens notis (och en okänd) går inte att nå med länken.
    for (const noteId of [secret.note.id, randomUUID()]) {
      expect((await replyViaMapLink(db, { ...link(named), noteId, request: { formatVersion: 1, requestId: randomUUID(), text: "Hej", name: null } })).status)
        .toBe("not-found");
      expect((await setVerdictViaMapLink(db, { ...link(named), noteId, request: { formatVersion: 1, requestId: randomUUID(), verdict: "FIXED",
        text: "", name: null } })).status).toBe("not-found");
    }
  });

  it("svar och besked syns för banläggaren, med kartritaren som avsändare, och journalförs", async () => {
    const owner = await race();
    await setUp(owner);
    const error = await created(createCourseSettingNoteAsAdmin(db, { ...owner, request: note({ kind: "POINT", at: { x: 20, y: 20 } }, { kind: "MAP_ERROR" }) }));
    const token = await newLink(owner);
    const noteId = error.note.id;
    const requestId = randomUUID();
    const reply = { formatVersion: 1, requestId, text: "Vilken stig menar ni?", name: "  Kim   Karta " };
    expect(await replyViaMapLink(db, { ...link(token), noteId, request: reply })).toEqual({ status: "ok", raceId: owner.raceId });
    // Samma begäran igen gör inget nytt.
    expect((await replyViaMapLink(db, { ...link(token), noteId, request: reply })).status).toBe("ok");
    expect((await setVerdictViaMapLink(db, { ...link(token), noteId, request: { formatVersion: 1, requestId: randomUUID(), verdict: "FIXED",
      text: "  ", name: null } })).status).toBe("ok");

    const list = await created(listCourseSettingNotesAsAdmin(db, owner));
    const after = list.response.notes.find(row => row.id === noteId)!;
    expect(after.status).toBe("DONE");
    expect(after.resolvedBy).toBeNull();
    expect(after.replies).toEqual([
      expect.objectContaining({ text: "Vilken stig menar ni?", createdBy: null, mapMaker: { name: "Kim Karta" } }),
      expect.objectContaining({ text: "", createdBy: null, mapMaker: { name: null }, verdict: "FIXED" })]);
    // "Inte åtgärdat" öppnar kartfelet igen, med kommentaren.
    expect((await setVerdictViaMapLink(db, { ...link(token), noteId, request: { formatVersion: 1, requestId: randomUUID(), verdict: "NOT_FIXED",
      text: "Stigen finns inte i terrängen", name: "Kim" } })).status).toBe("ok");
    const again = (await created(listCourseSettingNotesAsAdmin(db, owner))).response.notes.find(row => row.id === noteId)!;
    expect(again.status).toBe("OPEN");
    expect(again.replies.at(-1)).toMatchObject({ verdict: "NOT_FIXED", text: "Stigen finns inte i terrängen", mapMaker: { name: "Kim" } });
    // Kartritaren med länken ser samma tråd; den som tar bort kan fortfarande ta bort kartritarens svar.
    const view = await readMapLinkView(db, link(token));
    expect(view.status === "ok" && view.response.mapErrors[0]!.replies.map(row => [row.author, row.mapMaker, row.verdict])).toEqual([
      ["Kim Karta", true, null], [null, true, "FIXED"], ["Kim", true, "NOT_FIXED"]]);
    expect((await deleteCourseSettingNoteReplyAsAdmin(db, { ...owner, noteId, replyId: again.replies[0]!.id })).status).toBe("ok");

    const audit = await pool.query<{ action: string; actor_kind: string | null; after: unknown }>(
      "select action, actor_kind, after from audit_event where race_id = $1 and action like 'MAP_LINK%' order by created_at, action", [owner.raceId]);
    expect(audit.rows.map(row => row.action)).toEqual(expect.arrayContaining(["MAP_LINK_CREATED", "MAP_LINK_OPENED", "MAP_LINK_REPLY", "MAP_LINK_VERDICT"]));
    expect(audit.rows.filter(row => row.action === "MAP_LINK_REPLY")).toHaveLength(1);
    expect(audit.rows.filter(row => row.action !== "MAP_LINK_CREATED").every(row => row.actor_kind === "COURSE_SETTING_MAP_LINK")).toBe(true);
    // Bara nyckelns hash sparas; nyckeln finns ingenstans i databasen.
    const stored = await pool.query<{ token_hash: string }>("select token_hash from course_setting_map_link where race_id = $1", [owner.raceId]);
    expect(stored.rows.map(row => row.token_hash)).toEqual([createHash("sha256").update(token).digest("hex")]);
    const dump = await pool.query<{ text: string }>(`select string_agg(t::text, ' ') as text from (select * from course_setting_map_link where race_id = $1
      union all select null, null, null, null, null, null, null, null, null, null) t`, [owner.raceId]);
    expect(dump.rows[0]!.text).not.toContain(token);
    expect(JSON.stringify(audit.rows)).not.toContain(token);
  });

  it("utgången, avstängd och ersatt länk avvisas likadant som en okänd, och avstängningen gäller direkt", async () => {
    const owner = await race("2026-11-20");
    await setUp(owner);
    const now = new Date("2026-11-05T12:00:00Z");
    const limited = await newLink(owner, { lastDay: "2026-11-27" }, now);
    const state = await created(readMapLinkAsAdmin(db, owner, now));
    expect(state.response).toMatchObject({ raceDate: "2026-11-20", today: "2026-11-05",
      link: { status: "ACTIVE", expiresAt: "2026-11-27T23:00:00.000Z", showRaceName: false, lastOpenedAt: null } });
    expect((await readMapLinkView(db, link(limited), new Date("2026-11-27T22:59:59Z"))).status).toBe("ok");
    expect(await readMapLinkView(db, link(limited), new Date("2026-11-27T23:00:00Z"))).toEqual({ status: "invalid" });
    expect((await created(readMapLinkAsAdmin(db, owner, new Date("2026-11-28T00:00:00Z")))).response.link).toMatchObject({ status: "EXPIRED" });
    // Ett sista datum som redan passerat godtas inte.
    expect((await createMapLinkAsAdmin(db, { ...owner, request: { formatVersion: 1, lastDay: "2026-11-04", showRaceName: false } }, now)).status)
      .toBe("invalid-request");

    // Ny länk: den förra slutar gälla.
    const first = await newLink(owner);
    const second = await newLink(owner);
    expect(await readMapLinkView(db, link(first))).toEqual({ status: "invalid" });
    expect((await readMapLinkView(db, link(second))).status).toBe("ok");
    expect((await created(readMapLinkAsAdmin(db, owner))).response.link?.lastOpenedAt).not.toBeNull();
    // Stäng av: nästa anrop avvisas, också skrivningar.
    expect((await created(revokeMapLinkAsAdmin(db, owner))).response.link).toBeNull();
    expect(await readMapLinkView(db, link(second))).toEqual({ status: "invalid" });
    expect(await replyViaMapLink(db, { ...link(second), noteId: randomUUID(), request: { formatVersion: 1, requestId: randomUUID(), text: "Hej",
      name: null } })).toEqual({ status: "invalid" });
    for (const token of ["A".repeat(43), "kort", `${second}x`, ""]) expect(await readMapLinkView(db, link(token)), token).toEqual({ status: "invalid" });
  });

  it("spärren räknar per IP-adress (också missar) och per länk", async () => {
    const owner = await race();
    await setUp(owner);
    const token = await newLink(owner);
    const limits = { perIp: 3, perToken: 5 };
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    expect((await readMapLinkView(db, { ...link("A".repeat(43), ip), limits })).status).toBe("invalid");
    expect((await readMapLinkView(db, { ...link(token, ip), limits })).status).toBe("ok");
    expect((await readMapLinkView(db, { ...link(token, ip), limits })).status).toBe("ok");
    expect(await readMapLinkView(db, { ...link(token, ip), limits })).toEqual({ status: "rate-limited" });
    // Från andra adresser räknas länken: fem anrop med den, sedan är den spärrad för alla.
    expect((await readMapLinkView(db, { ...link(token, "192.0.2.1"), limits })).status).toBe("ok");
    expect((await readMapLinkView(db, { ...link(token, "192.0.2.2"), limits })).status).toBe("ok");
    expect((await readMapLinkView(db, { ...link(token, "192.0.2.3"), limits })).status).toBe("ok");
    expect(await readMapLinkView(db, { ...link(token, "192.0.2.4"), limits })).toEqual({ status: "rate-limited" });
    // En timme senare går det igen.
    expect((await readMapLinkView(db, { ...link(token, ip), limits }, new Date(Date.now() + 61 * 60 * 1000))).status).toBe("ok");
  });

  it("bara den som får ändra skapar, läser och stänger av länken", async () => {
    const owner = await race();
    await setUp(owner);
    const editor = await person(owner, "COURSE_EDIT");
    expect((await createMapLinkAsAdmin(db, { ...editor, request: { formatVersion: 1, lastDay: null, showRaceName: false } })).status).toBe("ok");
    for (const level of ["COURSE_COMMENT", "COURSE_MAP"] as const) {
      const other = await person(owner, level);
      expect((await createMapLinkAsAdmin(db, { ...other, request: { formatVersion: 1, lastDay: null, showRaceName: false } })).status, level).toBe("forbidden");
      expect((await readMapLinkAsAdmin(db, other)).status, level).toBe("forbidden");
      expect((await revokeMapLinkAsAdmin(db, other)).status, level).toBe("forbidden");
    }
    const stranger = await registerTestAccount(db);
    expect((await readMapLinkAsAdmin(db, { raceId: owner.raceId, ...stranger.proof })).status).toBe("unauthorized");
    expect((await created(readMapLinkAsAdmin(db, owner))).response.link).toMatchObject({ status: "ACTIVE" });
    expect((await created(revokeMapLinkAsAdmin(db, editor))).response.link).toBeNull();
  });

  it("beslut 9: bara den som skrev en notis eller ett svar redigerar den; den tidigare texten sparas", async () => {
    const owner = await race();
    await setUp(owner);
    const editor = await person(owner, "COURSE_EDIT");
    const mapMaker = await person(owner, "COURSE_MAP");
    const error = await created(createCourseSettingNoteAsAdmin(db, { ...editor, request: note({ kind: "POINT", at: { x: 20, y: 20 } }, { kind: "MAP_ERROR" }) }));
    const noteId = error.note.id;
    const answered = await created(replyCourseSettingNoteAsAdmin(db, { ...mapMaker, noteId, request: { formatVersion: 1, requestId: randomUUID(),
      text: "Rättat" } }));
    const replyId = answered.note.replies[0]!.id;
    const edit = (text: string, expectedText: string) => ({ formatVersion: 1, text, expectedText });

    // Inte ägaren (som får ta bort allt) och inte någon annan.
    expect((await editCourseSettingNoteAsAdmin(db, { ...owner, noteId, request: edit("Ny text", "Stigen saknas") })).status).toBe("forbidden");
    expect((await editCourseSettingNoteAsAdmin(db, { ...owner, noteId, replyId, request: edit("Ny", "Rättat") })).status).toBe("forbidden");
    expect((await editCourseSettingNoteAsAdmin(db, { ...mapMaker, noteId, request: edit("Ny", "Stigen saknas") })).status).toBe("forbidden");

    const t1 = new Date("2026-11-05T10:00:00Z");
    const edited = await created(editCourseSettingNoteAsAdmin(db, { ...editor, noteId, request: edit("Stigen saknas norr om kullen", "Stigen saknas") }, t1));
    expect(edited.note).toMatchObject({ text: "Stigen saknas norr om kullen", editedAt: t1.toISOString() });
    // Bygger på en gammal text: konflikt, inget skrivs.
    expect((await editCourseSettingNoteAsAdmin(db, { ...editor, noteId, request: edit("Något annat", "Stigen saknas") })).status).toBe("conflict");
    // Kartritaren (MAP) redigerar sitt eget svar.
    const reply = await created(editCourseSettingNoteAsAdmin(db, { ...mapMaker, noteId, replyId, request: edit("Rättat i kartfilen", "Rättat") }, t1));
    expect(reply.note.replies[0]).toMatchObject({ text: "Rättat i kartfilen", editedAt: t1.toISOString() });
    const history = await pool.query<{ previous_text: string; reply_id: string | null }>(
      "select previous_text, reply_id from course_setting_note_edit where note_id = $1 order by edited_at, previous_text", [noteId]);
    expect(history.rows).toEqual([{ previous_text: "Rättat", reply_id: replyId }, { previous_text: "Stigen saknas", reply_id: null }]);

    // Kartritaren med länken ser "(ändrad)" men inte den tidigare texten.
    const token = await newLink(owner);
    const view = await readMapLinkView(db, link(token));
    expect(view.status === "ok" && view.response.mapErrors[0]).toMatchObject({ text: "Stigen saknas norr om kullen", editedAt: t1.toISOString(),
      replies: [{ text: "Rättat i kartfilen", editedAt: t1.toISOString() }] });
    expect(JSON.stringify(view)).not.toContain("\"Rättat\"");

    // Kopian tar med kartritarens svar med länken; ägaren tar fortfarande bort notisen (med historiken).
    await created(replyViaMapLink(db, { ...link(token), noteId, request: { formatVersion: 1, requestId: randomUUID(), text: "Från länken", name: null } }));
    const copy = await copyRaceAsAdmin(db, { ...owner, request: { formatVersion: 1, requestId: randomUUID(), eventName: "Kopian",
      raceName: "Kopian", raceDate: "2026-12-01", includePeople: true } });
    if (copy.status !== "copied") throw new Error(`Kopian skapades inte: ${copy.status}`);
    const copied = await pool.query<{ text: string; created_by: string | null; map_link_id: string | null }>(
      "select text, created_by, map_link_id from course_setting_note_reply where race_id = $1 order by created_at", [copy.response.raceId]);
    expect(copied.rows.some(row => row.text === "Från länken" && row.created_by === null && row.map_link_id !== null)).toBe(true);
    expect((await deleteCourseSettingNoteAsAdmin(db, { ...owner, noteId })).status).toBe("ok");
    expect((await pool.query("select 1 from course_setting_note_edit where note_id = $1", [noteId])).rowCount).toBe(0);
  });
});
