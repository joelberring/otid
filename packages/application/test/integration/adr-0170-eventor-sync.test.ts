import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload, SyncPreviewResponse } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import { eventorConfigurationFromEnvironment } from "../../src/eventor-secret";
import {
  chooseEventorEventAsAdministrator, getEventorSettingsAsAdministrator, listEventorEventsAsAdministrator, removeEventorKeyAsAdministrator,
  saveEventorKeyAsAdministrator, type EventorRuntime
} from "../../src/eventor-link";
import {
  applySyncAsAdministrator, getSourceSyncStatusAsAdministrator, previewCourseFileAsAdministrator, previewEventorSyncAsAdministrator,
  syncConsequenceAsAdministrator
} from "../../src/source-sync";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0170-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0170_eventor_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0170_eventor_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const fixture = (path: string) => readFileSync(new URL(`../../../../fixtures/${path}`, import.meta.url), "utf8");
const API_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

/** Falsk Eventor: inspelade/konstruerade svar ur fixtures. `entries` byts mellan läsningarna. */
function fakeEventor(relay = false) {
  const state = { entries: fixture(relay ? "eventor/relay-entries.xml" : "eventor/entries-1.xml"), calls: [] as string[] };
  const fetch = (async (input: string, init?: RequestInit) => {
    const target = new URL(input);
    state.calls.push(target.pathname);
    if ((init?.headers as Record<string, string>).ApiKey !== API_KEY) return new Response("", { status: 401 });
    const body = target.pathname === "/api/organisation/apiKey" ? fixture("eventor/organisation.xml")
      : target.pathname === "/api/events" ? fixture("eventor/events.xml")
        : target.pathname === "/api/event/47110" ? fixture("eventor/event.xml")
          : target.pathname === "/api/event/47120" ? fixture("eventor/relay-event.xml")
          : target.pathname === "/api/eventclasses" ? fixture(relay ? "eventor/relay-classes.xml" : "eventor/classes.xml")
            : target.pathname === "/api/entries" ? state.entries : undefined;
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { headers: { "content-type": "text/xml; charset=utf-8" } });
  }) as typeof globalThis.fetch;
  const runtime: EventorRuntime = { configuration: eventorConfigurationFromEnvironment({
    OTID_EVENTOR_MASTER_KEY: Buffer.alloc(32, 3).toString("base64"), OTID_EVENTOR_BASE_URL: "http://eventor.test" }), fetch };
  return { state, runtime };
}

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function snapshot(raceId: string): Promise<number> {
  return (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId])).rows[0]!.snapshot_version;
}

async function race(raceType = "STANDARD"): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, loginName: `eventor.${suffix}`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Höstsprinten", raceName: "Sprint", raceDate: "2026-10-18",
      timeZone: "Europe/Stockholm", raceType }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

async function apply(proof: Proof, preview: SyncPreviewResponse, options: { excluded?: string[]; confirm?: boolean } = {}) {
  const requestId = randomUUID();
  const request = { formatVersion: 1, requestId, snapshotId: preview.snapshotId, expectedSnapshotVersion: await snapshot(proof.raceId),
    excludedRowIds: options.excluded ?? [], confirmResultChanges: options.confirm ?? false };
  return { request, result: await applySyncAsAdministrator(db, { ...proof, idempotencyKey: `source-sync:${requestId}`, request }) };
}

async function eventorPreview(proof: Proof, runtime: EventorRuntime): Promise<SyncPreviewResponse> {
  const preview = await previewEventorSyncAsAdministrator(db, proof, runtime);
  if (preview.status !== "ok") throw new Error(`Eventor kunde inte läsas: ${JSON.stringify(preview)}`);
  return preview.response;
}

async function coursePreview(proof: Proof, name: string): Promise<SyncPreviewResponse> {
  const preview = await previewCourseFileAsAdministrator(db, { ...proof, xml: fixture(`iof/${name}`), fileName: name });
  if (preview.status !== "ok") throw new Error(`Banfilen kunde inte läsas: ${preview.status}`);
  return preview.response;
}

async function entry(raceId: string, familyName: string) {
  return (await pool.query<{ id: string; class_name: string; version: number; external_source: string | null; external_id: string | null }>(
    `select e.id, c.name as class_name, e.version, e.external_source, e.external_id from entry e join class c on c.id = e.class_id
     where e.race_id = $1 and e.family_name = $2`, [raceId, familyName])).rows[0]!;
}

async function activeCard(entryId: string) {
  return (await pool.query<{ card_number: string }>("select card_number from card_assignment where entry_id = $1 and active", [entryId])).rows
    .map(row => row.card_number);
}

async function readout(proof: Proof, cardNumber: string, codes: number[]) {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", startPunchedAt: "2026-10-18T08:00:00.000Z",
    finishPunchedAt: "2026-10-18T08:20:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: `2026-10-18T08:${String(5 + index * 4).padStart(2, "0")}:00.000Z` })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(proof.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-18T08:21:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

async function effective(proof: Proof, entryId: string) {
  const result = await getAdministratorEffectiveResult(db, { ...proof, entryId });
  if (result.status !== "ok" || result.response.state !== "ACTIVE_RESULT") throw new Error("Gällande resultat saknas");
  return { status: result.response.result.status, current: result.response.resultCurrent };
}

const rowsOf = (preview: SyncPreviewResponse) => preview.rows.map(row => ({ kind: row.kind, subject: row.subject, label: row.label,
  changes: row.changes, readOut: row.readOut, note: row.note }));

describe("ADR-0170 Eventor och banfiler, med uppdateringar", () => {
  it("kopplar Eventor, importerar, läser banfil, uppdaterar med skillnader och räknar om via beskedet", async () => {
    const { state, runtime } = fakeEventor();
    const proof = await race();

    // Nyckeln sparas krypterad, testas och visas bara som sparad.
    const empty = await getEventorSettingsAsAdministrator(db, proof, runtime);
    expect(empty).toMatchObject({ status: "ok", response: { server: "OK", key: "NONE", event: null } });
    const saved = await saveEventorKeyAsAdministrator(db, { ...proof, request: { formatVersion: 1, apiKey: ` ${API_KEY} ` } }, runtime);
    expect(saved).toMatchObject({ status: "ok", response: { outcome: "CONNECTED", settings: { key: "SAVED",
      organisation: { id: "9321", name: "OK Skogsfalken" } } } });
    const stored: unknown = (await pool.query("select * from race_eventor_link where race_id = $1", [proof.raceId])).rows[0];
    expect(JSON.stringify(stored)).not.toContain(API_KEY);
    const audit = (await pool.query("select * from audit_event where race_id = $1", [proof.raceId])).rows;
    expect(JSON.stringify(audit)).not.toContain(API_KEY);
    const wrongKey = await saveEventorKeyAsAdministrator(db, { ...proof, request: { formatVersion: 1, apiKey: "a".repeat(32) } }, runtime);
    expect(wrongKey).toMatchObject({ status: "ok", response: { outcome: "REJECTED", settings: { key: "SAVED", organisation: null } } });
    await saveEventorKeyAsAdministrator(db, { ...proof, request: { formatVersion: 1, apiKey: API_KEY } }, runtime);

    const events = await listEventorEventsAsAdministrator(db, proof, runtime);
    expect(events).toMatchObject({ status: "ok", response: { outcome: "CONNECTED" } });
    if (events.status !== "ok") throw new Error("Tävlingslistan saknas");
    expect(events.response.events.map(event => [event.id, event.name, event.form])).toEqual([
      ["47110", "Höstsprinten i Skogsby", "INDIVIDUAL"], ["47120", "Skogsfalkens klubbstafett", "RELAY"]]);
    expect(await chooseEventorEventAsAdministrator(db, { ...proof, request: { formatVersion: 1, eventId: "99999" } }, runtime))
      .toMatchObject({ status: "ok", response: { outcome: "NOT_FOUND", settings: { event: null } } });
    expect(await chooseEventorEventAsAdministrator(db, { ...proof, request: { formatVersion: 1, eventId: "47110" } }, runtime))
      .toMatchObject({ status: "ok", response: { outcome: "CONNECTED", settings: { event: { id: "47110", date: "2026-10-18" } } } });

    // Första importen: klasser och anmälningar skapas.
    const first = await eventorPreview(proof, runtime);
    expect(first.summary).toEqual({ new: 10, changed: 0, withdrawn: 0, conflicts: 0, unchanged: 0 });
    expect(first.rows.filter(row => row.subject === "CLASS").every(row => !row.optional)).toBe(true);
    const firstApplied = await apply(proof, first);
    expect(firstApplied.result).toMatchObject({ status: "saved", response: { appliedRows: 10, recalculatedCount: 0 } });
    const david = await entry(proof.raceId, "Lund");
    expect(david).toMatchObject({ class_name: "H21", external_source: "eventor", external_id: "800004" });
    expect(await activeCard(david.id)).toEqual([]);
    expect((await entry(proof.raceId, "Nyström")).class_name).toBe("H35");
    // Samma kvitto för samma request-id.
    expect(await applySyncAsAdministrator(db, { ...proof, idempotencyKey: `source-sync:${firstApplied.request.requestId}`,
      request: firstApplied.request })).toMatchObject({ status: "saved", response: { replayed: true } });

    // Banfilen: tre nya banor och klasserna flyttas från "Bana saknas".
    const courses = await coursePreview(proof, "course-file-1.xml");
    expect(rowsOf(courses).map(row => [row.kind, row.subject, row.label, row.changes.map(change => `${change.from}→${change.to}`).join()])).toEqual([
      ["NEW", "COURSE", "Bana 1", "null→31 32 33 34"], ["NEW", "COURSE", "Bana 2", "null→31 35 33"], ["NEW", "COURSE", "Bana 3", "null→31 36 37"],
      ["CHANGED", "CLASS", "H21", "Bana saknas→Bana 1"], ["CHANGED", "CLASS", "D21", "Bana saknas→Bana 2"],
      ["CHANGED", "CLASS", "H35", "Bana saknas→Bana 2"], ["CHANGED", "CLASS", "D35", "Bana saknas→Bana 3"]]);
    expect((await apply(proof, courses)).result).toMatchObject({ status: "saved" });
    expect(await getSourceSyncStatusAsAdministrator(db, proof)).toMatchObject({ status: "ok", response: { courseFile: { fileName: "course-file-1.xml" } } });

    // En lokal direktanmälan och tre avläsningar.
    const classes = (await pool.query<{ id: string; name: string; course_version_id: string }>(
      "select id, name, course_version_id from class where race_id = $1", [proof.raceId])).rows;
    const h21 = classes.find(row => row.name === "H21")!;
    const local = await registerEntryAsAdmin(db, { ...proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
      formatVersion: 1, classId: h21.id, expectedCourseVersionId: h21.course_version_id, expectedStartRule: "PUNCH",
      expectedSnapshotVersion: await snapshot(proof.raceId), givenName: "Hanna", familyName: "Lokal", organisationName: "OK Skogsfalken",
      cardNumber: "2101099", fixedStartTime: null } });
    if (local.status !== "registered") throw new Error("Direktanmälan misslyckades");
    await readout(proof, "2101003", [31, 36, 37]); // Cecilia sprang D35:s bana men står i D21.
    await readout(proof, "2101006", [31, 38, 33]); // Fredrik sprang 38 (banfilen säger 35).
    await readout(proof, "2101001", [31, 35, 33]); // Anna godkänd.
    const cecilia = await entry(proof.raceId, "Ärlig");
    const fredrik = await entry(proof.raceId, "Nyström");
    const anna = await entry(proof.raceId, "Åkesson");
    expect(await effective(proof, cecilia.id)).toEqual({ status: "MP", current: true });
    expect(await effective(proof, fredrik.id)).toEqual({ status: "MP", current: true });

    // Uppdatering: ny bricka, klassbyte för avläst löpare, struken och ny löpare.
    state.entries = fixture("eventor/entries-2.xml");
    const update = await eventorPreview(proof, runtime);
    expect(rowsOf(update)).toEqual([
      { kind: "CHANGED", subject: "ENTRY", label: "Björn Öberg", changes: [{ field: "CARD", from: "2101002", to: "2109999" }], readOut: false, note: null },
      { kind: "CHANGED", subject: "ENTRY", label: "Cecilia Ärlig", changes: [{ field: "CLASS", from: "D21", to: "D35" }], readOut: true, note: null },
      { kind: "NEW", subject: "ENTRY", label: "Gustav Ek", changes: [{ field: "CARD", from: null, to: "2101007" }], readOut: false, note: null },
      { kind: "WITHDRAWN", subject: "ENTRY", label: "Eva Ström", changes: [], readOut: false, note: null }]);
    expect(update.summary).toEqual({ new: 1, changed: 2, withdrawn: 1, conflicts: 0, unchanged: 3 });
    expect(update.consequence).toMatchObject({ readOutCount: 1, becomesOkCount: 1, becomesMispunchedCount: 0, requiresConfirmation: true,
      changes: [{ displayName: "Cecilia Ärlig", className: "D21", before: "MP", after: "OK" }] });
    // Utan klassbytet krävs ingen bekräftelse.
    const classRow = update.rows.find(row => row.label === "Cecilia Ärlig")!;
    const without = await syncConsequenceAsAdministrator(db, { ...proof, request: { formatVersion: 1, snapshotId: update.snapshotId,
      expectedSnapshotVersion: update.snapshotVersion, excludedRowIds: [classRow.id] } });
    expect(without).toMatchObject({ status: "ok", response: { consequence: { readOutCount: 0, requiresConfirmation: false } } });
    expect((await apply(proof, update)).result).toMatchObject({ status: "confirmation-required", consequence: { becomesOkCount: 1 } });
    const hannaBefore = await entry(proof.raceId, "Lokal");
    const updated = await apply(proof, update, { confirm: true });
    expect(updated.result).toMatchObject({ status: "saved", response: { appliedRows: 4, recalculatedCount: 1 } });

    expect((await entry(proof.raceId, "Ärlig")).class_name).toBe("D35");
    expect(await effective(proof, cecilia.id)).toEqual({ status: "OK", current: true });
    expect(await activeCard((await entry(proof.raceId, "Öberg")).id)).toEqual(["2109999"]);
    expect(await entry(proof.raceId, "Ek")).toMatchObject({ class_name: "H21", external_id: "800007" });
    const eva = await entry(proof.raceId, "Ström");
    const evaRevisions = (await pool.query("select status, cause from result_revision where entry_id = $1", [eva.id])).rows;
    expect(evaRevisions).toEqual([{ status: "DNS", cause: "MANUAL_DID_NOT_START" }]);
    expect(await entry(proof.raceId, "Lokal")).toEqual(hannaBefore);
    expect(await activeCard(hannaBefore.id)).toEqual(["2101099"]);
    // Cecilias historik finns kvar: MP i D21, sedan omräknad OK.
    expect((await pool.query("select revision, status from result_revision where entry_id = $1 order by revision", [cecilia.id])).rows)
      .toEqual([{ revision: 1, status: "MP" }, { revision: 2, status: "OK" }]);

    // Samma källa igen: inget att göra, den strukna visas inte igen.
    const again = await eventorPreview(proof, runtime);
    expect(again.rows).toEqual([]);
    const afterUpdate = await getEventorSettingsAsAdministrator(db, proof, runtime);
    expect(afterUpdate.status === "ok" && afterUpdate.response.lastAppliedAt).toMatch(/^2026-/);

    // En avläst löpare som stryks i Eventor blir en konflikt i stället för att strykas tyst.
    state.entries = state.entries.replace(/<Entry>\s*<EntryId>800001<\/EntryId>[\s\S]*?<\/Entry>\s*/, "");
    const conflict = await eventorPreview(proof, runtime);
    expect(rowsOf(conflict)).toEqual([{ kind: "CONFLICT", subject: "ENTRY", label: "Anna Åkesson", changes: [], readOut: true, note: "WITHDRAWN_READ_OUT" }]);
    expect(await apply(proof, conflict, { excluded: [conflict.rows[0]!.id] })).toMatchObject({ result: { status: "invalid-request" } });

    // Ny banfil med ändrad kontroll: samma besked och omräkning som Redigera bana.
    const changedCourse = await coursePreview(proof, "course-file-2.xml");
    expect(rowsOf(changedCourse)).toEqual([{ kind: "CHANGED", subject: "COURSE", label: "Bana 2",
      changes: [{ field: "CONTROLS", from: "31 35 33", to: "31 38 33" }], readOut: true, note: null }]);
    expect(changedCourse.consequence).toMatchObject({ readOutCount: 2, becomesOkCount: 1, becomesMispunchedCount: 1, requiresConfirmation: true });
    expect(changedCourse.consequence.changes.map(change => [change.displayName, change.before, change.after]).sort()).toEqual([
      ["Anna Åkesson", "OK", "MP"], ["Fredrik Johan Nyström", "MP", "OK"]]);
    const stale = await apply(proof, changedCourse, { confirm: true });
    expect(stale.result).toMatchObject({ status: "saved", response: { recalculatedCount: 2 } });
    expect(await effective(proof, fredrik.id)).toEqual({ status: "OK", current: true });
    expect(await effective(proof, anna.id)).toEqual({ status: "MP", current: true });
    // En redan godkänd läsning kan inte godkännas igen.
    expect((await apply(proof, changedCourse, { confirm: true })).result).toMatchObject({ status: "conflict" });

    // Nyckeln kan tas bort; Eventor går då inte att läsa.
    expect(await removeEventorKeyAsAdministrator(db, proof, runtime)).toMatchObject({ status: "ok", response: { key: "NONE" } });
    expect(await previewEventorSyncAsAdministrator(db, proof, runtime)).toEqual({ status: "eventor", outcome: "NO_KEY" });
  });

  it("stafett: lag med sträcklöpare och vakant sträcka, som fylls i vid nästa uppdatering", async () => {
    const { state, runtime } = fakeEventor(true);
    const proof = await race("RELAY");
    await saveEventorKeyAsAdministrator(db, { ...proof, request: { formatVersion: 1, apiKey: API_KEY } }, runtime);
    await chooseEventorEventAsAdministrator(db, { ...proof, request: { formatVersion: 1, eventId: "47120" } }, runtime);
    const first = await eventorPreview(proof, runtime);
    expect(first.rows.map(row => [row.kind, row.subject, row.label])).toEqual([
      ["NEW", "CLASS", "Öppen stafett"], ["NEW", "TEAM", "OK Skogsfalken 1"], ["NEW", "TEAM", "Järfälla OK 1"]]);
    expect((await apply(proof, first)).result).toMatchObject({ status: "saved", response: { appliedRows: 3 } });
    const legs = (await pool.query("select leg, start_method from relay_leg where race_id = $1 order by leg", [proof.raceId])).rows;
    expect(legs).toEqual([{ leg: 1, start_method: "MASS_START" }, { leg: 2, start_method: "CHANGEOVER" }, { leg: 3, start_method: "CHANGEOVER" }]);
    const runners = (await pool.query<{ name: string; number: number; relay_leg: number }>(`select t.name, t.number, e.relay_leg,
      e.given_name || ' ' || e.family_name as runner from entry e join team t on t.id = e.team_id where e.race_id = $1
      order by t.number, e.relay_leg`, [proof.raceId])).rows.map(row => Object.values(row).join(" | "));
    expect(runners).toEqual(["OK Skogsfalken 1 | 1 | 1 | Anna Åkesson", "OK Skogsfalken 1 | 1 | 2 | David Lund",
      "OK Skogsfalken 1 | 1 | 3 | Gustav Ek", "Järfälla OK 1 | 2 | 1 | Björn Öberg", "Järfälla OK 1 | 2 | 2 | Eva Ström",
      "Järfälla OK 1 | 2 | 3 | Vakant sträcka 3"]);

    state.entries = state.entries.replace("<TeamSequence>3</TeamSequence>\n    </TeamCompetitor>",
      "<TeamSequence>3</TeamSequence><Person><PersonName><Family>Ärlig</Family><Given>Cecilia</Given></PersonName></Person>" +
      "<CCard><CCardId>2101003</CCardId></CCard></TeamCompetitor>");
    const update = await eventorPreview(proof, runtime);
    expect(rowsOf(update)).toEqual([{ kind: "CHANGED", subject: "ENTRY", label: "Cecilia Ärlig", readOut: false, note: null, changes: [
      { field: "NAME", from: "Vakant sträcka 3", to: "Cecilia Ärlig" }, { field: "CARD", from: null, to: "2101003" }] }]);
    expect((await apply(proof, update)).result).toMatchObject({ status: "saved" });
    expect((await eventorPreview(proof, runtime)).rows).toEqual([]);
  });

  it("utan masternyckel startar appen och visar att Eventor inte är konfigurerat", async () => {
    const proof = await race();
    const runtime: EventorRuntime = { configuration: eventorConfigurationFromEnvironment({}) };
    expect(await getEventorSettingsAsAdministrator(db, proof, runtime)).toMatchObject({ status: "ok", response: { server: "MISSING", key: "NONE" } });
    expect(await saveEventorKeyAsAdministrator(db, { ...proof, request: { formatVersion: 1, apiKey: API_KEY } }, runtime))
      .toEqual({ status: "not-configured" });
    expect(await previewEventorSyncAsAdministrator(db, proof, runtime)).toEqual({ status: "eventor", outcome: "NOT_CONFIGURED" });
  });
});
