import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@o-tid/database";
import { createDatabase } from "@o-tid/database";
import {
  approveResultAsAdmin,
  contentHash,
  createEvent,
  decideDidNotStartAsAdmin,
  decideDidNotFinishAsAdmin,
  decideOutOfCompetitionAsAdmin,
  decideWithoutTimingAsAdmin,
  disqualifyResultAsAdmin,
  importIofXml,
  ingestDeviceBatch,
  issuePairingAdminAccessCredential,
  listDidNotFinishCandidatesAsAdmin,
  listDidNotStartCandidatesAsAdmin,
  listDidNotStartWithdrawalsAsAdmin,
  listOutOfCompetitionCandidatesAsAdmin,
  listResultApprovalCandidatesAsAdmin,
  listResultDisqualificationCandidatesAsAdmin,
  listSpeakerBoardAsAdmin,
  listWithoutTimingCandidatesAsAdmin,
  loginPairingAdmin,
  listAdministratorForestWatch,
  correctAdministratorStart,
  registerAdministratorReturn,
  withdrawDidNotStartAsAdmin
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-06T12:00:00.000Z");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => { await pool.end(); });

type Capability = "VIEW_SPEAKER_BOARD" | "DISQUALIFY_RESULT" | "APPROVE_RESULT" |
  "DECIDE_DID_NOT_START" | "WITHDRAW_DID_NOT_START" | "DECIDE_DID_NOT_FINISH" |
  "DECIDE_OUT_OF_COMPETITION" | "DECIDE_WITHOUT_TIMING" | "RACE_FUNCTIONARY";

async function fixture() {
  const { race } = await createEvent(db, { name: "Manuell speakertest", raceName: "Lång",
    raceDate: "2026-08-30", timeZone: "Europe/Stockholm" });
  for (const file of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(db, race.id, await readFile(new URL(`../../../../fixtures/iof/${file}`, import.meta.url), "utf8"));
  }
  return race.id;
}

async function admin(raceId: string, capability: Capability, marker: number) {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability,
    label: `Manuell speaker ${capability}`, expiresAt: new Date(now.getTime() + 8 * 3600_000) },
  { now, secretBytes: Buffer.alloc(32, marker) });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, {
    now, expectedRaceId: raceId, expectedCapability: capability,
    sessionSecretBytes: Buffer.alloc(32, marker + 1), csrfSecretBytes: Buffer.alloc(32, marker + 2)
  });
  if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
  return { sessionToken: login.sessionToken, raceId, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken,
    credentialId: installation.credentialId };
}

function payload(kind: "ok" | "missing") {
  const punches = kind === "ok" ? [31, 32, 33] : [31, 33];
  return { cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z", punches: punches.map((code, index) => ({
      code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z`
    })) };
}

async function ingest(raceId: string, kind: "ok" | "missing") {
  const value = payload(kind);
  const response = await ingestDeviceBatch(db, raceId, { deviceId: crypto.randomUUID(), sessionId: crypto.randomUUID(),
    packageVersion: 1, firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator", payload: value, contentHash: contentHash(value) }] });
  expect(response.acknowledgements[0]?.status).toBe("stored");
}

async function board(raceId: string) {
  const auth = await admin(raceId, "VIEW_SPEAKER_BOARD", 11);
  const response = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: auth.sessionToken }, now);
  if (response.status !== "ok") throw new Error(`Speakerunderlag saknas: ${response.status}`);
  const [row] = response.response.rows;
  if (!row || row.state !== "ACTIVE_RESULT") throw new Error("Aktivt speakerresultat saknas");
  return row;
}

describe("TASK 008 speaker: manuella resultatlivscykler PostgreSQL", () => {
  it("behåller aktiv DSQ över senare teknisk OK", async () => {
    const raceId = await fixture();
    await ingest(raceId, "ok");
    const auth = await admin(raceId, "DISQUALIFY_RESULT", 21);
    const listed = await listResultDisqualificationCandidatesAsAdmin(db, auth, now);
    if (listed.status !== "ok") throw new Error("DSQ-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("DSQ-target saknas");
    const result = await disqualifyResultAsAdmin(db, { ...auth, entryId: candidate.id,
      idempotencyKey: `manual-disqualification:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status }, policyVersion: "manual-disqualification-v1" } }, now);
    expect(result.status).toBe("disqualified");
    await ingest(raceId, "ok");
    expect((await board(raceId)).result).toMatchObject({ status: "DSQ", reason: "MANUAL_DISQUALIFICATION" });
  });

  it("behåller aktiv approval över senare teknisk MP", async () => {
    const raceId = await fixture();
    await ingest(raceId, "missing");
    const auth = await admin(raceId, "APPROVE_RESULT", 31);
    const listed = await listResultApprovalCandidatesAsAdmin(db, auth, now);
    if (listed.status !== "ok") throw new Error("Approval-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("Approval-target saknas");
    const result = await approveResultAsAdmin(db, { ...auth, entryId: candidate.id,
      idempotencyKey: `manual-result-approval:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status, reason: candidate.targetResultRevision.reason },
        policyVersion: "manual-result-approval-v1" } }, now);
    expect(result.status).toBe("approved");
    await ingest(raceId, "missing");
    expect((await board(raceId)).result).toMatchObject({ status: "OK", reason: "MANUAL_APPROVAL" });
  });

  it("behåller aktiv DNF över senare teknisk MP utan tid", async () => {
    const raceId = await fixture();
    await ingest(raceId, "missing");
    const auth = await admin(raceId, "DECIDE_DID_NOT_FINISH", 41);
    const listed = await listDidNotFinishCandidatesAsAdmin(db, auth, now);
    if (listed.status !== "ok") throw new Error("DNF-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("DNF-target saknas");
    const result = await decideDidNotFinishAsAdmin(db, { ...auth, entryId: candidate.id,
      idempotencyKey: `did-not-finish:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status }, policyVersion: "did-not-finish-v1" } }, now);
    expect(result.status).toBe("did-not-finish");
    await ingest(raceId, "missing");
    expect((await board(raceId)).result).toEqual(expect.objectContaining({ status: "DNF", reason: "DID_NOT_FINISH" }));
    expect((await board(raceId)).result).not.toHaveProperty("elapsedMs");
  });

  it("behåller aktiv OOC över senare teknisk OK", async () => {
    const raceId = await fixture();
    await ingest(raceId, "ok");
    const auth = await admin(raceId, "DECIDE_OUT_OF_COMPETITION", 51);
    const listed = await listOutOfCompetitionCandidatesAsAdmin(db, auth, now);
    if (listed.status !== "ok") throw new Error("OOC-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("OOC-target saknas");
    const result = await decideOutOfCompetitionAsAdmin(db, { ...auth, entryId: candidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status }, policyVersion: "out-of-competition-v1" } }, now);
    expect(result.status).toBe("out-of-competition");
    await ingest(raceId, "ok");
    expect((await board(raceId)).result).toMatchObject({ status: "OOC", reason: "OUT_OF_COMPETITION" });
  });

  it("behåller aktiv NT över senare teknisk OK och exponerar aldrig tid", async () => {
    const raceId = await fixture();
    await ingest(raceId, "ok");
    const auth = await admin(raceId, "DECIDE_WITHOUT_TIMING", 61);
    const listed = await listWithoutTimingCandidatesAsAdmin(db, auth, now);
    if (listed.status !== "ok") throw new Error("NT-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("NT-target saknas");
    const result = await decideWithoutTimingAsAdmin(db, { ...auth, entryId: candidate.id,
      idempotencyKey: `without-timing:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision,
          status: "OK", reason: "COMPLETE" }, policyVersion: "without-timing-v1" } }, now);
    expect(result.status).toBe("without-timing");
    await ingest(raceId, "ok");
    const row = await board(raceId);
    expect(row.result).toEqual(expect.objectContaining({ status: "NT", reason: "WITHOUT_TIMING" }));
    expect(row.result).not.toHaveProperty("elapsedMs");
  });

  it("visar återtaget manuellt DNS som NO_ACTIVE_RESULT utan fallback eller tid", async () => {
    const raceId = await fixture();
    const dnsAuth = await admin(raceId, "DECIDE_DID_NOT_START", 71);
    const candidates = await listDidNotStartCandidatesAsAdmin(db, dnsAuth, now);
    if (candidates.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = candidates.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate) throw new Error("Ada saknas som DNS-kandidat");
    const decided = await decideDidNotStartAsAdmin(db, { ...dnsAuth, entryId: candidate.id,
      idempotencyKey: `did-not-start:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: candidates.response.snapshotVersion,
        expectedLatestResultRevision: null, policyVersion: "did-not-start-v1" } }, now);
    expect(decided.status).toBe("decided");
    const speaker = await admin(raceId, "VIEW_SPEAKER_BOARD", 81);
    const before = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (before.status !== "ok") throw new Error("DNS-speakerunderlag saknas");
    const beforeRow = before.response.rows.find((row) => row.givenName === "Ada");
    expect(beforeRow).toMatchObject({ state: "ACTIVE_RESULT", result: { status: "DNS", reason: "DID_NOT_START" } });

    const withdrawalAuth = await admin(raceId, "WITHDRAW_DID_NOT_START", 91);
    const withdrawals = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, now);
    if (withdrawals.status !== "ok") throw new Error("DNS-återtagandekandidater saknas");
    const withdrawal = withdrawals.response.entries.find((entry) => entry.id === candidate.id);
    if (!withdrawal || withdrawal.state !== "WITHDRAWABLE") throw new Error("DNS kan inte återtas");
    const withdrawn = await withdrawDidNotStartAsAdmin(db, { ...withdrawalAuth, entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: withdrawal.entryVersion, expectedClassId: withdrawal.classId,
        expectedCourseVersionId: withdrawal.courseVersionId, expectedSnapshotVersion: withdrawals.response.snapshotVersion,
        expectedDidNotStartDecisionId: withdrawal.didNotStartDecisionId,
        expectedResultRevision: { id: withdrawal.targetResultRevision.id, revision: withdrawal.targetResultRevision.revision },
        policyVersion: "did-not-start-withdrawal-v1" } }, now);
    expect(withdrawn.status).toBe("withdrawn");

    const after = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (after.status !== "ok") throw new Error("Återtaget DNS-speakerunderlag saknas");
    const row = after.response.rows.find((item) => item.givenName === "Ada");
    expect(row).toMatchObject({ state: "NO_ACTIVE_RESULT", selectedRevision: beforeRow?.selectedRevision,
      registeredAt: beforeRow?.registeredAt });
    expect(row).not.toHaveProperty("result");
    expect(after.response.raceSnapshotVersion).toBe(before.response.raceSnapshotVersion);
  });

  it("tolkar avpricknings-DNS med exakt källa och döljer den efter målkorrektion", async () => {
    const raceId = await fixture();
    // Funktionären vid starten rapporterar Ada som ej startad (ADR-0172 beslut 3).
    const start = await admin(raceId, "RACE_FUNCTIONARY", 101);
    const roster = await listAdministratorForestWatch(db, start, now);
    if (roster.status !== "ok") throw new Error("Avprickningsroster saknas");
    const ada = roster.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!ada) throw new Error("Ada saknas i avprickningsroster");
    const common = { formatVersion: 1 as const, entryId: ada.entryId, packageVersion: roster.response.snapshotVersion,
      expectedEntryVersion: ada.entryVersion, observedAt: now.toISOString() };
    const dns = await correctAdministratorStart(db, { ...start, request: { ...common, requestId: crypto.randomUUID(),
      expectedRevision: ada.revision, targetStartState: "REPORTED_NOT_STARTED" } }, now);
    expect(dns).toMatchObject({ status: "stored", response: { receipt: { effect: { kind: "APPLIED" } } } });

    const speaker = await admin(raceId, "VIEW_SPEAKER_BOARD", 111);
    const before = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (before.status !== "ok") throw new Error("Avpricknings-DNS speakerunderlag saknas");
    const beforeRow = before.response.rows.find((row) => row.givenName === "Ada");
    expect(beforeRow).toMatchObject({ state: "ACTIVE_RESULT", result: { status: "DNS", reason: "DID_NOT_START" } });

    // Funktionären i mål registrerar återkomst; avpricknings-DNS:et tas tillbaka.
    const withdrawn = await registerAdministratorReturn(db, { ...start, request: { ...common, requestId: crypto.randomUUID(),
      expectedRevision: 1, expectedStartState: "REPORTED_NOT_STARTED" } }, now);
    expect(withdrawn).toMatchObject({ status: "stored", response: { receipt: { effect: { kind: "APPLIED" } } } });

    const after = await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: speaker.sessionToken }, now);
    if (after.status !== "ok") throw new Error("Korrigerat avpricknings-DNS speakerunderlag saknas");
    const row = after.response.rows.find((item) => item.givenName === "Ada");
    expect(row).toMatchObject({ state: "NO_ACTIVE_RESULT", selectedRevision: beforeRow?.selectedRevision,
      registeredAt: beforeRow?.registeredAt });
    expect(row).not.toHaveProperty("result");
  });
});
