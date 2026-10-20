import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { eventorConfigurationFromEnvironment } from "../../src/eventor-secret";
import { saveEventorKeyAsAdmin, type EventorRuntime } from "../../src/eventor-link";
import {
  deleteRunnerDatabaseAsAdmin, getRunnerDatabaseSettingsAsAdmin, refreshRunnerDatabaseAsAdmin, searchRunnerDatabaseAsAdmin
} from "../../src/runner-database";
import { readReadoutPackageAsAdmin } from "../../src/readout-station";
import { listPublicRaces, readPublicRaceHub } from "../../src/public-races";
import { publicResults } from "../../src/results";
import { registerReadoutCard } from "../../src/readout-registration";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { setRacePublished } from "./accounts";
import { auth, ingest, NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 29: löpardatabasen från Eventor. Egen databas, eftersom löpardatabasen delas per Eventor-organisation (inte
 * per tävling). Eventor är en falsk fetch med påhittade löpare i Eventors struktur (fixtures/eventor/competitors.xml).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Steg 29-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_steg29_runners_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_steg29_runners_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/eventor/${name}`, import.meta.url), "utf8");
const API_KEY = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";

/** Falsk Eventor: klubben 9321 (OK Skogsfalken), löpare och organisationer. `competitors` kan bytas mellan anropen. */
function fakeEventor() {
  const state = { competitors: fixture("competitors.xml"), urls: [] as string[] };
  const fetch = (async (input: string, init?: RequestInit) => {
    const target = new URL(input);
    state.urls.push(`${target.pathname}${target.search}`);
    if ((init?.headers as Record<string, string>).ApiKey !== API_KEY) return new Response("", { status: 401 });
    const body = target.pathname === "/api/organisation/apiKey" ? fixture("organisation.xml")
      : target.pathname === "/api/organisations" ? fixture("organisations.xml")
        : target.pathname === "/api/export/cachedcompetitors" ? state.competitors : undefined;
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { headers: { "content-type": "text/xml; charset=utf-8" } });
  }) as typeof globalThis.fetch;
  const runtime: EventorRuntime = { configuration: eventorConfigurationFromEnvironment({
    OTID_EVENTOR_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"), OTID_EVENTOR_BASE_URL: "http://eventor.test" }), fetch };
  return { state, runtime };
}

/** Ett lopp (steg 25:s) kopplat till klubben 9321 med en sparad, testad nyckel. */
async function linkedRace(runtime: EventorRuntime) {
  const seeded = await seedRace(db, pool);
  const saved = await saveEventorKeyAsAdmin(db, { ...seeded.admin, request: { formatVersion: 1, apiKey: API_KEY } }, runtime, NOW);
  expect(saved).toMatchObject({ status: "ok", response: { outcome: "CONNECTED", settings: { organisation: { id: "9321" } } } });
  return seeded;
}

const refreshRequest = (extra: string[] = [], wholeCountry = false) =>
  ({ formatVersion: 1 as const, wholeCountry, extraOrganisationIds: extra });

async function competitorRows() {
  return (await pool.query<{ eventor_person_id: string; given_name: string; birth_year: number | null; sex: string | null;
    club_eventor_id: string | null; card_numbers: string[] }>(`SELECT eventor_person_id, given_name, birth_year, sex, club_eventor_id,
      card_numbers FROM runner_database_competitor ORDER BY eventor_person_id`)).rows;
}

/** Hela landet: `count` påhittade löpare, `own` av dem i den egna klubben (9321), övriga i klubben 9999. */
function syntheticCountry(count: number, own: number): string {
  const rows: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const club = index < own ? "9321" : "9999";
    rows.push(`<Competitor><Person sex="${index % 2 ? "F" : "M"}"><Id type="Eventor">${800_000 + index}</Id><Name><Family>Syntet${index}</Family>` +
      `<Given>Löpare</Given></Name><BirthDate>${1950 + (index % 60)}-06-01</BirthDate><Nationality code="SWE" /></Person>` +
      `<Organisation type="Club"><Id type="Eventor">${club}</Id><Name>Klubb ${club}</Name><ShortName>K${club}</ShortName></Organisation>` +
      `<ControlCard punchingSystem="SI">${2_000_000 + index}</ControlCard></Competitor>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?><CompetitorList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0">${rows.join("")}</CompetitorList>`;
}

describe("löpardatabasen från Eventor (PLAN.md steg 29)", () => {
  it("uppdateras från Eventor med dataminimering, ersätts helt nästa gång och kan raderas", async () => {
    const { state, runtime } = fakeEventor();
    const { ids, admin: owner } = await linkedRace(runtime);
    const before = await getRunnerDatabaseSettingsAsAdmin(db, owner, NOW);
    expect(before).toMatchObject({ status: "ok", response: { organisation: { id: "9321", name: "OK Skogsfalken" }, database: null } });

    const first = await refreshRunnerDatabaseAsAdmin(db, { ...owner, request: refreshRequest() }, runtime, NOW);
    expect(first).toMatchObject({ status: "ok", response: { outcome: "REFRESHED", settings: { database: { competitorCount: 5, cardCount: 5,
      clubCount: 6, wholeCountry: false, extraClubs: [], offlineCount: 3, offlineTruncated: false } } } });
    expect(state.urls).toContain("/api/export/cachedcompetitors?organisationIds=9321&includePreselectedClasses=false");
    const rows = await competitorRows();
    expect(rows.find((row) => row.eventor_person_id === "610101")).toEqual({ eventor_person_id: "610101", given_name: "Testa",
      birth_year: 1975, sex: "F", club_eventor_id: "9321", card_numbers: ["8100101"] });
    expect(rows.find((row) => row.eventor_person_id === "610102")!.card_numbers).toEqual(["8100102", "8100103"]);
    // Inget födelsedatum lagras, och auditposten har bara antal.
    const columns = (await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'runner_database_competitor'")).rows.map((row) => row.column_name);
    expect(columns).not.toContain("birth_date");
    expect(columns).not.toContain("nationality");
    const audit = (await pool.query<{ after: unknown }>("SELECT after FROM audit_event WHERE action = 'RUNNER_DATABASE_REFRESHED' AND race_id = $1",
      [ids.race])).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/Testsson|8100101/);

    // Andra gången: Prova har bytt bricka och Åsa finns inte längre; Järfälla OK och hela landet väljs till.
    state.competitors = fixture("competitors.xml").replace(">8100103<", ">8100199<")
      .replace(/<Competitor modifyTime="2026-10-01T18:00:00">[\s\S]*?<\/Competitor>/, "");
    const second = await refreshRunnerDatabaseAsAdmin(db, { ...owner, request: refreshRequest(["9400"], true) }, runtime, NOW);
    expect(second).toMatchObject({ status: "ok", response: { outcome: "REFRESHED", settings: { database: { competitorCount: 4,
      wholeCountry: true, extraClubs: [{ id: "9400", name: "Järfälla OK" }] } } } });
    expect(state.urls.at(-1)).toBe("/api/export/cachedcompetitors?includePreselectedClasses=false");
    const after = await competitorRows();
    expect(after.map((row) => row.eventor_person_id)).toEqual(["610101", "610102", "610103", "610105"]);
    expect(after.find((row) => row.eventor_person_id === "610102")!.card_numbers).toEqual(["8100102", "8100199"]);
    expect((await pool.query("SELECT 1 FROM runner_database")).rowCount).toBe(1);

    // Eventor svarar inte: inget ändras.
    state.competitors = "<CompetitorList><Competitor>";
    const broken = await refreshRunnerDatabaseAsAdmin(db, { ...owner, request: refreshRequest() }, runtime, NOW);
    expect(broken).toMatchObject({ status: "ok", response: { outcome: "UNAVAILABLE", settings: { database: { competitorCount: 4 } } } });

    const removed = await deleteRunnerDatabaseAsAdmin(db, owner, NOW);
    expect(removed).toMatchObject({ status: "ok", response: { database: null } });
    expect((await pool.query("SELECT 1 FROM runner_database_competitor")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM runner_database_club")).rowCount).toBe(0);
  });

  it("bara administratören uppdaterar och raderar; funktionären får förslag och paketet; inget publikt", async () => {
    const { runtime } = fakeEventor();
    const { ids, admin: owner } = await linkedRace(runtime);
    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    expect((await refreshRunnerDatabaseAsAdmin(db, { ...functionary, request: refreshRequest() }, runtime, NOW)).status).toBe("forbidden");
    expect((await getRunnerDatabaseSettingsAsAdmin(db, functionary, NOW)).status).toBe("forbidden");
    expect((await deleteRunnerDatabaseAsAdmin(db, functionary, NOW)).status).toBe("forbidden");
    const anonymous = { raceId: ids.race, sessionToken: "", csrfCookie: "", csrfHeader: "" };
    expect((await searchRunnerDatabaseAsAdmin(db, { ...anonymous, request: { formatVersion: 1, kind: "CARD", cardNumber: "8100101" } }, NOW)).status)
      .toBe("unauthorized");
    expect((await refreshRunnerDatabaseAsAdmin(db, { ...owner, request: refreshRequest() }, runtime, NOW)).status).toBe("ok");

    const byCard = await searchRunnerDatabaseAsAdmin(db, { ...functionary, request: { formatVersion: 1, kind: "CARD", cardNumber: "8100103" } }, NOW);
    expect(byCard).toMatchObject({ status: "ok", response: { runners: [{ personId: "610102", givenName: "Prova", club: "OK Skogsfalken",
      clubId: "9321", birthYear: 1990, sex: "M", cards: ["8100102", "8100103"] }] } });
    const byName = await searchRunnerDatabaseAsAdmin(db, { ...functionary, request: { formatVersion: 1, kind: "NAME", text: "åsa öb" } }, NOW);
    expect(byName.status === "ok" && byName.response.runners.map((row) => row.familyName)).toEqual(["Öberg-Ärling"]);
    const byClub = await searchRunnerDatabaseAsAdmin(db, { ...owner, request: { formatVersion: 1, kind: "CLUB", text: "järf" } }, NOW);
    expect(byClub.status === "ok" && byClub.response.clubs).toEqual([{ id: "9400", name: "Järfälla OK", shortName: "Järfälla", type: "CLUB" }]);
    const wildcard = await searchRunnerDatabaseAsAdmin(db, { ...owner, request: { formatVersion: 1, kind: "NAME", text: "%%" } }, NOW);
    expect(wildcard.status === "ok" && wildcard.response.runners).toEqual([]);

    // Avläsningspaketet (funktionären): bara den egna klubbens löpare offline, klubbarna med.
    const pkg = await readReadoutPackageAsAdmin(db, functionary, NOW);
    if (pkg.status !== "ok") throw new Error(pkg.status);
    expect(pkg.response.runnerLookup).toMatchObject({ organisationName: "OK Skogsfalken", wholeCountryOnServer: false, truncated: false });
    expect(pkg.response.runnerLookup!.runners.map((row) => row.familyName)).toEqual(["Bricklös", "Provsson", "Testsson"]);
    expect(pkg.response.runnerLookup!.clubs.slice(0, 3).map((row) => row.type)).toEqual(["CLUB", "CLUB", "CLUB"]);

    // Publikt: tävlingen publicerad, men inget ur löpardatabasen i någon publik projektion.
    expect(await setRacePublished(db, owner, ids.race, true, NOW)).toMatchObject({ status: "saved" });
    const publicJson = JSON.stringify([await listPublicRaces(db, {}), await readPublicRaceHub(db, ids.race), await publicResults(db, ids.race)]);
    for (const name of ["Testsson", "Provsson", "Bricklös", "8100101", "Järfälla OK"]) expect(publicJson).not.toContain(name);

    // En annan tävling för samma klubb delar databasen; en tävling utan nyckel får ingen.
    const other = await linkedRace(runtime);
    const shared = await getRunnerDatabaseSettingsAsAdmin(db, other.admin, NOW);
    expect(shared).toMatchObject({ status: "ok", response: { database: { competitorCount: 5 } } });
    const unlinked = await seedRace(db, pool);
    const none = await readReadoutPackageAsAdmin(db, unlinked.admin, NOW);
    expect(none.status === "ok" && none.response.runnerLookup).toBeUndefined();
    expect(await searchRunnerDatabaseAsAdmin(db, { ...unlinked.admin, request: { formatVersion: 1, kind: "CARD", cardNumber: "8100101" } }, NOW))
      .toMatchObject({ status: "ok", response: { runners: [] } });
    await deleteRunnerDatabaseAsAdmin(db, owner, NOW);
  });

  it("hela landet: paketet har en gräns (den egna klubben först), resten söks på servern", { timeout: 120_000 }, async () => {
    const { state, runtime } = fakeEventor();
    const { ids, admin: owner } = await linkedRace(runtime);
    state.competitors = syntheticCountry(40_000, 10_500);
    const started = Date.now();
    const refreshed = await refreshRunnerDatabaseAsAdmin(db, { ...owner, request: refreshRequest([], true) }, runtime, NOW);
    const refreshMs = Date.now() - started;
    expect(refreshed).toMatchObject({ status: "ok", response: { outcome: "REFRESHED", settings: { database: { competitorCount: 40_000,
      wholeCountry: true, offlineCount: 10_000, offlineTruncated: true } } } });
    const pkg = await readReadoutPackageAsAdmin(db, await auth(db, ids.race, "FUNCTIONARY"), NOW);
    if (pkg.status !== "ok") throw new Error(pkg.status);
    const lookup = pkg.response.runnerLookup!;
    expect(lookup).toMatchObject({ wholeCountryOnServer: true, truncated: true });
    expect(lookup.runners).toHaveLength(10_000);
    expect(lookup.runners.every((row) => row.clubId === "9321")).toBe(true);
    const packageBytes = Buffer.byteLength(JSON.stringify(pkg.response));
    const lookupBytes = Buffer.byteLength(JSON.stringify(lookup));
    // Mätt 2026-10-20: 1,53 MB för 10 000 löpare (≈ 153 byte per löpare före gzip). Gränsen: högst 2 MB.
    expect(lookupBytes).toBeLessThan(2 * 1024 * 1024);
    console.info(`steg 29: hela landet 40 000 löpare uppdaterat på ${refreshMs} ms; paketet ${packageBytes} byte, uppslaget ${lookupBytes} byte`);
    // En löpare i en annan klubb finns inte offline men hittas på servern.
    expect(lookup.runners.some((row) => row.cards.includes("2039999"))).toBe(false);
    const online = await searchRunnerDatabaseAsAdmin(db, { ...owner, request: { formatVersion: 1, kind: "CARD", cardNumber: "2039999" } }, NOW);
    expect(online).toMatchObject({ status: "ok", response: { runners: [{ familyName: "Syntet39999", clubId: "9999" }] } });
    await deleteRunnerDatabaseAsAdmin(db, owner, NOW);
  });
});

describe("okänd bricka kopplad till en anmäld deltagare (PLAN.md steg 29 punkt 4)", () => {
  const link = (cardNumber: string, entryId: string, expectedClassId: string) => {
    const requestId = randomUUID();
    return { idempotencyKey: `readout-registration:${requestId}`, request: { formatVersion: 1 as const, requestId, cardNumber,
      target: "EXISTING_ENTRY" as const, entryId, expectedClassId } };
  };

  it("funktionären kopplar brickan till Eva (ingen bricka); avläsningen bedöms mot henne; samma begäran igen ger samma kvitto", async () => {
    const { ids } = await seedRace(db, pool);
    const functionary = await auth(db, ids.race, "FUNCTIONARY");
    const card = "7900201";
    await ingest(db, ids.race, [run(card, "11:00:00", 30)]);
    const linking = link(card, ids.eva, ids.free);
    const first = await registerReadoutCard(db, { ...functionary, ...linking }, NOW);
    if (first.status !== "registered") throw new Error(first.status);
    expect(first.response).toMatchObject({ outcome: "LINKED", entryId: ids.eva, entryName: "Eva Ek", className: "Öppen",
      linkedResult: { status: "OK", revision: 1 } });
    const replay = await registerReadoutCard(db, { ...functionary, ...linking }, NOW);
    expect(replay).toEqual({ status: "registered", response: { ...first.response, replayed: true } });
    expect((await pool.query("SELECT card_number, active FROM card_assignment WHERE entry_id = $1", [ids.eva])).rows)
      .toEqual([{ card_number: card, active: true }]);
    expect((await pool.query("SELECT version FROM entry WHERE id = $1", [ids.eva])).rows).toEqual([{ version: 2 }]);
    expect((await pool.query("SELECT action FROM audit_event WHERE request_id = $1", [linking.request.requestId])).rows)
      .toEqual([{ action: "READOUT_CARD_LINKED" }]);
    expect((await pool.query("SELECT outcome, given_name FROM readout_registration WHERE request_id = $1", [linking.request.requestId])).rows)
      .toEqual([{ outcome: "LINKED", given_name: "Eva" }]);
    // Eva har nu läst ut: en ny koppling av en annan bricka till henne avvisas.
    expect((await registerReadoutCard(db, { ...functionary, ...link("7900202", ids.eva, ids.free) }, NOW)).status).toBe("conflict");
  });

  it("deltagare med bricka men utan avläsning: den gamla brickan släpps; fel klass, okänd deltagare och tagen bricka", async () => {
    const { ids, cards, admin: owner } = await seedRace(db, pool);
    const card = "7900203";
    const linked = await registerReadoutCard(db, { ...owner, ...link(card, ids.bo, ids.fixed) }, NOW);
    expect(linked).toMatchObject({ status: "registered", response: { outcome: "LINKED", entryId: ids.bo, linkedResult: null } });
    expect((await pool.query("SELECT card_number, active FROM card_assignment WHERE entry_id = $1 ORDER BY created_at, card_number", [ids.bo])).rows)
      .toEqual(expect.arrayContaining([{ card_number: cards.bo, active: false }, { card_number: card, active: true }]));
    // Avläsningen kommer efter kopplingen: den bedöms mot Bo som vanligt.
    const [ack] = await ingest(db, ids.race, [run(card, "10:05:00", 30)]);
    expect(ack).toMatchObject({ status: "stored", serverResult: { status: "OK" } });
    expect((await registerReadoutCard(db, { ...owner, ...link("7900204", ids.dan, ids.fixed) }, NOW)).status).toBe("conflict");
    expect((await registerReadoutCard(db, { ...owner, ...link("7900205", randomUUID(), ids.free) }, NOW)).status).toBe("not-found");
    // Brickan är redan Adas: Ada gäller, ingen koppling till Cia.
    const taken = await registerReadoutCard(db, { ...owner, ...link(cards.ada, ids.cia, ids.free) }, NOW);
    expect(taken).toMatchObject({ status: "registered", response: { outcome: "EXISTING", entryId: ids.ada } });
    expect((await pool.query("SELECT card_number FROM card_assignment WHERE entry_id = $1 AND active", [ids.cia])).rows)
      .toEqual([{ card_number: cards.cia }]);
  });

  it("direktanmälan och Ny deltagare ur löpardatabasen sparar Eventors id för IOF-exporten", async () => {
    const { ids, admin: owner } = await seedRace(db, pool);
    const requestId = randomUUID();
    const registered = await registerReadoutCard(db, { ...owner, idempotencyKey: `readout-registration:${requestId}`, request: {
      formatVersion: 1, requestId, cardNumber: "8100101", classId: ids.free, givenName: "Testa", familyName: "Testsson",
      organisationName: "OK Skogsfalken", eventorPersonId: "610101", eventorOrganisationId: "9321" } }, NOW);
    if (registered.status !== "registered") throw new Error(registered.status);
    const course = (await pool.query<{ course_version_id: string }>("SELECT course_version_id FROM class WHERE id = $1", [ids.free])).rows[0]!;
    const entry = await registerEntryAsAdmin(db, { ...owner, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
      formatVersion: 1, classId: ids.free, expectedCourseVersionId: course.course_version_id, expectedStartRule: "PUNCH", givenName: "Prova",
      familyName: "Provsson", organisationName: "OK Skogsfalken", cardNumber: "8100102", fixedStartTime: null, eventorPersonId: "610102",
      eventorOrganisationId: "9321" } }, NOW);
    expect(entry.status).toBe("registered");
    expect((await pool.query("SELECT given_name, eventor_person_id, eventor_organisation_id FROM entry WHERE race_id = $1 AND eventor_person_id LIKE '6101%' ORDER BY given_name",
      [ids.race])).rows).toEqual([{ given_name: "Prova", eventor_person_id: "610102", eventor_organisation_id: "9321" },
      { given_name: "Testa", eventor_person_id: "610101", eventor_organisation_id: "9321" }]);
  });
});
