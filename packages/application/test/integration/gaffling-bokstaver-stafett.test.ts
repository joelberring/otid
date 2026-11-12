import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { DeviceBatch, SportidentReadoutPayload } from "@o-tid/contracts";
import type { CourseForking } from "@o-tid/domain";
import { contentHash } from "../../src/serialization";
import { createOrganizerEvent } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdmin } from "../../src/manual-course-class";
import { ingestReadoutsAsAdmin } from "../../src/readout-station";
import { createRelayClassAsAdmin, registerRelayTeamAsAdmin } from "../../src/relay-admin";
import { changeRelayLegVariantAsAdmin } from "../../src/relay-admin-edit";
import { getRelayOverviewAsAdmin } from "../../src/relay-results";
import { editCourseAsAdmin, previewCourseEditAsAdmin } from "../../src/course-edit";
import { accountOnRace } from "./accounts";

/**
 * ADR-0175, tillägg 2026-11-12 (b): stafettsträckor följer samma regel som individuella löpare. En rättad kontrollkod i ett
 * alternativ ger sträckorna samma kod (förut fick de ingen variant), och när ett alternativ tas bort behåller övriga
 * sträckor sin kod (bokstäverna står kvar); bara sträckor med den borttagna bokstaven blir utan variant och står med namn
 * och sträcka i beskedet och i historiken.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_gaffelstafett_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 120_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_gaffelstafett_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };
const at = (clock: string) => `2026-12-09T${clock}:00.000Z`;

async function race(): Promise<Proof> {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, email: `stafett.${suffix}@test.o-tid.se`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createOrganizerEvent(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Nattstafett", raceName: "Onsdag", raceDate: "2026-12-09", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const entered = await accountOnRace(db, { ...accountProof, raceId: created.response.raceId });
  if (entered.status !== "authenticated") throw new Error("Kom inte in i tävlingen");
  return { raceId: created.response.raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
}

const control = (code: number) => ({ kind: "CONTROL" as const, code });
const fork = (...branches: number[][]) => ({ kind: "FORK" as const, branches });
// 31 [A:41 | B:42] 50 [C:61 | D:62 | E:63] 70
const night = (second: number[][]): CourseForking => ({ items: [control(31), fork([41], [42]), control(50), fork(...second), control(70)] });

async function edit(proof: Proof, courseId: string, forking: CourseForking) {
  const requestId = randomUUID();
  const result = await editCourseAsAdmin(db, { ...proof, idempotencyKey: `course-edit:${requestId}`, request: { formatVersion: 1,
    requestId, courseId, forking, confirmResultChanges: true } });
  if (result.status !== "edited") throw new Error(`Ändringen sparades inte: ${result.status}`);
  return result.response;
}

async function overview(proof: Proof) {
  const result = await getRelayOverviewAsAdmin(db, proof);
  if (result.status !== "ok") throw new Error(result.status);
  return result.response;
}

const legCodes = async (proof: Proof) => (await overview(proof)).teams.map(team => team.legs.map(leg => leg.variantCode ?? null));

async function readout(proof: Proof, cardNumber: string, codes: number[]) {
  const payload: SportidentReadoutPayload = { cardNumber, cardType: "SI10", finishPunchedAt: at("17:40"),
    punches: codes.map((code, index) => ({ code, punchedAt: new Date(Date.parse(at("17:00")) + (index + 1) * 60_000).toISOString() })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true };
  const version = (await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [proof.raceId])).rows[0]!.snapshot_version;
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: version, firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: at("17:41"), transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdmin(db, { ...proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

describe("gafflad stafett: bokstäverna och koderna står kvar (tillägg 2026-11-12 b)", () => {
  it("rättad kod ger samma kod på sträckorna; ett borttaget alternativ lämnar bara dess sträckor utan variant", async () => {
    const proof = await race();
    const requestId = randomUUID();
    const created = await createManualCourseClassAsAdmin(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
      request: { formatVersion: 1, requestId, courseName: "Natt", className: "Natt individuell", startRule: "PUNCH", controlCodes: [31, 41, 50, 61, 70] } });
    if (created.status !== "created") throw new Error("Banan kunde inte skapas");
    const courseId = created.response.courseId;
    await edit(proof, courseId, night([[61], [62], [63]]));

    const classId = randomUUID();
    const relay = await createRelayClassAsAdmin(db, { ...proof, idempotencyKey: `relay-class:${classId}`, request: { formatVersion: 1, requestId: classId,
      name: "Nattstafett", courseId, legs: [1, 2, 3].map(leg => ({ leg, startTime: leg === 1 ? at("17:00") : null, variantCode: null, courseId: null,
        restartAfterMinutes: null, startMethod: leg === 1 ? "MASS_START" : "CHANGEOVER" })) } });
    if (relay.status !== "saved") throw new Error("Stafettklassen kunde inte skapas");
    for (const [name, cards] of [["Lag Ett", ["9701", "9702", "9703"]], ["Lag Två", ["9711", "9712", "9713"]]] as const) {
      const id = randomUUID();
      const registered = await registerRelayTeamAsAdmin(db, { ...proof, idempotencyKey: `relay-team:${id}`, request: { formatVersion: 1, requestId: id,
        classId: relay.response.classId, number: null, name, organisationName: "OK Natt",
        runners: cards.map((cardNumber, index) => ({ givenName: `${name.split(" ").at(-1)}${index + 1}`, familyName: "Löpare", organisationName: null, cardNumber })) } });
      if (registered.status !== "saved") throw new Error("Laget kunde inte anmälas");
    }
    // Bestämda varianter per sträcka (som lagvyn ger före tryck).
    const planned = [["AE", "AD", "BC"], ["BE", "AC", "BD"]];
    for (const [teamIndex, codes] of planned.entries()) for (const [legIndex, code] of codes.entries()) {
      const view = await overview(proof);
      const team = view.teams[teamIndex]!, leg = team.legs[legIndex]!;
      if (leg.variantCode === code) continue;
      const id = randomUUID();
      const changed = await changeRelayLegVariantAsAdmin(db, { ...proof, idempotencyKey: `relay-leg-variant:${id}`, request: { formatVersion: 1,
        requestId: id, teamId: team.id, leg: legIndex + 1, expectedEntryVersion: leg.entryVersion, variantCode: code, confirmResultChanges: true } });
      expect(changed.status).toBe("saved");
    }
    expect(await legCodes(proof)).toEqual(planned);
    await readout(proof, "9701", [31, 41, 50, 63, 70]);
    expect((await overview(proof)).teams[0]!.legs[0]).toMatchObject({ status: "OK" });

    // Kodrättning: E 63 → 65. Sträckorna behåller sina koder (förut blev AE och BE utan variant); Ett1 räknas om och blir felstämplad.
    const fixed = night([[61], [62], [65]]);
    const preview = await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: fixed } });
    expect(preview).toMatchObject({ status: "ok", response: { forking: { removedCodes: [], changedCodes: ["AE", "BE"], renamedEntryCount: 0 },
      becomesMispunchedCount: 1 } });
    if (preview.status !== "ok") throw new Error("Beskedet saknas");
    expect(preview.response.forking!.entryChanges).toBeUndefined();
    await edit(proof, courseId, fixed);
    expect(await legCodes(proof)).toEqual(planned);
    expect((await overview(proof)).teams[0]!.legs[0]).toMatchObject({ variantCode: "AE", status: "MP" });

    // D (62) tas bort: E står kvar som E. Bara sträckorna med D (Ett2 på sträcka 2, Två3 på sträcka 3) blir utan variant och
    // står med namn, sträcka, kod före och efter i beskedet, i kvittot och i historiken.
    const removed = night([[61], [65]]);
    const removal = await previewCourseEditAsAdmin(db, { ...proof, courseId, request: { formatVersion: 1, forking: removed } });
    if (removal.status !== "ok") throw new Error("Beskedet saknas");
    expect(removal.response.forking).toMatchObject({ removedCodes: ["AD", "BD"], renamedEntryCount: 0 });
    expect(removal.response.forking!.entryChanges!.map(row => [row.displayName, row.className, row.leg, row.before, row.after]))
      .toEqual([["Ett2 Löpare", "Nattstafett", 2, "AD", null], ["Två3 Löpare", "Nattstafett", 3, "BD", null]]);
    const saved = await edit(proof, courseId, removed);
    expect(await legCodes(proof)).toEqual([["AE", null, "BC"], ["BE", "AC", null]]);
    expect(saved.variantChanges!.map(row => [row.displayName, row.leg, row.before, row.after])).toEqual([["Ett2 Löpare", 2, "AD", null], ["Två3 Löpare", 3, "BD", null]]);
    const history = (await pool.query<{ before: { courseVariantCode: string }; after: { courseVariantCode: string | null } }>(
      "select before, after from audit_event where race_id = $1 and action = 'ENTRY_COURSE_VARIANT_CHANGED_BY_COURSE_EDIT' and request_id = $2",
      [proof.raceId, saved.requestId])).rows;
    expect(history.map(row => [row.before.courseVariantCode, row.after.courseVariantCode]).sort()).toEqual([["AD", null], ["BD", null]]);
  }, 180_000);
});
