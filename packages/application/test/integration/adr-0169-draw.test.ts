import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { type DeviceBatch, type SportidentReadoutPayload, type StartDrawPreviewResponse } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { commitStartDrawAsAdministrator, loadStartDrawSetupAsAdministrator, previewStartDrawAsAdministrator } from "../../src/start-draw";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { exportCurrentStartListXmlAsAdmin, getStartListPublicationPreviewAsAdmin } from "../../src/start-list-publication";
import { publicResults } from "../../src/results";
import { exportPublicIofResultList } from "../../src/result-list-export";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Lottningstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0169_draw_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0169_draw_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const MINUTE = 60_000;
const firstStart = "2026-10-08T08:00:00.000Z"; // 10:00 i Stockholm
/** Nu, före tävlingsdagen (2026-10-08). Läses vid varje anrop så att sessionen redan finns. */
const before = () => new Date();
type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
type Race = { proof: Proof; raceId: string; classes: Record<"H21" | "D21" | "H16", string> };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function race(): Promise<Race> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `lotta.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbtävling", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const classes = {} as Race["classes"];
  for (const [courseName, className, controlCodes] of [["Lång", "H21", [31, 32, 33]], ["Mellan", "D21", [31, 34, 33]],
    ["Kort", "H16", [45, 33]]] as const) {
    const requestId = randomUUID();
    const result = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
      request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(raceId), courseName, className,
        startRule: "PUNCH", controlCodes: [...controlCodes] } });
    if (result.status !== "created") throw new Error(`Banan kunde inte skapas: ${result.status}`);
    classes[className] = result.response.classId;
  }
  return { proof, raceId, classes };
}

async function classRow(classId: string) {
  return (await pool.query<{ start_rule: "FIXED" | "PUNCH"; course_version_id: string; start_draw_id: string | null }>(
    "select start_rule, course_version_id, start_draw_id from class where id = $1", [classId])).rows[0]!;
}

async function register(f: Race, classId: string, givenName: string, club: string | null, cardNumber: string | null, now = before()) {
  const row = await classRow(classId);
  return registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId, expectedCourseVersionId: row.course_version_id, expectedStartRule: row.start_rule,
    expectedSnapshotVersion: await snapshot(f.raceId), givenName, familyName: "Löpare", organisationName: club,
    cardNumber, fixedStartTime: null } }, now);
}

async function readout(f: Race, cardNumber: string, codes: number[],
  punches = codes.map((code, index) => ({ code, punchedAt: `2026-10-08T08:${String(35 + index * 5).padStart(2, "0")}:00.000Z` })),
  finishPunchedAt = "2026-10-08T09:00:00.000Z") {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: "2026-10-08T08:30:00.000Z", finishPunchedAt,
    punches,
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T09:01:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...f.proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

function settings(f: Race, expectedSnapshotVersion: number, method: "MINUTE" | "MASS" | "FREE" = "MINUTE") {
  return { expectedSnapshotVersion, firstStartTime: firstStart, clubSeparation: true,
    classes: (["H21", "D21", "H16"] as const).map(name => ({ classId: f.classes[name], method, intervalMinutes: 2,
      vacancies: { kind: "COUNT" as const, value: 1 } })) };
}

async function preview(f: Race, request: ReturnType<typeof settings>): Promise<StartDrawPreviewResponse> {
  const result = await previewStartDrawAsAdministrator(db, { ...f.proof, request: { formatVersion: 1, ...request } }, before());
  if (result.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${result.status}`);
  return result.response;
}

function commit(f: Race, request: ReturnType<typeof settings>, seed: number, confirmChanges: boolean, requestId: string = randomUUID()) {
  return commitStartDrawAsAdministrator(db, { ...f.proof, idempotencyKey: `start-draw:${requestId}`,
    request: { formatVersion: 1, requestId, seed, ...request, confirmChanges } }, before());
}

const minutes = (preview: StartDrawPreviewResponse, classId: string) =>
  preview.classes.find(row => row.classId === classId)!.slots.map(slot => (Date.parse(slot.startTime) - Date.parse(firstStart)) / MINUTE);

describe("PLAN.md steg 9: lottning på riktigt", () => {
  it("lottar tre klasser med startfålla, vakanser och klubbseparering, och efteranmälda får vakanta tider", async () => {
    const f = await race();
    const clubs = ["OK Ek", "OK Ek", "IFK Lidingö", "Tullinge SK"];
    for (const name of ["H21", "D21", "H16"] as const) {
      for (const [index, club] of clubs.entries()) {
        const registered = await register(f, f.classes[name], `${name}-${index}`, club, name === "H16" && index === 0 ? "700001" : null);
        expect(registered.status).toBe("registered");
      }
    }
    // En löpare i H16 har redan läst ut med fri start; lottningen ger fast tid och resultatet räknas om.
    await readout(f, "700001", [45, 33]);
    const setup = await loadStartDrawSetupAsAdministrator(db, f.proof, before());
    if (setup.status !== "ok") throw new Error("Klasserna saknas");
    expect(setup.response.classes.map(row => [row.name, row.method, row.firstControlCode, row.entryCount])).toEqual([
      ["D21", "FREE", 31, 4], ["H16", "FREE", 45, 4], ["H21", "FREE", 31, 4]]);

    const version = await snapshot(f.raceId);
    const shown = await preview(f, settings(f, version));
    expect(await snapshot(f.raceId)).toBe(version);
    expect(shown.startGroups.map(group => ({ ...group, classNames: [...group.classNames].sort() })))
      .toEqual([{ firstControlCode: 31, classNames: ["D21", "H21"], alternating: true }]);
    const h21 = minutes(shown, f.classes.H21), d21 = minutes(shown, f.classes.D21), h16 = minutes(shown, f.classes.H16);
    expect(new Set([...h21, ...d21]).size).toBe(h21.length + d21.length);
    expect([h21[0], d21[0]].sort()).toEqual([0, 1]);
    expect(h16).toEqual([0, 2, 4, 6, 8]);
    for (const raceClass of shown.classes) {
      expect(raceClass.slots).toHaveLength(5);
      expect(raceClass.vacancyCount).toBe(1);
      const vacant = raceClass.slots.findIndex(slot => slot.entry === null);
      expect(vacant).toBeGreaterThan(0); expect(vacant).toBeLessThan(4);
      const runners = raceClass.slots.flatMap(slot => slot.entry ? [slot.entry.club] : []);
      expect(runners.some((club, index) => index > 0 && club === runners[index - 1])).toBe(false);
    }
    expect(shown.readOutCount).toBe(1);
    expect(shown.requiresConfirmation).toBe(false);

    const saved = await commit(f, settings(f, version), shown.seed, false);
    if (saved.status !== "drawn") throw new Error(`Lottningen sparades inte: ${saved.status}`);
    expect(saved.response).toMatchObject({ classCount: 3, entryCount: 12, vacancyCount: 3, recalculatedCount: 1,
      snapshotVersionAfter: version + 1 });
    // Samma frö och samma underlag ger exakt förhandsvisningens tider.
    const stored = await pool.query<{ id: string; fixed_start_time: Date }>("select id, fixed_start_time from entry where race_id = $1", [f.raceId]);
    const expected = new Map(shown.classes.flatMap(row => row.slots.flatMap(slot => slot.entry ? [[slot.entry.id, slot.startTime]] : [])));
    for (const row of stored.rows) expect(row.fixed_start_time.toISOString()).toBe(expected.get(row.id));
    for (const name of ["H21", "D21", "H16"] as const) {
      const row = await classRow(f.classes[name]);
      expect(row.start_rule).toBe("FIXED"); expect(row.start_draw_id).not.toBeNull();
    }
    const revisions = await pool.query<{ cause: string }>(`select r.cause from result_revision r join card_assignment a on a.entry_id = r.entry_id
      where a.card_number = '700001' order by r.revision`);
    expect(revisions.rows.map(row => row.cause)).toEqual(["CARD_READOUT", "EXPLICIT_RECALCULATION"]);
    const replay = await commit(f, settings(f, version), shown.seed, false, saved.response.requestId);
    expect(replay).toMatchObject({ status: "drawn", response: { replayed: true } });

    // PLAN.md steg 13: startlistornas fakta (startfålla, startsätt, vakanta tider) i arbetsytan och i publiceringen,
    // och IOF XML för startlistan som den ser ut nu.
    const vacancies = (name: "H21" | "D21" | "H16") => shown.classes.find(row => row.classId === f.classes[name])!.slots
      .flatMap(slot => slot.entry ? [] : [slot.startTime]);
    const facts = async () => {
      const listed = await listEntryTransfersAsAdministrator(db, f.proof, before());
      if (listed.status !== "ok") throw new Error("Deltagarlistan saknas");
      return Object.fromEntries(listed.response.classes.map(row => [row.name, [row.firstControlCode, row.drawMethod, row.vacancies]]));
    };
    expect(await facts()).toEqual({ D21: [31, "MINUTE", vacancies("D21")], H16: [45, "MINUTE", vacancies("H16")], H21: [31, "MINUTE", vacancies("H21")] });
    const publication = await getStartListPublicationPreviewAsAdmin(db, f.proof, before());
    if (publication.status !== "ok" || !publication.response.content) throw new Error("Publiceringen saknas");
    expect(publication.response.content.classes.map(row => [row.name, row.courseName, row.firstControlCode, row.drawMethod, row.vacancies]))
      .toEqual([["D21", "Mellan", 31, "MINUTE", vacancies("D21")], ["H16", "Kort", 45, "MINUTE", vacancies("H16")],
        ["H21", "Lång", 31, "MINUTE", vacancies("H21")]]);
    const startXml = await exportCurrentStartListXmlAsAdmin(db, f.proof, before());
    if (startXml.status !== "exported") throw new Error(`Startlistan saknas: ${startXml.status}`);
    expect(startXml.xml.match(/<PersonStart>/g)).toHaveLength(12);

    // Efteranmäld: första lediga vakanta tid efter nu, utan att admin väljer tid.
    const vacantH21 = shown.classes.find(row => row.classId === f.classes.H21)!.slots.find(slot => slot.entry === null)!.startTime;
    const late = await register(f, f.classes.H21, "Sen", "OK Ek", null);
    if (late.status !== "registered") throw new Error(`Efteranmälan misslyckades: ${late.status}`);
    expect(late.response).toMatchObject({ fixedStartTime: vacantH21, startTimeAssigned: true });
    expect((await facts()).H21).toEqual([31, "MINUTE", []]);
    // Vakanserna slut: första minut efter klassens sista start som D21 inte använder.
    const later = await register(f, f.classes.H21, "Senare", "IFK Lidingö", null);
    if (later.status !== "registered") throw new Error(`Efteranmälan misslyckades: ${later.status}`);
    const next = (Date.parse(later.response.fixedStartTime!) - Date.parse(firstStart)) / MINUTE;
    expect(next).toBe(Math.max(...h21) + 2);
    expect(d21).not.toContain(next);
    // Ny lottning med gammalt läge avvisas; med aktuellt läge krävs bekräftelse eftersom tider ersätts.
    expect((await commit(f, settings(f, version), shown.seed, true)).status).toBe("conflict");
    const current = await snapshot(f.raceId);
    const again = await preview(f, settings(f, current, "MASS"));
    expect(again.replacesStartTimes).toBe(true);
    expect(again.classes.every(row => new Set(row.slots.map(slot => slot.startTime)).size === 1)).toBe(true);
    expect((await commit(f, settings(f, current, "MASS"), again.seed, false)).status).toBe("confirmation-required");
    expect(await snapshot(f.raceId)).toBe(current);
    const mass = await commit(f, settings(f, current, "MASS"), again.seed, true);
    expect(mass.status).toBe("drawn");
    expect((await facts()).H16).toEqual([45, "MASS", []]);
    const massLate = await register(f, f.classes.H16, "Mass", null, null);
    if (massLate.status !== "registered") throw new Error(`Efteranmälan misslyckades: ${massLate.status}`);
    expect(massLate.response.fixedStartTime).toBe(again.classes.find(row => row.classId === f.classes.H16)!.firstStartTime);

    // Fri start: klassen får startstämpling och inga tider; efteranmälan utan tid går igen.
    const free = await preview(f, { ...settings(f, await snapshot(f.raceId), "FREE"), classes: settings(f, 1, "FREE").classes.slice(0, 1) });
    const freed = await commit(f, { ...settings(f, await snapshot(f.raceId), "FREE"), classes: settings(f, 1, "FREE").classes.slice(0, 1) },
      free.seed, true);
    expect(freed.status).toBe("drawn");
    expect(await classRow(f.classes.H21)).toMatchObject({ start_rule: "PUNCH", start_draw_id: null });
    expect((await pool.query("select 1 from entry where class_id = $1 and fixed_start_time is not null", [f.classes.H21])).rowCount).toBe(0);
  });

  it("en kontroll stämplad före den lottade starten fäller inte resultatlistan (PLAN.md steg 13)", async () => {
    const f = await race();
    for (const [index, card] of ["700101", "700102"].entries()) {
      expect((await register(f, f.classes.H21, `Tidig-${index}`, "OK Ek", card)).status).toBe("registered");
    }
    const version = await snapshot(f.raceId);
    const one = { ...settings(f, version), classes: settings(f, version).classes.slice(0, 1) };
    const shown = await preview(f, { ...one, classes: one.classes.map(row => ({ ...row, vacancies: { kind: "COUNT" as const, value: 0 } })) });
    const drawn = await commit(f, { ...one, classes: one.classes.map(row => ({ ...row, vacancies: { kind: "COUNT" as const, value: 0 } })) },
      shown.seed, false);
    expect(drawn.status).toBe("drawn");
    const starts = await pool.query<{ id: string; card: string; fixed_start_time: Date }>(`select e.id, a.card_number as card, e.fixed_start_time
      from entry e join card_assignment a on a.entry_id = e.id where e.race_id = $1 order by a.card_number`, [f.raceId]);
    // Löparen stämplar 31 en minut före sin lottade start (fel klocka eller tjuvstart), sedan 32 och 33 och mål.
    const early = starts.rows[0]!, start = early.fixed_start_time.getTime(), at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
    await readout(f, early.card, [], [{ code: 31, punchedAt: at(-1) }, { code: 32, punchedAt: at(10) }, { code: 33, punchedAt: at(20) }], at(30));

    const listed = await publicResults(db, f.raceId);
    const row = listed.results.find(result => result.givenName === "Tidig-0")!;
    expect(row).toMatchObject({ status: "OK", reason: "COMPLETE", elapsedMs: 30 * 60_000, position: 1 });
    expect("splits" in row && row.splits).toEqual([{ controlCode: 32, occurrence: 1, elapsedMs: 10 * 60_000, legMs: 10 * 60_000 },
      { controlCode: 33, occurrence: 1, elapsedMs: 20 * 60_000, legMs: 10 * 60_000 }]);
    const effective = await getAdministratorEffectiveResult(db, { ...f.proof, entryId: early.id }, before());
    if (effective.status !== "ok" || effective.response.state !== "ACTIVE_RESULT") throw new Error("Resultatet saknas");
    expect(effective.response.controlDetails?.untimedControls).toEqual([31]);
    const iof = await exportPublicIofResultList(db, f.raceId);
    if (iof.status !== "ok") throw new Error(`Exporten misslyckades: ${iof.status}`);
    expect(new TextDecoder().decode(iof.bytes)).toMatch(/<SplitTime status="OK">\s*<ControlCode>31<\/ControlCode>\s*<\/SplitTime>/);

    // En lagrad rad med ogiltiga sträcktider (t.ex. från en äldre version) fäller inte heller listan: den visas utan sträcktider.
    const other = starts.rows[1]!;
    await readout(f, other.card, [31, 32, 33], [{ code: 31, punchedAt: new Date(other.fixed_start_time.getTime() + 60_000).toISOString() },
      { code: 32, punchedAt: new Date(other.fixed_start_time.getTime() + 120_000).toISOString() },
      { code: 33, punchedAt: new Date(other.fixed_start_time.getTime() + 180_000).toISOString() }],
      new Date(other.fixed_start_time.getTime() + 240_000).toISOString());
    // Lagrade revisioner kan inte ändras; skyddet stängs av bara i den här testdatabasen för att efterlikna gammal data.
    await pool.query("alter table result_revision disable trigger user");
    await pool.query(`update result_revision set evaluation = jsonb_set(evaluation, '{splits,0,elapsedMs}', '-60000'::jsonb)
      where entry_id = $1`, [other.id]);
    await pool.query("alter table result_revision enable trigger user");
    const robust = await publicResults(db, f.raceId);
    expect(robust.results.map(result => [result.givenName, result.status])).toEqual(expect.arrayContaining([["Tidig-0", "OK"], ["Tidig-1", "OK"]]));
    expect(robust.results.find(result => result.givenName === "Tidig-1")).toMatchObject({ splits: [] });
  });

  it("vägrar fast start utan tid i en klass som inte är lottad", async () => {
    const f = await race();
    await pool.query("update class set start_rule = 'FIXED' where id = $1", [f.classes.H21]);
    expect((await register(f, f.classes.H21, "Ingen", null, null)).status).toBe("conflict");
  });
});
