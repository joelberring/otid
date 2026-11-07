import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { readMapBundlesAsAdmin } from "../../src/map-bundles";
import { accountOnRace } from "./accounts";

/**
 * ADR-0217 beslut 6: klassens layout i banläggningens dokument delar Kartor till startens grupper (bana, variant och layout),
 * med egen reserv och eget tryckantal. Utan layouter är svaret som förut.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0217-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0217_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const fixture = (name: string) => readFileSync(new URL(`../../../../fixtures/iof/${name}`, import.meta.url));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0217_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(): Promise<Proof & { accountId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `layout.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Layoutprov", raceName: "Natt", raceDate: "2026-12-09", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  const accountId = (await pool.query<{ id: string }>("select id from user_account where email = $1", [`layout.${suffix}@test.o-tid.se`])).rows[0]!.id;
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken, accountId };
}

async function importFile(proof: Proof, name: string) {
  const result = await importIofXmlAsAdmin(db, { ...proof, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: fixture(name) });
  if (result.status !== "stored") throw new Error(`Importen misslyckades: ${result.status}`);
}

async function bundles(proof: Proof) {
  const result = await readMapBundlesAsAdmin(db, proof);
  if (result.status !== "ok") throw new Error(`Kartbuntarna saknas: ${result.status}`);
  return result.response;
}

describe("ADR-0217: klassens layout i Kartor till starten", () => {
  it("klassen i en annan layout får egna grupper; utan layouter som förut", async () => {
    const proof = await race();
    await importFile(proof, "course-data-forked.xml");
    await importFile(proof, "entry-list-forked.xml");
    await importFile(proof, "course-assignment-forked.xml");
    const before = await bundles(proof);
    expect(before.groups.every(group => group.layout === undefined)).toBe(true);
    const h21 = before.classes.find(row => row.name === "H21")!;
    const document = { version: 1, event: { title: "Layoutprov", mapScale: 10000, classLayouts: { H21: "elit", X: "finns-inte" },
      layouts: [{ id: "elit", name: "Elit A3", scale: 15000, page: { width: 1169, height: 1654, margins: 28, landscape: true } }] },
      controls: {}, courseControls: {}, courses: [], legs: {}, specialObjects: [], raw: [] };
    await pool.query("insert into course_setting (race_id, document, version, updated_at, updated_by) values ($1, $2, 1, now(), $3)",
      [proof.raceId, JSON.stringify(document), proof.accountId]);
    const after = await bundles(proof);
    const mine = after.groups.filter(group => group.courseName === h21.courseName);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every(group => group.layout?.name === "Elit A3")).toBe(true);
    expect(after.classes.find(row => row.name === "H21")?.layout).toEqual({ id: "elit", name: "Elit A3" });
    expect(after.classes.filter(row => row.name !== "H21").every(row => row.layout === undefined)).toBe(true);
    // Samma kartor, bara uppdelade: lika många löpare som förut.
    const runners = (list: typeof before.groups) => list.reduce((sum, group) => sum + group.runnerCount, 0);
    expect(runners(after.groups)).toBe(runners(before.groups));
    expect(after.stateHash).not.toBe(before.stateHash);
  });
});
