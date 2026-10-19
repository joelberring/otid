import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { StartDrawPreviewRequest, StartDrawPreviewResponse } from "@o-tid/contracts";
import { createOrganizerEvent } from "../../src/organizer-events";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { commitStartDrawAsAdmin, loadStartDrawSetupAsAdmin, previewStartDrawAsAdmin } from "../../src/start-draw";
import { accountOnRace, registerTestAccount } from "./accounts";

/**
 * PLAN.md steg 26: avancerad lottning genom applikationstjänsten. En klass lottas, en klass som läggs till
 * senare lottas för sig med senare start och en seedad löpare, utan att den första klassens tider rörs.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Lottningstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg26_draw_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg26_draw_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const MINUTE = 60_000;
const firstStart = "2027-10-07T08:00:00.000Z"; // 10:00 i Stockholm
type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Settings = Omit<StartDrawPreviewRequest, "formatVersion">;

async function race() {
  const account = await registerTestAccount(db);
  const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbtävling", raceName: "Torsdag", raceDate: "2027-10-07", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...account.proof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  return proof;
}

async function addClass(proof: Proof, courseName: string, className: string, controlCodes: number[]) {
  const requestId = randomUUID();
  const result = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, courseName, className, startRule: "PUNCH", controlCodes } });
  if (result.status !== "created") throw new Error(`Banan kunde inte skapas: ${result.status}`);
  return result.response.classId;
}

async function register(proof: Proof, classId: string, givenName: string) {
  const { rows } = await pool.query<{ start_rule: "FIXED" | "PUNCH"; course_version_id: string }>(
    "select start_rule, course_version_id from class where id = $1", [classId]);
  const result = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId, expectedCourseVersionId: rows[0]!.course_version_id, expectedStartRule: rows[0]!.start_rule,
    givenName, familyName: "Löpare", organisationName: `Klubb ${givenName}`, cardNumber: null, fixedStartTime: null } }, new Date());
  if (result.status !== "registered") throw new Error(`Anmälan avvisades: ${result.status}`);
  return result.response.entryId;
}

async function preview(proof: Proof, settings: Settings): Promise<StartDrawPreviewResponse> {
  const result = await previewStartDrawAsAdmin(db, { ...proof, request: { formatVersion: 1, ...settings } }, new Date());
  if (result.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${result.status}`);
  return result.response;
}

async function draw(proof: Proof, settings: Settings) {
  const shown = await preview(proof, settings);
  const requestId = randomUUID();
  const saved = await commitStartDrawAsAdmin(db, { ...proof, idempotencyKey: `start-draw:${requestId}`,
    request: { formatVersion: 1, requestId, seed: shown.seed, ...settings, confirmChanges: shown.requiresConfirmation } }, new Date());
  if (saved.status !== "drawn") throw new Error(`Lottningen sparades inte: ${saved.status}`);
  return shown;
}

const minuteClass = (classId: string, extra: Partial<Settings["classes"][number]> = {}) =>
  ({ classId, method: "MINUTE" as const, intervalMinutes: 2, vacancies: { kind: "COUNT" as const, value: 0 }, ...extra });
async function times(classId: string) {
  const { rows } = await pool.query<{ id: string; fixed_start_time: Date }>(
    "select id, fixed_start_time from entry where class_id = $1 order by fixed_start_time, id", [classId]);
  return rows.map(row => [row.id, (row.fixed_start_time.getTime() - Date.parse(firstStart)) / MINUTE] as const);
}

describe("PLAN.md steg 26: avancerad lottning", () => {
  it("lottar en efteranmäld klass för sig med senare start och seedad sist, utan att röra den lottade klassen", async () => {
    const proof = await race();
    const h21 = await addClass(proof, "Lång", "H21", [31, 32, 33]);
    for (const name of ["A", "B", "C", "D", "E"]) await register(proof, h21, `H21${name}`);
    await draw(proof, { firstStartTime: firstStart, clubSeparation: true, classes: [minuteClass(h21)] });
    const before = await times(h21);
    expect(before.map(([, minute]) => minute)).toEqual([0, 2, 4, 6, 8]);

    // En klass läggs till efter lottningen och lottas för sig: +5 min, med en seedad löpare.
    const d21 = await addClass(proof, "Mellan", "D21", [31, 34, 33]);
    const d21Entries = [];
    for (const name of ["A", "B", "C", "D"]) d21Entries.push(await register(proof, d21, `D21${name}`));
    const seeded = d21Entries[1]!;
    const rules = { groupControls: 1, maxPerMinute: null, maxPerMinutePerPen: null, lastStartTime: "2027-10-07T08:10:00.000Z",
      seeding: "LAST" as const, classOrder: null };
    const settings: Settings = { firstStartTime: firstStart, clubSeparation: true, rules, seeds: [{ entryId: seeded, rank: 1 }],
      classes: [minuteClass(d21, { laterStart: { kind: "OFFSET", minutes: 5 } })] };
    const shown = await preview(proof, settings);
    const slots = shown.classes[0]!.slots;
    // Samma första kontroll som H21: D21 startar på udda minuter från +5, den seedade sist.
    expect(slots.map(slot => (Date.parse(slot.startTime) - Date.parse(firstStart)) / MINUTE)).toEqual([5, 7, 9, 11]);
    expect(slots.at(-1)!.entry).toMatchObject({ id: seeded, seedRank: 1 });
    expect(shown.existingClasses).toEqual([{ className: "H21", startCount: 5, firstStartTime: firstStart, lastStartTime: "2027-10-07T08:08:00.000Z" }]);
    expect(shown.timeline.map(row => [(Date.parse(row.startTime) - Date.parse(firstStart)) / MINUTE, row.starts.map(start => [start.className, start.existing])]))
      .toEqual([[0, [["H21", true]]], [2, [["H21", true]]], [4, [["H21", true]]], [5, [["D21", false]]], [6, [["H21", true]]],
        [7, [["D21", false]]], [8, [["H21", true]]], [9, [["D21", false]]], [11, [["D21", false]]]]);
    // Sista start 10:10 räcker inte: den sista som behövs är 10:11.
    expect(shown.warnings).toEqual([{ code: "AFTER_LAST_START", classNames: ["D21"], lastStartTime: "2027-10-07T08:10:00.000Z",
      firstAfterTime: "2027-10-07T08:11:00.000Z", neededLastStartTime: "2027-10-07T08:11:00.000Z" }]);
    expect(shown.replacesStartTimes).toBe(false);
    await draw(proof, settings);

    expect(await times(h21)).toEqual(before);
    const after = await times(d21);
    expect(after.at(-1)).toEqual([seeded, 11]);
    const { rows } = await pool.query<{ id: string; seed_rank: number | null }>("select id, seed_rank from entry where class_id = $1", [d21]);
    expect(rows.filter(row => row.seed_rank !== null)).toEqual([{ id: seeded, seed_rank: 1 }]);

    // Inställningarna och seedningen finns kvar nästa gång.
    const setup = await loadStartDrawSetupAsAdmin(db, proof, new Date());
    if (setup.status !== "ok") throw new Error("Klasserna saknas");
    expect(setup.response.settings).toEqual({ rules, laterStarts: [{ classId: d21, laterStart: { kind: "OFFSET", minutes: 5 } }] });
    expect(setup.response.entries.find(entry => entry.id === seeded)).toMatchObject({ classId: d21, name: "D21B Löpare", seedRank: 1 });

    // Lottas om utan seedning i begäran: den sparade seedningen gäller.
    const again = await preview(proof, { firstStartTime: firstStart, clubSeparation: true, classes: [minuteClass(d21)] });
    expect(again.classes[0]!.slots.at(-1)!.entry).toMatchObject({ id: seeded, seedRank: 1 });
    expect(again.replacesStartTimes).toBe(true);
  });

  it("håller taket per minut mot befintliga tider och två kontroller avgör startgruppen", async () => {
    const proof = await race();
    const a = await addClass(proof, "A", "A", [31, 32]);
    const b = await addClass(proof, "B", "B", [31, 33]);
    for (const name of ["1", "2", "3"]) { await register(proof, a, `A${name}`); await register(proof, b, `B${name}`); }
    await draw(proof, { firstStartTime: firstStart, clubSeparation: false, classes: [minuteClass(a, { intervalMinutes: 1 })] });
    const two = { groupControls: 2, maxPerMinute: null, maxPerMinutePerPen: null, lastStartTime: null, seeding: "LAST" as const, classOrder: null };
    const parallel = await preview(proof, { firstStartTime: firstStart, clubSeparation: false, rules: two,
      classes: [minuteClass(b, { intervalMinutes: 1 })] });
    expect(parallel.classes[0]!.firstStartTime).toBe(firstStart);
    expect(parallel.startGroups).toEqual([]);
    const capped = await preview(proof, { firstStartTime: firstStart, clubSeparation: false, rules: { ...two, maxPerMinute: 1 },
      classes: [minuteClass(b, { intervalMinutes: 1 })] });
    expect(capped.classes[0]!.firstStartTime).toBe("2027-10-07T08:03:00.000Z");
  });
});
