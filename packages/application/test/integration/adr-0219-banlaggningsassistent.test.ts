import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { readPpen } from "@o-tid/course-setting";
import { mapPointToWgs84 } from "@o-tid/map-file";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { saveRaceMapSourceAsAdmin } from "../../src/race-map-source";
import { importCourseSettingAsAdmin } from "../../src/course-setting";
import { listCourseSettingNotesAsAdmin } from "../../src/course-setting-notes";
import { handleMcpMessage } from "../../src/mcp";
import { AI_NOTE_PREFIX } from "../../src/mcp-course-setting";
import { accountOnRace, grantRacePerson, registerTestAccount } from "./accounts";
import { acceptRacePersonInvitations } from "../../src/race-person-invitations";

/**
 * Ägaren 2026-11-08: AI-banläggningsassistenten. Med behörigheten `banlaggning` ser kopplingen banläggningen där kontot har
 * behörighet (banor, nivå, kontroller, sträckor, varningar) och lämnar notiser med AI-märkning; utan den syns inga sådana
 * verktyg. Ett konto utan behörighet i tävlingen får inget.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219b_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_adr0219b_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

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

async function raceWithCourses() {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `assistent.${suffix}@test.o-tid.se`, displayName: "Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const proof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Nivågranskning", raceName: "Torsdag", raceDate: "2026-10-08",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const raceId = created.response.raceId;
  const entered = await accountOnRace(db, { ...proof, raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const owner = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const bytes = new Uint8Array(await readFile(new URL("maps/kartfil.omap", fixtures)));
  const saved = await saveRaceMapSourceAsAdmin(db, { ...owner, file: bytes, fileName: "kartfil.omap", image: png(992, 832), metadata: metadata() });
  if (saved.status !== "ok") throw new Error(saved.status);
  const ppen = await readFile(new URL("course-setting/kartfil.ppen", fixtures), "utf8");
  const { document } = readPpen(ppen);
  const imported = await importCourseSettingAsAdmin(db, { ...owner, request: { formatVersion: 1, expectedVersion: 0, document, fileName: "kartfil.ppen", ppen } });
  if (imported.status !== "ok") throw new Error("Inläsningen misslyckades");
  return { owner, accountId: account.response.accountId, document };
}

const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
type Result = { result?: { content: { text: string }[]; isError?: boolean } };
const parsed = (response: unknown) => JSON.parse((response as Result).result!.content[0]!.text) as Record<string, unknown>;

describe("ADR-0219: AI-banläggningsassistenten", () => {
  it("behörigheten banlaggning: banorna, nivån och notiser; utan den eller utan behörighet i tävlingen inget", async () => {
    const { owner, accountId, document } = await raceWithCourses();
    const both = ["kartprojekt", "banlaggning"] as const;
    const tools = await handleMcpMessage(db, accountId, { jsonrpc: "2.0", id: 1, method: "tools/list" }, {}, both);
    expect((tools?.result as { tools: { name: string }[] }).tools.map(tool => tool.name)).toEqual(expect.arrayContaining(
      ["list_map_projects", "list_course_settings", "course_overview", "add_course_note"]));
    const mapsOnly = await handleMcpMessage(db, accountId, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((mapsOnly?.result as { tools: { name: string }[] }).tools.map(tool => tool.name)).not.toContain("course_overview");
    expect((await handleMcpMessage(db, accountId, call(3, "list_course_settings")) as Result).result?.isError).toBe(true);

    const races = parsed(await handleMcpMessage(db, accountId, call(4, "list_course_settings"), {}, both));
    expect(races.races).toMatchObject([{ raceId: owner.raceId, race: "Torsdag", event: "Nivågranskning", access: "EDIT", courses: document.courses.length }]);
    const overview = parsed(await handleMcpMessage(db, accountId, call(5, "course_overview", { race_id: owner.raceId }), {}, both));
    const courses = overview.courses as { courseId: string; name: string; controls: { controlId: string; code: string | null; kind: string }[];
      legs: { straightMeters: number; fromControlId: string; toControlId: string }[] }[];
    expect(overview.mapScale).toBe(document.event.mapScale);
    expect(courses).toHaveLength(document.courses.length);
    const course = courses.find(row => row.controls.length > 2)!;
    expect(course.controls[0]!.kind).toBe("START");
    expect(course.legs).toHaveLength(course.controls.length - 1);
    expect(course.legs.every(leg => leg.straightMeters > 0)).toBe(true);

    const leg = course.legs[1]!;
    const note = parsed(await handleMcpMessage(db, accountId, call(6, "add_course_note", { race_id: owner.raceId,
      leg: { from_control_id: leg.fromControlId, to_control_id: leg.toControlId }, text: "Sträckan saknar vägval för nivån Orange." }), {}, both));
    expect(note.noteId).toEqual(expect.any(String));
    const notes = await listCourseSettingNotesAsAdmin(db, owner);
    if (notes.status !== "ok") throw new Error(notes.status);
    expect(notes.response.notes).toMatchObject([{ target: { kind: "LEG", from: leg.fromControlId, to: leg.toControlId },
      text: `${AI_NOTE_PREFIX}Sträckan saknar vägval för nivån Orange.`, createdBy: { accountId } }]);
    const missing = await handleMcpMessage(db, accountId, call(7, "add_course_note", { race_id: owner.raceId, control_id: "finns-inte", text: "x" }), {}, both);
    expect((missing as Result).result?.isError).toBe(true);

    // Ett annat konto: ingen tävling i listan, ingen översikt.
    const stranger = await registerTestAccount(db);
    expect(parsed(await handleMcpMessage(db, stranger.accountId, call(8, "list_course_settings"), {}, both)).races).toEqual([]);
    expect((await handleMcpMessage(db, stranger.accountId, call(9, "course_overview", { race_id: owner.raceId }), {}, both) as Result).result?.isError).toBe(true);
    // Med behörigheten Kommentera i banläggningen syns tävlingen och notiser går att lämna.
    const commenter = await registerTestAccount(db);
    const granted = await grantRacePerson(db, owner, owner.raceId, commenter.email, "COURSE_COMMENT" as never);
    if (granted.status !== "granted") throw new Error(granted.status);
    await acceptRacePersonInvitations(db, commenter.accountId, new Date(), owner.raceId);
    expect(parsed(await handleMcpMessage(db, commenter.accountId, call(10, "list_course_settings"), {}, both)).races).toMatchObject([{ access: "COMMENT" }]);
  });
});
