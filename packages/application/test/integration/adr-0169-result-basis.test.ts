import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { RESULT_APPROVAL_POLICY_VERSION, RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION, type DeviceBatch, type SportidentReadoutPayload } from "@o-tid/contracts";
import { contentHash } from "../../src/hash";
import { createEventAsUserAccount, enterRaceAsUserAccount } from "../../src/organizer-events";
import { registerUserAccount } from "../../src/user-account";
import { createManualCourseClassAsAdministrator } from "../../src/manual-course-class";
import { registerEntryAsAdmin } from "../../src/entry-registration";
import { changeEntryCardAsAdmin } from "../../src/entry-card";
import { changeEntryIdentityAsAdmin } from "../../src/entry-identity";
import { ingestReadoutsAsAdministrator } from "../../src/readout-station";
import { approveResultAsAdmin, listResultApprovalCandidatesAsAdmin } from "../../src/result-approval";
import { listResultApprovalWithdrawalsAsAdmin, withdrawResultApprovalAsAdmin } from "../../src/result-approval-withdrawal";
import { listClassResultRecalculationCandidatesAsAdministrator, recalculateClassResultsAsAdministrator } from "../../src/class-result-recalculation";
import { listResultFinalizationCandidatesAsAdmin } from "../../src/result-finalization";
import { exportIofResultListAsAdmin } from "../../src/result-list-export";
import { listEntryTransfersAsAdministrator } from "../../src/entry-transfer";
import { getAdministratorEffectiveResult } from "../../src/administrator-effective-result";
import {
  previewManualCourseResultBearingRelinkAsAdministrator,
  relinkManualCourseResultBearingClassAsAdministrator
} from "../../src/manual-course-result-bearing-relink";
import { neutralizeClassControlAsAdministrator, previewClassControlNeutralizationAsAdministrator } from "../../src/class-control-neutralization";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("ADR-0169-testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0169_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0169_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

type Proof = { raceId: string; sessionToken: string; csrfCookie: string; csrfHeader: string };

async function race(controlCodes: number[]) {
  const suffix = randomUUID().slice(0, 8);
  const account = await registerUserAccount(db, { formatVersion: 1, loginName: `underlag.${suffix}`, displayName: "Arrangör", password: "hemligt-lösen" });
  if (account.status !== "authenticated") throw new Error("Kontot kunde inte skapas");
  const accountProof = { sessionToken: account.sessionToken, csrfCookie: account.csrfToken, csrfHeader: account.csrfToken };
  const created = await createEventAsUserAccount(db, { ...accountProof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Klubbträning", raceName: "Torsdag", raceDate: "2026-10-08", timeZone: "Europe/Stockholm" }) });
  if (created.status !== "created") throw new Error("Tävlingen kunde inte skapas");
  const { raceId } = created.response;
  const entered = await enterRaceAsUserAccount(db, { ...accountProof, raceId });
  if (entered.status !== "entered") throw new Error("Kom inte in i tävlingen");
  const proof: Proof = { raceId, sessionToken: entered.sessionToken, csrfCookie: entered.csrfToken, csrfHeader: entered.csrfToken };
  const requestId = randomUUID();
  const course = await createManualCourseClassAsAdministrator(db, { ...proof, idempotencyKey: `manual-course-class-create:${requestId}`,
    request: { formatVersion: 1, requestId, expectedSnapshotVersion: await snapshot(raceId), courseName: "Bana 1",
      className: "Öppen", startRule: "PUNCH", controlCodes } });
  if (course.status !== "created") throw new Error(`Banan kunde inte skapas: ${course.status}`);
  return { proof, raceId, classId: course.response.classId, courseId: course.response.courseId };
}

async function snapshot(raceId: string): Promise<number> {
  const result = await pool.query<{ snapshot_version: number }>("select snapshot_version from race where id = $1", [raceId]);
  return result.rows[0]!.snapshot_version;
}

async function courseVersionOf(classId: string): Promise<string> {
  const result = await pool.query<{ course_version_id: string }>("select course_version_id from class where id = $1", [classId]);
  return result.rows[0]!.course_version_id;
}

async function register(f: Awaited<ReturnType<typeof race>>, givenName: string, cardNumber: string): Promise<string> {
  const registered = await registerEntryAsAdmin(db, { ...f.proof, idempotencyKey: `entry-registration:${randomUUID()}`, request: {
    formatVersion: 1, classId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId), expectedStartRule: "PUNCH",
    expectedSnapshotVersion: await snapshot(f.raceId), givenName, familyName: "Underlag", organisationName: null,
    cardNumber, fixedStartTime: null } });
  if (registered.status !== "registered") throw new Error(`Anmälan misslyckades: ${registered.status}`);
  return registered.response.entryId;
}

async function readout(f: Awaited<ReturnType<typeof race>>, cardNumber: string, codes: number[]) {
  const payload: SportidentReadoutPayload = {
    cardNumber, cardType: "SI10", startPunchedAt: "2026-10-08T16:00:00.000Z", finishPunchedAt: "2026-10-08T16:30:00.000Z",
    punches: codes.map((code, index) => ({ code, punchedAt: `2026-10-08T16:${String(5 + index * 5).padStart(2, "0")}:00.000Z` })),
    untimedPunchCodes: [], frames: ["02ef8300"], stationSerial: 999001, simulated: true
  };
  const batch: DeviceBatch = { deviceId: randomUUID(), sessionId: randomUUID(), packageVersion: await snapshot(f.raceId),
    firstSequence: 1, lastSequence: 1,
    events: [{ localSequence: 1, stationReceivedAt: "2026-10-08T16:31:00.000Z", transport: "sportident", payload, contentHash: contentHash(payload) }] };
  const ingested = await ingestReadoutsAsAdministrator(db, { ...f.proof, batch });
  if (ingested.status !== "ok") throw new Error(`Avläsningen togs inte emot: ${ingested.status}`);
}

/** Läser alla vyer som avgör om löparens resultat är aktuellt. */
async function view(f: Awaited<ReturnType<typeof race>>, entryId: string) {
  const approval = await listResultApprovalCandidatesAsAdmin(db, f.proof);
  const recalculation = await listClassResultRecalculationCandidatesAsAdministrator(db, { ...f.proof, classId: f.classId });
  const roster = await listEntryTransfersAsAdministrator(db, f.proof);
  const effective = await getAdministratorEffectiveResult(db, { ...f.proof, entryId });
  const finalization = await listResultFinalizationCandidatesAsAdmin(db, f.proof);
  const exported = await exportIofResultListAsAdmin(db, f.proof);
  if (approval.status !== "ok" || recalculation.status !== "ok" || roster.status !== "ok" || effective.status !== "ok" ||
      finalization.status !== "ok" || exported.status !== "ok") {
    throw new Error(`Vyerna kunde inte läsas: ${[approval.status, recalculation.status, roster.status, effective.status, finalization.status, exported.status].join(", ")}`);
  }
  const approvalEntry = approval.response.entries.find((row) => row.id === entryId)!;
  const recalculationEntry = recalculation.response.entries.find((row) => row.id === entryId)!;
  const rosterEntry = roster.response.entries.find((row) => row.id === entryId)!;
  const classBlockers = finalization.response.classes.find((row) => row.classId === f.classId)!.blockerCodes;
  return {
    approval: approvalEntry.readiness, approvalTarget: approvalEntry.targetResultRevision,
    recalculation: recalculationEntry.readiness, freshness: rosterEntry.resultFreshness,
    effectiveCurrent: effective.response.state === "ACTIVE_RESULT" ? effective.response.resultCurrent : null,
    staleBlocker: classBlockers.includes("STALE_RESULT_SNAPSHOT"),
    staleResultCount: exported.metadata.staleResultCount
  };
}

const current = { approval: "READY", recalculation: "CURRENT", freshness: "CURRENT_SNAPSHOT", effectiveCurrent: true,
  staleBlocker: false, staleResultCount: 0 };
const stale = { approval: "STALE_RESULT", recalculation: "READY", freshness: "OLDER_SNAPSHOT", effectiveCurrent: false,
  staleBlocker: true, staleResultCount: 1 };

async function recalculateClass(f: Awaited<ReturnType<typeof race>>, entryIds: string[]) {
  const candidates = await listClassResultRecalculationCandidatesAsAdministrator(db, { ...f.proof, classId: f.classId });
  if (candidates.status !== "ok") throw new Error("Omräkningsunderlaget saknas");
  const requestId = randomUUID();
  const recalculated = await recalculateClassResultsAsAdministrator(db, { ...f.proof, idempotencyKey: `class-result-recalculation:${requestId}`,
    request: { formatVersion: 1, classId: f.classId, snapshotVersion: candidates.response.snapshotVersion,
      engineVersion: candidates.response.engineVersion, manifestHash: candidates.response.manifestHash, entryIds: [...entryIds].sort() } });
  expect(recalculated.status).toBe("recalculated");
}

describe("ADR-0169 resultatets underlag gäller löparen", () => {
  it("andra ändringar gör inte resultatet inaktuellt; bytt bana gör det tills det räknats om", async () => {
    const f = await race([31, 32, 33]);
    const ada = await register(f, "Ada", "7001");
    await readout(f, "7001", [31, 33]);
    expect(await view(f, ada)).toMatchObject(current);
    const [first] = (await pool.query<{ basis_hash: string | null }>("select basis_hash from result_revision where entry_id = $1", [ada])).rows;
    expect(first?.basis_hash).toMatch(/^[0-9a-f]{64}$/);

    // En direktanmälan, ett brickbyte och ett namnbyte påverkar inte Adas bedömning.
    const bertil = await register(f, "Bertil", "7010");
    expect(await view(f, ada)).toMatchObject(current);
    const cards = await pool.query<{ id: string }>("select id from card_assignment where entry_id = $1 and active", [bertil]);
    const card = await changeEntryCardAsAdmin(db, { ...f.proof, entryId: bertil, idempotencyKey: `entry-card-change:${randomUUID()}`, request: {
      formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId, expectedSnapshotVersion: await snapshot(f.raceId),
      expectedAssignment: { id: cards.rows[0]!.id, cardNumber: "7010" }, cardNumber: "7011" } });
    expect(card.status).toBe("changed");
    const identity = await changeEntryIdentityAsAdmin(db, { ...f.proof, entryId: ada, idempotencyKey: `entry-identity-change:${randomUUID()}`, request: {
      formatVersion: 1, expectedEntryVersion: 1, expectedClassId: f.classId, expectedSnapshotVersion: await snapshot(f.raceId),
      expectedIdentity: { givenName: "Ada", familyName: "Underlag", organisationName: null },
      identity: { givenName: "Ada", familyName: "Lovelace", organisationName: "OK Test" } } });
    expect(identity.status).toBe("changed");
    expect(await view(f, ada)).toMatchObject(current);

    // Ny banversion för klassen gör Adas resultat inaktuellt.
    const preview = await previewManualCourseResultBearingRelinkAsAdministrator(db, { ...f.proof, classId: f.classId });
    if (preview.status !== "ok") throw new Error("Förhandsgranskningen saknas");
    const relinkId = randomUUID();
    const relinked = await relinkManualCourseResultBearingClassAsAdministrator(db, { ...f.proof,
      idempotencyKey: `manual-course-result-bearing-link:${relinkId}`, request: { formatVersion: 1, requestId: relinkId,
        expectedSnapshotVersion: preview.response.snapshotVersion, expectedBasisHash: preview.response.basisHash,
        courseId: f.courseId, classId: f.classId, expectedClassCourseVersionId: preview.response.classCourseVersionId,
        controlCodes: [31, 33, 34], acknowledgedImpact: true } });
    expect(relinked.status).toBe("changed");
    expect(await view(f, ada)).toMatchObject(stale);

    // Omräkning ger en ny revision med aktuellt underlag; historiken finns kvar.
    await recalculateClass(f, [ada]);
    const after = await view(f, ada);
    expect(after).toMatchObject(current);
    expect((await pool.query("select id from result_revision where entry_id = $1", [ada])).rowCount).toBe(2);

    // Ännu en direktanmälan, sedan godkänns Ada direkt utan omräkning.
    await register(f, "Cecilia", "7020");
    const again = await view(f, ada);
    expect(again).toMatchObject(current);
    const target = again.approvalTarget!;
    const approved = await approveResultAsAdmin(db, { ...f.proof, entryId: ada, idempotencyKey: `manual-result-approval:${randomUUID()}`, request: {
      formatVersion: 1, expectedEntryVersion: 2, expectedClassId: f.classId, expectedCourseVersionId: await courseVersionOf(f.classId),
      expectedSnapshotVersion: await snapshot(f.raceId),
      expectedResultRevision: { id: target.id, revision: target.revision, status: "MP", reason: target.reason },
      policyVersion: RESULT_APPROVAL_POLICY_VERSION } });
    expect(approved.status).toBe("approved");
    const approvedView = await view(f, ada);
    expect(approvedView).toMatchObject({ approval: "ACTIVE_APPROVAL", freshness: "CURRENT_SNAPSHOT", effectiveCurrent: true,
      staleBlocker: false, staleResultCount: 0 });

    // Godkännandet kan återtas efter ännu en direktanmälan, utan omräkning.
    await register(f, "David", "7030");
    const withdrawals = await listResultApprovalWithdrawalsAsAdmin(db, f.proof);
    if (withdrawals.status !== "ok") throw new Error("Återtagandeunderlaget saknas");
    const row = withdrawals.response.entries.find((entry) => entry.id === ada)!;
    const withdrawn = await withdrawResultApprovalAsAdmin(db, { ...f.proof, entryId: ada,
      idempotencyKey: `manual-result-approval-withdrawal:${randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: row.entryVersion, expectedClassId: row.classId, expectedCourseVersionId: row.courseVersionId,
        expectedSnapshotVersion: withdrawals.response.snapshotVersion, expectedResultApprovalDecisionId: row.resultApprovalDecisionId,
        expectedTargetResultRevision: row.targetResultRevision, expectedApprovedResultRevision: row.approvedResultRevision,
        expectedAbsoluteResultRevision: row.absoluteResultRevision,
        expectedRestorationSourceResultRevision: row.restorationSourceResultRevision,
        policyVersion: RESULT_APPROVAL_WITHDRAWAL_POLICY_VERSION } });
    expect(withdrawn.status).toBe("withdrawn");
    if (withdrawn.status === "withdrawn") expect(withdrawn.response.snapshotVersion).toBe(await snapshot(f.raceId));
    // Den återställda revisionen är inte en teknisk källa för ett nytt godkännande, men den är aktuell.
    expect(await view(f, ada)).toMatchObject({ ...current, approval: "UNSUPPORTED_RESULT" });
  });

  it("en struken kontroll gör klassens resultat inaktuella tills de räknats om", async () => {
    const f = await race([31, 32, 33]);
    const ada = await register(f, "Ada", "8001");
    await readout(f, "8001", [31, 33]);
    expect(await view(f, ada)).toMatchObject(current);

    const preview = await previewClassControlNeutralizationAsAdministrator(db, { ...f.proof, classId: f.classId });
    if (preview.status !== "ok") throw new Error("Förhandsgranskningen saknas");
    const control = preview.response.controls.find((row) => row.controlCode === 32)!;
    const requestId = randomUUID();
    const neutralized = await neutralizeClassControlAsAdministrator(db, { ...f.proof, idempotencyKey: `class-control-neutralization:${requestId}`,
      request: { formatVersion: 1, requestId, expectedSnapshotVersion: preview.response.snapshotVersion, expectedBasisHash: preview.response.basisHash,
        classId: f.classId, expectedCourseVersionId: preview.response.courseVersionId, courseControlId: control.id,
        sequence: control.sequence, controlCode: control.controlCode, acknowledgedNoAutomaticRecalculation: true } });
    expect(neutralized.status).toBe("changed");
    expect(await view(f, ada)).toMatchObject(stale);

    await recalculateClass(f, [ada]);
    const after = await view(f, ada);
    expect(after).toMatchObject({ ...current, approval: "UNSUPPORTED_RESULT" });
    const [latest] = (await pool.query<{ status: string }>("select status from result_revision where entry_id = $1 order by revision desc limit 1", [ada])).rows;
    expect(latest?.status).toBe("OK");
  });
});
