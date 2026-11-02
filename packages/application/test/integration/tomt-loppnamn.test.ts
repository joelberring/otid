import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createOrganizerEvent, listMyEvents } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { saveRaceSettingsAsAdmin } from "../../src/race-settings";
import { copyRaceAsAdmin } from "../../src/race-copy";
import { listEntryTransfersAsAdmin } from "../../src/entry-transfer";
import { readReadoutPackageAsAdmin } from "../../src/readout-station";
import { getRaceOverviewAsAdmin, publicRaceSummary } from "../../src/overview";
import { getStartListPublicationPreviewAsAdmin } from "../../src/start-list-publication";
import { listSpeakerBoardAsAdmin } from "../../src/speaker-board";
import { readMapBundlesAsAdmin } from "../../src/map-bundles";
import { exportRaceAsAdmin } from "../../src/race-export";
import { accountOnRace } from "./accounts";

/**
 * Loppets namn är valfritt: ett evenemang med ett lopp sparar "" (NOT NULL kvar) när fältet lämnas tomt, vid skapande,
 * under Inställningar och vid kopiering. Svaren som visar loppet tål tomt namn. Migration 0032 tar bort det gamla
 * förvalet "Lopp 1" från det enda loppet i ett evenemang.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet av tomt loppnamn kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_tomt_lopp_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const migrations = new URL("../../../database/migrations/", import.meta.url);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: migrations.pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_tomt_lopp_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type AccountProof = { sessionToken: string; csrfCookie: string; csrfHeader: string };
type Proof = AccountProof & { raceId: string };

async function account(): Promise<AccountProof> {
  const created = await registerUserAccount(db, { formatVersion: 1, email: `lopp.${randomUUID().slice(0, 8)}@test.o-tid.se`,
    displayName: "Arrangör", password: "hemligt-lösen" });
  if (created.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  return { sessionToken: created.sessionToken, csrfCookie: created.csrfToken, csrfHeader: created.csrfToken };
}

async function create(proof: AccountProof, eventName: string, raceName: string, requestId = randomUUID()) {
  const created = await createOrganizerEvent(db, { ...proof, idempotencyKey: `organizer-event-create:${requestId}`,
    readBody: async () => ({ formatVersion: 1, eventName, raceName, raceDate: "2026-11-05", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error(`Tävlingen kunde inte skapas: ${created.status}`);
  return created.response;
}

async function enter(proof: AccountProof, raceId: string): Promise<Proof> {
  const entered = await accountOnRace(db, { ...proof, raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

const stored = async (raceId: string) => (await pool.query<{ name: string; snapshot_version: number }>(
  "select name, snapshot_version from race where id = $1", [raceId])).rows[0]!;

async function settings(proof: Proof, raceName: string) {
  const requestId = randomUUID();
  return saveRaceSettingsAsAdmin(db, { ...proof, idempotencyKey: `race-settings:${requestId}`,
    request: { formatVersion: 1, requestId, eventName: "Natt-KM", raceName, raceDate: "2026-11-05", raceType: "TRAINING" } });
}

describe("tomt loppnamn", () => {
  it("skapar, visar, ändrar och kopierar ett lopp utan eget namn", async () => {
    const owner = await account();
    const requestId = randomUUID();
    const created = await create(owner, "Natt-KM", "   ", requestId);
    expect((await stored(created.raceId)).name).toBe("");
    // Samma försök igen är en omsändning, inte en ny tävling.
    expect((await create(owner, "Natt-KM", "", requestId)).raceId).toBe(created.raceId);

    const mine = await listMyEvents(db, owner);
    if (mine.status !== "ok") throw new Error(mine.status);
    expect(mine.response.events.find(event => event.eventName === "Natt-KM")?.races)
      .toEqual([expect.objectContaining({ raceId: created.raceId, raceName: "" })]);

    const proof = await enter(owner, created.raceId);
    const transfers = await listEntryTransfersAsAdmin(db, proof);
    if (transfers.status !== "ok") throw new Error(transfers.status);
    expect(transfers.response).toMatchObject({ eventName: "Natt-KM", raceName: "" });
    const overview = await getRaceOverviewAsAdmin(db, proof);
    if (overview.status !== "ok") throw new Error(overview.status);
    expect(overview.response.race).toMatchObject({ eventName: "Natt-KM", name: "" });
    expect(await publicRaceSummary(db, created.raceId)).toMatchObject({ eventName: "Natt-KM", name: "" });
    const pkg = await readReadoutPackageAsAdmin(db, proof);
    if (pkg.status !== "ok") throw new Error(pkg.status);
    expect(pkg.response.raceSnapshot.race.name).toBe("");
    expect(await getStartListPublicationPreviewAsAdmin(db, proof)).toMatchObject({ status: "ok" });
    expect(await listSpeakerBoardAsAdmin(db, proof)).toMatchObject({ status: "ok", response: { raceName: "" } });
    expect(await readMapBundlesAsAdmin(db, proof)).toMatchObject({ status: "ok", response: { raceName: "" } });
    // Exportfilen får evenemangets namn när loppet saknar eget.
    expect(await exportRaceAsAdmin(db, proof)).toMatchObject({ status: "ok", fileName: expect.stringMatching(/^otid-sakerhetskopia-natt-km-2026-11-05-/) as unknown });

    // Inställningar: ett namn kan sättas och tas bort igen.
    expect(await settings(proof, "Etapp 1")).toMatchObject({ status: "saved" });
    expect((await stored(created.raceId)).name).toBe("Etapp 1");
    expect(await settings(proof, " ")).toMatchObject({ status: "saved", response: { request: { raceName: "" } } });
    expect((await stored(created.raceId)).name).toBe("");
    expect(await settings(proof, "x".repeat(161))).toEqual({ status: "invalid-request" });

    // Kopiera med tomt namn.
    const copyRequest = { formatVersion: 1, requestId: randomUUID(), eventName: "Natt-KM 2027", raceName: "", raceDate: "2027-11-04",
      includePeople: false };
    const copied = await copyRaceAsAdmin(db, { ...owner, raceId: created.raceId, request: copyRequest });
    if (copied.status !== "copied") throw new Error(`Kopian skapades inte: ${copied.status}`);
    expect((await stored(copied.response.raceId)).name).toBe("");
  });

  it("migration 0032 tar bort förvalet Lopp 1 bara från det enda loppet i sitt evenemang", async () => {
    const owner = await account();
    const single = await create(owner, "Ensam träning", "Lopp 1");
    const named = await create(owner, "Torsdagsträning", "Torsdag");
    const almost = await create(owner, "Nästan", "Lopp 1 kväll");
    const multi = await create(owner, "Helgen", "Lopp 1");
    const second = (await pool.query<{ id: string }>(
      "insert into race (event_id, name, race_date) select event_id, 'Lopp 2', race_date from race where id = $1 returning id",
      [multi.raceId])).rows[0]!.id;
    const before = await stored(single.raceId);
    expect(before.name).toBe("Lopp 1");

    const sql = await readFile(new URL("0032_tomt_loppnamn.sql", migrations), "utf8");
    await pool.query(sql);

    expect(await stored(single.raceId)).toEqual({ name: "", snapshot_version: before.snapshot_version + 1 });
    expect((await stored(named.raceId)).name).toBe("Torsdag");
    expect((await stored(almost.raceId)).name).toBe("Lopp 1 kväll");
    expect((await stored(multi.raceId)).name).toBe("Lopp 1");
    expect((await stored(second)).name).toBe("Lopp 2");
    // Kontots skapandeförsök tillåter tomt loppnamn men inte för långt.
    const constraint = (await pool.query<{ definition: string }>("select pg_get_constraintdef(oid) as definition from pg_constraint " +
      "where conname = 'user_account_event_creation_race_name_check'")).rows[0]!.definition;
    expect(constraint).toContain("<= 160");
    // En andra körning ändrar inget mer.
    await pool.query(sql);
    expect((await stored(single.raceId)).snapshot_version).toBe(before.snapshot_version + 1);
  });
});
