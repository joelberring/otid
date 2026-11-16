import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { startGuestDemo } from "../../src/guest-demo";
import { createOrganizerEvent } from "../../src/organizer-events";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { requireCourseSettingAccess } from "../../src/course-setting-access";
import { registerTestAccount } from "./accounts";

/**
 * Demoläget med en mall (ägaren 2026-11-16): gästens tävling kopieras ur mallens banor och får de påhittade löparna med
 * resultat. Mallen ändras inte. Utan mall (eller med en mall som inte finns) blir det övningstävlingen som förut.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_demomall_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-16T14:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_demomall_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const count = async (sql: string, values: unknown[]) => Number((await pool.query<{ n: string }>(sql, values)).rows[0]!.n);

async function templateRace(): Promise<string> {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createOrganizerEvent(db, { ...owner.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Järflotta demotävling", raceName: "Demo", raceDate: "2027-05-24",
      timeZone: "Europe/Stockholm" }) }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const raceId = created.response.raceId;
  for (const [name, controls] of [["Lång", [31, 32, 33, 34, 35, 36]], ["Mellan", [31, 33, 35, 36]], ["Kort", [31, 34, 36]]] as const) {
    const requestId = randomUUID();
    const result = await createManualCourseClassAsAdmin(db, { ...owner.proof, raceId, idempotencyKey: `manual-course-class-create:${requestId}`,
      request: { formatVersion: 1, requestId, courseName: name, className: `Mall ${name}`, startRule: "PUNCH", controlCodes: [...controls] } }, NOW);
    if (result.status !== "created") throw new Error(result.status);
  }
  return raceId;
}

describe("demoläget: gästens tävling ur mallen", () => {
  it("kopierar banorna, lägger in de påhittade löparna med resultat och lämnar mallen orörd", async () => {
    const template = await templateRace();
    const started = await startGuestDemo(db, { clientKey: "203.0.113.20", now: NOW, templateRaceId: template });
    if (started.status !== "created") throw new Error(started.status);
    expect(started.raceId).not.toBe(template);

    expect(await count("select count(*) as n from course where race_id = $1", [started.raceId])).toBe(3);
    // Mallens tre klasser följer med, och demons fyra läggs till.
    expect(await count("select count(*) as n from class where race_id = $1", [started.raceId])).toBe(7);
    expect(await count("select count(*) as n from entry where race_id = $1", [started.raceId])).toBe(16);
    expect(await count("select count(*) as n from card_readout where race_id = $1", [started.raceId])).toBe(8);
    const statuses = (await pool.query<{ status: string; n: string }>(`select r.status, count(*) as n from result_revision r
      where r.race_id = $1 and r.revision = (select max(x.revision) from result_revision x where x.entry_id = r.entry_id)
      group by r.status order by r.status`, [started.raceId])).rows;
    const byStatus = Object.fromEntries(statuses.map(row => [row.status, Number(row.n)]));
    expect(byStatus.OK).toBe(6);
    expect((byStatus.MP ?? 0) + (byStatus.DNF ?? 0)).toBe(2);
    expect(await count("select count(*) as n from race where id = $1 and race_date = '2026-11-16' and published_at is null",
      [started.raceId])).toBe(1);

    // Mallen är orörd.
    expect(await count("select count(*) as n from entry where race_id = $1", [template])).toBe(0);
    expect(await count("select count(*) as n from class where race_id = $1", [template])).toBe(3);

    // Gästen är ägare av kopian men har ingen roll på mallen; banläggningen märker gästen.
    const proof = { sessionToken: started.sessionToken, csrfCookie: started.csrfToken, csrfHeader: started.csrfToken };
    const own = await requireCourseSettingAccess(db, { ...proof, raceId: started.raceId, required: "EDIT" }, NOW);
    if (own.status !== "authenticated") throw new Error(own.status);
    expect(own.principal.guest).toBe(true);
    expect((await requireCourseSettingAccess(db, { ...proof, raceId: template, required: "COMMENT" }, NOW)).status).toBe("unauthorized");
  });

  it("en mall som inte finns ger övningstävlingen", async () => {
    const started = await startGuestDemo(db, { clientKey: "203.0.113.21", now: NOW, templateRaceId: randomUUID() });
    if (started.status !== "created") throw new Error(started.status);
    expect(await count("select count(*) as n from entry where race_id = $1", [started.raceId])).toBe(10);
  });
});
