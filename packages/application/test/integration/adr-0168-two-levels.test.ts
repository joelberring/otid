import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import { authenticatePairingAdminSession, type RaceAdminCapability } from "../../src/pairing-admin";
import { registerUserAccount } from "../../src/user-account";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { grantRacePerson } from "./accounts";
import { importIofXmlAsAdmin } from "../../src/import-iof";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0168-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0168_spec_${randomUUID().replaceAll("-", "")}`;
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
  if (!/^otid_adr0168_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function register(name: string) {
  const result = await registerUserAccount(db, { formatVersion: 1, email: `${name}@test.o-tid.se`, displayName: `Person ${name}`, password: "hemligt-lösen" });
  if (result.status !== "authenticated") throw new Error(`Registreringen misslyckades: ${result.status}`);
  return { result, proof: { sessionToken: result.sessionToken, csrfCookie: result.csrfToken, csrfHeader: result.csrfToken } };
}

describe("ADR-0168 två behörighetsnivåer", () => {
  it("registrerar konto, skapar tävling, bjuder in admin och låter admin göra allt i tävlingen", async () => {
    const suffix = randomUUID().slice(0, 8);
    const owner = await register(`agare.${suffix}`);
    const expiresIn = Date.parse(owner.result.response.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(29 * 24 * 3600_000);

    // Upptagen adress (oavsett versaler) och för kort lösenord avvisas.
    expect(await registerUserAccount(db, { formatVersion: 1, email: `AGARE.${suffix}@Test.O-Tid.se`, displayName: "X", password: "annat-lösen" }))
      .toEqual({ status: "conflict" });
    expect(await registerUserAccount(db, { formatVersion: 1, email: `kort.${suffix}@test.o-tid.se`, displayName: "X", password: "kort" }))
      .toEqual({ status: "invalid-request" });

    const created = await createEventAsUserAccount(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
      readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdagsträning",
        raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
    if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
    const { raceId } = created.response;

    // En annan registrerad person har ingen åtkomst förrän ägaren bjuder in.
    const helper = await register(`hjalp.${suffix}`);
    expect((await enterRaceAsUserAccount(db, { ...helper.proof, raceId })).status).toBe("not-found");
    const granted = await grantRacePerson(db, owner.proof, raceId, `hjalp.${suffix}@test.o-tid.se`, "ADMIN");
    expect(granted.status).toBe("granted");

    const entered = await enterRaceAsUserAccount(db, { ...helper.proof, raceId });
    if (entered.status !== "entered") throw new Error("Administratören kom inte in");
    const raceProof = { sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };

    // Administratören har alla funktioner, även de som tidigare krävde egen inloggning.
    const capabilities: RaceAdminCapability[] = ["IMPORT_IOF", "DECIDE_DID_NOT_START", "FINALIZE_RESULTS",
      "VIEW_READOUT_RESULT_HISTORY", "VIEW_SPEAKER_BOARD", "PUBLISH_START_LIST"];
    for (const capability of capabilities) {
      const auth = await authenticatePairingAdminSession(db, { ...raceProof, raceId, capability, requireCsrf: true });
      expect(auth.status, capability).toBe("authenticated");
    }
    const imported = await importIofXmlAsAdmin(db, { ...raceProof, raceId,
      idempotencyKey: `iof-import:${randomUUID()}`, xmlBytes: courseData });
    expect(imported.status).toBe("stored");

    // Fel tävling ger ingen åtkomst.
    const other = await authenticatePairingAdminSession(db, { ...raceProof, raceId: randomUUID(), capability: "IMPORT_IOF" });
    expect(other.status).not.toBe("authenticated");
  });
});
