import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import {
  issuePairingAdminAccessCredential,
  listStartListAsAdmin,
  loginPairingAdmin,
  revokePairingAdminAccessCredential
} from "../../src";

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL eller DATABASE_URL krävs för PostgreSQL-integrationstester");
const { db, pool } = createDatabase(connectionString);
const issuedAt = new Date("2026-09-04T06:00:00.000Z");
const usedAt = new Date("2026-09-04T06:02:00.123Z");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => { await pool.end(); });

async function fixture(marker: string) {
  const [event] = await db.insert(schema.events).values({
    name: `Startlista ${marker}`, startsOn: "2026-09-04", timeZone: "Europe/Stockholm"
  }).returning();
  if (!event) throw new Error("Event saknas");
  const [race] = await db.insert(schema.races).values({ eventId: event.id, name: "Medel", raceDate: "2026-09-04" }).returning();
  if (!race) throw new Error("Lopp saknas");
  const [course] = await db.insert(schema.courses).values({ raceId: race.id, name: "Bana" }).returning();
  if (!course) throw new Error("Bana saknas");
  const [courseVersion] = await db.insert(schema.courseVersions).values({ courseId: course.id, version: 1 }).returning();
  if (!courseVersion) throw new Error("Banversion saknas");
  const classes = await db.insert(schema.classes).values([
    { raceId: race.id, name: "Z FIXED", courseVersionId: courseVersion.id, startRule: "FIXED" },
    { raceId: race.id, name: "A PUNCH", courseVersionId: courseVersion.id, startRule: "PUNCH" }
  ]).returning();
  const fixed = classes.find((item) => item.startRule === "FIXED");
  const punch = classes.find((item) => item.startRule === "PUNCH");
  if (!fixed || !punch) throw new Error("Klasser saknas");
  const entries = await db.insert(schema.entries).values([
    { raceId: race.id, classId: fixed.id, givenName: "Zelda", familyName: "Å", organisationName: "Klubb Z", fixedStartTime: null },
    { raceId: race.id, classId: fixed.id, givenName: "Ada", familyName: "A", organisationName: null, fixedStartTime: new Date("2026-09-04T07:00:00.123Z") },
    { raceId: race.id, classId: punch.id, givenName: "Bo", familyName: "B", organisationName: "Klubb B", fixedStartTime: new Date("2026-09-04T08:00:00.000Z") }
  ]).returning();
  const ada = entries.find((item) => item.givenName === "Ada");
  const bo = entries.find((item) => item.givenName === "Bo");
  if (!ada || !bo) throw new Error("Deltagare saknas");
  await db.insert(schema.cardAssignments).values([
    { raceId: race.id, entryId: ada.id, cardNumber: "111" },
    { raceId: race.id, entryId: bo.id, cardNumber: "222" },
    { raceId: race.id, entryId: bo.id, cardNumber: "333" }
  ]);
  return { race, fixed, punch, ada, bo };
}

async function admin(raceId: string, byte: number, capability: "VIEW_START_LIST" | "VIEW_RACE_OVERVIEW" = "VIEW_START_LIST") {
  const installation = await issuePairingAdminAccessCredential(db, {
    raceId, capability, label: "Startpersonal", expiresAt: new Date("2026-09-04T14:00:00.000Z")
  }, { now: issuedAt, secretBytes: Buffer.alloc(32, byte) });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, {
    expectedRaceId: raceId, expectedCapability: capability, now: new Date("2026-09-04T06:01:00.000Z"),
    sessionSecretBytes: Buffer.alloc(32, byte + 1), csrfSecretBytes: Buffer.alloc(32, byte + 2)
  });
  if (login.status !== "authenticated") throw new Error("Startlistesession saknas");
  return { installation, login };
}

describe("TASK 006R privat operativ startlista PostgreSQL", () => {
  it("sorterar FIXED/PUNCH sanningsenligt och skriver inte under GET", async () => {
    const data = await fixture("ordning");
    const access = await admin(data.race.id, 41);
    const footprint = async () => {
      const [audits, sessions] = await Promise.all([
        db.select({ value: count() }).from(schema.auditEvents),
        db.select({ value: count() }).from(schema.pairingAdminSessions)
      ]);
      return { audits: audits[0]?.value, sessions: sessions[0]?.value };
    };
    const before = await footprint();
    const result = await listStartListAsAdmin(db, { sessionToken: access.login.sessionToken, raceId: data.race.id }, usedAt);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Startlistan saknas");
    expect(result.response.timeZone).toBe("Europe/Stockholm");
    expect(result.response.generatedAt).toBe("2026-09-04T06:02:00.123Z");
    expect(result.response.classes.map((item) => item.name)).toEqual(["A PUNCH", "Z FIXED"]);
    const fixed = result.response.classes.find((item) => item.id === data.fixed.id);
    const punch = result.response.classes.find((item) => item.id === data.punch.id);
    expect(fixed?.entries.map((item) => [item.displayName, item.fixedStartTime, item.cardNumber, item.multipleActiveAssignments]))
      .toEqual([["Ada A", "2026-09-04T07:00:00.123Z", "111", false], ["Zelda Å", null, null, false]]);
    expect(punch?.entries).toEqual([{ id: data.bo.id, displayName: "Bo B", organisationName: "Klubb B",
      fixedStartTime: null, cardNumber: null, multipleActiveAssignments: true }]);
    expect(await footprint()).toEqual(before);
  });

  it("isolerar lopp, capability och spärrad credential", async () => {
    const first = await fixture("första");
    const second = await fixture("andra");
    const access = await admin(first.race.id, 51);
    const wrongCapability = await admin(first.race.id, 61, "VIEW_RACE_OVERVIEW");
    await expect(listStartListAsAdmin(db, { sessionToken: wrongCapability.login.sessionToken, raceId: first.race.id }, usedAt))
      .resolves.toEqual({ status: "forbidden" });
    await expect(listStartListAsAdmin(db, { sessionToken: access.login.sessionToken, raceId: second.race.id }, usedAt))
      .resolves.toEqual({ status: "forbidden" });
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: access.installation.credentialId, capability: "VIEW_START_LIST"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(listStartListAsAdmin(db, { sessionToken: access.login.sessionToken, raceId: first.race.id }, usedAt))
      .resolves.toEqual({ status: "unauthorized" });
  });
});
