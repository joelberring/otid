import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import type { EntryStatusDecision } from "@o-tid/contracts";
import { setEntryStatus } from "../../src/entry-status";
import { publicResults } from "../../src/results";
import { listAdministratorForestWatch } from "../../src/start-checkin-roster";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { setResultsOfficialAsAdmin } from "../../src/result-official";
import { exportFrozenIofResultListAsAdmin, readPublicFrozenRaceResults } from "../../src/result-finalization";
import { ingest, NOW, run, seedRace } from "./steg-25-fixtures";

/**
 * PLAN.md steg 35: disk, utom tävlan och "Deltog utan tid" med och utan avläsning. Besluten ger revision och auditpost,
 * syns utan placering, räknas som i mål i kvar i skogen och exporteras i IOF XML (NT som NotCompeting utan tid).
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

type Admin = Awaited<ReturnType<typeof seedRace>>["admin"];

async function decide(admin: Admin, entryId: string, decision: EntryStatusDecision, requestId = randomUUID()) {
  const head = (await pool.query<{ revision: number }>("SELECT coalesce(max(revision),0) AS revision FROM result_revision WHERE entry_id=$1",
    [entryId])).rows[0]!;
  return setEntryStatus(db, { ...admin, entryId, idempotencyKey: `entry-status:${requestId}`,
    request: { formatVersion: 1, requestId, expectedRevision: head.revision, decision } }, NOW);
}
const row = async (raceId: string, givenName: string) =>
  (await publicResults(db, raceId)).results.find((result) => result.givenName === givenName);
async function forest(admin: Admin) {
  const roster = await listAdministratorForestWatch(db, admin, NOW);
  if (roster.status !== "ok") throw new Error(roster.status);
  return new Map(roster.response.entries.map((entry) => [entry.displayName, entry.forestState]));
}

describe("steg 35: fler statusval", () => {
  it("disk, utom tävlan och deltog utan tid utan avläsning: revision, audit, kvar i skogen och borttagning", async () => {
    const { ids, admin } = await seedRace(db, pool);
    const requestId = randomUUID();
    expect(await decide(admin, ids.bo, { kind: "WITHOUT_TIMING" }, requestId)).toMatchObject({ status: "decided",
      response: { revision: 1, cause: "MANUAL_WITHOUT_TIMING", status: "NT", reason: "WITHOUT_TIMING" } });
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)))
      .toEqual([expect.objectContaining({ action: "WITHOUT_TIMING_DECIDED", actorKind: "USER_ACCOUNT" })]);
    expect(await row(ids.race, "Bo")).toEqual(expect.objectContaining({ status: "NT", rankingState: "NOT_RANKABLE_STATUS" }));
    expect(await row(ids.race, "Bo")).not.toHaveProperty("elapsedMs");

    expect(await decide(admin, ids.eva, { kind: "OUT_OF_COMPETITION" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_OUT_OF_COMPETITION", status: "OOC" } });
    expect(await decide(admin, ids.dan, { kind: "DISQUALIFIED", reason: "Genade" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_DISQUALIFICATION", status: "DSQ" } });
    expect(await row(ids.race, "Dan")).toMatchObject({ status: "DSQ" });

    // Kvar i skogen: ett beslut utan avläsning räknas som i mål. Ada och Cia har inget och är kvar.
    const states = await forest(admin);
    expect([states.get("Bo Ek"), states.get("Eva Ek"), states.get("Dan Ek")]).toEqual(["RETURNED", "RETURNED", "RETURNED"]);
    expect(states.get("Cia Ek")).not.toBe("RETURNED");

    // Tillbaka till bedömningen: inget resultat finns kvar, och löparen är kvar i skogen igen.
    expect(await decide(admin, ids.bo, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { revision: 2, cause: "MANUAL_RESULT_REMOVED" } });
    expect(await row(ids.race, "Bo")).toBeUndefined();
    expect((await forest(admin)).get("Bo Ek")).not.toBe("RETURNED");
    expect(await decide(admin, ids.dan, { kind: "WITHDRAW" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_RESULT_REMOVED" } });
    expect((await pool.query("SELECT note FROM result_revision WHERE entry_id=$1 ORDER BY revision", [ids.dan])).rows)
      .toEqual([{ note: "Genade" }, { note: null }]);
  });

  it("med avläsning: utom tävlan behåller tiden, deltog utan tid står sist; IOF-export och fastställande", async () => {
    const { ids, cards, admin } = await seedRace(db, pool);
    await ingest(db, ids.race, [run(cards.ada, "10:02:00", 40), run(cards.cia, "11:00:00", 30), run(cards.dan, "11:00:00", 35)]);
    expect(await decide(admin, ids.cia, { kind: "OUT_OF_COMPETITION" })).toMatchObject({ status: "decided" });
    // Dan sprang men tiden gäller inte (t.ex. lånad bricka): deltog utan tid även med avläsning.
    expect(await decide(admin, ids.dan, { kind: "WITHOUT_TIMING" })).toMatchObject({ status: "decided",
      response: { cause: "MANUAL_WITHOUT_TIMING", status: "NT" } });
    expect(await decide(admin, ids.bo, { kind: "WITHOUT_TIMING" })).toMatchObject({ status: "decided" });
    expect(await decide(admin, ids.eva, { kind: "DID_NOT_START" })).toMatchObject({ status: "decided" });
    expect(await row(ids.race, "Cia")).toMatchObject({ status: "OOC", elapsedMs: 1_800_000 });
    expect(await row(ids.race, "Cia")).not.toHaveProperty("position");
    const open = (await publicResults(db, ids.race)).results.filter((result) => result.className === "Öppen");
    expect(open.map((result) => [result.givenName, result.status])).toEqual([["Cia", "OOC"], ["Eva", "DNS"], ["Dan", "NT"]]);

    const exported = await exportIofResultListAsAdmin(db, admin, NOW);
    if (exported.status !== "ok") throw new Error(exported.status);
    const xml = new TextDecoder().decode(exported.bytes);
    const person = (given: string) => xml.slice(xml.indexOf(`<Given>${given}</Given>`), xml.indexOf("</PersonResult>", xml.indexOf(`<Given>${given}</Given>`)));
    expect(person("Dan")).toContain("<Status>NotCompeting</Status>");
    expect(person("Dan")).not.toMatch(/<Time>|<SplitTime|<Position>/);
    expect(person("Bo")).toContain("<Status>NotCompeting</Status>");
    expect(person("Cia")).toMatch(/<Time>1800<\/Time>[\s\S]*<Status>NotCompeting<\/Status>/);
    expect(xml.indexOf("<Given>Eva</Given>")).toBeLessThan(xml.indexOf("<Given>Dan</Given>"));

    const requestId = randomUUID();
    const official = await setResultsOfficialAsAdmin(db, { ...admin, idempotencyKey: `results-official:${requestId}`,
      request: { formatVersion: 1, requestId, action: "OFFICIAL" } }, new Date(NOW.getTime() + 60_000));
    if (official.status !== "saved" || official.response.result.outcome !== "OFFICIAL") throw new Error(JSON.stringify(official));
    const frozen = await exportFrozenIofResultListAsAdmin(db, { ...admin, finalizationId: official.response.result.finalization.id }, NOW);
    if (frozen.status !== "ok") throw new Error(frozen.status);
    const frozenXml = new TextDecoder().decode(frozen.bytes);
    expect(frozenXml.match(/<Status>NotCompeting<\/Status>/g)).toHaveLength(3);
    const publicFrozen = await readPublicFrozenRaceResults(db, ids.race, official.response.result.finalization.id);
    expect(publicFrozen.status === "ok" && publicFrozen.response.results.map((result) => [result.givenName, result.status, result.elapsedMs]))
      .toEqual(expect.arrayContaining([["Dan", "NT", null], ["Bo", "NT", null], ["Cia", "OOC", 1_800_000]]));
  });
});
