import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { applyEdit, emptyDocument, writePpen, type CourseSettingDocument, type CourseSettingEdit } from "@o-tid/course-setting";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { applySyncAsAdmin } from "../../src/source-sync";
import { importCourseSettingAsAdmin, previewCourseSettingTransferAsAdmin } from "../../src/course-setting";
import { listEntryRegistrationClassesAsAdmin, registerEntryAsAdmin } from "../../src/entry-registration";
import { changeEntryVariantAsAdmin } from "../../src/course-variant-assignment";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { changeRelayLegVariantAsAdmin } from "../../src/relay-admin-edit";
import { getRelayOverviewAsAdmin } from "../../src/relay-results";
import { accountOnRace } from "./accounts";

/**
 * ADR-0175, tillägg 2026-11-12 (c): kartorna trycks ur banläggningen. En gren tas bort där efter att löpare och lag fått
 * varianter; bokstäverna står kvar (E blir inte D), så "Överför till tävlingen" ger samma koder. Bara löpare och sträckor med
 * den borttagna grenen står i beskedet, med namn, kod och kontroller före och efter, och överföringen kräver bekräftelse.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_overfor_gren_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_overfor_gren_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function race() {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `gren.${suffix}@test.o-tid.se`, displayName: "Banläggare",
    password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Stockholm by Night", raceName: "Natt", raceDate: "2026-12-09",
      timeZone: "Europe/Stockholm", raceType: "STANDARD" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}
type Proof = Awaited<ReturnType<typeof race>>;

/** Banläggningen: Natt = S 31 [A:41 | B:42] 50 [C:61 | D:63 | E:64] 70 M för klassen "Natt lång". */
function nightDocument() {
  let document: CourseSettingDocument = emptyDocument({ title: "Stockholm by Night", mapScale: 10000 });
  const edit = (value: CourseSettingEdit) => { const result = applyEdit(document, value); document = result.document; return result.created ?? ""; };
  const control = (kind: "START" | "NORMAL" | "FINISH", x: number, y: number, code?: string) =>
    edit({ type: "ADD_CONTROL", kind, at: { x, y }, ...(code ? { code } : {}) });
  const start = control("START", 0, 0), finish = control("FINISH", 200, 0);
  const codes = Object.fromEntries(["31", "41", "42", "50", "61", "63", "64", "70"].map((code, index) => [code, control("NORMAL", 20 + index * 20, index % 2 * 10, code)]));
  const course = edit({ type: "ADD_COURSE", name: "Natt" });
  edit({ type: "UPDATE_COURSE", course, changes: { secondaryTitle: "Natt lång" } });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: start });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: finish });
  const at31 = edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["31"]! });
  const at50 = edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["50"]! });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["70"]! });
  edit({ type: "ADD_SPLIT", course, at: at31, kind: "FORK", branches: 2 });
  const first = document.courseControls[at31]!.split!.branches;
  edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["41"]!, after: first[0]! });
  edit({ type: "INSERT_COURSE_CONTROL", course, control: codes["42"]!, after: first[1]! });
  edit({ type: "ADD_SPLIT", course, at: at50, kind: "FORK", branches: 3 });
  const second = document.courseControls[at50]!.split!.branches;
  for (const [index, code] of ["61", "63", "64"].entries()) edit({ type: "INSERT_COURSE_CONTROL", course, control: codes[code]!, after: second[index]! });
  return { document, course, second };
}

async function save(proof: Proof, document: CourseSettingDocument, expectedVersion: number) {
  const saved = await importCourseSettingAsAdmin(db, { ...proof, request: { formatVersion: 1, expectedVersion, document,
    fileName: "natt.ppen", ppen: writePpen(document) } });
  expect(saved.status).toBe("ok");
}

async function preview(proof: Proof, version: number) {
  const result = await previewCourseSettingTransferAsAdmin(db, { ...proof, request: { formatVersion: 1, version } });
  if (result.status !== "ok") throw new Error(`Förhandsvisningen saknas: ${result.status}`);
  return result.response;
}

async function apply(proof: Proof, snapshotId: string, confirmResultChanges: boolean) {
  const requestId = randomUUID();
  return applySyncAsAdmin(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request: { formatVersion: 1, requestId, snapshotId,
    excludedRowIds: [], confirmResultChanges } });
}

const raceVariants = async (raceId: string) => (await pool.query<{ code: string }>(`select cv.code from course_variant cv
  join course_version v on v.id = cv.course_version_id join course c on c.id = v.course_id
  where c.race_id = $1 and c.name = 'Natt' and v.version = (select max(version) from course_version where course_id = c.id) order by cv.sequence`,
[raceId])).rows.map(row => row.code);

const entryCodes = async (raceId: string) => Object.fromEntries((await pool.query<{ given_name: string; course_variant_code: string | null }>(
  "select given_name, course_variant_code from entry where race_id = $1", [raceId])).rows.map(row => [row.given_name, row.course_variant_code]));

describe("Överför till tävlingen efter en borttagen gren (tillägg 2026-11-12 c)", () => {
  it("bokstäverna står kvar; bara löpare och sträckor med den borttagna grenen står i beskedet, som kräver bekräftelse", async () => {
    const proof = await race();
    const { document, course, second } = nightDocument();
    await save(proof, document, 0);
    const first = await preview(proof, 1);
    expect((await apply(proof, first.snapshotId, true)).status).toBe("saved");
    expect(await raceVariants(proof.raceId)).toEqual(["AC", "AD", "AE", "BC", "BD", "BE"]);

    // Tre löpare i Natt lång med bestämda varianter (som före tryck).
    const classes = await listEntryRegistrationClassesAsAdmin(db, proof);
    if (classes.status !== "ok") throw new Error("Klasserna saknas");
    const nattLang = classes.response.classes.find(row => row.name === "Natt lång")!;
    for (const [given, code] of [["Ada", "AC"], ["Bo", "AD"], ["Cia", "AE"]] as const) {
      const registered = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: { formatVersion: 1,
        classId: nattLang.id, expectedCourseVersionId: nattLang.courseVersionId, expectedStartRule: nattLang.startRule, givenName: given,
        familyName: "Natt", organisationName: "OK Natt", cardNumber: null, fixedStartTime: null } });
      if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
      const current = (await pool.query<{ version: number; course_variant_code: string | null }>("select version, course_variant_code from entry where id = $1",
        [registered.response.entryId])).rows[0]!;
      if (current.course_variant_code === code) continue;
      const requestId = randomUUID();
      const changed = await changeEntryVariantAsAdmin(db, { ...proof, idempotencyKey: `entry-variant:${requestId}`, request: { formatVersion: 1,
        requestId, expectedEntryVersion: current.version, entryId: registered.response.entryId, variantCode: code, confirmResultChanges: true } });
      expect(changed.status).toBe("changed");
    }
    // Ett stafettlag på samma bana: sträcka 1 BD, sträcka 2 BE.
    const courseId = (await pool.query<{ id: string }>("select id from course where race_id = $1 and name = 'Natt'", [proof.raceId])).rows[0]!.id;
    const classRequest = randomUUID();
    const relay = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${classRequest}`, request: { formatVersion: 1,
      requestId: classRequest, name: "Nattstafett", courseId, legs: [1, 2].map(leg => ({ leg, startTime: leg === 1 ? "2026-12-09T17:00:00.000Z" : null,
        variantCode: null, courseId: null, restartAfterMinutes: null, startMethod: leg === 1 ? "MASS_START" : "CHANGEOVER" })) } });
    if (relay.status !== "saved") throw new Error("Stafettklassen kunde inte skapas");
    const teamRequest = randomUUID();
    expect((await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${teamRequest}`, request: { formatVersion: 1,
      requestId: teamRequest, classId: relay.response.classId, number: null, name: "Lag Natt", organisationName: "OK Natt",
      runners: ["Lag1", "Lag2"].map(given => ({ givenName: given, familyName: "Löpare", organisationName: null, cardNumber: null })) } })).status).toBe("saved");
    for (const [index, code] of ["BD", "BE"].entries()) {
      const view = await getRelayOverviewAsAdmin(db, proof);
      if (view.status !== "ok") throw new Error("Lagvyn saknas");
      const team = view.response.teams[0]!, leg = team.legs[index]!;
      if (leg.variantCode === code) continue;
      const id = randomUUID();
      expect((await changeRelayLegVariantAsAdmin(db, { ...proof, idempotencyKey: `relay-leg-variant:${id}`, request: { formatVersion: 1,
        requestId: id, teamId: team.id, leg: index + 1, expectedEntryVersion: leg.entryVersion, variantCode: code, confirmResultChanges: true } })).status)
        .toBe("saved");
    }
    expect(await entryCodes(proof.raceId)).toMatchObject({ Ada: "AC", Bo: "AD", Cia: "AE", Lag1: "BD", Lag2: "BE" });

    // I banläggningen tas grenen D (63) bort. E står kvar som E (Purple Pen hade döpt om den till D).
    const removed = applyEdit(document, { type: "REMOVE_COURSE_CONTROL", course, courseControl: second[1]! }).document;
    await save(proof, removed, 1);
    const transfer = await preview(proof, 2);
    expect(transfer.consequence.requiresConfirmation).toBe(true);
    expect(transfer.consequence.variantChanges!.map(row => [row.displayName, row.className, row.leg ?? null, row.code, row.beforeControls, row.afterControls]))
      .toEqual([["Bo Natt", "Natt lång", null, "AD", [31, 41, 50, 63, 70], null], ["Lag1 Löpare", "Nattstafett", 1, "BD", [31, 42, 50, 63, 70], null]]);
    // Utan bekräftelse sparas inget; med bekräftelse får tävlingen banläggningens koder och Cia (AE) samma kontroller som förut.
    expect((await apply(proof, transfer.snapshotId, false)).status).toBe("confirmation-required");
    expect(await raceVariants(proof.raceId)).toEqual(["AC", "AD", "AE", "BC", "BD", "BE"]);
    expect((await apply(proof, transfer.snapshotId, true)).status).toBe("saved");
    expect(await raceVariants(proof.raceId)).toEqual(["AC", "AE", "BC", "BE"]);
    const cia = (await pool.query<{ codes: number[] }>(`select array_agg(ct.code order by cvc.sequence) as codes from course_variant cv
      join course_variant_control cvc on cvc.course_variant_id = cv.id join control ct on ct.id = cvc.control_id
      join course_version v on v.id = cv.course_version_id join course c on c.id = v.course_id
      where c.race_id = $1 and c.name = 'Natt' and cv.code = 'AE' and v.version = (select max(version) from course_version where course_id = c.id)`,
    [proof.raceId])).rows[0]!;
    expect(cia.codes).toEqual([31, 41, 50, 64, 70]);
    expect(await entryCodes(proof.raceId)).toMatchObject({ Ada: "AC", Cia: "AE", Lag2: "BE" });
  }, 180_000);
});
