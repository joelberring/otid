import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import { contentHash } from "../../src/hash";
import { ingestDeviceBatch } from "../../src/ingest";
import { issuePairingAdminAccessCredential, loginPairingAdmin } from "../../src/pairing-admin";
import {
  issueParticipantEntryClaimAsAdmin,
  listMyParticipantResults,
  listParticipantEntryClaimsAsAdmin,
  redeemParticipantEntryClaimAsAccount,
  revokeParticipantEntryClaimAsAdmin
} from "../../src/participant-entry-claim";
import { logoutUserAccountSession } from "../../src/user-account";
import { registerTestAccount } from "./accounts";
import { recalculateEntry } from "../../src/results";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("TASK152 kräver uttrycklig isolerad TEST_DATABASE_URL med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_task152_spec_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const at = new Date("2026-09-23T10:00:00.000Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => {
  await pool.end();
  if (!/^otid_task152_spec_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig syntetisk testdatabas");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function fixture() {
  const eventId = randomUUID(), raceId = randomUUID(), courseId = randomUUID();
  const courseVersionId = randomUUID(), classId = randomUUID(), entryId = randomUUID();
  await db.insert(schema.events).values({ id: eventId, name: "Syntetisk helg", startsOn: "2026-09-23", timeZone: "Europe/Stockholm" });
  await db.insert(schema.races).values({ id: raceId, eventId, name: "Lång", raceDate: "2026-09-23" });
  await db.insert(schema.courses).values({ id: courseId, raceId, name: "Bana" });
  await db.insert(schema.courseVersions).values({ id: courseVersionId, courseId, version: 1 });
  const controlId = randomUUID();
  await db.insert(schema.controls).values({ id: controlId, raceId, code: 31 });
  await db.insert(schema.courseControls).values({ courseVersionId, controlId, sequence: 1 });
  await db.insert(schema.classes).values({ id: classId, raceId, courseVersionId, name: "Öppen", startRule: "FIXED" });
  await db.insert(schema.entries).values({ id: entryId, raceId, classId, givenName: "Ada", familyName: "Syntetisk",
    fixedStartTime: new Date("2026-09-23T10:00:00.000Z") });
  const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE",
    label: "TASK152", expiresAt: new Date(at.getTime() + 60 * 60 * 1000) }, { now: at });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
    { expectedRaceId: raceId, expectedCapability: "MANAGE_RACE", now: at });
  if (login.status !== "authenticated") throw new Error("Syntetisk administratör saknas");
  return { eventId, raceId, entryId, classId, adminProof: { raceId,
    sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

async function account(prefix: string) {
  const created = await registerTestAccount(db, `${prefix}.${randomUUID().slice(0, 8)}`, at);
  const login = created.login;
  if (login.status !== "authenticated") throw new Error("Syntetiskt deltagarkonto saknas");
  return { created, proof: { sessionToken: login.sessionToken,
    csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

function code(byte: number) {
  const secret = Buffer.alloc(16, byte);
  return { plain: secret.toString("base64url"), hash: createHash("sha256").update(secret).digest("hex") };
}

function issueRequest(f: Awaited<ReturnType<typeof fixture>>, secretHash: string, requestId = randomUUID()) {
  return { formatVersion: 1 as const, requestId, raceId: f.raceId, entryId: f.entryId,
    secretHash, expiresAt: new Date(at.getTime() + 86_400_000).toISOString(),
    attestation: "IDENTITY_CHECKED" as const };
}

function issue(f: Awaited<ReturnType<typeof fixture>>, request: ReturnType<typeof issueRequest>, now = at) {
  return issueParticipantEntryClaimAsAdmin(db, { ...f.adminProof, entryId: f.entryId,
    idempotencyKey: `participant-claim-issue:${request.requestId}`, request }, now);
}

function redeem(proof: Awaited<ReturnType<typeof account>>["proof"], plain: string, requestId = randomUUID(), now = at) {
  return redeemParticipantEntryClaimAsAccount(db, { ...proof,
    idempotencyKey: `participant-claim-redeem:${requestId}`,
    request: { formatVersion: 1, requestId, code: plain } }, now);
}

describe("TASK152 kontobunden exakt anmälan", () => {
  it("binder bara innehavaren av engångskoden, visar vänteläge och sedan samma publicerade revision", async () => {
    const f = await fixture(), ada = await account("ada"), other = await account("other"), secret = code(7);
    const request = issueRequest(f, secret.hash);
    const issued = await issue(f, request);
    expect(issued).toMatchObject({ status: "issued", response: { raceId: f.raceId, entryId: f.entryId, replayed: false } });
    expect(await issue(f, request, new Date(at.getTime() + 60_000)))
      .toMatchObject({ status: "issued", response: { replayed: true } });
    expect((await issue(f, { ...request, secretHash: code(8).hash })).status).toBe("conflict");
    expect((await pool.query("SELECT secret_hash FROM participant_entry_claim_issue WHERE request_id=$1", [request.requestId])).rows)
      .toEqual([{ secret_hash: secret.hash }]);
    expect(JSON.stringify(issued)).not.toContain(secret.plain);
    const redeemId = randomUUID();
    expect(await redeem(ada.proof, secret.plain, redeemId)).toMatchObject({ status: "redeemed", response: { replayed: false } });
    expect(await redeem(ada.proof, secret.plain, redeemId)).toMatchObject({ status: "redeemed", response: { replayed: true } });
    expect((await redeem(other.proof, secret.plain, redeemId)).status).toBe("conflict");
    expect((await redeem(other.proof, secret.plain)).status).toBe("not-found");
    expect((await listMyParticipantResults(db, other.proof, at)).status).toBe("ok");
    expect(await listMyParticipantResults(db, ada.proof, at)).toMatchObject({ status: "ok", response: { items: [
      { raceId: f.raceId, eventName: "Syntetisk helg", raceName: "Lång", result: null }
    ] } });

    const cardNumber = `152${f.entryId.slice(0, 8)}`;
    await db.insert(schema.cardAssignments).values({ raceId: f.raceId, entryId: f.entryId, cardNumber });
    const payload = { cardNumber, startPunchedAt: "2026-09-23T10:00:00Z", finishPunchedAt: "2026-09-23T10:20:00Z",
      punches: [{ code: 31, punchedAt: "2026-09-23T10:10:00Z" }] };
    const deviceId = randomUUID();
    await ingestDeviceBatch(db, f.raceId, { deviceId, sessionId: deviceId, packageVersion: 1,
      firstSequence: 1, lastSequence: 1,
      events: [{ localSequence: 1, stationReceivedAt: "2026-09-23T10:21:00Z", transport: "simulator",
        payload, contentHash: contentHash(payload) }] });
    const published = await listMyParticipantResults(db, ada.proof, at);
    expect(published).toMatchObject({ status: "ok", response: { items: [
      { result: { givenName: "Ada", status: "OK", revision: 1 } }
    ] } });
    expect(JSON.stringify(published)).not.toContain(f.entryId);
    expect(JSON.stringify(published)).not.toContain(cardNumber);
    await db.update(schema.entries).set({ givenName: "Ada Rättad" }).where(eq(schema.entries.id, f.entryId));
    expect(await listMyParticipantResults(db, ada.proof, at)).toMatchObject({ status: "ok", response: { items: [
      { result: { givenName: "Ada Rättad", revision: 1 } }
    ] } });
    await recalculateEntry(db, f.raceId, f.entryId);
    expect(await listMyParticipantResults(db, ada.proof, at)).toMatchObject({ status: "ok", response: { items: [
      { result: { givenName: "Ada Rättad", revision: 2, status: "OK" } }
    ] } });
    expect((await pool.query("SELECT revision FROM result_revision WHERE entry_id=$1 ORDER BY revision", [f.entryId])).rows)
      .toEqual([{ revision: 1 }, { revision: 2 }]);
  });

  it("spärrar felkoppling, låter ny kod ges och nekar okänd eller utgången kod", async () => {
    const f = await fixture(), first = await account("first"), second = await account("second");
    const secret = code(9), request = issueRequest(f, secret.hash), issued = await issue(f, request);
    if (issued.status !== "issued") throw new Error("Utfärdande saknas");
    expect((await issue(f, issueRequest(f, code(10).hash))).status).toBe("conflict");
    expect((await redeem(first.proof, code(11).plain)).status).toBe("not-found");
    expect((await redeem(first.proof, secret.plain)).status).toBe("redeemed");
    const revokeId = randomUUID();
    const revokeRequest = { formatVersion: 1 as const, requestId: revokeId, raceId: f.raceId,
      entryId: f.entryId, claimId: issued.response.claimId, reason: "Fel konto" };
    const revokeInput = { ...f.adminProof, entryId: f.entryId, claimId: issued.response.claimId,
      idempotencyKey: `participant-claim-revoke:${revokeId}`, request: revokeRequest };
    expect(await revokeParticipantEntryClaimAsAdmin(db, revokeInput, at))
      .toMatchObject({ status: "revoked", response: { replayed: false } });
    expect(await revokeParticipantEntryClaimAsAdmin(db, revokeInput, at))
      .toMatchObject({ status: "revoked", response: { replayed: true } });
    expect((await revokeParticipantEntryClaimAsAdmin(db, { ...revokeInput,
      request: { ...revokeRequest, reason: "Annat skäl" } }, at)).status).toBe("conflict");
    expect(await listMyParticipantResults(db, first.proof, at)).toMatchObject({ status: "ok", response: { items: [] } });
    expect(await listParticipantEntryClaimsAsAdmin(db, { ...f.adminProof, entryId: f.entryId }, at))
      .toMatchObject({ status: "ok", response: { claims: [{ claimId: issued.response.claimId,
        redeemedAt: at.toISOString(), revokedAt: at.toISOString() }] } });
    const newSecret = code(12), secondIssue = await issue(f, issueRequest(f, newSecret.hash));
    expect(secondIssue.status).toBe("issued");
    expect((await redeem(second.proof, newSecret.plain)).status).toBe("redeemed");
    expect((await listMyParticipantResults(db, second.proof, at)).status).toBe("ok");
    expect((await logoutUserAccountSession(db, second.proof, at)).status).toBe("logged-out");
    expect((await listMyParticipantResults(db, second.proof, at)).status).toBe("unauthorized");
    const expiredFixture = await fixture(), shortCode = code(14);
    const shortRequest = { ...issueRequest(expiredFixture, shortCode.hash),
      expiresAt: new Date(at.getTime() + 60_000).toISOString() };
    expect((await issue(expiredFixture, shortRequest)).status).toBe("issued");
    expect((await redeem(first.proof, shortCode.plain, randomUUID(), new Date(at.getTime() + 120_000))).status)
      .toBe("not-found");
  });

  it("serialiserar två olika kontons samtidiga inlösen till högst en koppling", async () => {
    const f = await fixture(), one = await account("one"), two = await account("two"), secret = code(13);
    expect((await issue(f, issueRequest(f, secret.hash))).status).toBe("issued");
    const outcomes = await Promise.all([redeem(one.proof, secret.plain), redeem(two.proof, secret.plain)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["not-found", "redeemed"]);
    expect((await pool.query("SELECT count(*)::int AS value FROM participant_entry_claim_redemption WHERE claim_id IN (SELECT id FROM participant_entry_claim_issue WHERE race_id=$1)", [f.raceId])).rows)
      .toEqual([{ value: 1 }]);
  });

  it("låter ett konto återfinna två uttryckligen kopplade lopp utan namnmatchning", async () => {
    const first = await fixture(), second = await fixture(), participant = await account("guardian");
    for (const [f, byte] of [[first, 15], [second, 16]] as const) {
      const secret = code(byte);
      expect((await issue(f, issueRequest(f, secret.hash))).status).toBe("issued");
      expect((await redeem(participant.proof, secret.plain)).status).toBe("redeemed");
    }
    const listed = await listMyParticipantResults(db, participant.proof, at);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") return;
    expect(listed.response.items.map(item => item.raceId).sort()).toEqual([first.raceId, second.raceId].sort());
    expect(listed.response.items.every(item => item.result === null)).toBe(true);
  });
});
