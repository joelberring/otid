import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import {
  contentHash,
  createEvent,
  disqualifyResultAsAdmin,
  importIofXml,
  ingestDeviceBatch,
  issuePairingAdminAccessCredential,
  listResultDisqualificationCandidatesAsAdmin,
  listResultDisqualificationWithdrawalsAsAdmin,
  listSpeakerBoardAsAdmin,
  loginPairingAdmin,
  withdrawResultDisqualificationAsAdmin
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const entries = 25;
const decisionsPerEntry = 40;
const expectedDecisionCount = entries * decisionsPerEntry;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => { await pool.end(); });

type Capability = "VIEW_SPEAKER_BOARD" | "DISQUALIFY_RESULT" | "WITHDRAW_DISQUALIFICATION";

async function admin(raceId: string, capability: Capability, now: Date) {
  const issued = await issuePairingAdminAccessCredential(db, {
    raceId,
    capability,
    label: `TASK008 history cap ${capability}`,
    expiresAt: new Date(now.getTime() + 8 * 3_600_000)
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential }, {
    now,
    expectedRaceId: raceId,
    expectedCapability: capability
  });
  if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
  return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
}

function entryListXml(): string {
  const personEntries = Array.from({ length: entries }, (_, index) => {
    const card = 20_000 + index;
    return `<PersonEntry><Id>history-entry-${index}</Id><Person><Id>history-person-${index}</Id>` +
      `<Name><Family>${index}</Family><Given>History</Given></Name></Person><Organisation><Name>Cap OK</Name></Organisation>` +
      `<ControlCard punchingSystem="SPORTident">${card}</ControlCard><Class><Id>class-h21</Id><Name>H21</Name></Class></PersonEntry>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><EntryList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="2026-08-30T08:00:00Z" creator="O-Tid history cap"><Event><Name>O-Tid history cap</Name></Event>${personEntries}</EntryList>`;
}

function payload(cardNumber: string, cycle: number) {
  const seconds = String(cycle).padStart(2, "0");
  return {
    cardNumber,
    startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: `2026-08-30T10:40:${seconds}Z`,
    punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z` }))
  };
}

async function ingestTechnical(raceId: string, cards: readonly string[], cycle: number) {
  const events = cards.map((cardNumber, index) => {
    const value = payload(cardNumber, cycle);
    return {
      localSequence: index + 1,
      stationReceivedAt: `2026-08-30T10:41:${String(cycle).padStart(2, "0")}Z`,
      transport: "simulator" as const,
      payload: value,
      contentHash: contentHash(value)
    };
  });
  const response = await ingestDeviceBatch(db, raceId, {
    deviceId: randomUUID(),
    sessionId: randomUUID(),
    packageVersion: cycle + 1,
    firstSequence: 1,
    lastSequence: events.length,
    events
  });
  expect(response.acknowledgements.every((acknowledgement) => acknowledgement.status === "stored")).toBe(true);
}

describe("TASK008 speaker: PostgreSQL decision-history cap", () => {
  it("resolves exactly 1000 persisted decisions and rejects the 1001st before projection", async () => {
    const now = new Date();
    const { race } = await createEvent(db, {
      name: "Syntetiskt speaker-historiktak",
      raceName: "Lång",
      raceDate: "2026-08-30",
      timeZone: "Europe/Stockholm"
    });
    await importIofXml(db, race.id, await readFile(new URL("../../../../fixtures/iof/course-data.xml", import.meta.url), "utf8"));
    await importIofXml(db, race.id, entryListXml());
    const cards = Array.from({ length: entries }, (_, index) => String(20_000 + index));
    await ingestTechnical(race.id, cards, 0);

    const speaker = await admin(race.id, "VIEW_SPEAKER_BOARD", now);
    const disqualification = await admin(race.id, "DISQUALIFY_RESULT", now);
    const withdrawal = await admin(race.id, "WITHDRAW_DISQUALIFICATION", now);
    let cardByEntryId = new Map<string, string>();

    for (let cycle = 0; cycle < decisionsPerEntry; cycle++) {
      const candidates = await listResultDisqualificationCandidatesAsAdmin(db, disqualification, now);
      if (candidates.status !== "ok") throw new Error("Diskvalifikationskandidater saknas");
      const ready = candidates.response.entries.filter((entry) => entry.readiness === "READY" && entry.targetResultRevision);
      expect(ready).toHaveLength(entries);
      if (cycle === 0) {
        cardByEntryId = new Map(ready.map((entry) => [entry.id, String(20_000 + Number(entry.displayName.split(" ").at(-1)))]));
      }
      for (const entry of ready) {
        const target = entry.targetResultRevision!;
        const result = await disqualifyResultAsAdmin(db, {
          ...disqualification,
          entryId: entry.id,
          idempotencyKey: `manual-disqualification:${randomUUID()}`,
          request: {
            formatVersion: 1,
            expectedEntryVersion: entry.entryVersion,
            expectedClassId: entry.classId,
            expectedCourseVersionId: entry.courseVersionId,
            expectedSnapshotVersion: candidates.response.snapshotVersion,
            expectedResultRevision: { id: target.id, revision: target.revision, status: target.status },
            policyVersion: "manual-disqualification-v1"
          }
        }, now);
        expect(result.status).toBe("disqualified");
      }
      if (cycle === decisionsPerEntry - 1) continue;

      const withdrawals = await listResultDisqualificationWithdrawalsAsAdmin(db, withdrawal, now);
      if (withdrawals.status !== "ok") throw new Error("Diskvalifikationsåtertaganden saknas");
      const withdrawable = withdrawals.response.entries.filter((entry) => entry.state === "WITHDRAWABLE");
      expect(withdrawable).toHaveLength(entries);
      for (const entry of withdrawable) {
        const result = await withdrawResultDisqualificationAsAdmin(db, {
          ...withdrawal,
          entryId: entry.id,
          idempotencyKey: `manual-disqualification-withdrawal:${randomUUID()}`,
          request: {
            formatVersion: 1,
            expectedEntryVersion: entry.entryVersion,
            expectedClassId: entry.classId,
            expectedCourseVersionId: entry.courseVersionId,
            expectedSnapshotVersion: withdrawals.response.snapshotVersion,
            expectedResultDisqualificationDecisionId: entry.resultDisqualificationDecisionId,
            expectedTargetResultRevision: entry.targetResultRevision,
            expectedDisqualifiedResultRevision: entry.disqualifiedResultRevision,
            expectedAbsoluteResultRevision: entry.absoluteResultRevision,
            expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
            policyVersion: "manual-disqualification-withdrawal-v1"
          }
        }, now);
        expect(result.status).toBe("withdrawn");
      }
      await ingestTechnical(race.id, cards, cycle + 1);
    }

    expect((await db.select({ total: count() }).from(schema.resultDisqualificationDecisions)
      .where(eq(schema.resultDisqualificationDecisions.raceId, race.id)))[0]?.total).toBe(expectedDecisionCount);
    const atCap = await listSpeakerBoardAsAdmin(db, speaker, now);
    if (atCap.status !== "ok") throw new Error("Exakt 1000 beslut måste kunna resolveras");
    expect(atCap.response.rows).toHaveLength(entries);
    for (const row of atCap.response.rows) {
      expect(row.state).toBe("ACTIVE_RESULT");
      if (row.state !== "ACTIVE_RESULT") throw new Error("Aktivt resultat saknas vid historiktaket");
      expect(row.result).toMatchObject({ status: "DSQ", reason: "MANUAL_DISQUALIFICATION" });
    }

    const lastWithdrawals = await listResultDisqualificationWithdrawalsAsAdmin(db, withdrawal, now);
    if (lastWithdrawals.status !== "ok") throw new Error("Sista återtagandet saknas");
    const last = lastWithdrawals.response.entries.find((entry) => entry.state === "WITHDRAWABLE");
    if (!last) throw new Error("Ingen sista diskvalifikation kan återtas");
    expect((await withdrawResultDisqualificationAsAdmin(db, {
      ...withdrawal,
      entryId: last.id,
      idempotencyKey: `manual-disqualification-withdrawal:${randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: last.entryVersion,
        expectedClassId: last.classId,
        expectedCourseVersionId: last.courseVersionId,
        expectedSnapshotVersion: lastWithdrawals.response.snapshotVersion,
        expectedResultDisqualificationDecisionId: last.resultDisqualificationDecisionId,
        expectedTargetResultRevision: last.targetResultRevision,
        expectedDisqualifiedResultRevision: last.disqualifiedResultRevision,
        expectedAbsoluteResultRevision: last.absoluteResultRevision,
        expectedRestorationSourceResultRevision: last.restorationSourceResultRevision,
        policyVersion: "manual-disqualification-withdrawal-v1"
      }
    }, now)).status).toBe("withdrawn");
    const card = cardByEntryId.get(last.id);
    if (!card) throw new Error("Kortmappning saknas");
    await ingestTechnical(race.id, [card], decisionsPerEntry + 1);
    const finalCandidates = await listResultDisqualificationCandidatesAsAdmin(db, disqualification, now);
    if (finalCandidates.status !== "ok") throw new Error("Sista diskvalifikationskandidaten saknas");
    const final = finalCandidates.response.entries.find((entry) => entry.id === last.id && entry.readiness === "READY");
    if (!final?.targetResultRevision) throw new Error("Sista tekniska resultatrevisionen saknas");
    expect((await disqualifyResultAsAdmin(db, {
      ...disqualification,
      entryId: final.id,
      idempotencyKey: `manual-disqualification:${randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: final.entryVersion,
        expectedClassId: final.classId,
        expectedCourseVersionId: final.courseVersionId,
        expectedSnapshotVersion: finalCandidates.response.snapshotVersion,
        expectedResultRevision: { id: final.targetResultRevision.id, revision: final.targetResultRevision.revision, status: final.targetResultRevision.status },
        policyVersion: "manual-disqualification-v1"
      }
    }, now)).status).toBe("disqualified");
    expect((await db.select({ total: count() }).from(schema.resultDisqualificationDecisions)
      .where(eq(schema.resultDisqualificationDecisions.raceId, race.id)))[0]?.total).toBe(expectedDecisionCount + 1);
    await expect(listSpeakerBoardAsAdmin(db, speaker, now)).rejects.toThrow("beslutshistorik är för stor");
  }, 300_000);
});
