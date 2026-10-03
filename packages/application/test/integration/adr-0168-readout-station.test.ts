import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { importIofXmlAsAdmin } from "../../src/import-iof";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { ingestReadoutsAsAdministrator, readReadoutPackageAsAdministrator } from "../../src/readout-station";
import { registerUserAccount } from "../../src/user-account";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Avläsningstestet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_readout_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const courseData = readFileSync(new URL("../../../../fixtures/iof/course-data.xml", import.meta.url));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_readout_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

describe("ADR-0168 avläsning i webbläsaren", () => {
  it("hämtar avläsningspaket och tar emot SPORTident-avläsningar, även utan mål, idempotent", async () => {
    const suffix = randomUUID().slice(0, 8);
    const account = await registerUserAccount(db, { formatVersion: 1, loginName: `las.${suffix}`, displayName: "Avläsare", password: "hemligt-lösen" });
    if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
    const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
    const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
    if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
    const { raceId } = created.response;
    const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
    if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
    const proof = { sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
    expect((await importIofXmlAsAdmin(db, { ...proof, raceId, idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: courseData })).status).toBe("stored");

    const pkg = await readReadoutPackageAsAdministrator(db, { ...proof, raceId });
    if (pkg.status !== "ok") throw new Error(`Paketet kunde inte hämtas: ${pkg.status}`);
    expect(pkg.response).toMatchObject({ formatVersion: 1, raceId, event: { timeZone: "Europe/Stockholm" } });
    expect(pkg.response.raceSnapshot.courses.length).toBeGreaterThan(0);
    expect(await readReadoutPackageAsAdministrator(db, { sessionToken: "fel", raceId })).toEqual({ status: "unauthorized" });

    const payload: SportidentReadoutPayload = {
      cardNumber: "7123456", cardType: "SI10", startPunchedAt: "2026-10-08T16:00:00.000Z",
      punches: [{ code: 31, punchedAt: "2026-10-08T16:05:00.000Z" }], untimedPunchCodes: [],
      frames: ["02ef8300", "02ef8301"], stationSerial: 999001, simulated: true
    };
    const batch: DeviceBatch = {
      deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: pkg.response.packageVersion,
      firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T16:40:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }]
    };
    const first = await ingestReadoutsAsAdministrator(db, { ...proof, raceId, batch });
    if (first.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${first.status}`);
    expect(first.response.acknowledgements[0]).toMatchObject({ status: "stored", serverResult: { status: "UNKNOWN_CARD" } });

    const again = await ingestReadoutsAsAdministrator(db, { ...proof, raceId, batch });
    if (again.status !== "ok") throw new Error("Omsändningen avvisades");
    expect(again.response.acknowledgements[0]).toMatchObject({ status: "duplicate" });

    const raw = await pool.query<{ transport: string; finish: Date | null }>(
      `select m.transport, r.finish_punched_at as finish from raw_device_message m join card_readout r on r.raw_message_id = m.id where m.race_id = $1`, [raceId]);
    expect(raw.rows).toEqual([{ transport: "sportident", finish: null }]);

    // Skrivning kräver CSRF.
    expect((await ingestReadoutsAsAdministrator(db, { sessionToken: proof.sessionToken, raceId, batch })).status).not.toBe("ok");
  });
});
