import { readFile } from "node:fs/promises";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import {
  evaluationResultSchema,
  type ResultApprovalWithdrawalListResponse,
  type ResultDisqualificationWithdrawalListResponse,
  type DidNotFinishWithdrawalListResponse,
  type OutOfCompetitionWithdrawalListResponse
} from "@o-tid/contracts";
import { createDatabase, schema } from "@o-tid/database";
import {
  changeEntryClass,
  changeEntryClassAsAdmin,
  changeEntryStartTimeAsAdmin,
  listEntryStartTimesAsAdmin,
  changeEntryCardAsAdmin,
  changeEntryIdentityAsAdmin,
  listEntryIdentitiesAsAdmin,
  listEntryIdentityHistoryAsAdmin,
  listEntryCardsAsAdmin,
  listEntryRegistrationClassesAsAdmin,
  registerEntryAsAdmin,
  buildSignedStationPackage,
  contentHash,
  createEvent,
  createEventAsAdmin,
  decideDidNotFinishAsAdmin,
  decideDidNotStartAsAdmin,
  decideOutOfCompetitionAsAdmin,
  decideWithoutTimingAsAdmin,
  disqualifyResultAsAdmin,
  approveResultAsAdmin,
  listDidNotStartWithdrawalsAsAdmin,
  listResultApprovalCandidatesAsAdmin,
  listResultApprovalWithdrawalsAsAdmin,
  listResultDisqualificationCandidatesAsAdmin,
  listResultDisqualificationWithdrawalsAsAdmin,
  withdrawDidNotStartAsAdmin,
  withdrawResultApprovalAsAdmin,
  withdrawResultDisqualificationAsAdmin,
  importIofXml,
  importIofXmlAsAdmin,
  ingestDeviceBatch,
  evaluationHash,
  authenticateStationBearer,
  hasStationCredentialScope,
  issueStationPairingGrant,
  issueStationCredential,
  issueEventCreationAccessCredential,
  exportIofResultListAsAdmin,
  exportFrozenIofResultListAsAdmin,
  finalizeResultsAsAdmin,
  getRaceOverviewAsAdmin,
  getReadoutHistoryAsAdmin,
  listReadoutHistoryAsAdmin,
  listEntryReadoutHistoryAsAdmin,
  listEntryClassesAsAdmin,
  listDidNotFinishCandidatesAsAdmin,
  listDidNotFinishWithdrawalsAsAdmin,
  listDidNotStartCandidatesAsAdmin,
  listOutOfCompetitionCandidatesAsAdmin,
  listWithoutTimingCandidatesAsAdmin,
  listWithoutTimingWithdrawalsAsAdmin,
  listOutOfCompetitionWithdrawalsAsAdmin,
  listFrozenRaceFinalizationsAsAdmin,
  listResultFinalizationCandidatesAsAdmin,
  listResultRecalculationCandidatesAsAdmin,
  publicRaceSummary,
  publicResults,
  recalculateEntry,
  recalculateEntryAsAdmin,
  redeemStationPairingGrant,
  revokeStationPairingGrant,
  revokeStationCredential,
  revokeEventCreationAccessCredential,
  rotateStationCredential,
  verifySignedStationPackage,
  withdrawDidNotFinishAsAdmin,
  withdrawOutOfCompetitionAsAdmin,
  withdrawWithoutTimingAsAdmin
} from "../../src";
import {
  loginEventCreationAdmin,
  logoutEventCreationAdminSession
} from "../../src/event-creation-admin";
import {
  authenticatePairingAdminSession,
  issuePairingAdminAccessCredential,
  issuePairingGrantAsAdmin,
  listPairingGrantsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  revokePairingAdminAccessCredential,
  revokePairingGrantAsAdmin
} from "../../src/pairing-admin";
import { decideStartListPublicationAsAdmin, getStartListPublicationPreviewAsAdmin, getPublishedStartListXml } from "../../src/start-list-publication";
import { listStartListAsAdmin } from "../../src/start-list";

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("TEST_DATABASE_URL eller DATABASE_URL krävs för PostgreSQL-integrationstester");
const database = createDatabase(connectionString);
const { db, pool } = database;
let courseXml: string;
let entryXml: string;
let startListXml: string;
const stationPackagePrivateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const stationPackagePrivateKeyPem = stationPackagePrivateKey.export({ format: "pem", type: "pkcs8" }).toString();
const stationPackagePublicKeySpkiBase64 = createPublicKey(stationPackagePrivateKey)
  .export({ format: "der", type: "spki" }).toString("base64");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
  courseXml = await readFile(new URL("../../../../fixtures/iof/course-data.xml", import.meta.url), "utf8");
  entryXml = await readFile(new URL("../../../../fixtures/iof/entry-list.xml", import.meta.url), "utf8");
  startListXml = await readFile(new URL("../../../../fixtures/iof/start-list.xml", import.meta.url), "utf8");
});

describe("TASK029 gemensam tävlingsadministratör PostgreSQL", () => {
  const now = new Date("2026-09-12T12:00:00.000Z");
  async function admin(raceId: string, capability: "MANAGE_RACE" | "CHANGE_ENTRY_CLASS" = "MANAGE_RACE") {
    const installation = await issuePairingAdminAccessCredential(db, { raceId, capability,
      label: "Syntetisk TASK029", expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000) }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
      { expectedRaceId: raceId, expectedCapability: capability, now });
    if (login.status !== "authenticated") throw new Error("TASK029 fixture login failed");
    return { installation, login, proof: { raceId, sessionToken: login.sessionToken,
      csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
  }

  it("använder samma session för översikt, lista och spårbart klassbyte med exakt retry", async () => {
    const { raceId, overview } = await importedRace();
    const actor = await admin(raceId);
    expect(actor.login.response.capability).toBe("MANAGE_RACE");
    expect(actor.login.response.expiresAt).toBe("2026-09-12T13:00:00.000Z");
    expect((await getRaceOverviewAsAdmin(db, actor.proof, now)).status).toBe("ok");
    expect((await listStartListAsAdmin(db, actor.proof, now)).status).toBe("ok");
    expect((await listEntryClassesAsAdmin(db, actor.proof, now)).status).toBe("ok");
    const entry = overview.entries[0];
    const target = overview.classes.find((value) => value.id !== entry?.classId);
    if (!entry || !target) throw new Error("TASK029 fixture missing entry/class");
    const [storedEntry] = await db.select({ version: schema.entries.version }).from(schema.entries)
      .where(eq(schema.entries.id, entry.id));
    if (!storedEntry) throw new Error("TASK029 fixture missing version");
    const requestId = crypto.randomUUID();
    const input = { ...actor.proof, entryId: entry.id, idempotencyKey: `entry-class-change:${requestId}`,
      request: { formatVersion: 1, classId: target.id, expectedEntryVersion: storedEntry.version } };
    expect(await changeEntryClassAsAdmin(db, { ...input, csrfHeader: "invalid" }, now)).toEqual({ status: "forbidden" });
    const changed = await changeEntryClassAsAdmin(db, input, now);
    expect(changed.status).toBe("changed");
    if (changed.status !== "changed") throw new Error("TASK029 change failed");
    expect(await changeEntryClassAsAdmin(db, input, now)).toEqual({ status: "changed",
      response: { ...changed.response, replayed: true } });
    const other = await admin(raceId);
    expect(await changeEntryClassAsAdmin(db, { ...input, ...other.proof }, now)).toEqual({ status: "conflict" });
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: actor.installation.credentialId });
    const journal = await db.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId));
    expect(journal).toHaveLength(1);
    expect(journal[0]?.actorCredentialId).toBe(actor.installation.credentialId);
  });


  it("respekterar expiry, revocation och maximal livslängd även i databasen", async () => {
    const { raceId } = await importedRace();
    const actor = await admin(raceId);
    expect((await listStartListAsAdmin(db, actor.proof, new Date("2026-09-12T13:00:00Z"))).status).toBe("unauthorized");
    await revokePairingAdminAccessCredential(db, { credentialId: actor.installation.credentialId,
      capability: "MANAGE_RACE", reason: "Synthetic test" }, now);
    expect((await listEntryClassesAsAdmin(db, actor.proof, now)).status).toBe("unauthorized");
    await expect(issuePairingAdminAccessCredential(db, { raceId, capability: "MANAGE_RACE", label: "Too long",
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000 + 1) }, { now })).rejects.toThrow();
    await expect(db.insert(schema.pairingAdminAccessCredentials).values({ raceId, capability: "MANAGE_RACE",
      label: "Invalid synthetic duration", secretHash: "a".repeat(64), issuedAt: now,
      expiresAt: new Date(now.getTime() + 9 * 60 * 60 * 1000) })).rejects.toThrow();
  });
});

describe("TASK 005F pairing-admin PostgreSQL", () => {
  const accessIssuedAt = new Date("2026-08-31T14:00:00.000Z");

  async function adminSession(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId, capability: "PAIR_STATION", label: `Målvagn ${marker}`,
      expiresAt: new Date("2026-09-01T14:00:00.000Z")
    }, { now: accessIssuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1, accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "PAIR_STATION",
      now: new Date("2026-08-31T14:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1), csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Adminsession kunde inte skapas");
    return { installation, login };
  }

  it("lagrar endast access-/sessionhashar och upprätthåller race, CSRF och livslängd", async () => {
    const { raceId } = await importedRace();
    const other = await importedRace();
    const { installation, login } = await adminSession(raceId, 61);
    expect(login.response).toEqual({
      formatVersion: 1, raceId, capability: "PAIR_STATION", expiresAt: "2026-08-31T22:01:00.000Z"
    });
    const [storedCredential] = await db.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, installation.credentialId));
    const [storedSession] = await db.select().from(schema.pairingAdminSessions)
      .where(eq(schema.pairingAdminSessions.accessCredentialId, installation.credentialId));
    expect(storedCredential?.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedSession?.sessionSecretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedSession?.csrfSecretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify({ storedCredential, storedSession })).not.toContain(installation.accessCredential);
    expect(JSON.stringify({ storedCredential, storedSession })).not.toContain(login.sessionToken);
    expect(JSON.stringify({ storedCredential, storedSession })).not.toContain(login.csrfToken);

    await expect(authenticatePairingAdminSession(db, {
      sessionToken: login.sessionToken, raceId, capability: "PAIR_STATION",
      requireCsrf: true, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toMatchObject({ status: "authenticated" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: login.sessionToken, raceId, capability: "PAIR_STATION",
      requireCsrf: true, csrfCookie: login.csrfToken, csrfHeader: "A".repeat(43)
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toEqual({ status: "forbidden" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: login.sessionToken, raceId: other.raceId, capability: "PAIR_STATION"
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toEqual({ status: "forbidden" });
    await expect(loginPairingAdmin(db, {
      formatVersion: 1, accessCredential: installation.accessCredential.replace(/.$/, "A")
    }, {
      expectedRaceId: raceId, expectedCapability: "PAIR_STATION",
      now: new Date("2026-08-31T14:02:00.000Z")
    })).resolves.toEqual({ status: "unauthorized" });
    const [beforeUnknown] = await db.select({ value: count() }).from(schema.pairingAdminSessions);
    await expect(loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: `otid_org_pair_v1.${crypto.randomUUID()}.${Buffer.alloc(32, 63).toString("base64url")}`
    }, {
      expectedRaceId: raceId, expectedCapability: "PAIR_STATION",
      now: new Date("2026-08-31T14:02:00.000Z")
    })).resolves.toEqual({ status: "unauthorized" });
    const [afterUnknown] = await db.select({ value: count() }).from(schema.pairingAdminSessions);
    expect(afterUnknown?.value).toBe(beforeUnknown?.value);
  });

  it("utfärdar klienthashat grant exakt idempotent och auditerar bara första mutation", async () => {
    const { raceId } = await importedRace();
    const { installation, login } = await adminSession(raceId, 71);
    const grantId = crypto.randomUUID();
    const body = { formatVersion: 1 as const, grantId, grantSecretHash: "b".repeat(64), credentialLifetimeHours: 24 as const };
    const call = () => issuePairingGrantAsAdmin(db, {
      sessionToken: login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: login.csrfToken, csrfHeader: login.csrfToken,
      idempotencyKey: `pairing-grant:${grantId}`, readBody: async () => body
    }, new Date("2026-08-31T14:03:00.000Z"));
    const results = await Promise.all(Array.from({ length: 100 }, call));
    expect(results.filter((result) => result.status === "stored")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate")).toHaveLength(99);
    const [stored] = await db.select().from(schema.stationPairingGrants)
      .where(eq(schema.stationPairingGrants.id, grantId));
    expect(stored).toMatchObject({ raceId, secretHash: body.grantSecretHash,
      issuerCredentialId: installation.credentialId });
    expect(stored?.expiresAt.toISOString()).toBe("2026-08-31T14:13:00.000Z");
    expect(stored?.credentialExpiresAt.toISOString()).toBe("2026-09-01T14:03:00.000Z");
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, grantId),
      eq(schema.auditEvents.action, "STATION_PAIRING_GRANT_ISSUED_BY_ADMIN")
    ));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorKind: "PAIRING_ADMIN_ACCESS_CREDENTIAL",
      actorId: installation.credentialId, requestId: grantId });
    expect(JSON.stringify(audits)).not.toContain(body.grantSecretHash);
    await expect(issuePairingGrantAsAdmin(db, {
      sessionToken: login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: login.csrfToken, csrfHeader: login.csrfToken,
      idempotencyKey: `pairing-grant:${grantId}`,
      readBody: async () => ({ ...body, grantSecretHash: "c".repeat(64) })
    }, new Date("2026-08-31T14:03:01.000Z"))).resolves.toEqual({ status: "conflict" });
    const otherActor = await adminSession(raceId, 76);
    await expect(issuePairingGrantAsAdmin(db, {
      sessionToken: otherActor.login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: otherActor.login.csrfToken, csrfHeader: otherActor.login.csrfToken,
      idempotencyKey: `pairing-grant:${grantId}`,
      readBody: async () => body
    }, new Date("2026-08-31T14:03:02.000Z"))).resolves.toEqual({ status: "conflict" });
  });

  it("autentiserar före body, listar metadata och spärrar endast inom loppet idempotent", async () => {
    const first = await importedRace();
    const second = await importedRace();
    const admin = await adminSession(first.raceId, 81);
    const otherAdmin = await adminSession(second.raceId, 91);
    let reads = 0;
    await expect(issuePairingGrantAsAdmin(db, {
      sessionToken: "otid_org_session_v1.00000000-0000-4000-8000-000000000000." + "A".repeat(43),
      raceId: first.raceId, capability: "PAIR_STATION", csrfCookie: null, csrfHeader: null,
      idempotencyKey: null, readBody: async () => { reads += 1; return {}; }
    }, new Date("2026-08-31T14:03:00.000Z"))).resolves.toEqual({ status: "unauthorized" });
    expect(reads).toBe(0);
    await expect(revokePairingGrantAsAdmin(db, {
      sessionToken: "otid_org_session_v1.00000000-0000-4000-8000-000000000000." + "A".repeat(43),
      raceId: first.raceId, capability: "PAIR_STATION", csrfCookie: null, csrfHeader: null,
      grantId: crypto.randomUUID(), readBodyIsEmpty: async () => { reads += 1; return false; }
    }, new Date("2026-08-31T14:03:00.000Z"))).resolves.toEqual({ status: "unauthorized" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: "otid_org_session_v1.00000000-0000-4000-8000-000000000000." + "A".repeat(43),
      raceId: first.raceId, capability: "PAIR_STATION",
      csrfCookie: null, csrfHeader: null,
      readBodyIsEmpty: async () => { reads += 1; return false; }
    }, new Date("2026-08-31T14:03:00.000Z"))).resolves.toEqual({ status: "unauthorized" });
    expect(reads).toBe(0);

    const grantId = crypto.randomUUID();
    await issuePairingGrantAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: first.raceId, capability: "PAIR_STATION",
      csrfCookie: admin.login.csrfToken, csrfHeader: admin.login.csrfToken,
      idempotencyKey: `pairing-grant:${grantId}`,
      readBody: async () => ({ formatVersion: 1, grantId, grantSecretHash: "d".repeat(64), credentialLifetimeHours: 8 })
    }, new Date("2026-08-31T14:03:00.000Z"));
    const list = await listPairingGrantsAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: first.raceId, capability: "PAIR_STATION"
    }, new Date("2026-08-31T14:04:00.000Z"));
    expect(list.status === "ok" && list.response.grants.find((grant) => grant.grantId === grantId))
      .toMatchObject({ status: "ACTIVE", redeemedAt: null, revokedAt: null });
    await expect(revokePairingGrantAsAdmin(db, {
      sessionToken: otherAdmin.login.sessionToken, raceId: second.raceId, capability: "PAIR_STATION",
      csrfCookie: otherAdmin.login.csrfToken, csrfHeader: otherAdmin.login.csrfToken, grantId
    }, new Date("2026-08-31T14:05:00.000Z"))).resolves.toEqual({ status: "not-found" });
    await expect(revokePairingGrantAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: first.raceId, capability: "PAIR_STATION",
      csrfCookie: admin.login.csrfToken, csrfHeader: admin.login.csrfToken, grantId,
      readBodyIsEmpty: async () => false
    }, new Date("2026-08-31T14:05:00.000Z"))).resolves.toEqual({ status: "invalid-request" });
    const revoke = () => revokePairingGrantAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: first.raceId, capability: "PAIR_STATION" as const,
      csrfCookie: admin.login.csrfToken, csrfHeader: admin.login.csrfToken, grantId
    }, new Date("2026-08-31T14:05:00.000Z"));
    const revokeResults = await Promise.all(Array.from({ length: 100 }, revoke));
    expect(revokeResults.filter((result) => result.status === "revoked")).toHaveLength(1);
    expect(revokeResults.filter((result) => result.status === "already-revoked")).toHaveLength(99);
    const revoked = revokeResults.find((result) => result.status === "revoked");
    expect(revoked?.status === "revoked" && revoked.response.grant).toMatchObject({ status: "REVOKED" });
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, grantId), eq(schema.auditEvents.action, "STATION_PAIRING_GRANT_REVOKED_BY_ADMIN")
    ));
    expect(audits).toHaveLength(1);
  });

  it("serialiserar grantspärr och inlösen så att den första commiten vinner", async () => {
    const { raceId } = await importedRace();
    const admin = await adminSession(raceId, 96);

    async function issueKnownGrant(marker: number) {
      const grantId = crypto.randomUUID();
      const grantSecret = Buffer.alloc(32, marker);
      const result = await issuePairingGrantAsAdmin(db, {
        sessionToken: admin.login.sessionToken, raceId, capability: "PAIR_STATION",
        csrfCookie: admin.login.csrfToken, csrfHeader: admin.login.csrfToken,
        idempotencyKey: `pairing-grant:${grantId}`,
        readBody: async () => ({
          formatVersion: 1, grantId,
          grantSecretHash: createHash("sha256").update(grantSecret).digest("hex"),
          credentialLifetimeHours: 24
        })
      }, new Date("2026-08-31T14:03:00.000Z"));
      expect(result.status).toBe("stored");
      return { grantId, token: `otid_pair_v1.${grantId}.${grantSecret.toString("base64url")}` };
    }

    function redemption(marker: number) {
      const credentialSecret = Buffer.alloc(32, marker);
      return {
        credentialSecret,
        body: {
          formatVersion: 1 as const,
          attemptId: crypto.randomUUID(),
          deviceId: crypto.randomUUID(),
          credentialSecretHash: createHash("sha256").update(credentialSecret).digest("hex")
        }
      };
    }

    const revokedFirst = await issueKnownGrant(121);
    await expect(revokePairingGrantAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: admin.login.csrfToken, csrfHeader: admin.login.csrfToken,
      grantId: revokedFirst.grantId
    }, new Date("2026-08-31T14:04:00.000Z"))).resolves.toMatchObject({ status: "revoked" });
    const blockedRedemption = redemption(122);
    await expect(redeemStationPairingGrant(db, {
      authorization: `Bearer ${revokedFirst.token}`,
      idempotencyKey: `pairing:${blockedRedemption.body.attemptId}`,
      readBody: async () => blockedRedemption.body
    }, new Date("2026-08-31T14:05:00.000Z"))).resolves.toEqual({ status: "unauthorized" });

    const redeemedFirst = await issueKnownGrant(123);
    const successfulRedemption = redemption(124);
    const redeemed = await redeemStationPairingGrant(db, {
      authorization: `Bearer ${redeemedFirst.token}`,
      idempotencyKey: `pairing:${successfulRedemption.body.attemptId}`,
      readBody: async () => successfulRedemption.body
    }, new Date("2026-08-31T14:04:00.000Z"));
    expect(redeemed.status).toBe("stored");
    if (redeemed.status !== "stored") throw new Error("Grantet löstes inte in");
    await expect(revokePairingGrantAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: admin.login.csrfToken, csrfHeader: admin.login.csrfToken,
      grantId: redeemedFirst.grantId
    }, new Date("2026-08-31T14:05:00.000Z"))).resolves.toMatchObject({ status: "revoked" });
    const credentialToken = `otid_stn_v1.${redeemed.response.credential.credentialId}.` +
      successfulRedemption.credentialSecret.toString("base64url");
    await expect(authenticateStationBearer(db, `Bearer ${credentialToken}`,
      new Date("2026-08-31T14:06:00.000Z"))).resolves.toMatchObject({ status: "authenticated" });
  });

  it("spärr och logout slår igenom direkt och auth-tabellerna är append-only", async () => {
    const { raceId } = await importedRace();
    const first = await adminSession(raceId, 101);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: first.login.sessionToken, csrfCookie: first.login.csrfToken, csrfHeader: first.login.csrfToken,
      raceId, capability: "PAIR_STATION",
      readBodyIsEmpty: async () => false
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toEqual({ status: "invalid-request" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "PAIR_STATION"
    }, new Date("2026-08-31T14:02:30.000Z"))).resolves.toMatchObject({ status: "authenticated" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: first.login.csrfToken, csrfHeader: first.login.csrfToken
    }, new Date("2026-08-31T14:03:00.000Z"))).resolves.toEqual({ status: "logged-out" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: first.login.csrfToken, csrfHeader: first.login.csrfToken
    }, new Date("2026-08-31T14:04:00.000Z"))).resolves.toEqual({ status: "already-logged-out" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "PAIR_STATION"
    }, new Date("2026-08-31T14:04:00.000Z"))).resolves.toEqual({ status: "unauthorized" });
    let bodyReads = 0;
    await expect(issuePairingGrantAsAdmin(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "PAIR_STATION",
      csrfCookie: first.login.csrfToken, csrfHeader: first.login.csrfToken,
      idempotencyKey: `pairing-grant:${crypto.randomUUID()}`,
      readBody: async () => { bodyReads += 1; return {}; }
    }, new Date("2026-08-31T14:04:00.000Z"))).resolves.toEqual({ status: "unauthorized" });
    expect(bodyReads).toBe(0);

    const second = await adminSession(raceId, 111);
    await revokePairingAdminAccessCredential(db, {
      credentialId: second.installation.credentialId,
      capability: "PAIR_STATION"
    },
      new Date("2026-08-31T14:03:00.000Z"));
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: second.login.sessionToken, raceId, capability: "PAIR_STATION"
    }, new Date("2026-08-31T14:04:00.000Z"))).resolves.toEqual({ status: "unauthorized" });
    const [credential] = await db.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, second.installation.credentialId));
    const [session] = await db.select().from(schema.pairingAdminSessions)
      .where(eq(schema.pairingAdminSessions.accessCredentialId, second.installation.credentialId));
    const [credentialRevocation] = await db.select().from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, second.installation.credentialId));
    const [loggedOutSession] = await db.select().from(schema.pairingAdminSessions)
      .where(eq(schema.pairingAdminSessions.accessCredentialId, first.installation.credentialId));
    const [sessionRevocation] = await db.select().from(schema.pairingAdminSessionRevocations)
      .where(eq(schema.pairingAdminSessionRevocations.sessionId, loggedOutSession?.id ?? crypto.randomUUID()));
    if (!credential || !session || !credentialRevocation || !sessionRevocation) throw new Error("Authspår saknas");
    await expect(db.update(schema.pairingAdminAccessCredentials).set({ label: "Ändrad" })
      .where(eq(schema.pairingAdminAccessCredentials.id, credential.id))).rejects.toThrow();
    await expect(db.delete(schema.pairingAdminSessions)
      .where(eq(schema.pairingAdminSessions.id, session.id))).rejects.toThrow();
    await expect(db.delete(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.id, credentialRevocation.id))).rejects.toThrow();
    await expect(db.update(schema.pairingAdminSessionRevocations).set({ reason: "Ändrad" })
      .where(eq(schema.pairingAdminSessionRevocations.id, sessionRevocation.id))).rejects.toThrow();
  });
});

describe("TASK 005G autentiserad IOF-import PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T16:00:00.000Z");
  const usedAt = new Date("2026-08-31T16:02:00.000Z");

  async function emptyRace() {
    const created = await createEvent(db, {
      name: `Importtest ${crypto.randomUUID()}`,
      raceName: "Individuellt",
      raceDate: "2026-08-31",
      timeZone: "Europe/Stockholm"
    });
    return created.race.id;
  }

  async function importAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "IMPORT_IOF",
      label: `Importör ${marker}`,
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000)
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "IMPORT_IOF",
      now: new Date("2026-08-31T16:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Importsession kunde inte skapas");
    return { installation, login };
  }

  function authenticatedInput(
    raceId: string,
    login: Awaited<ReturnType<typeof importAdmin>>["login"],
    requestId: string,
    xml: string
  ) {
    if (login.status !== "authenticated") throw new Error("Importsession saknas");
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken,
      idempotencyKey: `iof-import:${requestId}`,
      xmlBytes: Buffer.from(xml, "utf8")
    };
  }

  it("separerar prefix, race, capability och kortare livslängder utan orphan-session", async () => {
    const raceId = await emptyRace();
    const otherRaceId = await emptyRace();
    const admin = await importAdmin(raceId, 131);
    expect(admin.installation.accessCredential).toMatch(/^otid_org_import_v1\./);
    expect(admin.login.response).toEqual({
      formatVersion: 1,
      raceId,
      capability: "IMPORT_IOF",
      expiresAt: "2026-08-31T17:01:00.000Z"
    });
    const credentialAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, admin.installation.credentialId),
      eq(schema.auditEvents.action, "IOF_IMPORT_ACCESS_CREDENTIAL_ISSUED")
    ));
    expect(credentialAudits).toHaveLength(1);
    expect(credentialAudits[0]?.entityType).toBe("iof_import_access_credential");
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      raceId,
      capability: "IMPORT_IOF"
    }, usedAt)).resolves.toMatchObject({ status: "authenticated" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      raceId,
      capability: "PAIR_STATION"
    }, usedAt)).resolves.toEqual({ status: "forbidden" });

    const beforeSessions = await db.select({ value: count() }).from(schema.pairingAdminSessions);
    await expect(loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: admin.installation.accessCredential
    }, {
      expectedRaceId: otherRaceId,
      expectedCapability: "IMPORT_IOF",
      now: usedAt
    })).resolves.toEqual({ status: "unauthorized" });
    await expect(loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: admin.installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "PAIR_STATION",
      now: usedAt
    })).resolves.toEqual({ status: "unauthorized" });
    const afterSessions = await db.select({ value: count() }).from(schema.pairingAdminSessions);
    expect(afterSessions[0]?.value).toBe(beforeSessions[0]?.value);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: admin.installation.credentialId,
      capability: "PAIR_STATION"
    }, usedAt)).rejects.toThrow(/finns inte/);
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      raceId,
      capability: "IMPORT_IOF"
    }, usedAt)).resolves.toMatchObject({ status: "authenticated" });
    await expect(issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "IMPORT_IOF",
      label: "För lång",
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000 + 1)
    }, { now: issuedAt })).rejects.toThrow(/högst 8 timmar/);
  });

  it("committar 100 samtidiga exakta requests en gång och spårar nya content-duplicates", async () => {
    const raceId = await emptyRace();
    const admin = await importAdmin(raceId, 141);
    const requestId = crypto.randomUUID();
    const input = authenticatedInput(raceId, admin.login, requestId, courseXml);
    const results = await Promise.all(Array.from({ length: 100 }, () => importIofXmlAsAdmin(db, input, usedAt)));
    const successes = results.filter((result) => result.status === "stored");
    expect(successes).toHaveLength(100);
    expect(successes.filter((result) => result.status === "stored" && !result.response.replayed)).toHaveLength(1);
    expect(successes.filter((result) => result.status === "stored" && result.response.replayed)).toHaveLength(99);

    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const requests = await db.select().from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.requestId, requestId));
    const imports = await db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "IOF_IMPORT_STORED_BY_ADMIN")
    ));
    expect({ snapshot: race?.snapshotVersion, requests: requests.length, imports: imports.length, audits: audits.length })
      .toEqual({ snapshot: 2, requests: 1, imports: 1, audits: 1 });
    expect(audits[0]).toMatchObject({
      entityType: "import_file",
      entityId: imports[0]?.id,
      actorKind: "IOF_IMPORT_ACCESS_CREDENTIAL",
      actorId: admin.installation.credentialId,
      requestId,
      after: {
        kind: "CourseData",
        byteCount: Buffer.byteLength(courseXml, "utf8"),
        imported: { courses: 2, classes: 2 },
        snapshotVersionBefore: 1,
        snapshotVersionAfter: 2
      }
    });
    expect(JSON.stringify(audits)).not.toContain(contentHash(courseXml));
    expect(JSON.stringify(audits)).not.toContain("course-short");
    expect(JSON.stringify(audits)).not.toContain("Korta");
    expect(JSON.stringify(audits)).not.toContain(courseXml);
    expect(JSON.stringify(audits)).not.toContain(admin.installation.accessCredential);
    expect(JSON.stringify(audits)).not.toContain(admin.login.sessionToken);
    expect(JSON.stringify(audits)).not.toContain(admin.login.csrfToken);
    expect(JSON.stringify(audits)).not.toContain("secret-course-data.xml");
    await expect(db.update(schema.importFiles).set({ report: { changed: true } })
      .where(eq(schema.importFiles.id, imports[0]?.id ?? crypto.randomUUID()))).rejects.toThrow();
    await expect(db.delete(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.requestId, requestId))).rejects.toThrow();

    const duplicateRequestId = crypto.randomUUID();
    const duplicate = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, duplicateRequestId, courseXml),
      usedAt
    );
    expect(duplicate).toMatchObject({
      status: "duplicate",
      response: { status: "duplicate", replayed: false, requestId: duplicateRequestId }
    });
    const [raceAfterDuplicate] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const duplicateAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, raceId),
      eq(schema.auditEvents.action, "IOF_IMPORT_STORED_BY_ADMIN")
    ));
    expect(raceAfterDuplicate?.snapshotVersion).toBe(2);
    expect(duplicateAudits).toHaveLength(1);
  });

  it("ger request-konflikt före parserfel och binder request till actor, race och hash", async () => {
    const raceId = await emptyRace();
    const otherRaceId = await emptyRace();
    const first = await importAdmin(raceId, 151);
    const otherActor = await importAdmin(raceId, 161);
    const otherRaceActor = await importAdmin(otherRaceId, 171);
    const requestId = crypto.randomUUID();
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, first.login, requestId, courseXml),
      usedAt
    )).resolves.toMatchObject({ status: "stored" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, first.login, requestId, "<malformed>"),
      usedAt
    )).resolves.toEqual({ status: "conflict" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, otherActor.login, requestId, courseXml),
      usedAt
    )).resolves.toEqual({ status: "conflict" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(otherRaceId, otherRaceActor.login, requestId, courseXml),
      usedAt
    )).resolves.toEqual({ status: "conflict" });
  });

  it("avvisar ogiltig XML atomärt och stoppar import efter capability-säker logout", async () => {
    const raceId = await emptyRace();
    const admin = await importAdmin(raceId, 181);
    const before = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    await expect(importIofXmlAsAdmin(db, authenticatedInput(
      raceId,
      admin.login,
      crypto.randomUUID(),
      `<!DOCTYPE EntryList [<!ENTITY x "y">]><EntryList>&x;</EntryList>`
    ), usedAt)).resolves.toEqual({ status: "invalid-iof-xml" });
    const after = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    expect(after[0]?.value).toBe(before[0]?.value);

    await expect(logoutPairingAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      raceId,
      capability: "PAIR_STATION",
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      raceId,
      capability: "IMPORT_IOF",
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), courseXml),
      usedAt
    )).resolves.toEqual({ status: "unauthorized" });

    const revokedAdmin = await importAdmin(raceId, 186);
    await revokePairingAdminAccessCredential(db, {
      credentialId: revokedAdmin.installation.credentialId,
      capability: "IMPORT_IOF"
    }, usedAt);
    await expect(importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, revokedAdmin.login, crypto.randomUUID(), courseXml),
      usedAt
    )).resolves.toEqual({ status: "unauthorized" });
  });

  it("importerar EntryList genom skyddad yta efter betrodd CourseData-setup", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    const admin = await importAdmin(raceId, 191);
    const result = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), entryXml),
      usedAt
    );
    expect(result).toMatchObject({
      status: "stored",
      response: { report: { kind: "EntryList", imported: { entries: 2 } } }
    });
  });

  it("importerar StartList atomärt, versionsstyrt och utan automatisk resultatrevision", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await importAdmin(raceId, 196);
    const requestId = crypto.randomUUID();
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesBefore = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.externalId));
    const rawBefore = await db.select().from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId));
    const readoutsBefore = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const revisionsBefore = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    const oldSigned = await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem);
    const oldPayload = verifySignedStationPackage(oldSigned, stationPackagePublicKeySpkiBase64);

    const result = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, requestId, startListXml),
      usedAt
    );
    expect(result).toMatchObject({
      status: "stored",
      response: {
        status: "stored",
        replayed: false,
        requestId,
        report: {
          kind: "StartList",
          imported: { classes: 1, entries: 2 },
          changed: { classes: 1, entries: 2 },
          resultsRequiringRecalculation: 1,
          snapshotChanged: true
        }
      }
    });

    const [raceClass] = await db.select().from(schema.classes).where(and(
      eq(schema.classes.raceId, raceId),
      eq(schema.classes.externalId, "class-h21")
    ));
    const entriesAfter = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.externalId));
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const rawAfter = await db.select().from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId));
    const readoutsAfter = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const revisionsAfter = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect(raceClass?.startRule).toBe("FIXED");
    expect(entriesAfter.map((entry) => ({
      externalId: entry.externalId,
      fixedStartTime: entry.fixedStartTime?.toISOString(),
      versionDelta: entry.version - (entriesBefore.find((before) => before.id === entry.id)?.version ?? 0)
    }))).toEqual([
      { externalId: "entry-ada", fixedStartTime: "2026-08-31T08:00:00.000Z", versionDelta: 1 },
      { externalId: "entry-bo", fixedStartTime: "2026-08-31T08:03:00.000Z", versionDelta: 1 }
    ]);
    expect(raceAfter?.snapshotVersion).toBe((raceBefore?.snapshotVersion ?? 0) + 1);
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(revisionsAfter).toEqual(revisionsBefore);

    const [saved] = await db.select().from(schema.importFiles).where(and(
      eq(schema.importFiles.raceId, raceId),
      eq(schema.importFiles.kind, "StartList")
    ));
    expect(saved).toMatchObject({
      contentHash: contentHash(startListXml),
      originalXml: startListXml,
      report: {
        kind: "StartList",
        changed: { classes: 1, entries: 2 },
        resultsRequiringRecalculation: 1,
        snapshotChanged: true
      }
    });
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, saved?.id ?? crypto.randomUUID()),
      eq(schema.auditEvents.action, "IOF_IMPORT_STORED_BY_ADMIN")
    ));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({
      kind: "StartList",
      changed: { classes: 1, entries: 2 },
      resultsRequiringRecalculation: 1,
      snapshotChanged: true,
      snapshotVersionBefore: raceBefore?.snapshotVersion,
      snapshotVersionAfter: raceAfter?.snapshotVersion
    });
    expect(JSON.stringify(audits)).not.toContain("entry-ada");
    expect(JSON.stringify(audits)).not.toContain(startListXml);

    const signed = await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem);
    const payload = verifySignedStationPackage(signed, stationPackagePublicKeySpkiBase64);
    expect(verifySignedStationPackage(oldSigned, stationPackagePublicKeySpkiBase64)).toEqual(oldPayload);
    expect(oldPayload.raceSnapshot.classes.find((item) => item.externalIdentity?.externalId === "class-h21")?.startRule)
      .toBe("PUNCH");
    expect(oldPayload.raceSnapshot.entries.find((item) => item.externalIdentity?.externalId === "entry-ada")?.fixedStartTime)
      .toBeUndefined();
    expect(payload.packageVersion).toBe(raceAfter?.snapshotVersion);
    expect(payload.raceSnapshot.classes.find((item) => item.externalIdentity?.externalId === "class-h21")?.startRule)
      .toBe("FIXED");
    expect(payload.raceSnapshot.entries.find((item) => item.externalIdentity?.externalId === "entry-ada")?.fixedStartTime)
      .toBe("2026-08-31T08:00:00.000Z");

    const staleResponse = await ingestDeviceBatch(db, raceId, batch(
      crypto.randomUUID(),
      { ...okPayload, cardNumber: "999999" },
      { packageVersion: oldPayload.packageVersion }
    ));
    expect(staleResponse).toMatchObject({
      currentPackageVersion: payload.packageVersion,
      packageVersionStatus: "stale",
      packageUpdateRequired: true,
      acknowledgements: [{ status: "stored" }]
    });
  });

  it("återspelar StartList exakt och bevarar en ny fil med identisk effekt utan versionschurn", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    const admin = await importAdmin(raceId, 197);
    const firstRequestId = crypto.randomUUID();
    const input = authenticatedInput(raceId, admin.login, firstRequestId, startListXml);
    const first = await importIofXmlAsAdmin(db, input, usedAt);
    expect(first).toMatchObject({ status: "stored", response: { replayed: false } });
    const replay = await importIofXmlAsAdmin(db, input, usedAt);
    expect(replay).toMatchObject({ status: "stored", response: { replayed: true, requestId: firstRequestId } });
    const duplicate = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), startListXml),
      usedAt
    );
    expect(duplicate).toMatchObject({ status: "duplicate", response: { replayed: false } });

    const [raceAfterFirst] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesAfterFirst = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    const sameEffectXml = startListXml.replace(
      'creator="O-Tid fixture"',
      'creator="O-Tid fixture semantic retry"'
    );
    const sameEffect = await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), sameEffectXml),
      usedAt
    );
    expect(sameEffect).toMatchObject({
      status: "stored",
      response: {
        report: {
          kind: "StartList",
          changed: { classes: 0, entries: 0 },
          resultsRequiringRecalculation: 0,
          snapshotChanged: false
        }
      }
    });
    const [raceAfterSameEffect] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesAfterSameEffect = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    const imports = await db.select().from(schema.importFiles).where(and(
      eq(schema.importFiles.raceId, raceId),
      eq(schema.importFiles.kind, "StartList")
    ));
    expect(imports).toHaveLength(2);
    expect(raceAfterSameEffect?.snapshotVersion).toBe(raceAfterFirst?.snapshotVersion);
    expect(entriesAfterSameEffect.map((entry) => [entry.id, entry.version, entry.fixedStartTime?.toISOString()]))
      .toEqual(entriesAfterFirst.map((entry) => [entry.id, entry.version, entry.fixedStartTime?.toISOString()]));
  });

  it("avvisar okänd, partiell eller klasskonfliktande StartList utan writes", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    const admin = await importAdmin(raceId, 198);
    const startList = (classId: string, entryIds: readonly string[]) => `<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0"><Event><Name>Test</Name></Event><ClassStart><Class><Id>${classId}</Id></Class>${entryIds.map((entryId, index) => `<PersonStart><EntryId>${entryId}</EntryId><Start><StartTime>2026-08-31T08:0${index}:00Z</StartTime></Start></PersonStart>`).join("")}</ClassStart></StartList>`;
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesBefore = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    const [importsBefore] = await db.select({ value: count() }).from(schema.importFiles)
      .where(eq(schema.importFiles.raceId, raceId));
    const [requestsBefore] = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    for (const xml of [
      startList("class-unknown", ["entry-ada", "entry-bo"]),
      startList("class-h21", ["entry-ada"]),
      startList("class-d21", ["entry-ada", "entry-bo"])
    ]) {
      await expect(importIofXmlAsAdmin(
        db,
        authenticatedInput(raceId, admin.login, crypto.randomUUID(), xml),
        usedAt
      )).resolves.toEqual({ status: "conflict" });
    }
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    const entriesAfter = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    const [importsAfter] = await db.select({ value: count() }).from(schema.importFiles)
      .where(eq(schema.importFiles.raceId, raceId));
    const [requestsAfter] = await db.select({ value: count() }).from(schema.iofImportRequests)
      .where(eq(schema.iofImportRequests.raceId, raceId));
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    expect(entriesAfter).toEqual(entriesBefore);
    expect(importsAfter?.value).toBe(importsBefore?.value);
    expect(requestsAfter?.value).toBe(requestsBefore?.value);
  });

  it("bevarar FIXED och fasta starttider vid senare CourseData- och EntryList-import", async () => {
    const raceId = await emptyRace();
    await importIofXml(db, raceId, courseXml);
    await importIofXml(db, raceId, entryXml);
    const admin = await importAdmin(raceId, 199);
    await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), startListXml),
      usedAt
    );
    await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), courseXml.replace(
        "</CourseData>",
        "<!-- after-start-list --></CourseData>"
      )),
      usedAt
    );
    await importIofXmlAsAdmin(
      db,
      authenticatedInput(raceId, admin.login, crypto.randomUUID(), entryXml.replace(
        "</EntryList>",
        "<!-- after-start-list --></EntryList>"
      )),
      usedAt
    );
    const [raceClass] = await db.select().from(schema.classes).where(and(
      eq(schema.classes.raceId, raceId),
      eq(schema.classes.externalId, "class-h21")
    ));
    const entries = await db.select().from(schema.entries)
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.externalId));
    expect(raceClass?.startRule).toBe("FIXED");
    expect(entries.map((entry) => entry.fixedStartTime?.toISOString())).toEqual([
      "2026-08-31T08:00:00.000Z",
      "2026-08-31T08:03:00.000Z"
    ]);
  });

  it("binder hash och byteantal till exakta UTF-8-bytes inklusive BOM", async () => {
    const raceId = await emptyRace();
    const admin = await importAdmin(raceId, 201);
    const xmlBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(courseXml, "utf8")]);
    const requestId = crypto.randomUUID();
    const result = await importIofXmlAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken,
      idempotencyKey: `iof-import:${requestId}`,
      xmlBytes
    }, usedAt);
    expect(result).toMatchObject({
      status: "stored",
      response: {
        byteCount: xmlBytes.byteLength,
        contentHash: createHash("sha256").update(xmlBytes).digest("hex")
      }
    });
    const [saved] = await db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId));
    expect(saved?.originalXml.codePointAt(0)).toBe(0xfeff);
    expect(Buffer.from(saved?.originalXml ?? "", "utf8")).toEqual(xmlBytes);
  });
});

describe("TASK 005H autentiserad deltagarklassändring PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T18:00:00.000Z");
  const usedAt = new Date("2026-08-31T18:02:00.000Z");

  async function classAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "CHANGE_ENTRY_CLASS",
      label: `Klassadministratör ${marker}`,
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000)
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "CHANGE_ENTRY_CLASS",
      now: new Date("2026-08-31T18:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Klassadministratörssession kunde inte skapas");
    return { installation, login };
  }

  function changeInput(
    raceId: string,
    login: Awaited<ReturnType<typeof classAdmin>>["login"],
    entryId: string,
    requestId: string,
    classId: string,
    expectedEntryVersion: number
  ) {
    if (login.status !== "authenticated") throw new Error("Klassadministratörssession saknas");
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken,
      entryId,
      idempotencyKey: `entry-class-change:${requestId}`,
      request: { formatVersion: 1, classId, expectedEntryVersion }
    };
  }

  async function classFixture() {
    const { raceId, overview } = await importedRace();
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const h21 = overview.classes.find((raceClass) => raceClass.name === "H21");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !h21 || !d21) throw new Error("Fixture saknar Ada, H21 eller D21");
    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, ada.id));
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    if (!entry || !race) throw new Error("Fixture saknar deltagare eller lopp");
    return { raceId, ada, h21, d21, entry, race };
  }

  it("separerar prefix, capability, race och livslängd samt listar endast minsta DTO", async () => {
    const fixture = await classFixture();
    const other = await classFixture();
    const admin = await classAdmin(fixture.raceId, 211);
    expect(admin.installation.accessCredential).toMatch(/^otid_org_entry_class_v1\./);
    expect(admin.login.response).toEqual({
      formatVersion: 1,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      expiresAt: "2026-08-31T19:01:00.000Z"
    });

    const issueAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, admin.installation.credentialId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_ACCESS_CREDENTIAL_ISSUED")
    ));
    expect(issueAudits).toHaveLength(1);
    expect(issueAudits[0]?.entityType).toBe("entry_class_access_credential");
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "IMPORT_IOF"
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: admin.installation.accessCredential
    }, {
      expectedRaceId: other.raceId,
      expectedCapability: "CHANGE_ENTRY_CLASS",
      now: usedAt
    })).resolves.toEqual({ status: "unauthorized" });
    await expect(issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      label: "För lång",
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000 + 1)
    }, { now: issuedAt })).rejects.toThrow(/högst 8 timmar/);

    const listed = await listEntryClassesAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    expect(listed.status).toBe("ok");
    if (listed.status !== "ok") throw new Error("Klasslistan kunde inte läsas");
    expect(listed.response).toMatchObject({
      formatVersion: 1,
      raceId: fixture.raceId,
      snapshotVersion: fixture.race.snapshotVersion,
      classes: [{ name: "D21" }, { name: "H21" }]
    });
    const listedAda = listed.response.entries.find((entry) => entry.id === fixture.ada.id);
    expect(listedAda).toEqual({
      id: fixture.ada.id,
      displayName: "Ada Löpare",
      organisationName: "Centrum OK",
      classId: fixture.h21.id,
      version: fixture.entry.version
    });
    expect(Object.keys(listedAda ?? {}).sort()).toEqual([
      "classId", "displayName", "id", "organisationName", "version"
    ]);
  });

  it("committar 100 samtidiga exakta requests exakt en gång utan resultatrevision", async () => {
    const fixture = await classFixture();
    const admin = await classAdmin(fixture.raceId, 221);
    const requestId = crypto.randomUUID();
    const input = changeInput(
      fixture.raceId, admin.login, fixture.ada.id, requestId, fixture.d21.id, fixture.entry.version
    );
    const beforeResults = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, fixture.raceId));
    const results = await Promise.all(Array.from(
      { length: 100 },
      () => changeEntryClassAsAdmin(db, input, usedAt)
    ));
    expect(results.filter((result) => result.status === "changed")).toHaveLength(100);
    expect(results.filter((result) => result.status === "changed" && !result.response.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.status === "changed" && result.response.replayed)).toHaveLength(99);

    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.ada.id));
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const requests = await db.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_CHANGED_BY_ADMIN")
    ));
    const afterResults = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, fixture.raceId));
    expect({
      classId: entry?.classId,
      entryVersion: entry?.version,
      snapshotVersion: race?.snapshotVersion,
      requests: requests.length,
      audits: audits.length,
      resultRevisions: afterResults[0]?.value
    }).toEqual({
      classId: fixture.d21.id,
      entryVersion: fixture.entry.version + 1,
      snapshotVersion: fixture.race.snapshotVersion + 1,
      requests: 1,
      audits: 1,
      resultRevisions: beforeResults[0]?.value
    });
    expect(audits[0]).toMatchObject({
      entityType: "entry",
      entityId: fixture.ada.id,
      actorKind: "ENTRY_CLASS_ACCESS_CREDENTIAL",
      actorId: admin.installation.credentialId,
      requestId,
      before: {
        classId: fixture.h21.id,
        entryVersion: fixture.entry.version,
        snapshotVersion: fixture.race.snapshotVersion
      },
      after: {
        classId: fixture.d21.id,
        entryVersion: fixture.entry.version + 1,
        snapshotVersion: fixture.race.snapshotVersion + 1
      }
    });
    const auditJson = JSON.stringify(audits);
    expect(auditJson).not.toContain("Ada");
    expect(auditJson).not.toContain("Löpare");
    expect(auditJson).not.toContain("Centrum OK");
    expect(auditJson).not.toContain(admin.installation.accessCredential);
    expect(auditJson).not.toContain(admin.login.sessionToken);
    expect(auditJson).not.toContain(admin.login.csrfToken);
    await expect(db.update(schema.entryClassChangeRequests).set({ classId: fixture.h21.id })
      .where(eq(schema.entryClassChangeRequests.requestId, requestId))).rejects.toThrow();
    await expect(db.delete(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId))).rejects.toThrow();
  });

  it("avvisar no-op, stale version och objekt från annat lopp atomärt", async () => {
    const fixture = await classFixture();
    const other = await classFixture();
    const admin = await classAdmin(fixture.raceId, 231);
    const beforeRequests = await db.select({ value: count() }).from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.raceId, fixture.raceId));
    const beforeAudits = await db.select({ value: count() }).from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_CHANGED_BY_ADMIN")
    ));
    const cases = [
      changeInput(fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.h21.id, fixture.entry.version),
      changeInput(fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.d21.id, fixture.entry.version + 1)
    ];
    for (const input of cases) {
      await expect(changeEntryClassAsAdmin(db, input, usedAt)).resolves.toEqual({ status: "conflict" });
    }
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId, admin.login, other.ada.id, crypto.randomUUID(), fixture.d21.id, other.entry.version
    ), usedAt)).resolves.toEqual({ status: "not-found" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), other.d21.id, fixture.entry.version
    ), usedAt)).resolves.toEqual({ status: "not-found" });

    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.ada.id));
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const afterRequests = await db.select({ value: count() }).from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.raceId, fixture.raceId));
    const afterAudits = await db.select({ value: count() }).from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_CHANGED_BY_ADMIN")
    ));
    expect({
      classId: entry?.classId,
      entryVersion: entry?.version,
      snapshotVersion: race?.snapshotVersion,
      requests: afterRequests[0]?.value,
      audits: afterAudits[0]?.value
    }).toEqual({
      classId: fixture.entry.classId,
      entryVersion: fixture.entry.version,
      snapshotVersion: fixture.race.snapshotVersion,
      requests: beforeRequests[0]?.value,
      audits: beforeAudits[0]?.value
    });
  });

  it("låter två olika request-id med samma expected version ge exakt en vinnare", async () => {
    const fixture = await classFixture();
    const admin = await classAdmin(fixture.raceId, 241);
    const results = await Promise.all([
      changeEntryClassAsAdmin(db, changeInput(
        fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.d21.id, fixture.entry.version
      ), usedAt),
      changeEntryClassAsAdmin(db, changeInput(
        fixture.raceId, admin.login, fixture.ada.id, crypto.randomUUID(), fixture.d21.id, fixture.entry.version
      ), usedAt)
    ]);
    expect(results.filter((result) => result.status === "changed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
    const requests = await db.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(1);
  });

  it("replayar originalsvaret efter senare ändring men binder request till exakt actor och kontext", async () => {
    const fixture = await classFixture();
    const otherRace = await classFixture();
    const firstAdmin = await classAdmin(fixture.raceId, 251);
    const otherAdmin = await classAdmin(fixture.raceId, 261);
    const otherRaceAdmin = await classAdmin(otherRace.raceId, 262);
    const firstRequestId = crypto.randomUUID();
    const firstInput = changeInput(
      fixture.raceId, firstAdmin.login, fixture.ada.id, firstRequestId, fixture.d21.id, fixture.entry.version
    );
    const first = await changeEntryClassAsAdmin(db, firstInput, usedAt);
    expect(first).toMatchObject({ status: "changed", response: { replayed: false, classId: fixture.d21.id } });
    const second = await changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      fixture.ada.id,
      crypto.randomUUID(),
      fixture.h21.id,
      fixture.entry.version + 1
    ), new Date(usedAt.getTime() + 1));
    expect(second).toMatchObject({ status: "changed", response: { replayed: false, classId: fixture.h21.id } });
    const replay = await changeEntryClassAsAdmin(db, firstInput, new Date(usedAt.getTime() + 2));
    expect(replay).toEqual(first.status === "changed"
      ? { status: "changed", response: { ...first.response, replayed: true } }
      : first);
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      otherAdmin.login,
      fixture.ada.id,
      firstRequestId,
      fixture.d21.id,
      fixture.entry.version
    ), new Date(usedAt.getTime() + 3))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      crypto.randomUUID(),
      firstRequestId,
      fixture.d21.id,
      fixture.entry.version
    ), new Date(usedAt.getTime() + 4))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      fixture.ada.id,
      firstRequestId,
      fixture.h21.id,
      fixture.entry.version
    ), new Date(usedAt.getTime() + 5))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      firstAdmin.login,
      fixture.ada.id,
      firstRequestId,
      fixture.d21.id,
      fixture.entry.version + 1
    ), new Date(usedAt.getTime() + 6))).resolves.toEqual({ status: "conflict" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      otherRace.raceId,
      otherRaceAdmin.login,
      otherRace.ada.id,
      firstRequestId,
      otherRace.d21.id,
      otherRace.entry.version
    ), new Date(usedAt.getTime() + 7))).resolves.toEqual({ status: "conflict" });
  });

  it("stoppar mutation efter capability-säker logout och revocation", async () => {
    const fixture = await classFixture();
    const loggedOut = await classAdmin(fixture.raceId, 271);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken,
      raceId: fixture.raceId,
      capability: "IMPORT_IOF",
      csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      loggedOut.login,
      fixture.ada.id,
      crypto.randomUUID(),
      fixture.d21.id,
      fixture.entry.version
    ), usedAt)).resolves.toEqual({ status: "unauthorized" });

    const revoked = await classAdmin(fixture.raceId, 281);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revoked.installation.credentialId,
      capability: "IMPORT_IOF"
    }, usedAt)).rejects.toThrow(/finns inte/);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revoked.installation.credentialId,
      capability: "CHANGE_ENTRY_CLASS"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(changeEntryClassAsAdmin(db, changeInput(
      fixture.raceId,
      revoked.login,
      fixture.ada.id,
      crypto.randomUUID(),
      fixture.d21.id,
      fixture.entry.version
    ), usedAt)).resolves.toEqual({ status: "unauthorized" });
    const revokeAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, revoked.installation.credentialId),
      eq(schema.auditEvents.action, "ENTRY_CLASS_ACCESS_CREDENTIAL_REVOKED")
    ));
    expect(revokeAudits).toHaveLength(1);
    expect(revokeAudits[0]?.entityType).toBe("entry_class_access_credential");
  });
});

describe("TASK 005I autentiserad explicit resultatomräkning PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T20:00:00.000Z");
  const usedAt = new Date("2026-08-31T20:02:00.000Z");

  async function recalculationAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "RECALCULATE_RESULT",
      label: `Resultatomräknare ${marker}`,
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000)
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "RECALCULATE_RESULT",
      now: new Date("2026-08-31T20:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Omräkningssession kunde inte skapas");
    return { installation, login };
  }

  async function readyFixture(marker: number) {
    const { raceId, overview } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await recalculationAdmin(raceId, marker);
    const listed = await listResultRecalculationCandidatesAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId
    }, usedAt);
    if (listed.status !== "ok") throw new Error("Omräkningskandidater kunde inte läsas");
    const candidate = listed.response.entries.find((entry) => entry.displayName === "Ada Löpare");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!candidate || candidate.readiness !== "READY" || !candidate.cardAssignmentId ||
      !candidate.latestReadout || !candidate.latestResultRevision || !d21) {
      throw new Error("Fixture saknar en komplett omräkningskandidat");
    }
    const readyCandidate = {
      ...candidate,
      cardAssignmentId: candidate.cardAssignmentId,
      latestReadout: candidate.latestReadout,
      latestResultRevision: candidate.latestResultRevision
    };
    return { raceId, overview, admin, candidate: readyCandidate, d21, response: listed.response };
  }

  function recalculationInput(
    fixture: Awaited<ReturnType<typeof readyFixture>>,
    requestId = crypto.randomUUID(),
    admin = fixture.admin
  ) {
    return {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken,
      entryId: fixture.candidate.id,
      idempotencyKey: `result-recalculation:${requestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: fixture.candidate.entryVersion,
        expectedClassId: fixture.candidate.classId,
        expectedSnapshotVersion: fixture.response.snapshotVersion,
        expectedCardAssignmentId: fixture.candidate.cardAssignmentId,
        expectedReadoutId: fixture.candidate.latestReadout.id,
        expectedLatestResultRevision: {
          id: fixture.candidate.latestResultRevision.id,
          revision: fixture.candidate.latestResultRevision.revision
        },
        expectedEngineVersion: fixture.response.engineVersion
      }
    };
  }

  it("separerar capability/prefix/livslängd och lämnar endast säkra readiness-kandidater", async () => {
    const fixture = await readyFixture(291);
    expect(fixture.admin.installation.accessCredential).toMatch(/^otid_org_result_recalc_v1\./);
    expect(fixture.admin.login.response).toEqual({
      formatVersion: 1,
      raceId: fixture.raceId,
      capability: "RECALCULATE_RESULT",
      expiresAt: "2026-08-31T21:01:00.000Z"
    });
    const issueAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, fixture.admin.installation.credentialId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATION_ACCESS_CREDENTIAL_ISSUED")
    ));
    expect(issueAudits).toHaveLength(1);
    expect(issueAudits[0]?.entityType).toBe("result_recalculation_access_credential");
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS"
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "RECALCULATE_RESULT",
      label: "För lång",
      expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000 + 1)
    }, { now: issuedAt })).rejects.toThrow(/högst 8 timmar/);

    expect(fixture.candidate.readiness).toBe("READY");
    expect(typeof fixture.candidate.latestReadout.id).toBe("string");
    expect(typeof fixture.candidate.latestReadout.readAt).toBe("string");
    expect(fixture.candidate.latestResultRevision).toMatchObject({
      revision: 1,
      cause: "CARD_READOUT"
    });
    const bo = fixture.response.entries.find((entry) => entry.displayName === "Bo Skog");
    expect(bo?.readiness).toBe("NO_READOUT");
    expect(typeof bo?.cardAssignmentId).toBe("string");
    expect(bo?.latestReadout).toBeNull();
    expect(bo?.latestResultRevision).toBeNull();
    const candidateJson = JSON.stringify(fixture.response);
    for (const forbidden of ["cardNumber", "punches", "evaluation", "rawPayload", "accessCredential"]) {
      expect(candidateJson).not.toContain(forbidden);
    }

    await db.update(schema.cardAssignments).set({ active: false })
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    const noAssignment = await listResultRecalculationCandidatesAsAdmin(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (noAssignment.status !== "ok") throw new Error("Kandidatlistning misslyckades");
    expect(noAssignment.response.entries.find((entry) => entry.id === fixture.candidate.id)).toMatchObject({
      readiness: "NO_ACTIVE_ASSIGNMENT",
      cardAssignmentId: null,
      latestReadout: null
    });
    await db.update(schema.cardAssignments).set({ active: true })
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    await db.insert(schema.cardAssignments).values({
      raceId: fixture.raceId,
      entryId: fixture.candidate.id,
      cardNumber: `extra-${crypto.randomUUID()}`,
      active: true
    });
    const multipleAssignments = await listResultRecalculationCandidatesAsAdmin(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (multipleAssignments.status !== "ok") throw new Error("Kandidatlistning misslyckades");
    expect(multipleAssignments.response.entries.find((entry) => entry.id === fixture.candidate.id)).toMatchObject({
      readiness: "MULTIPLE_ACTIVE_ASSIGNMENTS",
      cardAssignmentId: null,
      latestReadout: null
    });
  });

  it("committar 100 samtidiga exact retries en gång utan att mutera inputstate", async () => {
    const fixture = await readyFixture(301);
    const requestId = crypto.randomUUID();
    const input = recalculationInput(fixture, requestId);
    const [entryBefore] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.candidate.id));
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const [assignmentBefore] = await db.select().from(schema.cardAssignments)
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    const [readoutBefore] = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.id, fixture.candidate.latestReadout.id));
    const rawBefore = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId));
    const results = await Promise.all(Array.from(
      { length: 100 },
      () => recalculateEntryAsAdmin(db, input, usedAt)
    ));
    expect(results.filter((result) => result.status === "recalculated")).toHaveLength(100);
    expect(results.filter((result) => result.status === "recalculated" && !result.response.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.status === "recalculated" && result.response.replayed)).toHaveLength(99);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id)).orderBy(desc(schema.resultRevisions.revision));
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.requestId, requestId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATED_BY_ADMIN")
    ));
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({
      revision: 2,
      cause: "EXPLICIT_RECALCULATION",
      published: true,
      readoutId: fixture.candidate.latestReadout.id,
      snapshotVersion: fixture.response.snapshotVersion
    });
    expect(requests).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "result_revision",
      entityId: revisions[0]?.id,
      actorKind: "RESULT_RECALCULATION_ACCESS_CREDENTIAL",
      actorId: fixture.admin.installation.credentialId,
      requestId
    });
    const [entryAfter] = await db.select().from(schema.entries).where(eq(schema.entries.id, fixture.candidate.id));
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const [assignmentAfter] = await db.select().from(schema.cardAssignments)
      .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    const [readoutAfter] = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.id, fixture.candidate.latestReadout.id));
    const rawAfter = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId));
    expect(entryAfter).toEqual(entryBefore);
    expect(raceAfter).toEqual(raceBefore);
    expect(assignmentAfter).toEqual(assignmentBefore);
    expect(readoutAfter).toEqual(readoutBefore);
    expect(rawAfter).toEqual(rawBefore);
    const auditJson = JSON.stringify(audits);
    for (const forbidden of [
      "Ada", "Löpare", "Centrum OK", "12345", "punches", "evaluation",
      fixture.admin.installation.accessCredential, fixture.admin.login.sessionToken, fixture.admin.login.csrfToken
    ]) expect(auditJson).not.toContain(forbidden);
    await expect(db.update(schema.resultRecalculationRequests).set({ expectedEntryVersion: 999 })
      .where(eq(schema.resultRecalculationRequests.requestId, requestId))).rejects.toThrow();
    await expect(db.delete(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.requestId, requestId))).rejects.toThrow();
    await expect(db.update(schema.resultRevisions).set({ published: false })
      .where(eq(schema.resultRevisions.id, revisions[0]?.id ?? crypto.randomUUID()))).rejects.toThrow();
  });

  it("avvisar stale värde för vart och ett av de frysta intentfälten utan write", async () => {
    const fixture = await readyFixture(311);
    const base = recalculationInput(fixture);
    const current = base.request;
    const staleRequests = [
      { ...current, expectedEntryVersion: current.expectedEntryVersion + 1 },
      { ...current, expectedClassId: fixture.d21.id },
      { ...current, expectedSnapshotVersion: current.expectedSnapshotVersion + 1 },
      { ...current, expectedCardAssignmentId: crypto.randomUUID() },
      { ...current, expectedReadoutId: crypto.randomUUID() },
      { ...current, expectedLatestResultRevision: null },
      { ...current, expectedLatestResultRevision: {
        id: crypto.randomUUID(), revision: current.expectedLatestResultRevision.revision
      } },
      { ...current, expectedLatestResultRevision: {
        id: current.expectedLatestResultRevision.id,
        revision: current.expectedLatestResultRevision.revision + 1
      } },
      { ...current, expectedEngineVersion: `${current.expectedEngineVersion}-stale` }
    ];
    const [beforeRevisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    for (const request of staleRequests) {
      await expect(recalculateEntryAsAdmin(db, {
        ...base,
        idempotencyKey: `result-recalculation:${crypto.randomUUID()}`,
        request
      }, usedAt)).resolves.toEqual({ status: "conflict" });
    }
    const [afterRevisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATED_BY_ADMIN")
    ));
    expect(afterRevisionCount?.value).toBe(beforeRevisionCount?.value);
    expect(requests).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("ger en vinnare för två request-id och replayar originalet efter senare domänhändelser", async () => {
    const fixture = await readyFixture(321);
    const firstInput = recalculationInput(fixture, crypto.randomUUID());
    const secondInput = recalculationInput(fixture, crypto.randomUUID());
    const initialResults = await Promise.all([
      recalculateEntryAsAdmin(db, firstInput, usedAt),
      recalculateEntryAsAdmin(db, secondInput, usedAt)
    ]);
    expect(initialResults.filter((result) => result.status === "recalculated")).toHaveLength(1);
    expect(initialResults.filter((result) => result.status === "conflict")).toHaveLength(1);
    const winningIndex = initialResults.findIndex((result) => result.status === "recalculated");
    const winningResult = initialResults[winningIndex];
    const winningInput = winningIndex === 0 ? firstInput : secondInput;
    if (!winningResult || winningResult.status !== "recalculated") throw new Error("Omräkningsvinnare saknas");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:45:00Z"
    }, { stationReceivedAt: "2026-08-30T11:00:00Z" }));
    await changeEntryClass(db, fixture.raceId, fixture.candidate.id, fixture.d21.id);
    const replay = await recalculateEntryAsAdmin(db, winningInput, new Date(usedAt.getTime() + 1));
    expect(replay).toEqual({
      status: "recalculated",
      response: { ...winningResult.response, replayed: true }
    });
    const winningRequest = winningInput.request;
    const changedReplayRequests = [
      { ...winningRequest, expectedEntryVersion: winningRequest.expectedEntryVersion + 1 },
      { ...winningRequest, expectedClassId: crypto.randomUUID() },
      { ...winningRequest, expectedSnapshotVersion: winningRequest.expectedSnapshotVersion + 1 },
      { ...winningRequest, expectedCardAssignmentId: crypto.randomUUID() },
      { ...winningRequest, expectedReadoutId: crypto.randomUUID() },
      { ...winningRequest, expectedLatestResultRevision: null },
      { ...winningRequest, expectedLatestResultRevision: {
        id: crypto.randomUUID(), revision: winningRequest.expectedLatestResultRevision.revision
      } },
      { ...winningRequest, expectedLatestResultRevision: {
        id: winningRequest.expectedLatestResultRevision.id,
        revision: winningRequest.expectedLatestResultRevision.revision + 1
      } },
      { ...winningRequest, expectedEngineVersion: `${winningRequest.expectedEngineVersion}-changed` }
    ];
    for (const request of changedReplayRequests) {
      await expect(recalculateEntryAsAdmin(db, {
        ...winningInput,
        request
      }, new Date(usedAt.getTime() + 2))).resolves.toEqual({ status: "conflict" });
    }
    await expect(recalculateEntryAsAdmin(db, {
      ...winningInput,
      entryId: crypto.randomUUID()
    }, new Date(usedAt.getTime() + 2))).resolves.toEqual({ status: "conflict" });

    const otherActor = await recalculationAdmin(fixture.raceId, 331);
    await expect(recalculateEntryAsAdmin(db, {
      ...winningInput,
      sessionToken: otherActor.login.sessionToken,
      csrfCookie: otherActor.login.csrfToken,
      csrfHeader: otherActor.login.csrfToken
    }, new Date(usedAt.getTime() + 2))).resolves.toEqual({ status: "conflict" });
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["ingen aktiv assignment", 332, "none"],
    ["flera aktiva assignments", 333, "multiple"],
    ["saknad readout", 334, "missing-readout"]
  ] as const)("avvisar %s utan resultatskrivning", async (_label, marker, condition) => {
    const fixture = await readyFixture(marker);
    const input = recalculationInput(fixture);
    if (condition === "none") {
      await db.update(schema.cardAssignments).set({ active: false })
        .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
    } else if (condition === "multiple") {
      await db.insert(schema.cardAssignments).values({
        raceId: fixture.raceId,
        entryId: fixture.candidate.id,
        cardNumber: `extra-${crypto.randomUUID()}`,
        active: true
      });
    } else {
      await db.update(schema.cardAssignments).set({ active: false })
        .where(eq(schema.cardAssignments.id, fixture.candidate.cardAssignmentId));
      const [assignment] = await db.insert(schema.cardAssignments).values({
        raceId: fixture.raceId,
        entryId: fixture.candidate.id,
        cardNumber: `missing-${crypto.randomUUID()}`,
        active: true
      }).returning({ id: schema.cardAssignments.id });
      if (!assignment) throw new Error("Testassignment kunde inte skapas");
      input.request = {
        ...input.request,
        expectedCardAssignmentId: assignment.id,
        expectedReadoutId: crypto.randomUUID()
      };
    }
    const [before] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    await expect(recalculateEntryAsAdmin(db, input, usedAt)).resolves.toEqual({ status: "conflict" });
    const [after] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id));
    expect(after?.value).toBe(before?.value);
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(0);
  });

  it("stoppar omräkning efter capability-säker logout och revocation", async () => {
    const fixture = await readyFixture(341);
    const input = recalculationInput(fixture);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "CHANGE_ENTRY_CLASS",
      csrfCookie: fixture.admin.login.csrfToken,
      csrfHeader: fixture.admin.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: fixture.admin.login.sessionToken,
      raceId: fixture.raceId,
      capability: "RECALCULATE_RESULT",
      csrfCookie: fixture.admin.login.csrfToken,
      csrfHeader: fixture.admin.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(recalculateEntryAsAdmin(db, input, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const revokedFixture = await readyFixture(351);
    const revokedInput = recalculationInput(revokedFixture);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revokedFixture.admin.installation.credentialId,
      capability: "CHANGE_ENTRY_CLASS"
    }, usedAt)).rejects.toThrow(/finns inte/);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revokedFixture.admin.installation.credentialId,
      capability: "RECALCULATE_RESULT"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(recalculateEntryAsAdmin(db, revokedInput, usedAt)).resolves.toEqual({ status: "unauthorized" });
    const revokeAudits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.entityId, revokedFixture.admin.installation.credentialId),
      eq(schema.auditEvents.action, "RESULT_RECALCULATION_ACCESS_CREDENTIAL_REVOKED")
    ));
    expect(revokeAudits).toHaveLength(1);
    expect(revokeAudits[0]?.entityType).toBe("result_recalculation_access_credential");
  });

  it("serialiserar samtidig ingest till obrutna revisioner eller stale konflikt", async () => {
    const fixture = await readyFixture(361);
    const input = recalculationInput(fixture);
    const [recalculation, ingest] = await Promise.all([
      recalculateEntryAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:46:00Z"
      }, { stationReceivedAt: "2026-08-30T11:01:00Z" }))
    ]);
    expect(["recalculated", "conflict"]).toContain(recalculation.status);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, fixture.candidate.id)).orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(Array.from({ length: revisions.length }, (_, index) => index + 1));
    expect(revisions).toHaveLength(recalculation.status === "recalculated" ? 3 : 2);
    const requests = await db.select().from(schema.resultRecalculationRequests)
      .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
    expect(requests).toHaveLength(recalculation.status === "recalculated" ? 1 : 0);
  });

  it.each(["class", "import"] as const)(
    "serialiserar samtidig %s-mutation till hel snapshot eller stale konflikt",
    async (mutation) => {
      const fixture = await readyFixture(mutation === "class" ? 371 : 381);
      const input = recalculationInput(fixture);
      const mutate = mutation === "class"
        ? () => changeEntryClass(db, fixture.raceId, fixture.candidate.id, fixture.d21.id)
        : () => importIofXml(db, fixture.raceId, courseXml.replace(
          "</CourseData>",
          `<!-- concurrency-${crypto.randomUUID()} --></CourseData>`
        ));
      const [recalculation] = await Promise.all([
        recalculateEntryAsAdmin(db, input, usedAt),
        mutate()
      ]);
      expect(["recalculated", "conflict"]).toContain(recalculation.status);
      const requests = await db.select().from(schema.resultRecalculationRequests)
        .where(eq(schema.resultRecalculationRequests.raceId, fixture.raceId));
      expect(requests).toHaveLength(recalculation.status === "recalculated" ? 1 : 0);
      if (recalculation.status === "recalculated") {
        expect(recalculation.response.snapshotVersion).toBe(fixture.response.snapshotVersion);
      }
    }
  );
});
afterAll(async () => pool.end());

async function importedRace() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { race } = await createEvent(db, {
    name: `Test ${suffix}`, raceName: "Individuellt", raceDate: "2026-08-30", timeZone: "Europe/Stockholm"
  });
  await importIofXml(db, race.id, courseXml);
  await importIofXml(db, race.id, entryXml);
  return { raceId: race.id, overview: await trustedRaceFixtureOverview(race.id) };
}

async function trustedRaceFixtureOverview(raceId: string) {
  const [race] = await db.select({
    id: schema.races.id,
    name: schema.races.name,
    raceDate: schema.races.raceDate,
    snapshotVersion: schema.races.snapshotVersion,
    eventName: schema.events.name
  }).from(schema.races).innerJoin(schema.events, eq(schema.races.eventId, schema.events.id))
    .where(eq(schema.races.id, raceId));
  if (!race) throw new Error("Testloppet finns inte");
  const [classes, courses, entries, imports] = await Promise.all([
    db.select().from(schema.classes).where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.name)),
    db.select().from(schema.courses).where(eq(schema.courses.raceId, raceId)).orderBy(asc(schema.courses.name)),
    db.select({
      id: schema.entries.id,
      givenName: schema.entries.givenName,
      familyName: schema.entries.familyName,
      organisationName: schema.entries.organisationName,
      classId: schema.entries.classId,
      className: schema.classes.name,
      cardNumber: schema.cardAssignments.cardNumber
    }).from(schema.entries)
      .innerJoin(schema.classes, eq(schema.entries.classId, schema.classes.id))
      .leftJoin(schema.cardAssignments, eq(schema.entries.id, schema.cardAssignments.entryId))
      .where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.familyName)),
    db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId))
      .orderBy(desc(schema.importFiles.createdAt))
  ]);
  return { race, classes, courses, entries, imports };
}

function batch(deviceId: string, payload: {
  cardNumber: string;
  startPunchedAt: string;
  finishPunchedAt: string;
  punches: Array<{ code: number; punchedAt: string }>;
}, options: {
  localSequence?: number;
  packageVersion?: number;
  sessionId?: string;
  stationReceivedAt?: string;
} = {}) {
  const localSequence = options.localSequence ?? 1;
  return {
    deviceId,
    sessionId: options.sessionId ?? deviceId,
    packageVersion: options.packageVersion ?? 3,
    firstSequence: localSequence,
    lastSequence: localSequence,
    events: [{
      localSequence,
      stationReceivedAt: options.stationReceivedAt ?? "2026-08-30T10:41:00Z",
      transport: "simulator" as const,
      payload,
      contentHash: contentHash(payload)
    }]
  };
}

const okPayload = {
  cardNumber: "12345",
  startPunchedAt: "2026-08-30T10:00:00Z",
  finishPunchedAt: "2026-08-30T10:40:00Z",
  punches: [31, 32, 33].map((code, index) => ({ code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z` }))
};

describe("TASK 006Q direktanmälan PostgreSQL", () => {
  const now = new Date("2026-09-04T10:00:00Z");
  async function auth(raceId: string, capability: "REGISTER_ENTRY" | "RECALCULATE_RESULT" = "REGISTER_ENTRY") {
    const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Registreringstest",
      expiresAt: new Date(now.getTime() + 3600_000) }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
      { now, expectedRaceId: raceId, expectedCapability: capability });
    if (login.status !== "authenticated") throw new Error("Registreringssession saknas");
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function input(authentication: Awaited<ReturnType<typeof auth>>) {
    const list = await listEntryRegistrationClassesAsAdmin(db, authentication, now);
    if (list.status !== "ok") throw new Error("Klassunderlag saknas");
    const raceClass = list.response.classes.find((row) => row.name === "H21")!;
    return { ...authentication, idempotencyKey: `entry-registration:${crypto.randomUUID()}`,
      request: { formatVersion: 1, classId: raceClass.id, expectedCourseVersionId: raceClass.courseVersionId,
        expectedStartRule: raceClass.startRule, expectedSnapshotVersion: list.response.snapshotVersion,
        givenName: " Anna ", familyName: " Andersson ", organisationName: "Test OK", cardNumber: "54321",
        fixedStartTime: raceClass.startRule === "FIXED" ? "2026-08-30T12:00:00+02:00" : null } };
  }
  it("skapar atomiskt utan resultat, återger exakt retry och deltar i paket och vanlig ingest", async () => {
    const { raceId } = await importedRace();
    const request = await input(await auth(raceId));
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const original = await publicResults(db, raceId);
    const result = await registerEntryAsAdmin(db, request, now);
    if (result.status !== "registered") throw new Error("Registrering misslyckades");
    expect(result.response).toMatchObject({ givenName: "Anna", familyName: "Andersson", entryVersion: 1 });
    expect(await publicResults(db, raceId)).toEqual(original);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, result.response.entryId))).toHaveLength(0);
    const packet = verifySignedStationPackage(await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem), stationPackagePublicKeySpkiBase64);
    expect(packet.packageVersion).toBe(request.request.expectedSnapshotVersion + 1);
    expect(packet.raceSnapshot.entries.find((row) => row.id === result.response.entryId)).toBeDefined();
    expect(packet.raceSnapshot.cardAssignments.find((row) => row.cardNumber === "54321")).toMatchObject({ entryId: result.response.entryId, active: true });
    const ack = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321" }));
    expect(ack.acknowledgements[0]).toMatchObject({ status: "stored", serverResult: { status: "OK" } });
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, result.response.entryId));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.evaluation).toMatchObject({ elapsedMs: 40 * 60_000 });
    await db.update(schema.entries).set({ givenName: "Senare namn", version: 2 }).where(eq(schema.entries.id, result.response.entryId));
    expect(await registerEntryAsAdmin(db, request, now)).toEqual({ status: "registered", response: { ...result.response, replayed: true } });
    const journals = await db.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.raceId, raceId));
    expect(journals).toHaveLength(1);
    await expect(db.delete(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.id, journals[0]!.id))).rejects.toThrow();
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.action, "ENTRY_REGISTERED_BY_ADMIN")))).toHaveLength(1);
  });
  it("avvisar stale/auth/ägd bricka utan orphan-entry och serialiserar samtidiga registreringar", async () => {
    const { raceId } = await importedRace();
    const request = await input(await auth(raceId));
    const before = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    expect((await registerEntryAsAdmin(db, { ...request, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await listEntryRegistrationClassesAsAdmin(db, await auth(raceId, "RECALCULATE_RESULT"), now)).status).toBe("forbidden");
    await db.update(schema.cardAssignments).set({ active: false }).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, "67890")));
    for (const change of [{ expectedSnapshotVersion: 99 }, { classId: crypto.randomUUID() },
      { expectedCourseVersionId: crypto.randomUUID() }, { cardNumber: "12345" }, { cardNumber: "67890" }]) {
      expect((await registerEntryAsAdmin(db, { ...request, request: { ...request.request, ...change } }, now)).status).toBe("conflict");
    }
    expect(await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId))).toEqual(before);
    const other = { ...request, idempotencyKey: `entry-registration:${crypto.randomUUID()}` };
    const results = await Promise.all([request, other].map((r) => registerEntryAsAdmin(db, r, now)));
    expect(results.map((row) => row.status).sort()).toEqual(["conflict", "registered"]);
    const winner = results[0]?.status === "registered" ? request : other;
    expect((await registerEntryAsAdmin(db, { ...winner, request: { ...winner.request, givenName: "Ändrad" } }, now)).status).toBe("conflict");
    expect((await registerEntryAsAdmin(db, { ...winner, ...await auth(raceId) }, now)).status).toBe("conflict");
    expect(await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId))).toHaveLength(before.length + 1);
    expect(await db.select().from(schema.entryRegistrationRequests).where(eq(schema.entryRegistrationRequests.raceId, raceId))).toHaveLength(1);
  });
  it("kräver FIXED-tid, tillåter utan bricka och löser tidigare okänd avläsning endast genom separat omräkning", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const initial = await input(authentication);
    const unknownBatch = batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321" });
    const unknown = await ingestDeviceBatch(db, raceId, unknownBatch);
    expect(unknown.acknowledgements[0]).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    const registration = await registerEntryAsAdmin(db, initial, now);
    if (registration.status !== "registered") throw new Error("Registrering misslyckades");
    const recalcAuth = await auth(raceId, "RECALCULATE_RESULT");
    const list = await listResultRecalculationCandidatesAsAdmin(db, recalcAuth, now);
    if (list.status !== "ok") throw new Error("Omräkningslista saknas");
    const candidate = list.response.entries.find((row) => row.id === registration.response.entryId)!;
    expect(candidate.latestResultRevision).toBeNull();
    expect((await recalculateEntryAsAdmin(db, { ...recalcAuth, entryId: candidate.id,
      idempotencyKey: `result-recalculation:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedSnapshotVersion: list.response.snapshotVersion, expectedCardAssignmentId: candidate.cardAssignmentId,
        expectedReadoutId: candidate.latestReadout!.id, expectedLatestResultRevision: null,
        expectedEngineVersion: list.response.engineVersion } }, now)).status).toBe("recalculated");
    expect((await ingestDeviceBatch(db, raceId, unknownBatch)).acknowledgements[0]).toEqual({ ...unknown.acknowledgements[0], status: "duplicate" });
    await db.update(schema.classes).set({ startRule: "FIXED" }).where(eq(schema.classes.id, initial.request.classId));
    const fixed = await input(authentication);
    expect((await registerEntryAsAdmin(db, { ...fixed, request: { ...fixed.request, fixedStartTime: null } }, now)).status).toBe("conflict");
    const noCard = await registerEntryAsAdmin(db, { ...fixed, request: { ...fixed.request, cardNumber: null } }, now);
    expect(noCard).toMatchObject({ status: "registered", response: { cardNumber: null, assignmentId: null, fixedStartTime: "2026-08-30T10:00:00.000Z" } });
  });
});

describe("TASK 006P individuellt brickbyte PostgreSQL", () => {
  const now = new Date("2026-09-04T10:00:00Z");
  async function auth(raceId: string, capability: "CHANGE_ENTRY_CARD" | "RECALCULATE_RESULT" | "IMPORT_IOF" | "DECIDE_WITHOUT_TIMING" = "CHANGE_ENTRY_CARD") {
    const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Brickbytestest",
      expiresAt: new Date(now.getTime() + 3600_000) }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
      { now, expectedRaceId: raceId, expectedCapability: capability });
    if (login.status !== "authenticated") throw new Error("Brickbytessession saknas");
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function input(authentication: Awaited<ReturnType<typeof auth>>, cardNumber = "54321") {
    const listed = await listEntryCardsAsAdmin(db, authentication, now);
    if (listed.status !== "ok") throw new Error("Brickbyteslista saknas");
    const entry = listed.response.entries.find((row) => row.displayName.startsWith("Ada"));
    if (!entry) throw new Error("Ada saknas");
    return { ...authentication, entryId: entry.id, idempotencyKey: `entry-card-change:${crypto.randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedSnapshotVersion: listed.response.snapshotVersion, expectedAssignment: entry.activeAssignment, cardNumber } };
  }
  it("byter idempotent, bevarar gamla data, ger nytt paket och räknar om tidigare okänd ny bricka explicit", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const request = await input(authentication);
    const oldBatch = batch(crypto.randomUUID(), okPayload);
    const originalAck = await ingestDeviceBatch(db, raceId, oldBatch);
    const unknownBatch = batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321", finishPunchedAt: "2026-08-30T10:45:00Z" });
    const unknownAck = await ingestDeviceBatch(db, raceId, unknownBatch);
    expect(unknownAck.acknowledgements[0]).toMatchObject({ status: "stored", serverResult: { status: "UNKNOWN_CARD" } });
    const oldResults = await publicResults(db, raceId);
    const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)).orderBy(asc(schema.rawDeviceMessages.id));
    const result = await changeEntryCardAsAdmin(db, request, now);
    expect(result.status).toBe("changed");
    if (result.status !== "changed") throw new Error("Byte misslyckades");
    expect(await changeEntryCardAsAdmin(db, request, now)).toEqual({ status: "changed", response: { ...result.response, replayed: true } });
    expect(await publicResults(db, raceId)).toEqual(oldResults);
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)).orderBy(asc(schema.rawDeviceMessages.id))).toEqual(raw);
    const packet = verifySignedStationPackage(await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem), stationPackagePublicKeySpkiBase64);
    expect(packet.packageVersion).toBe(request.request.expectedSnapshotVersion + 1);
    expect(packet.raceSnapshot.cardAssignments.find((row) => row.cardNumber === "12345")?.active).toBe(false);
    expect(packet.raceSnapshot.cardAssignments.find((row) => row.cardNumber === "54321")?.active).toBe(true);
    const late = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    expect(late).toMatchObject({ packageVersionStatus: "stale" });
    expect(late.acknowledgements[0]).toMatchObject({ status: "stored", serverResult: { status: "UNKNOWN_CARD" } });
    expect((await ingestDeviceBatch(db, raceId, oldBatch)).acknowledgements[0]).toEqual({ ...originalAck.acknowledgements[0], status: "duplicate" });
    expect((await ingestDeviceBatch(db, raceId, unknownBatch)).acknowledgements[0]).toEqual({ ...unknownAck.acknowledgements[0], status: "duplicate" });
    const recalcAuth = await auth(raceId, "RECALCULATE_RESULT");
    const list = await listResultRecalculationCandidatesAsAdmin(db, recalcAuth, now);
    if (list.status !== "ok") throw new Error("Omräkning saknas");
    const candidate = list.response.entries.find((row) => row.id === request.entryId)!;
    expect(candidate.latestReadout?.id).not.toBeUndefined();
    expect((await recalculateEntryAsAdmin(db, { ...recalcAuth, entryId: request.entryId,
      idempotencyKey: `result-recalculation:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedSnapshotVersion: list.response.snapshotVersion, expectedCardAssignmentId: candidate.cardAssignmentId,
        expectedReadoutId: candidate.latestReadout!.id, expectedLatestResultRevision: {
          id: candidate.latestResultRevision!.id, revision: candidate.latestResultRevision!.revision }, expectedEngineVersion: list.response.engineVersion } }, now)).status).toBe("recalculated");
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, request.entryId)).orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect(revisions[1]?.evaluation).toMatchObject({ elapsedMs: 45 * 60_000 });
    const back = await changeEntryCardAsAdmin(db, await input(authentication, "12345"), now);
    expect(back).toMatchObject({ status: "changed", response: { activeAssignment: request.request.expectedAssignment } });
    expect((await changeEntryCardAsAdmin(db, request, now))).toEqual({ status: "changed", response: { ...result.response, replayed: true } });
    const journals = await db.select().from(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.raceId, raceId));
    expect(journals).toHaveLength(2);
    await expect(db.delete(schema.entryCardChangeRequests).where(eq(schema.entryCardChangeRequests.id, journals[0]!.id))).rejects.toThrow();
    await expect(db.update(schema.cardAssignments).set({ cardNumber: "99999" }).where(eq(schema.cardAssignments.id, result.response.activeAssignment.id))).rejects.toThrow();
    await expect(db.delete(schema.cardAssignments).where(eq(schema.cardAssignments.id, result.response.activeAssignment.id))).rejects.toThrow();
  });
  it("avvisar fel auth/stale/no-op och annans historiska bricka; två writers får en vinnare", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const request = await input(authentication);
    expect((await changeEntryCardAsAdmin(db, { ...request, csrfHeader: null }, now)).status).toBe("forbidden");
    expect((await listEntryCardsAsAdmin(db, await auth(raceId, "RECALCULATE_RESULT"), now)).status).toBe("forbidden");
    for (const changed of [{ expectedEntryVersion: 99 }, { expectedSnapshotVersion: 99 }, { expectedClassId: crypto.randomUUID() },
      { expectedAssignment: null }, { cardNumber: "12345" }, { cardNumber: "67890" }]) {
      expect((await changeEntryCardAsAdmin(db, { ...request, request: { ...request.request, ...changed } }, now)).status).toBe("conflict");
    }
    await db.update(schema.cardAssignments).set({ active: false }).where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.cardNumber, "67890")));
    expect((await changeEntryCardAsAdmin(db, { ...request, request: { ...request.request, cardNumber: "67890" } }, now)).status).toBe("conflict");
    const other = { ...request, idempotencyKey: `entry-card-change:${crypto.randomUUID()}` };
    const results = await Promise.all([request, other].map((r) => changeEntryCardAsAdmin(db, r, now)));
    expect(results.map((row) => row.status).sort()).toEqual(["changed", "conflict"]);
    const winner = results[0]?.status === "changed" ? request : other;
    expect((await changeEntryCardAsAdmin(db, { ...winner, request: { ...winner.request, cardNumber: "33333" } }, now)).status).toBe("conflict");
    expect((await changeEntryCardAsAdmin(db, { ...winner, ...await auth(raceId) }, now)).status).toBe("conflict");
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, raceId), eq(schema.auditEvents.action, "ENTRY_CARD_CHANGED_BY_ADMIN")))).toHaveLength(1);
    const recalc = await listResultRecalculationCandidatesAsAdmin(db, await auth(raceId, "RECALCULATE_RESULT"), now);
    if (recalc.status !== "ok") throw new Error("Omräkningslista saknas");
    expect(recalc.response.entries.find((row) => row.id === request.entryId)).toMatchObject({ readiness: "NO_READOUT", latestReadout: null });
    await db.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.entryId, request.entryId));
    expect((await changeEntryCardAsAdmin(db, await input(authentication, "33333"), now)).status).toBe("changed");
    await db.insert(schema.cardAssignments).values({ raceId, entryId: request.entryId, cardNumber: "44444" });
    const multiple = await listEntryCardsAsAdmin(db, authentication, now);
    if (multiple.status !== "ok") throw new Error("Brickbyteslista saknas");
    expect(multiple.response.entries.find((row) => row.id === request.entryId)).toMatchObject({ multipleActiveAssignments: true, activeAssignment: null });
    expect((await changeEntryCardAsAdmin(db, await input(authentication, "55555"), now)).status).toBe("conflict");
  });
  it("EntryList kan varken återställa byte eller flytta ägare och rullar tillbaka övriga filändringar", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    await changeEntryCardAsAdmin(db, await input(authentication), now);
    const before = await trustedRaceFixtureOverview(raceId);
    await expect(importIofXml(db, raceId, entryXml.replace("Ada", "Ändrat namn"))).rejects.toThrow(/brickbyte/);
    expect(await trustedRaceFixtureOverview(raceId)).toEqual(before);
    await expect(importIofXml(db, raceId, entryXml.replace("12345", "67890"))).rejects.toThrow();
    expect(await trustedRaceFixtureOverview(raceId)).toEqual(before);
    await importIofXml(db, raceId, entryXml.replace("12345", "54321"));
    const current = await listEntryCardsAsAdmin(db, authentication, now);
    if (current.status !== "ok") throw new Error("Brickbyteslista saknas");
    expect(current.response.entries.find((row) => row.displayName.startsWith("Ada")))
      .toMatchObject({ activeAssignment: { cardNumber: "54321" }, multipleActiveAssignments: false });
    await importIofXml(db, raceId, entryXml);
    expect(await listEntryCardsAsAdmin(db, authentication, now)).toEqual(current);
  });
  it("behåller manuellt NT när ny bricka anländer samtidigt med brickbyte", async () => {
    const { raceId } = await importedRace();
    const authentication = await auth(raceId);
    const request = await input(authentication);
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ntAuth = await auth(raceId, "DECIDE_WITHOUT_TIMING");
    const list = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, now);
    if (list.status !== "ok") throw new Error("NT-lista saknas");
    const candidate = list.response.entries.find((row) => row.id === request.entryId)!;
    expect((await decideWithoutTimingAsAdmin(db, { ...ntAuth, entryId: request.entryId,
      idempotencyKey: `without-timing:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: list.response.snapshotVersion,
        expectedResultRevision: { id: candidate.targetResultRevision!.id, revision: candidate.targetResultRevision!.revision,
          status: "OK", reason: "COMPLETE" }, policyVersion: "without-timing-v1" } }, now)).status).toBe("without-timing");
    const before = await publicResults(db, raceId);
    expect(before.results[0]?.status).toBe("NT");
    const [changed, ingested] = await Promise.all([changeEntryCardAsAdmin(db, request, now),
      ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), { ...okPayload, cardNumber: "54321" }))]);
    expect(changed.status).toBe("changed");
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    expect(await publicResults(db, raceId)).toEqual(before);
  });
});

describe("TASK 006O individuell fast starttid PostgreSQL", () => {
  const now = new Date("2026-09-04T10:02:00Z");
  async function access(raceId: string, capability: "CHANGE_ENTRY_START_TIME" | "RECALCULATE_RESULT" | "FINALIZE_RESULTS" | "DECIDE_WITHOUT_TIMING") {
    const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "Starttidstest",
      expiresAt: new Date("2026-09-04T18:00:00Z") }, { now: new Date("2026-09-04T10:00:00Z") });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
      { expectedRaceId: raceId, expectedCapability: capability, now });
    if (login.status !== "authenticated") throw new Error("Starttidssession saknas");
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function fixture() {
    const { raceId } = await importedRace();
    await importIofXml(db, raceId, startListXml);
    const auth = await access(raceId, "CHANGE_ENTRY_START_TIME");
    const listed = await listEntryStartTimesAsAdmin(db, auth, now);
    if (listed.status !== "ok" || !listed.response.entries[0]) throw new Error("Starttidslista saknas");
    expect(listed.response.timeZone).toBe("Europe/Stockholm");
    const entry = listed.response.entries.find((row) => row.displayName.startsWith("Ada"));
    if (!entry) throw new Error("Ada saknas");
    const input = { ...auth, entryId: entry.id, idempotencyKey: `entry-start-time-change:${crypto.randomUUID()}`,
      request: { formatVersion: 1, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedSnapshotVersion: listed.response.snapshotVersion, expectedFixedStartTime: entry.fixedStartTime,
        fixedStartTime: "2026-08-31T10:05:00+02:00" } };
    return { raceId, auth, entry, input };
  }
  const payload = { ...okPayload, startPunchedAt: "2026-08-31T08:00:00Z", finishPunchedAt: "2026-08-31T08:40:00Z",
    punches: [31, 32, 33].map((code, i) => ({ code, punchedAt: `2026-08-31T08:${10 + i * 10}:00Z` })) };

  it("bevarar resultat och Complete, omräknar explicit och ger nytt paket samt stale ingest", async () => {
    const f = await fixture();
    for (const cardNumber of ["12345", "67890"]) {
      await ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), { ...payload, cardNumber },
        { packageVersion: f.input.request.expectedSnapshotVersion, stationReceivedAt: "2026-08-31T08:41:00Z" }));
    }
    const finalAuth = await access(f.raceId, "FINALIZE_RESULTS");
    const candidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (candidates.status !== "ok") throw new Error("Finaliseringslista saknas");
    for (const candidate of candidates.response.classes.filter((row) => row.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      expect((await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: { formatVersion: 1, scope: "CLASS", classId: candidate.classId,
          expectedSnapshotVersion: candidates.response.snapshotVersion, expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null } }, { now })).status).toBe("finalized");
    }
    const ready = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (ready.status !== "ok") throw new Error("Finaliseringsgrund saknas");
    const finalized = await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: { formatVersion: 1, scope: "RACE", classId: null, expectedSnapshotVersion: ready.response.snapshotVersion,
        expectedBasisHash: ready.response.race.basisHash, expectedLatestScopeRevision: null } }, { now });
    expect(finalized.status).toBe("finalized");
    const frozen = await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, f.raceId));
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId)).orderBy(asc(schema.resultRevisions.id));
    const raw = await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, f.raceId));
    const readouts = await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, f.raceId));
    const publicBefore = await publicResults(db, f.raceId);
    const oldPackage = await buildSignedStationPackage(db, f.raceId, stationPackagePrivateKeyPem);
    const saved = await changeEntryStartTimeAsAdmin(db, f.input, now);
    expect(saved.status).toBe("changed");
    expect(await publicResults(db, f.raceId)).toEqual(publicBefore);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, f.raceId)).orderBy(asc(schema.resultRevisions.id))).toEqual(revisions);
    expect(await db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, f.raceId))).toEqual(raw);
    expect(await db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, f.raceId))).toEqual(readouts);
    const stale = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (stale.status !== "ok") throw new Error("Finaliseringslista saknas");
    expect(stale.response.classes.find((row) => row.classId === f.entry.classId)?.blockerCodes).toContain("STALE_RESULT_SNAPSHOT");
    const nextPackage = verifySignedStationPackage(await buildSignedStationPackage(db, f.raceId, stationPackagePrivateKeyPem), stationPackagePublicKeySpkiBase64);
    expect(nextPackage.packageVersion).toBe(f.input.request.expectedSnapshotVersion + 1);
    expect(nextPackage.raceSnapshot.entries.find((row) => row.id === f.entry.id)?.fixedStartTime).toBe("2026-08-31T08:05:00.000Z");
    expect(verifySignedStationPackage(oldPackage, stationPackagePublicKeySpkiBase64).raceSnapshot.entries.find((row) => row.id === f.entry.id)?.fixedStartTime).toBe("2026-08-31T08:00:00.000Z");
    const recalcAuth = await access(f.raceId, "RECALCULATE_RESULT");
    const list = await listResultRecalculationCandidatesAsAdmin(db, recalcAuth, now);
    if (list.status !== "ok") throw new Error("Omräkningslista saknas");
    const candidate = list.response.entries.find((row) => row.id === f.entry.id);
    if (!candidate?.latestReadout || !candidate.latestResultRevision) throw new Error("Omräkningsgrund saknas");
    const recalculated = await recalculateEntryAsAdmin(db, { ...recalcAuth, entryId: f.entry.id,
      idempotencyKey: `result-recalculation:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedSnapshotVersion: list.response.snapshotVersion, expectedCardAssignmentId: candidate.cardAssignmentId,
        expectedReadoutId: candidate.latestReadout.id, expectedLatestResultRevision: { id: candidate.latestResultRevision.id,
          revision: candidate.latestResultRevision.revision }, expectedEngineVersion: list.response.engineVersion } }, now);
    expect(recalculated.status).toBe("recalculated");
    const updated = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.entry.id)).orderBy(asc(schema.resultRevisions.revision));
    expect(updated).toHaveLength(2);
    expect(updated[1]).toMatchObject({ cause: "EXPLICIT_RECALCULATION", evaluation: { elapsedMs: 35 * 60_000, startTime: "2026-08-31T08:05:00.000Z" } });
    const ack = await ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), payload,
      { packageVersion: f.input.request.expectedSnapshotVersion, stationReceivedAt: "2026-08-31T08:45:00Z" }));
    expect(ack).toMatchObject({ packageVersionStatus: "stale", packageUpdateRequired: true });
    expect(await db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, f.raceId))).toEqual(frozen);
    if (saved.status !== "changed") throw new Error("Sparat svar saknas");
    expect(await changeEntryStartTimeAsAdmin(db, f.input, now)).toEqual({ status: "changed", response: { ...saved.response, replayed: true } });
  });

  it("avvisar fel behörighet och stale/no-op/PUNCH; en samtidig vinnare med immutable auditjournal", async () => {
    const f = await fixture();
    expect(await listEntryStartTimesAsAdmin(db, { ...f.auth, sessionToken: null }, now)).toEqual({ status: "unauthorized" });
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, csrfHeader: "x".repeat(43) }, now)).status).toBe("forbidden");
    const otherAuth = await access(f.raceId, "RECALCULATE_RESULT");
    expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, ...otherAuth }, now)).status).toBe("forbidden");
    for (const request of [{ ...f.input.request, fixedStartTime: f.entry.fixedStartTime },
      { ...f.input.request, expectedEntryVersion: 99 }, { ...f.input.request, expectedClassId: crypto.randomUUID() },
      { ...f.input.request, expectedSnapshotVersion: 99 }, { ...f.input.request, expectedFixedStartTime: null }]) {
      expect((await changeEntryStartTimeAsAdmin(db, { ...f.input, request }, now)).status).toBe("conflict");
    }
    await db.update(schema.classes).set({ startRule: "PUNCH" }).where(eq(schema.classes.id, f.entry.classId));
    expect((await listEntryStartTimesAsAdmin(db, f.auth, now))).toMatchObject({ status: "ok", response: { entries: [] } });
    expect((await changeEntryStartTimeAsAdmin(db, f.input, now)).status).toBe("conflict");
    await db.update(schema.classes).set({ startRule: "FIXED" }).where(eq(schema.classes.id, f.entry.classId));
    const inputs = [f.input, { ...f.input, idempotencyKey: `entry-start-time-change:${crypto.randomUUID()}` }];
    const results = await Promise.all(inputs.map((input) => changeEntryStartTimeAsAdmin(db, input, now)));
    expect(results.map((row) => row.status).sort()).toEqual(["changed", "conflict"]);
    const winner = inputs[results.findIndex((row) => row.status === "changed")]!;
    const journal = await db.select().from(schema.entryStartTimeChangeRequests).where(eq(schema.entryStartTimeChangeRequests.raceId, f.raceId));
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ entryVersionBefore: f.entry.version, entryVersionAfter: f.entry.version + 1,
      snapshotVersionBefore: f.input.request.expectedSnapshotVersion, snapshotVersionAfter: f.input.request.expectedSnapshotVersion + 1 });
    expect(await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, f.raceId), eq(schema.auditEvents.action, "ENTRY_START_TIME_CHANGED_BY_ADMIN")))).toHaveLength(1);
    await expect(db.update(schema.entryStartTimeChangeRequests).set({ changedAt: now }).where(eq(schema.entryStartTimeChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.entryStartTimeChangeRequests).where(eq(schema.entryStartTimeChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    expect((await changeEntryStartTimeAsAdmin(db, { ...winner, request: { ...winner.request, fixedStartTime: "2026-08-31T09:00:00Z" } }, now)).status).toBe("conflict");
    expect((await changeEntryStartTimeAsAdmin(db, { ...winner, ...await access(f.raceId, "CHANGE_ENTRY_START_TIME") }, now)).status).toBe("conflict");
    await db.update(schema.entries).set({ fixedStartTime: null }).where(eq(schema.entries.id, f.entry.id));
    const fromMissing = await changeEntryStartTimeAsAdmin(db, { ...f.input,
      idempotencyKey: `entry-start-time-change:${crypto.randomUUID()}`, request: { ...f.input.request,
        expectedEntryVersion: f.entry.version + 1, expectedSnapshotVersion: f.input.request.expectedSnapshotVersion + 1,
        expectedFixedStartTime: null } }, now);
    expect(fromMissing).toMatchObject({ status: "changed", response: { previousFixedStartTime: null } });
  });

  it("bevarar aktivt manuellt NT vid starttidsändring och samtidig ingest", async () => {
    const f = await fixture();
    await ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), payload));
    const ntAuth = await access(f.raceId, "DECIDE_WITHOUT_TIMING");
    const list = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, now);
    if (list.status !== "ok") throw new Error("NT-lista saknas");
    const candidate = list.response.entries.find((row) => row.id === f.entry.id);
    if (!candidate?.targetResultRevision) throw new Error("NT-target saknas");
    expect((await decideWithoutTimingAsAdmin(db, { ...ntAuth, entryId: f.entry.id,
      idempotencyKey: `without-timing:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: list.response.snapshotVersion,
        expectedResultRevision: { id: candidate.targetResultRevision.id, revision: candidate.targetResultRevision.revision,
          status: "OK", reason: "COMPLETE" }, policyVersion: "without-timing-v1" } }, now)).status).toBe("without-timing");
    const before = await publicResults(db, f.raceId);
    expect(before.results).toHaveLength(1);
    expect(before.results[0]?.status).toBe("NT");
    const [changed, ingested] = await Promise.all([
      changeEntryStartTimeAsAdmin(db, f.input, now),
      ingestDeviceBatch(db, f.raceId, batch(crypto.randomUUID(), payload, { packageVersion: f.input.request.expectedSnapshotVersion }))
    ]);
    expect(changed.status).toBe("changed");
    expect(ingested.acknowledgements[0]?.status).toBe("stored");
    expect(await publicResults(db, f.raceId)).toEqual(before);
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, f.entry.id)).orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((row) => row.revision)).toEqual([1, 2, 3]);
    const last = revisions[2]!;
    const isNew = last.snapshotVersion === f.input.request.expectedSnapshotVersion + 1;
    expect(last.snapshotVersion).toBe(isNew ? f.input.request.expectedSnapshotVersion + 1 : f.input.request.expectedSnapshotVersion);
    expect(last.evaluation).toMatchObject({ elapsedMs: (isNew ? 35 : 40) * 60_000 });
  });
});

describe("TASK 005K autentiserat idempotent eventskapande PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T06:00:00.000Z");
  const usedAt = new Date("2026-08-31T06:02:00.000Z");
  const baseIntent = {
    formatVersion: 1 as const,
    eventName: "Nattcupen final",
    raceName: "Individuellt",
    raceDate: "2026-09-12",
    timeZone: "Europe/Stockholm"
  };

  async function eventCreationAdmin(marker: number) {
    const installation = await issueEventCreationAccessCredential(db, {
      label: `Tävlingsskapare ${marker}`,
      expiresAt: new Date("2026-08-31T14:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginEventCreationAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      now: new Date("2026-08-31T06:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Eventskaparsession kunde inte skapas");
    return { installation, login };
  }

  function createInput(
    admin: Awaited<ReturnType<typeof eventCreationAdmin>>,
    requestId: string,
    body: unknown = baseIntent,
    onRead?: () => void
  ) {
    return {
      sessionToken: admin.login.sessionToken,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken,
      idempotencyKey: `event-create:${requestId}`,
      readBody: async () => { onRead?.(); return body; }
    };
  }

  it("skapar atomiskt, auditerar utan hemligheter och gör 100 samtidiga retries exakta", async () => {
    const admin = await eventCreationAdmin(171);
    expect(admin.login.response).toEqual({
      formatVersion: 1,
      capability: "CREATE_EVENT",
      expiresAt: "2026-08-31T07:01:00.000Z"
    });
    const requestId = crypto.randomUUID();
    const responses = await Promise.all(Array.from({ length: 100 }, () =>
      createEventAsAdmin(db, createInput(admin, requestId), usedAt)
    ));
    expect(responses.every((response) => response.status === "created")).toBe(true);
    const created = responses.flatMap((response) => response.status === "created" ? [response.response] : []);
    expect(created.filter((response) => !response.replayed)).toHaveLength(1);
    expect(created.filter((response) => response.replayed)).toHaveLength(99);
    expect(new Set(created.map((response) => response.eventId)).size).toBe(1);
    expect(new Set(created.map((response) => response.raceId)).size).toBe(1);
    expect(new Set(created.map((response) => response.createdAt))).toEqual(new Set([usedAt.toISOString()]));

    const requests = await db.select().from(schema.eventCreationRequests)
      .where(eq(schema.eventCreationRequests.requestId, requestId));
    const events = await db.select().from(schema.events)
      .where(eq(schema.events.id, created[0]!.eventId));
    const races = await db.select().from(schema.races)
      .where(eq(schema.races.id, created[0]!.raceId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.requestId, requestId),
      eq(schema.auditEvents.action, "EVENT_CREATED_BY_ADMIN")
    ));
    const [credential] = await db.select().from(schema.eventCreationAccessCredentials)
      .where(eq(schema.eventCreationAccessCredentials.id, admin.installation.credentialId));
    const [session] = await db.select().from(schema.eventCreationSessions)
      .where(eq(schema.eventCreationSessions.accessCredentialId, admin.installation.credentialId));
    expect(credential?.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.sessionSecretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session?.csrfSecretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      actorCredentialId: admin.installation.credentialId,
      eventName: baseIntent.eventName,
      raceName: baseIntent.raceName,
      raceDate: baseIntent.raceDate,
      timeZone: baseIntent.timeZone,
      eventId: created[0]!.eventId,
      raceId: created[0]!.raceId,
      createdAt: usedAt
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: baseIntent.eventName,
      startsOn: baseIntent.raceDate,
      timeZone: baseIntent.timeZone,
      createdAt: usedAt
    });
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({
      eventId: created[0]!.eventId,
      name: baseIntent.raceName,
      raceDate: baseIntent.raceDate,
      snapshotVersion: 1,
      createdAt: usedAt
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      raceId: created[0]!.raceId,
      entityType: "event",
      entityId: created[0]!.eventId,
      action: "EVENT_CREATED_BY_ADMIN",
      actorKind: "EVENT_CREATION_ACCESS_CREDENTIAL",
      actorId: admin.installation.credentialId,
      requestId
    });
    const storedSecurity = JSON.stringify({ credential, session });
    const mutationEvidence = JSON.stringify({ requests, audits });
    for (const value of [admin.installation.accessCredential, admin.login.sessionToken, admin.login.csrfToken]) {
      expect(storedSecurity).not.toContain(value);
      expect(mutationEvidence).not.toContain(value);
    }
    expect(mutationEvidence).not.toContain("secretHash");

    const [sessionsBeforeExpiry] = await db.select({ value: count() }).from(schema.eventCreationSessions)
      .where(eq(schema.eventCreationSessions.accessCredentialId, admin.installation.credentialId));
    await expect(loginEventCreationAdmin(db, {
      formatVersion: 1,
      accessCredential: admin.installation.accessCredential
    }, { now: new Date("2026-08-31T14:00:00.000Z") })).resolves.toEqual({ status: "unauthorized" });
    const [sessionsAfterExpiry] = await db.select({ value: count() }).from(schema.eventCreationSessions)
      .where(eq(schema.eventCreationSessions.accessCredentialId, admin.installation.credentialId));
    expect(sessionsAfterExpiry?.value).toBe(sessionsBeforeExpiry?.value);
  });

  it("returnerar originalcreatedAt vid replay och konflikt för varje ändrat intentfält eller aktör", async () => {
    const firstAdmin = await eventCreationAdmin(181);
    const secondAdmin = await eventCreationAdmin(191);
    const requestId = crypto.randomUUID();
    const first = await createEventAsAdmin(db, createInput(firstAdmin, requestId), usedAt);
    if (first.status !== "created") throw new Error("Första eventet skapades inte");
    const replay = await createEventAsAdmin(db, createInput(firstAdmin, requestId), new Date(usedAt.getTime() + 60_000));
    expect(replay).toEqual({
      status: "created",
      response: { ...first.response, replayed: true }
    });

    const changedBodies = [
      { ...baseIntent, eventName: "Annan nattcup" },
      { ...baseIntent, raceName: "Annat lopp" },
      { ...baseIntent, raceDate: "2026-09-13" },
      { ...baseIntent, timeZone: "Europe/Oslo" }
    ];
    for (const body of changedBodies) {
      await expect(createEventAsAdmin(db, createInput(firstAdmin, requestId, body), usedAt))
        .resolves.toEqual({ status: "conflict" });
    }
    await expect(createEventAsAdmin(db, createInput(secondAdmin, requestId), usedAt))
      .resolves.toEqual({ status: "conflict" });
    const separateDecision = await createEventAsAdmin(db, createInput(
      secondAdmin,
      crypto.randomUUID()
    ), usedAt);
    expect(separateDecision.status).toBe("created");
    if (separateDecision.status === "created") {
      expect(separateDecision.response.eventId).not.toBe(first.response.eventId);
      expect(separateDecision.response.raceId).not.toBe(first.response.raceId);
    }
    expect(await db.select().from(schema.eventCreationRequests)
      .where(eq(schema.eventCreationRequests.requestId, requestId))).toHaveLength(1);
    expect(await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.requestId, requestId),
      eq(schema.auditEvents.action, "EVENT_CREATED_BY_ADMIN")
    ))).toHaveLength(1);
  });

  it("autentiserar och validerar key före body samt avvisar ogiltig strict body", async () => {
    const admin = await eventCreationAdmin(201);
    let reads = 0;
    const countRead = () => { reads += 1; };
    await expect(createEventAsAdmin(db, {
      ...createInput(admin, crypto.randomUUID(), baseIntent, countRead),
      sessionToken: "felaktig-session"
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });
    await expect(createEventAsAdmin(db, {
      ...createInput(admin, crypto.randomUUID(), baseIntent, countRead),
      csrfHeader: "A".repeat(43)
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(createEventAsAdmin(db, {
      ...createInput(admin, crypto.randomUUID(), baseIntent, countRead),
      idempotencyKey: "event-create:INTE-UUID"
    }, usedAt)).resolves.toEqual({ status: "invalid-request" });
    expect(reads).toBe(0);

    await expect(createEventAsAdmin(db, createInput(admin, crypto.randomUUID(), {
      ...baseIntent,
      extra: "avvisas"
    }, countRead), usedAt)).resolves.toEqual({ status: "invalid-request" });
    expect(reads).toBe(1);
  });

  it("stoppar efter logout och credentialrevocation utan att läsa body", async () => {
    const loggedOut = await eventCreationAdmin(211);
    await expect(logoutEventCreationAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken,
      csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    let reads = 0;
    await expect(createEventAsAdmin(db, createInput(loggedOut, crypto.randomUUID(), baseIntent, () => {
      reads += 1;
    }), usedAt)).resolves.toEqual({ status: "unauthorized" });

    const revoked = await eventCreationAdmin(221);
    await expect(revokeEventCreationAccessCredential(db, {
      credentialId: revoked.installation.credentialId
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(createEventAsAdmin(db, createInput(revoked, crypto.randomUUID(), baseIntent, () => {
      reads += 1;
    }), usedAt)).resolves.toEqual({ status: "unauthorized" });
    await expect(loginEventCreationAdmin(db, {
      formatVersion: 1,
      accessCredential: revoked.installation.accessCredential
    }, { now: usedAt })).resolves.toEqual({ status: "unauthorized" });
    expect(reads).toBe(0);
  });

  it("rullar tillbaka event och race när auditinsert misslyckas", async () => {
    const admin = await eventCreationAdmin(231);
    const requestId = crypto.randomUUID();
    const eventName = `Rollback ${crypto.randomUUID()}`;
    await db.execute(sql`drop trigger if exists task_005k_reject_audit on audit_event`);
    await db.execute(sql`drop function if exists task_005k_reject_audit()`);
    await db.execute(sql`
      create function task_005k_reject_audit() returns trigger language plpgsql as $$
      begin
        if NEW.action = 'EVENT_CREATED_BY_ADMIN' then raise exception 'task 005k rollback'; end if;
        return NEW;
      end $$
    `);
    await db.execute(sql`
      create trigger task_005k_reject_audit before insert on audit_event
      for each row execute function task_005k_reject_audit()
    `);
    try {
      await expect(createEventAsAdmin(db, createInput(admin, requestId, {
        ...baseIntent,
        eventName
      }), usedAt)).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists task_005k_reject_audit on audit_event`);
      await db.execute(sql`drop function if exists task_005k_reject_audit()`);
    }
    expect(await db.select().from(schema.events).where(eq(schema.events.name, eventName))).toHaveLength(0);
    expect(await db.select().from(schema.eventCreationRequests)
      .where(eq(schema.eventCreationRequests.requestId, requestId))).toHaveLength(0);
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)))
      .toHaveLength(0);
  });

  it("avvisar update/delete av credential-, session-, revocation-, journal- och auditbevis", async () => {
    const admin = await eventCreationAdmin(241);
    const requestId = crypto.randomUUID();
    const created = await createEventAsAdmin(db, createInput(admin, requestId), usedAt);
    if (created.status !== "created") throw new Error("Eventet skapades inte");
    await logoutEventCreationAdminSession(db, {
      sessionToken: admin.login.sessionToken,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    }, usedAt);
    await revokeEventCreationAccessCredential(db, {
      credentialId: admin.installation.credentialId
    }, usedAt);
    const [session] = await db.select().from(schema.eventCreationSessions)
      .where(eq(schema.eventCreationSessions.accessCredentialId, admin.installation.credentialId));
    const [sessionRevocation] = await db.select().from(schema.eventCreationSessionRevocations)
      .where(eq(schema.eventCreationSessionRevocations.sessionId, session?.id ?? crypto.randomUUID()));
    const [credentialRevocation] = await db.select().from(schema.eventCreationAccessCredentialRevocations)
      .where(eq(schema.eventCreationAccessCredentialRevocations.credentialId, admin.installation.credentialId));
    const [request] = await db.select().from(schema.eventCreationRequests)
      .where(eq(schema.eventCreationRequests.requestId, requestId));
    const [audit] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId));
    if (!session || !sessionRevocation || !credentialRevocation || !request || !audit) {
      throw new Error("005K-bevisrader saknas");
    }
    await expect(db.update(schema.eventCreationAccessCredentials).set({ label: "Ändrad" })
      .where(eq(schema.eventCreationAccessCredentials.id, admin.installation.credentialId))).rejects.toThrow();
    await expect(db.delete(schema.eventCreationSessions)
      .where(eq(schema.eventCreationSessions.id, session.id))).rejects.toThrow();
    await expect(db.update(schema.eventCreationSessionRevocations).set({ reason: "Ändrad" })
      .where(eq(schema.eventCreationSessionRevocations.id, sessionRevocation.id))).rejects.toThrow();
    await expect(db.delete(schema.eventCreationAccessCredentialRevocations)
      .where(eq(schema.eventCreationAccessCredentialRevocations.id, credentialRevocation.id))).rejects.toThrow();
    await expect(db.update(schema.eventCreationRequests).set({ eventName: "Ändrat" })
      .where(eq(schema.eventCreationRequests.id, request.id))).rejects.toThrow();
    await expect(db.delete(schema.auditEvents).where(eq(schema.auditEvents.id, audit.id))).rejects.toThrow();
  });

  it("serialiserar samtidig create och revocation till full commit eller ingen domänwrite", async () => {
    const admin = await eventCreationAdmin(251);
    const requestId = crypto.randomUUID();
    const [creation, revocation] = await Promise.all([
      createEventAsAdmin(db, createInput(admin, requestId), usedAt),
      revokeEventCreationAccessCredential(db, { credentialId: admin.installation.credentialId }, usedAt)
    ]);
    expect(revocation.status).toBe("revoked");
    expect(["created", "unauthorized"]).toContain(creation.status);
    const requests = await db.select().from(schema.eventCreationRequests)
      .where(eq(schema.eventCreationRequests.requestId, requestId));
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.requestId, requestId),
      eq(schema.auditEvents.action, "EVENT_CREATED_BY_ADMIN")
    ));
    expect(requests).toHaveLength(creation.status === "created" ? 1 : 0);
    expect(audits).toHaveLength(creation.status === "created" ? 1 : 0);
    if (creation.status === "created") {
      expect(await db.select().from(schema.events).where(eq(schema.events.id, creation.response.eventId)))
        .toHaveLength(1);
      expect(await db.select().from(schema.races).where(eq(schema.races.id, creation.response.raceId)))
        .toHaveLength(1);
    }
  });
});

describe("TASK 005J capability-skyddad raceöversikt PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T20:00:00.000Z");
  const usedAt = new Date("2026-08-31T20:02:00.000Z");

  async function overviewAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      label: `Översiktsoperatör ${marker}`,
      expiresAt: new Date("2026-09-01T04:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "VIEW_RACE_OVERVIEW",
      now: new Date("2026-08-31T20:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Översiktssession kunde inte skapas");
    return { installation, login };
  }

  async function writeFootprint() {
    const [audits, sessions, sessionRevocations, credentialRevocations, revisions, imports] = await Promise.all([
      db.select({ value: count() }).from(schema.auditEvents),
      db.select({ value: count() }).from(schema.pairingAdminSessions),
      db.select({ value: count() }).from(schema.pairingAdminSessionRevocations),
      db.select({ value: count() }).from(schema.pairingAdminAccessCredentialRevocations),
      db.select({ value: count() }).from(schema.resultRevisions),
      db.select({ value: count() }).from(schema.importFiles)
    ]);
    return {
      audits: audits[0]?.value,
      sessions: sessions[0]?.value,
      sessionRevocations: sessionRevocations[0]?.value,
      credentialRevocations: credentialRevocations[0]?.value,
      revisions: revisions[0]?.value,
      imports: imports[0]?.value
    };
  }

  it("returnerar strikt PII-fri projektion och en separat minimal publik sammanfattning", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await overviewAdmin(fixture.raceId, 111);
    const result = await getRaceOverviewAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Raceöversikten kunde inte läsas");

    expect(result.response).toMatchObject({
      formatVersion: 1,
      race: {
        id: fixture.raceId,
        eventName: fixture.overview.race.eventName,
        name: fixture.overview.race.name,
        raceDate: fixture.overview.race.raceDate,
        timeZone: "Europe/Stockholm",
        snapshotVersion: fixture.overview.race.snapshotVersion
      },
      counts: {
        classes: fixture.overview.classes.length,
        courses: fixture.overview.courses.length,
        entries: fixture.overview.entries.length,
        activeCardAssignments: fixture.overview.entries.length,
        readouts: 1,
        resultRevisions: 1,
        imports: fixture.overview.imports.length
      }
    });
    expect(result.response.latestActivity.readoutAt).toBe("2026-08-30T10:41:00.000Z");
    expect(typeof result.response.latestActivity.resultRevisionAt).toBe("string");
    expect(typeof result.response.latestActivity.importAt).toBe("string");
    expect(result.response.classes.reduce((sum, raceClass) => sum + raceClass.entryCount, 0))
      .toBe(fixture.overview.entries.length);

    const encoded = JSON.stringify(result.response);
    const privateValues = fixture.overview.entries.flatMap((entry) => [
      entry.givenName,
      entry.familyName,
      entry.organisationName,
      entry.cardNumber
    ]).concat(fixture.overview.imports.flatMap((file) => [file.originalXml, file.contentHash]));
    for (const value of privateValues) {
      if (typeof value === "string" && value.length > 0) expect(encoded).not.toContain(value);
    }
    for (const forbiddenField of [
      "givenName", "familyName", "organisationName", "cardNumber", "punches",
      "rawPayload", "evaluation", "originalXml", "contentHash", "externalId"
    ]) expect(encoded).not.toContain(forbiddenField);
    expect(encoded).not.toContain(admin.installation.accessCredential);
    expect(encoded).not.toContain(admin.login.sessionToken);
    expect(encoded).not.toContain(admin.login.csrfToken);
    expect(encoded).not.toContain("Översiktsoperatör 111");

    const summary = await publicRaceSummary(db, fixture.raceId);
    expect(summary).toEqual({
      id: fixture.raceId,
      eventName: fixture.overview.race.eventName,
      name: fixture.overview.race.name,
      raceDate: fixture.overview.race.raceDate
    });
    expect(Object.keys(summary).sort()).toEqual(["eventName", "id", "name", "raceDate"]);
  });

  it("isolerar race och capability samt gör 100 samtidiga läsningar utan skrivningar", async () => {
    const fixture = await importedRace();
    const other = await importedRace();
    await ingestDeviceBatch(db, other.raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await overviewAdmin(fixture.raceId, 121);

    await expect(getRaceOverviewAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: other.raceId
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(getRaceOverviewAsAdmin(db, {
      sessionToken: "otid_org_session_v1.00000000-0000-4000-8000-000000000000." + "A".repeat(43),
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const pairingCredential = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "PAIR_STATION",
      label: "Fel capability",
      expiresAt: new Date("2026-09-01T20:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 124) });
    const pairingLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: pairingCredential.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "PAIR_STATION",
      now: new Date("2026-08-31T20:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 125),
      csrfSecretBytes: Buffer.alloc(32, 126)
    });
    if (pairingLogin.status !== "authenticated") throw new Error("Pairingsession kunde inte skapas");
    await expect(getRaceOverviewAsAdmin(db, {
      sessionToken: pairingLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "forbidden" });

    const before = await writeFootprint();
    const responses = await Promise.all(Array.from({ length: 100 }, () => getRaceOverviewAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt)));
    expect(responses.every((response) => response.status === "ok")).toBe(true);
    expect(responses.every((response) => response.status !== "ok" ||
      response.response.race.id === fixture.raceId && response.response.counts.readouts === 0)).toBe(true);
    expect(await writeFootprint()).toEqual(before);
  });

  it("stoppar läsning efter capability-säker logout och credential-revocation", async () => {
    const fixture = await importedRace();
    const loggedOut = await overviewAdmin(fixture.raceId, 131);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken,
      raceId: fixture.raceId,
      capability: "PAIR_STATION",
      csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken,
      raceId: fixture.raceId,
      capability: "VIEW_RACE_OVERVIEW",
      csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(getRaceOverviewAsAdmin(db, {
      sessionToken: loggedOut.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const revoked = await overviewAdmin(fixture.raceId, 141);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revoked.installation.credentialId,
      capability: "PAIR_STATION"
    }, usedAt)).rejects.toThrow(/finns inte/);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revoked.installation.credentialId,
      capability: "VIEW_RACE_OVERVIEW"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(getRaceOverviewAsAdmin(db, {
      sessionToken: revoked.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });
  });

  it.each(["class", "import"] as const)(
    "serialiserar samtidig %s-mutation till en sammanhängande snapshotprojektion",
    async (mutation) => {
      const fixture = await importedRace();
      const admin = await overviewAdmin(fixture.raceId, mutation === "class" ? 151 : 161);
      const before = await getRaceOverviewAsAdmin(db, {
        sessionToken: admin.login.sessionToken,
        raceId: fixture.raceId
      }, usedAt);
      if (before.status !== "ok") throw new Error("Utgångsöversikten saknas");

      const ada = fixture.overview.entries.find((entry) => entry.givenName === "Ada");
      const d21 = fixture.overview.classes.find((raceClass) => raceClass.name === "D21");
      if (!ada || !d21) throw new Error("Fixture saknar Ada eller D21");
      const mutate = mutation === "class"
        ? () => changeEntryClass(db, fixture.raceId, ada.id, d21.id)
        : () => importIofXml(db, fixture.raceId, courseXml.replace(
          "</CourseData>",
          `<!-- overview-${crypto.randomUUID()} --></CourseData>`
        ));
      const [read] = await Promise.all([
        getRaceOverviewAsAdmin(db, {
          sessionToken: admin.login.sessionToken,
          raceId: fixture.raceId
        }, usedAt),
        mutate()
      ]);
      if (read.status !== "ok") throw new Error("Samtidig översikt saknas");
      expect([before.response.race.snapshotVersion, before.response.race.snapshotVersion + 1])
        .toContain(read.response.race.snapshotVersion);
      expect(read.response.counts.entries)
        .toBe(read.response.classes.reduce((sum, raceClass) => sum + raceClass.entryCount, 0));
      if (read.response.race.snapshotVersion === before.response.race.snapshotVersion) {
        expect(read.response.classes).toEqual(before.response.classes);
        expect(read.response.counts.imports).toBe(before.response.counts.imports);
      } else if (mutation === "class") {
        const previousClass = before.response.classes.find((raceClass) => raceClass.id === ada.classId);
        const nextClass = read.response.classes.find((raceClass) => raceClass.id === d21.id);
        expect(previousClass).toBeDefined();
        expect(nextClass?.entryCount).toBe(
          (before.response.classes.find((raceClass) => raceClass.id === d21.id)?.entryCount ?? 0) + 1
        );
      } else {
        expect(read.response.counts.imports).toBe(before.response.counts.imports + 1);
      }
    }
  );
});

describe("TASK 001 PostgreSQL", () => {
  it("lagrar samma batch 100 gånger som exakt en råpost", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    for (let attempt = 0; attempt < 100; attempt += 1) await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload));
    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId));
    const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, revision: revisionCount?.value }).toEqual({ raw: 1, readout: 1, revision: 1 });
  });

  it("klassändring och explicit omräkning skapar en ny revision", async () => {
    const { raceId, overview } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !d21) throw new Error("Fixture saknar Ada eller D21");
    const beforeChange = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, ada.id));
    expect(beforeChange).toHaveLength(1);
    await changeEntryClass(db, raceId, ada.id, d21.id);
    const beforeExplicitRecalculation = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, ada.id));
    expect(beforeExplicitRecalculation).toHaveLength(1);
    await recalculateEntry(db, raceId, ada.id);
    const history = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, ada.id));
    const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId));
    expect(history.map((revision) => revision.revision).sort()).toEqual([1, 2]);
    expect(audits.some((audit) => audit.action === "CLASS_CHANGED")).toBe(true);
    expect(audits.some((audit) => audit.action === "RESULT_RECALCULATED")).toBe(true);
  });

  it("ogiltig XML lämnar loppet oförändrat", async () => {
    const { raceId } = await importedRace();
    const before = await trustedRaceFixtureOverview(raceId);
    await expect(importIofXml(db, raceId, "<EntryList iofVersion=\"3.0\"><broken>")).rejects.toThrow();
    const after = await trustedRaceFixtureOverview(raceId);
    expect({ classes: after.classes.length, courses: after.courses.length, entries: after.entries.length, imports: after.imports.length })
      .toEqual({ classes: before.classes.length, courses: before.courses.length, entries: before.entries.length, imports: before.imports.length });
  });

  it("samma XML-import skapar inga okontrollerade dubletter", async () => {
    const { raceId } = await importedRace();
    const before = await trustedRaceFixtureOverview(raceId);
    expect((await importIofXml(db, raceId, courseXml)).duplicate).toBe(true);
    expect((await importIofXml(db, raceId, entryXml)).duplicate).toBe(true);
    const after = await trustedRaceFixtureOverview(raceId);
    expect({ classes: after.classes.length, courses: after.courses.length, entries: after.entries.length, imports: after.imports.length })
      .toEqual({ classes: before.classes.length, courses: before.courses.length, entries: before.entries.length, imports: before.imports.length });
  });

  it("publikresultat visar senaste publicerade revision", async () => {
    const { raceId, overview } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !d21) throw new Error("Fixture saknar Ada eller D21");
    await changeEntryClass(db, raceId, ada.id, d21.id);
    await recalculateEntry(db, raceId, ada.id);
    const [latest] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, ada.id))
      .orderBy(desc(schema.resultRevisions.revision)).limit(1);
    if (!latest) throw new Error("Resultatrevision saknas");
    await db.insert(schema.resultRevisions).values({
      raceId,
      entryId: ada.id,
      readoutId: latest.readoutId,
      revision: 3,
      cause: "CLASS_CHANGE_RECALCULATION",
      status: latest.status,
      reason: latest.reason,
      evaluation: latest.evaluation,
      engineVersion: latest.engineVersion,
      snapshotVersion: latest.snapshotVersion,
      courseVersionId: latest.courseVersionId,
      published: false
    });
    const response = await publicResults(db, raceId);
    const [result] = response.results;
    expect(response.formatVersion).toBe(7);
    expect(result).toMatchObject({ revision: 2, className: "D21", status: "MP" });
    expect(result).not.toHaveProperty("entryId");
    expect(result).not.toHaveProperty("evaluation");
    expect(JSON.stringify(response)).not.toContain(ada.id);
  });
});

describe("TASK 004 konkurrenssäker multi-station-ingest", () => {
  it.each([2, 10])("serialiserar %i samtidiga stationer till obrutna revisioner", async (stationCount) => {
    const { raceId } = await importedRace();
    const responses = await Promise.all(Array.from({ length: stationCount }, async () =>
      ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload))
    ));

    expect(responses.flatMap((response) => response.acknowledgements.map((ack) => ack.status)))
      .toEqual(Array.from({ length: stationCount }, () => "stored"));
    const storedAcks = responses.flatMap((response) => {
      const acknowledgement = response.acknowledgements[0];
      return acknowledgement?.status === "stored" ? [acknowledgement] : [];
    });
    expect(new Set(storedAcks.map((ack) => ack.rawMessageId)).size).toBe(stationCount);
    expect(storedAcks.map((ack) => ack.contentHash))
      .toEqual(Array.from({ length: stationCount }, () => contentHash(okPayload)));
    const storedResults = storedAcks.flatMap((ack) => {
      const result = ack.serverResult;
      return result && result.status !== "UNKNOWN_CARD" ? [result] : [];
    });
    expect(storedResults.map((result) => result.revision).sort((left, right) => left - right))
      .toEqual(Array.from({ length: stationCount }, (_, index) => index + 1));
    expect(storedResults).toHaveLength(stationCount);
    const rawRows = await db.select().from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.raceId, raceId));
    const readoutRows = await db.select().from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const revisionRows = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawRows.length, readouts: readoutRows.length, revisions: revisionRows.length })
      .toEqual({ raw: stationCount, readouts: stationCount, revisions: stationCount });
    expect(revisionRows.map((row) => row.revision).sort((left, right) => left - right))
      .toEqual(Array.from({ length: stationCount }, (_, index) => index + 1));
  });

  it("gör 100 samtidiga omsändningar till en stored och 99 duplicate", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const retry = batch(deviceId, okPayload);
    const responses = await Promise.all(Array.from({ length: 100 }, async () =>
      ingestDeviceBatch(db, raceId, retry)
    ));
    const statuses = responses.map((response) => response.acknowledgements[0]?.status);
    expect(statuses.filter((status) => status === "stored")).toHaveLength(1);
    expect(statuses.filter((status) => status === "duplicate")).toHaveLength(99);
    const acknowledgements = responses.flatMap((response) => {
      const acknowledgement = response.acknowledgements[0];
      return acknowledgement && acknowledgement.status !== "rejected" ? [acknowledgement] : [];
    });
    expect(new Set(acknowledgements.map((ack) => ack.rawMessageId)).size).toBe(1);
    const persistedResults = acknowledgements.flatMap((ack) => {
      const result = ack.serverResult;
      return result && result.status !== "UNKNOWN_CARD" ? [result] : [];
    });
    expect(new Set(persistedResults.map((result) => result.resultRevisionId)).size).toBe(1);
    expect(new Set(persistedResults.map((result) => result.revision)).size).toBe(1);
    expect(persistedResults).toHaveLength(100);

    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, revision: revisionCount?.value })
      .toEqual({ raw: 1, readout: 1, revision: 1 });
  });

  it("fortsätter efter hashfel och kvitterar giltig, ogiltig, giltig i ordning", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const first = batch(deviceId, okPayload, { localSequence: 1 }).events[0]!;
    const secondPayload = { ...okPayload, finishPunchedAt: "2026-08-30T10:41:00Z" };
    const second = batch(deviceId, secondPayload, { localSequence: 2 }).events[0]!;
    const thirdPayload = { ...okPayload, finishPunchedAt: "2026-08-30T10:42:00Z" };
    const third = batch(deviceId, thirdPayload, { localSequence: 3 }).events[0]!;
    const response = await ingestDeviceBatch(db, raceId, {
      deviceId,
      sessionId: deviceId,
      packageVersion: 3,
      firstSequence: 1,
      lastSequence: 3,
      events: [first, { ...second, contentHash: "0".repeat(64) }, third]
    });

    expect(response.acknowledgements.map((ack) => [ack.localSequence, ack.status]))
      .toEqual([[1, "stored"], [2, "rejected"], [3, "stored"]]);
    expect(response.acknowledgements[1]).toMatchObject({ reason: "CONTENT_HASH_MISMATCH" });
    expect(response.highestContiguousSequence).toBe(1);
    const rawRows = await db.select({ sequence: schema.rawDeviceMessages.localSequence })
      .from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    expect(rawRows.map((row) => row.sequence).sort()).toEqual([1, 3]);
  });

  it("accepterar stale paket och beräknar med aktuell server-snapshot", async () => {
    const { raceId, overview } = await importedRace();
    const currentPackageVersion = overview.race.snapshotVersion;
    const response = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload, {
      packageVersion: currentPackageVersion - 1
    }));

    expect(response).toMatchObject({
      currentPackageVersion,
      packageVersionStatus: "stale",
      packageUpdateRequired: true,
      acknowledgements: [{ status: "stored", serverResult: { snapshotVersion: currentPackageVersion } }]
    });
  });

  it("accepterar ahead paket utan att rekommendera nedgradering", async () => {
    const { raceId, overview } = await importedRace();
    const currentPackageVersion = overview.race.snapshotVersion;
    const response = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload, {
      packageVersion: currentPackageVersion + 1
    }));
    expect(response).toMatchObject({
      currentPackageVersion,
      packageVersionStatus: "ahead",
      packageUpdateRequired: false,
      acknowledgements: [{ status: "stored" }]
    });
  });

  it("avvisar sekvens/hash-konflikt utan att mutera den första avläsningen", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const first = await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload));
    const conflictingPayload = { ...okPayload, cardNumber: "99999" };
    const conflict = await ingestDeviceBatch(db, raceId, batch(deviceId, conflictingPayload));
    expect(first.acknowledgements[0]).toMatchObject({ status: "stored" });
    expect(conflict.acknowledgements[0]).toMatchObject({
      status: "rejected",
      reason: "SEQUENCE_HASH_CONFLICT"
    });

    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, raceId));
    const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, revision: revisionCount?.value })
      .toEqual({ raw: 1, readout: 1, revision: 1 });
  });

  it("avvisar samma sekvens/hash med ändrad immutable kontext", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload));
    const conflict = await ingestDeviceBatch(db, raceId, batch(deviceId, okPayload, {
      sessionId: crypto.randomUUID()
    }));
    expect(conflict.acknowledgements[0]).toMatchObject({
      status: "rejected",
      reason: "SEQUENCE_CONTEXT_CONFLICT"
    });
    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    expect(rawCount?.value).toBe(1);
  });

  it("ger ingest en hel snapshot före eller efter en samtidig klassändring", async () => {
    const { raceId, overview } = await importedRace();
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const h21 = overview.classes.find((raceClass) => raceClass.name === "H21");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !h21 || !d21) throw new Error("Fixture saknar Ada, H21 eller D21");

    await Promise.all([
      ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload)),
      changeEntryClass(db, raceId, ada.id, d21.id)
    ]);
    const [revision] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, ada.id));
    if (!revision) throw new Error("Resultatrevision saknas");
    const beforeOrAfter = revision.snapshotVersion === overview.race.snapshotVersion
      ? h21.id
      : revision.snapshotVersion === overview.race.snapshotVersion + 1 ? d21.id : undefined;
    expect(beforeOrAfter).toBeDefined();
    expect(revision.evaluation.classId).toBe(beforeOrAfter);
  });
});

describe("TASK 005C beständigt serverutfall", () => {
  it.each([
    ["känd", okPayload, "OK"],
    ["okänd", { ...okPayload, cardNumber: "saknas-i-startlistan" }, "UNKNOWN_CARD"]
  ] as const)("återger samma raw-id, bedömning och hash efter tappat svar för %s bricka", async (
    _label,
    payload,
    expectedStatus
  ) => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const request = batch(deviceId, payload);

    const stored = await ingestDeviceBatch(db, raceId, request);
    // Det första svaret betraktas som tappat. Samma frysta request skickas igen.
    const duplicate = await ingestDeviceBatch(db, raceId, request);
    const storedAck = stored.acknowledgements[0];
    const duplicateAck = duplicate.acknowledgements[0];
    if (!storedAck || storedAck.status !== "stored" || !storedAck.serverResult ||
        !duplicateAck || duplicateAck.status !== "duplicate" || !duplicateAck.serverResult) {
      throw new Error("Fixture gav inte fullständiga positiva kvittenser");
    }

    expect(storedAck.serverResult.status).toBe(expectedStatus);
    expect(duplicateAck.rawMessageId).toBe(storedAck.rawMessageId);
    expect(duplicateAck.serverResult).toEqual(storedAck.serverResult);
    expect(duplicateAck.serverResult.evaluationHash).toBe(storedAck.serverResult.evaluationHash);

    const [rawCount] = await db.select({ value: count() }).from(schema.rawDeviceMessages)
      .where(eq(schema.rawDeviceMessages.deviceId, deviceId));
    const [readoutCount] = await db.select({ value: count() }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.rawMessageId, storedAck.rawMessageId));
    const outcomes = await db.select().from(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, storedAck.rawMessageId));
    expect({ raw: rawCount?.value, readout: readoutCount?.value, outcomes: outcomes.length })
      .toEqual({ raw: 1, readout: 1, outcomes: 1 });
    expect(outcomes[0]?.evaluationHash).toBe(storedAck.serverResult.evaluationHash);
    expect(outcomes[0]?.serverResult).toEqual(storedAck.serverResult);

    if (expectedStatus === "UNKNOWN_CARD") {
      expect(storedAck.serverResult.evaluationHash).toBe(evaluationHash({
        status: "UNKNOWN_CARD",
        reason: "UNKNOWN_CARD",
        missingControls: [],
        extraPunches: [],
        splits: []
      }));
      const [revisionCount] = await db.select({ value: count() }).from(schema.resultRevisions)
        .innerJoin(schema.cardReadouts, eq(schema.resultRevisions.readoutId, schema.cardReadouts.id))
        .where(eq(schema.cardReadouts.rawMessageId, storedAck.rawMessageId));
      expect(revisionCount?.value).toBe(0);
    } else {
      const [revision] = await db.select({ evaluation: schema.resultRevisions.evaluation })
        .from(schema.resultRevisions)
        .innerJoin(schema.cardReadouts, eq(schema.resultRevisions.readoutId, schema.cardReadouts.id))
        .where(eq(schema.cardReadouts.rawMessageId, storedAck.rawMessageId));
      expect(revision).toBeDefined();
      expect(storedAck.serverResult.evaluationHash)
        .toBe(evaluationHash(evaluationResultSchema.parse(revision!.evaluation)));
    }
  });

  it("återläser en känd äldre post från resultatrevision när ingestutfall saknas", async () => {
    const { raceId } = await importedRace();
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const [sourceRevision] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    if (!sourceRevision) throw new Error("Fixture saknar en resultatrevision");

    const deviceId = crypto.randomUUID();
    const request = batch(deviceId, okPayload);
    const event = request.events[0]!;
    const [raw] = await db.insert(schema.rawDeviceMessages).values({
      raceId,
      deviceId,
      sessionId: request.sessionId,
      localSequence: event.localSequence,
      packageVersion: request.packageVersion,
      stationReceivedAt: new Date(event.stationReceivedAt),
      transport: event.transport,
      rawPayload: event.payload,
      contentHash: event.contentHash
    }).returning();
    if (!raw) throw new Error("Fixture kunde inte skapa en äldre råpost");
    const [readout] = await db.insert(schema.cardReadouts).values({
      raceId,
      rawMessageId: raw.id,
      cardNumber: event.payload.cardNumber,
      startPunchedAt: new Date(event.payload.startPunchedAt),
      finishPunchedAt: new Date(event.payload.finishPunchedAt),
      punches: event.payload.punches,
      readAt: new Date(event.stationReceivedAt)
    }).returning();
    if (!readout) throw new Error("Fixture kunde inte skapa en äldre readout");
    const [legacyRevision] = await db.insert(schema.resultRevisions).values({
      raceId,
      entryId: sourceRevision.entryId,
      readoutId: readout.id,
      revision: sourceRevision.revision + 1,
      cause: "CARD_READOUT",
      status: sourceRevision.status,
      reason: sourceRevision.reason,
      evaluation: sourceRevision.evaluation,
      engineVersion: sourceRevision.engineVersion,
      snapshotVersion: sourceRevision.snapshotVersion,
      courseVersionId: sourceRevision.courseVersionId,
      published: true
    }).returning();
    if (!legacyRevision) throw new Error("Fixture kunde inte skapa en äldre resultatrevision");

    const retry = await ingestDeviceBatch(db, raceId, request);
    const acknowledgement = retry.acknowledgements[0];
    expect(acknowledgement).toMatchObject({
      status: "duplicate",
      rawMessageId: raw.id,
      serverResult: {
        resultRevisionId: legacyRevision.id,
        revision: legacyRevision.revision,
        evaluationHash: evaluationHash(evaluationResultSchema.parse(legacyRevision.evaluation))
      }
    });
    expect(await db.select().from(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, raw.id))).toHaveLength(0);
  });

  it("förbjuder update och delete av ingestutfallet", async () => {
    const { raceId } = await importedRace();
    const response = await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const acknowledgement = response.acknowledgements[0];
    if (!acknowledgement || acknowledgement.status !== "stored") throw new Error("Fixture saknar stored-kvittens");

    await expect(db.update(schema.deviceIngestOutcomes)
      .set({ evaluationHash: "f".repeat(64) })
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, acknowledgement.rawMessageId)))
      .rejects.toThrow();
    await expect(db.delete(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, acknowledgement.rawMessageId)))
      .rejects.toThrow();
    const rows = await db.select().from(schema.deviceIngestOutcomes)
      .where(eq(schema.deviceIngestOutcomes.rawMessageId, acknowledgement.rawMessageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.evaluationHash).not.toBe("f".repeat(64));
  });
});

describe("TASK 005A signerat stationspaket", () => {
  it("bygger samma signerade bytes deterministiskt med komplett och explicit sorterad snapshot", async () => {
    const { raceId, overview } = await importedRace();
    const first = await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem);
    const second = await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem);
    expect(second).toEqual(first);

    const payload = verifySignedStationPackage(first, stationPackagePublicKeySpkiBase64);
    expect(payload).toMatchObject({
      formatVersion: 1,
      raceId,
      packageVersion: overview.race.snapshotVersion,
      resultEngineVersion: "0.2.0",
      stationFunction: "READOUT",
      event: {
        name: overview.race.eventName,
        startsOn: overview.race.raceDate,
        timeZone: "Europe/Stockholm"
      },
      raceSnapshot: {
        race: {
          id: overview.race.id,
          name: overview.race.name,
          raceDate: overview.race.raceDate,
          snapshotVersion: overview.race.snapshotVersion
        }
      }
    });
    expect(payload.raceSnapshot.race.eventId).toBe(payload.event.id);
    expect(payload.raceSnapshot.entries.some((entry) => entry.givenName === "Ada")).toBe(true);
    expect(payload.raceSnapshot.cardAssignments.some((assignment) => assignment.cardNumber === "12345")).toBe(true);

    expect(payload.raceSnapshot.classes.map((item) => item.id))
      .toEqual(payload.raceSnapshot.classes.map((item) => item.id).sort());
    expect(payload.raceSnapshot.courses.map((item) => item.id))
      .toEqual(payload.raceSnapshot.courses.map((item) => item.id).sort());
    expect(payload.raceSnapshot.entries.map((item) => item.id))
      .toEqual(payload.raceSnapshot.entries.map((item) => item.id).sort());
    expect(payload.raceSnapshot.cardAssignments.map((item) => item.id))
      .toEqual(payload.raceSnapshot.cardAssignments.map((item) => item.id).sort());
    for (const course of payload.raceSnapshot.courses) {
      expect(course.versions.map((version) => [version.version, version.id]))
        .toEqual(course.versions.map((version) => [version.version, version.id])
          .sort(([leftVersion, leftId], [rightVersion, rightId]) =>
            Number(leftVersion) - Number(rightVersion) || String(leftId).localeCompare(String(rightId))));
      for (const version of course.versions) {
        expect(version.controls.map((control) => [control.sequence, control.id]))
          .toEqual(version.controls.map((control) => [control.sequence, control.id])
            .sort(([leftSequence, leftId], [rightSequence, rightId]) =>
              Number(leftSequence) - Number(rightSequence) || String(leftId).localeCompare(String(rightId))));
      }
    }
  });

  it("ger paketbyggaren en hel snapshot före eller efter en samtidig mutation", async () => {
    const { raceId, overview } = await importedRace();
    const ada = overview.entries.find((entry) => entry.givenName === "Ada");
    const h21 = overview.classes.find((raceClass) => raceClass.name === "H21");
    const d21 = overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !h21 || !d21) throw new Error("Fixture saknar Ada, H21 eller D21");

    const [envelope] = await Promise.all([
      buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem),
      changeEntryClass(db, raceId, ada.id, d21.id)
    ]);
    const payload = verifySignedStationPackage(envelope, stationPackagePublicKeySpkiBase64);
    const packagedAda = payload.raceSnapshot.entries.find((entry) => entry.id === ada.id);
    const expectedClassId = payload.packageVersion === overview.race.snapshotVersion
      ? h21.id
      : payload.packageVersion === overview.race.snapshotVersion + 1 ? d21.id : undefined;
    expect(expectedClassId).toBeDefined();
    expect(packagedAda?.classId).toBe(expectedClassId);
  });
});

describe("TASK 005D device-bundna stationscredentials", () => {
  const issuedAt = new Date("2026-08-31T12:00:00.000Z");
  const expiresAt = new Date("2026-09-01T12:00:00.000Z");

  it("utfärdar exakt nativeformat, lagrar bara secrethash och verifierar strikt bearer", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const secret = Buffer.alloc(32, 7);
    const issued = await issueStationCredential(db, {
      deviceId,
      raceId,
      scope: "READOUT",
      expiresAt
    }, { now: issuedAt, secretBytes: secret });

    expect(issued).toEqual({
      formatVersion: 1,
      token: `otid_stn_v1.${issued.credentialId}.${secret.toString("base64url")}`,
      credentialId: issued.credentialId,
      deviceId,
      raceId,
      scope: "READOUT",
      generation: 1,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    const [device] = await db.select().from(schema.stationDevices)
      .where(eq(schema.stationDevices.deviceId, deviceId));
    const [credential] = await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.id, issued.credentialId));
    expect(device).toBeDefined();
    expect(device?.id).not.toBe(deviceId);
    expect(credential?.stationDeviceId).toBe(device?.id);
    expect(credential?.secretHash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(JSON.stringify(credential)).not.toContain(issued.token);

    const authenticated = await authenticateStationBearer(db, `Bearer ${issued.token}`, new Date("2026-08-31T13:00:00Z"));
    expect(authenticated).toMatchObject({
      status: "authenticated",
      principal: { credentialId: issued.credentialId, deviceId, raceId, scope: "READOUT", generation: 1 }
    });
    if (authenticated.status !== "authenticated") throw new Error("Credentialen autentiserades inte");
    expect(hasStationCredentialScope(authenticated.principal, { raceId, deviceId, scope: "READOUT" })).toBe(true);
    expect(hasStationCredentialScope(authenticated.principal, {
      raceId: crypto.randomUUID(), deviceId, scope: "READOUT"
    })).toBe(false);
    expect(hasStationCredentialScope(authenticated.principal, {
      raceId, deviceId: crypto.randomUUID(), scope: "READOUT"
    })).toBe(false);
    expect(hasStationCredentialScope(authenticated.principal, { raceId, deviceId, scope: "START" })).toBe(false);

    const otherSecret = Buffer.alloc(32, 8).toString("base64url");
    const unknownCredential = crypto.randomUUID();
    await expect(authenticateStationBearer(db, `Bearer otid_stn_v1.${issued.credentialId}.${otherSecret}`, issuedAt))
      .resolves.toEqual({ status: "unauthorized" });
    await expect(authenticateStationBearer(db, `Bearer otid_stn_v1.${unknownCredential}.${otherSecret}`, issuedAt))
      .resolves.toEqual({ status: "unauthorized" });
    await expect(authenticateStationBearer(db, issued.token, issuedAt))
      .resolves.toEqual({ status: "unauthorized" });
    await expect(authenticateStationBearer(db, `bearer ${issued.token}`, issuedAt))
      .resolves.toEqual({ status: "unauthorized" });
    await expect(authenticateStationBearer(db, `Bearer ${issued.token}=`, issuedAt))
      .resolves.toEqual({ status: "unauthorized" });
    await expect(authenticateStationBearer(db, `Bearer ${issued.token}`, expiresAt))
      .resolves.toEqual({ status: "unauthorized" });

    const audits = await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, issued.credentialId));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "STATION_CREDENTIAL_ISSUED", after: {
      generation: 1, scope: "READOUT", issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString()
    } });
    const serializedAudit = JSON.stringify(audits);
    expect(serializedAudit).not.toContain(issued.token);
    expect(serializedAudit).not.toContain(credential?.secretHash ?? "saknad-hash");
  });

  it("roterar med ökande generation och spärrar endast vald credential append-only", async () => {
    const { raceId } = await importedRace();
    const deviceId = crypto.randomUUID();
    const first = await issueStationCredential(db, {
      deviceId, raceId, scope: "READOUT", expiresAt
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 11) });
    const rotatedAt = new Date("2026-08-31T13:00:00.000Z");
    const second = await rotateStationCredential(db, {
      credentialId: first.credentialId,
      expiresAt: new Date("2026-09-02T12:00:00.000Z")
    }, { now: rotatedAt, secretBytes: Buffer.alloc(32, 12) });

    expect(second).toMatchObject({
      formatVersion: 1, deviceId, raceId, scope: "READOUT", generation: 2,
      issuedAt: rotatedAt.toISOString()
    });
    await expect(authenticateStationBearer(db, `Bearer ${first.token}`, rotatedAt))
      .resolves.toMatchObject({ status: "authenticated" });
    await expect(authenticateStationBearer(db, `Bearer ${second.token}`, rotatedAt))
      .resolves.toMatchObject({ status: "authenticated" });

    const revokedAt = new Date("2026-08-31T14:00:00.000Z");
    await expect(revokeStationCredential(db, { credentialId: first.credentialId }, revokedAt))
      .resolves.toEqual({ status: "revoked", credentialId: first.credentialId, revokedAt: revokedAt.toISOString() });
    await expect(revokeStationCredential(db, { credentialId: first.credentialId }, new Date("2026-08-31T15:00:00Z")))
      .resolves.toEqual({ status: "already-revoked", credentialId: first.credentialId, revokedAt: revokedAt.toISOString() });
    await expect(authenticateStationBearer(db, `Bearer ${first.token}`, revokedAt))
      .resolves.toEqual({ status: "unauthorized" });
    await expect(authenticateStationBearer(db, `Bearer ${second.token}`, revokedAt))
      .resolves.toMatchObject({ status: "authenticated" });

    const credentials = await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.stationDeviceId,
        (await db.select({ id: schema.stationDevices.id }).from(schema.stationDevices)
          .where(eq(schema.stationDevices.deviceId, deviceId)))[0]!.id));
    const revocations = await db.select().from(schema.stationCredentialRevocations)
      .where(eq(schema.stationCredentialRevocations.credentialId, first.credentialId));
    expect(credentials.map((row) => row.generation).sort()).toEqual([1, 2]);
    expect(revocations).toHaveLength(1);

    await expect(db.update(schema.stationCredentials).set({ secretHash: "f".repeat(64) })
      .where(eq(schema.stationCredentials.id, first.credentialId))).rejects.toThrow();
    await expect(db.delete(schema.stationCredentialRevocations)
      .where(eq(schema.stationCredentialRevocations.credentialId, first.credentialId))).rejects.toThrow();
    const [audit] = await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, first.credentialId)).limit(1);
    if (!audit) throw new Error("Credentialaudit saknas");
    await expect(db.delete(schema.auditEvents).where(eq(schema.auditEvents.id, audit.id))).rejects.toThrow();
  });

  it("återanvänder extern device-identitet mellan lopp men kräver rotation inom samma scope", async () => {
    const firstRace = await importedRace();
    const secondRace = await importedRace();
    const deviceId = crypto.randomUUID();
    await issueStationCredential(db, {
      deviceId, raceId: firstRace.raceId, scope: "READOUT", expiresAt
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 21) });
    await issueStationCredential(db, {
      deviceId, raceId: secondRace.raceId, scope: "READOUT", expiresAt
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 22) });
    await expect(issueStationCredential(db, {
      deviceId, raceId: firstRace.raceId, scope: "READOUT", expiresAt
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 23) })).rejects.toThrow("rotation");

    const devices = await db.select().from(schema.stationDevices)
      .where(eq(schema.stationDevices.deviceId, deviceId));
    const credentials = await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.stationDeviceId, devices[0]!.id));
    expect(devices).toHaveLength(1);
    expect(credentials).toHaveLength(2);
  });
});

describe("TASK 005E kortlivad engångsparning", () => {
  const issuedAt = new Date("2026-08-31T12:00:00.000Z");
  const grantExpiresAt = new Date("2026-08-31T12:15:00.000Z");
  const credentialExpiresAt = new Date("2026-09-01T12:00:00.000Z");

  function redemptionRequest(deviceId = crypto.randomUUID(), attemptId = crypto.randomUUID()) {
    const credentialSecret = Buffer.alloc(32, 51);
    return {
      credentialSecret,
      body: {
        formatVersion: 1 as const,
        attemptId,
        deviceId,
        credentialSecretHash: createHash("sha256").update(credentialSecret).digest("hex")
      }
    };
  }

  async function issueGrant(raceId: string, secret = Buffer.alloc(32, 41)) {
    return issueStationPairingGrant(db, {
      raceId,
      scope: "READOUT",
      expiresAt: grantExpiresAt,
      credentialExpiresAt
    }, { now: issuedAt, secretBytes: secret });
  }

  function redeem(grantToken: string, request: ReturnType<typeof redemptionRequest>["body"], now = issuedAt) {
    return redeemStationPairingGrant(db, {
      authorization: `Bearer ${grantToken}`,
      idempotencyKey: `pairing:${request.attemptId}`,
      readBody: async () => request
    }, now);
  }

  it("begränsar grant till 15 minuter och kräver credentialgiltighet efter grantet", async () => {
    const { raceId } = await importedRace();
    await expect(issueStationPairingGrant(db, {
      raceId,
      scope: "READOUT",
      expiresAt: new Date(issuedAt.getTime() + 15 * 60 * 1000 + 1),
      credentialExpiresAt
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 40) })).rejects.toThrow("högst 15 minuter");
    await expect(issueStationPairingGrant(db, {
      raceId,
      scope: "READOUT",
      expiresAt: grantExpiresAt,
      credentialExpiresAt: grantExpiresAt
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 40) })).rejects.toThrow("efter grantets utgångstid");
    expect(await db.select().from(schema.stationPairingGrants)
      .where(eq(schema.stationPairingGrants.raceId, raceId))).toHaveLength(0);
  });

  it("utfärdar hash-only grant och återhämtar ett tappat svar med exakt samma credential", async () => {
    const { raceId } = await importedRace();
    const grantSecret = Buffer.alloc(32, 41);
    const grant = await issueGrant(raceId, grantSecret);
    const request = redemptionRequest();

    expect(grant).toEqual({
      formatVersion: 1,
      token: `otid_pair_v1.${grant.grantId}.${grantSecret.toString("base64url")}`,
      grantId: grant.grantId,
      raceId,
      scope: "READOUT",
      issuedAt: issuedAt.toISOString(),
      expiresAt: grantExpiresAt.toISOString(),
      credentialExpiresAt: credentialExpiresAt.toISOString()
    });
    const [storedGrant] = await db.select().from(schema.stationPairingGrants)
      .where(eq(schema.stationPairingGrants.id, grant.grantId));
    expect(storedGrant?.secretHash).toBe(createHash("sha256").update(grantSecret).digest("hex"));
    expect(JSON.stringify(storedGrant)).not.toContain(grant.token);

    const first = await redeem(grant.token, request.body);
    expect(first).toMatchObject({
      status: "stored",
      response: {
        formatVersion: 1,
        attemptId: request.body.attemptId,
        credential: {
          deviceId: request.body.deviceId,
          raceId,
          scope: "READOUT",
          generation: 1,
          issuedAt: issuedAt.toISOString(),
          expiresAt: credentialExpiresAt.toISOString()
        }
      }
    });
    if (first.status !== "stored") throw new Error("Första inlösen lagrades inte");

    const retryAfterGrantExpiry = await redeem(
      grant.token,
      request.body,
      new Date("2026-08-31T12:20:00.000Z")
    );
    expect(retryAfterGrantExpiry).toEqual({ status: "duplicate", response: first.response });

    const credentialToken = `otid_stn_v1.${first.response.credential.credentialId}.` +
      request.credentialSecret.toString("base64url");
    await expect(authenticateStationBearer(db, `Bearer ${credentialToken}`, new Date("2026-08-31T12:21:00Z")))
      .resolves.toMatchObject({
        status: "authenticated",
        principal: { deviceId: request.body.deviceId, raceId, scope: "READOUT", generation: 1 }
      });

    const redemptions = await db.select().from(schema.stationPairingRedemptions)
      .where(eq(schema.stationPairingRedemptions.grantId, grant.grantId));
    const credentials = await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.id, first.response.credential.credentialId));
    expect(redemptions).toHaveLength(1);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.secretHash).toBe(request.body.credentialSecretHash);

    const attempts = await db.select().from(schema.stationPairingAttempts)
      .where(eq(schema.stationPairingAttempts.grantId, grant.grantId));
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["REDEEMED"]);
    const audits = await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.raceId, raceId));
    const serializedAudit = JSON.stringify(audits);
    expect(serializedAudit).not.toContain(grant.token);
    expect(serializedAudit).not.toContain(storedGrant?.secretHash ?? "saknad-granthash");
    expect(serializedAudit).not.toContain(request.body.credentialSecretHash);
  });

  it("serialiserar 100 samtidiga identiska requests till en credential och samma metadata", async () => {
    const { raceId } = await importedRace();
    const grant = await issueGrant(raceId, Buffer.alloc(32, 42));
    const request = redemptionRequest();
    const results = await Promise.all(Array.from({ length: 100 }, () => redeem(grant.token, request.body)));
    expect(results.filter((result) => result.status === "stored")).toHaveLength(1);
    expect(results.filter((result) => result.status === "duplicate")).toHaveLength(99);
    const responses = results.flatMap((result) =>
      result.status === "stored" || result.status === "duplicate" ? [JSON.stringify(result.response)] : []);
    expect(new Set(responses).size).toBe(1);
    expect(await db.select().from(schema.stationPairingRedemptions)
      .where(eq(schema.stationPairingRedemptions.grantId, grant.grantId))).toHaveLength(1);
    expect(await db.select().from(schema.stationPairingAttempts)
      .where(eq(schema.stationPairingAttempts.grantId, grant.grantId))).toHaveLength(1);
    const credentialId = results[0]?.status === "stored" || results[0]?.status === "duplicate"
      ? results[0].response.credential.credentialId
      : undefined;
    expect(credentialId).toBeDefined();
    expect(await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.id, credentialId!))).toHaveLength(1);
  }, 30_000);

  it("avvisar konkurrerande attempt och återanvänder aldrig grantet för en ny credential", async () => {
    const { raceId } = await importedRace();
    const grant = await issueGrant(raceId, Buffer.alloc(32, 43));
    const firstRequest = redemptionRequest();
    const first = await redeem(grant.token, firstRequest.body);
    const competing = redemptionRequest(firstRequest.body.deviceId);
    await expect(redeem(grant.token, competing.body)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.stationPairingRedemptions)
      .where(eq(schema.stationPairingRedemptions.grantId, grant.grantId))).toHaveLength(1);
    const device = await db.select().from(schema.stationDevices)
      .where(eq(schema.stationDevices.deviceId, firstRequest.body.deviceId));
    expect(device).toHaveLength(1);
    const credentials = await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.stationDeviceId, device[0]!.id));
    expect(credentials).toHaveLength(1);
    expect(first.status).toBe("stored");
  });

  it("kräver exakt body och exakt pairing-idempotensnyckel efter autentisering", async () => {
    const { raceId } = await importedRace();
    const grant = await issueGrant(raceId, Buffer.alloc(32, 48));
    const request = redemptionRequest();
    await expect(redeemStationPairingGrant(db, {
      authorization: `Bearer ${grant.token}`,
      idempotencyKey: `pairing:${request.body.attemptId}`,
      readBody: async () => ({ ...request.body, raceId })
    }, issuedAt)).resolves.toEqual({ status: "invalid-request" });
    await expect(redeemStationPairingGrant(db, {
      authorization: `Bearer ${grant.token}`,
      idempotencyKey: request.body.attemptId,
      readBody: async () => request.body
    }, new Date(issuedAt.getTime() + 1))).resolves.toEqual({ status: "invalid-request" });

    const attempts = await db.select().from(schema.stationPairingAttempts)
      .where(eq(schema.stationPairingAttempts.grantId, grant.grantId));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ outcome: "BODY_INVALID", attemptId: null, deviceId: null });
    expect(attempts[1]).toMatchObject({
      outcome: "IDEMPOTENCY_KEY_INVALID",
      attemptId: request.body.attemptId,
      deviceId: request.body.deviceId
    });
    expect(await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.raceId, raceId))).toHaveLength(0);
  });

  it("kör okänt syntaktiskt grant genom auth utan body eller databasmutation", async () => {
    const request = redemptionRequest();
    let reads = 0;
    const beforeAttempts = await db.select({ value: count() }).from(schema.stationPairingAttempts);
    const unknownToken = `otid_pair_v1.${crypto.randomUUID()}.${Buffer.alloc(32, 77).toString("base64url")}`;
    await expect(redeemStationPairingGrant(db, {
      authorization: `Bearer ${unknownToken}`,
      idempotencyKey: `pairing:${request.body.attemptId}`,
      readBody: async () => { reads += 1; return request.body; }
    }, issuedAt)).resolves.toEqual({ status: "unauthorized" });
    const afterAttempts = await db.select({ value: count() }).from(schema.stationPairingAttempts);
    expect(reads).toBe(0);
    expect(afterAttempts[0]?.value).toBe(beforeAttempts[0]?.value);
  });

  it("räknar fem fel före body, gör fortsatt 429 read-only och tillåter exakt replay även under block", async () => {
    const { raceId } = await importedRace();
    const grant = await issueGrant(raceId, Buffer.alloc(32, 44));
    const request = redemptionRequest();
    const wrongSecretToken = `otid_pair_v1.${grant.grantId}.${Buffer.alloc(32, 99).toString("base64url")}`;
    let bodyReads = 0;

    const wrong = (now: Date) => redeemStationPairingGrant(db, {
      authorization: `Bearer ${wrongSecretToken}`,
      idempotencyKey: `pairing:${request.body.attemptId}`,
      readBody: async () => {
        bodyReads += 1;
        return request.body;
      }
    }, now);
    const failures = [];
    for (let index = 0; index < 5; index += 1) {
      failures.push(await wrong(new Date(issuedAt.getTime() + index)));
    }
    expect(failures.map((result) => result.status)).toEqual([
      "unauthorized", "unauthorized", "unauthorized", "unauthorized", "rate-limited"
    ]);
    expect(bodyReads).toBe(0);
    const beforeBlockedRetry = await db.select().from(schema.stationPairingAttempts)
      .where(eq(schema.stationPairingAttempts.grantId, grant.grantId));
    expect(beforeBlockedRetry).toHaveLength(5);
    expect(beforeBlockedRetry.every((attempt) =>
      attempt.outcome === "AUTH_FAILED" && attempt.attemptId === null && attempt.deviceId === null)).toBe(true);
    await expect(wrong(new Date(issuedAt.getTime() + 5))).resolves.toMatchObject({ status: "rate-limited" });
    expect(await db.select().from(schema.stationPairingAttempts)
      .where(eq(schema.stationPairingAttempts.grantId, grant.grantId))).toHaveLength(5);

    let validBodyReads = 0;
    await expect(redeemStationPairingGrant(db, {
      authorization: `Bearer ${grant.token}`,
      idempotencyKey: `pairing:${request.body.attemptId}`,
      readBody: async () => {
        validBodyReads += 1;
        return request.body;
      }
    }, new Date(issuedAt.getTime() + 6))).resolves.toMatchObject({ status: "rate-limited" });
    expect(validBodyReads).toBe(0);

    const reopenedAt = new Date("2026-08-31T12:10:01.000Z");
    const stored = await redeem(grant.token, request.body, reopenedAt);
    if (stored.status !== "stored") throw new Error("Grantet återöppnades inte efter rate-limitfönstret");
    for (let index = 1; index <= 5; index += 1) {
      await wrong(new Date(reopenedAt.getTime() + index));
    }
    const replay = await redeem(grant.token, request.body, new Date(reopenedAt.getTime() + 6));
    expect(replay).toEqual({ status: "duplicate", response: stored.response });
  });

  it("spärrar grant append-only och förbjuder mutation av samtliga pairing-spår", async () => {
    const { raceId } = await importedRace();
    const grant = await issueGrant(raceId, Buffer.alloc(32, 45));
    const request = redemptionRequest();
    const stored = await redeem(grant.token, request.body);
    if (stored.status !== "stored") throw new Error("Fixture kunde inte lösa in grantet");
    await expect(revokeStationPairingGrant(db, { grantId: grant.grantId }, new Date("2026-08-31T12:05:00Z")))
      .resolves.toMatchObject({ status: "revoked", grantId: grant.grantId });

    const [revocation] = await db.select().from(schema.stationPairingGrantRevocations)
      .where(eq(schema.stationPairingGrantRevocations.grantId, grant.grantId));
    const [attempt] = await db.select().from(schema.stationPairingAttempts)
      .where(eq(schema.stationPairingAttempts.grantId, grant.grantId));
    const [redemption] = await db.select().from(schema.stationPairingRedemptions)
      .where(eq(schema.stationPairingRedemptions.grantId, grant.grantId));
    if (!revocation || !attempt || !redemption) throw new Error("Pairingspåren saknas");
    await expect(db.update(schema.stationPairingGrants).set({ secretHash: "f".repeat(64) })
      .where(eq(schema.stationPairingGrants.id, grant.grantId))).rejects.toThrow();
    await expect(db.delete(schema.stationPairingGrantRevocations)
      .where(eq(schema.stationPairingGrantRevocations.id, revocation.id))).rejects.toThrow();
    await expect(db.update(schema.stationPairingAttempts).set({ outcome: "CONFLICT" })
      .where(eq(schema.stationPairingAttempts.id, attempt.id))).rejects.toThrow();
    await expect(db.delete(schema.stationPairingRedemptions)
      .where(eq(schema.stationPairingRedemptions.id, redemption.id))).rejects.toThrow();
  });

  it("avvisar utgånget och spärrat grant utan bodyparsning eller credential", async () => {
    const expiredRace = await importedRace();
    const expiredGrant = await issueGrant(expiredRace.raceId, Buffer.alloc(32, 46));
    const expiredRequest = redemptionRequest();
    let reads = 0;
    await expect(redeemStationPairingGrant(db, {
      authorization: `Bearer ${expiredGrant.token}`,
      idempotencyKey: `pairing:${expiredRequest.body.attemptId}`,
      readBody: async () => { reads += 1; return expiredRequest.body; }
    }, new Date("2026-08-31T12:16:00Z"))).resolves.toEqual({ status: "unauthorized" });

    const revokedRace = await importedRace();
    const revokedGrant = await issueGrant(revokedRace.raceId, Buffer.alloc(32, 47));
    await revokeStationPairingGrant(db, { grantId: revokedGrant.grantId }, new Date("2026-08-31T12:01:00Z"));
    const revokedRequest = redemptionRequest();
    await expect(redeemStationPairingGrant(db, {
      authorization: `Bearer ${revokedGrant.token}`,
      idempotencyKey: `pairing:${revokedRequest.body.attemptId}`,
      readBody: async () => { reads += 1; return revokedRequest.body; }
    }, new Date("2026-08-31T12:02:00Z"))).resolves.toEqual({ status: "unauthorized" });
    expect(reads).toBe(0);
    const credentialRows = await db.select().from(schema.stationCredentials)
      .where(eq(schema.stationCredentials.raceId, expiredRace.raceId));
    expect(credentialRows).toHaveLength(0);
  });
});

describe("TASK 005N capability-skyddad avläsnings- och resultathistorik PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T21:00:00.000Z");
  const usedAt = new Date("2026-08-31T21:02:00.000Z");

  async function historyAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId, capability: "VIEW_READOUT_RESULT_HISTORY", label: `Historik ${marker}`,
      expiresAt: new Date("2026-09-01T05:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1, accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId, expectedCapability: "VIEW_READOUT_RESULT_HISTORY",
      now: new Date("2026-08-31T21:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1), csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Historiksession kunde inte skapas");
    return { installation, login };
  }

  async function readFootprint(raceId: string) {
    const [audits, raw, readouts, outcomes, revisions] = await Promise.all([
      db.select({ value: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)),
      db.select({ value: count() }).from(schema.deviceIngestOutcomes)
        .innerJoin(schema.rawDeviceMessages, eq(schema.deviceIngestOutcomes.rawMessageId, schema.rawDeviceMessages.id))
        .where(eq(schema.rawDeviceMessages.raceId, raceId)),
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId))
    ]);
    return [audits[0]?.value, raw[0]?.value, readouts[0]?.value, outcomes[0]?.value, revisions[0]?.value];
  }

  it("visar känd och okänd readout samt full immutable revisionskedja utan råfält", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload, cardNumber: "999999"
    }, { stationReceivedAt: "2026-08-30T10:42:00Z" }));
    const ada = fixture.overview.entries.find((entry) => entry.cardNumber === okPayload.cardNumber);
    if (!ada) throw new Error("Fixture saknar känd bricka");
    await recalculateEntry(db, fixture.raceId, ada.id);
    const [latest] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, ada.id)).orderBy(desc(schema.resultRevisions.revision)).limit(1);
    if (!latest) throw new Error("Fixture saknar resultatrevision");
    await db.insert(schema.resultRevisions).values({
      raceId: latest.raceId, entryId: latest.entryId, readoutId: latest.readoutId,
      revision: latest.revision + 1, cause: "EXPLICIT_RECALCULATION", status: latest.status,
      reason: latest.reason, evaluation: latest.evaluation, engineVersion: latest.engineVersion,
      snapshotVersion: latest.snapshotVersion, courseVersionId: latest.courseVersionId, published: false
    });
    const admin = await historyAdmin(fixture.raceId, 171);

    const firstPage = await listReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId, limit: 1
    }, usedAt);
    expect(firstPage.status).toBe("ok");
    if (firstPage.status !== "ok") throw new Error("Readoutlistan saknas");
    expect(firstPage.response.items).toHaveLength(1);
    expect(firstPage.response.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const secondPage = await listReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId, limit: 1,
      cursor: firstPage.response.nextCursor!
    }, usedAt);
    if (secondPage.status !== "ok") throw new Error("Andra readoutsidan saknas");
    const all = [...firstPage.response.items, ...secondPage.response.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(2);
    const unknown = all.find((item) => item.cardNumber === "999999");
    const known = all.find((item) => item.cardNumber === okPayload.cardNumber);
    expect(unknown).toMatchObject({ entry: null,
      firstServerAssessment: { status: "UNKNOWN_CARD", reason: "UNKNOWN_CARD", courseVersionId: null } });
    expect(known?.entry?.displayName).toContain("Ada");

    const unknownDetail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId,
      readoutId: unknown!.id, limit: 50
    }, usedAt);
    expect(unknownDetail).toMatchObject({ status: "ok", response: {
      entry: null, history: { upperRevision: 0, items: [], nextCursor: null }
    } });
    const knownDetail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId,
      readoutId: known!.id, limit: 50
    }, usedAt);
    if (knownDetail.status !== "ok") throw new Error("Känd readoutdetail saknas");
    expect(knownDetail.response.readout.punches.map((punch) => punch.code)).toEqual([31, 32, 33]);
    expect(knownDetail.response.history.items.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT", "CLASS_CHANGE_RECALCULATION", "EXPLICIT_RECALCULATION"
    ]);
    expect(knownDetail.response.history.items.map((revision) => revision.published)).toEqual([true, true, false]);
    const serialized = JSON.stringify({ list: all, detail: knownDetail.response });
    for (const forbidden of ["rawPayload", "rawMessageId", "deviceId", "sessionId", "localSequence",
      "packageVersion", "contentHash", "evaluationHash", "originalXml", "secretHash", "credentialLabel"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain(admin.installation.accessCredential);
    expect(serialized).not.toContain(admin.login.sessionToken);
  });

  it("fryser revisionsvattenmärke mellan sidor och låter ny request se append", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const ada = fixture.overview.entries.find((entry) => entry.cardNumber === okPayload.cardNumber);
    if (!ada) throw new Error("Fixture saknar Ada");
    await recalculateEntry(db, fixture.raceId, ada.id);
    const admin = await historyAdmin(fixture.raceId, 181);
    const list = await listReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId, limit: 50
    }, usedAt);
    if (list.status !== "ok") throw new Error("Readoutlistan saknas");
    const readoutId = list.response.items[0]!.id;
    const first = await getReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId, readoutId, limit: 1
    }, usedAt);
    if (first.status !== "ok") throw new Error("Första historiksidan saknas");
    expect(first.response.history.upperRevision).toBe(2);
    expect(first.response.history.nextCursor).not.toBeNull();
    await recalculateEntry(db, fixture.raceId, ada.id);
    const second = await getReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId, readoutId, limit: 1,
      cursor: first.response.history.nextCursor!
    }, usedAt);
    if (second.status !== "ok") throw new Error("Andra historiksidan saknas");
    expect(second.response.history.upperRevision).toBe(2);
    expect(second.response.history.items.map((item) => item.revision)).toEqual([2]);
    expect(second.response.history.nextCursor).toBeNull();
    const fresh = await getReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId, readoutId, limit: 50
    }, usedAt);
    expect(fresh.status === "ok" && fresh.response.history.upperRevision).toBe(3);
  });

  it("isolerar capability/race och gör 100 samtidiga GET utan writes", async () => {
    const fixture = await importedRace();
    const other = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await historyAdmin(fixture.raceId, 191);
    await expect(listReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: other.raceId, limit: 50
    }, usedAt)).resolves.toEqual({ status: "forbidden" });
    const overviewCredential = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId, capability: "VIEW_RACE_OVERVIEW", label: "Fel capability",
      expiresAt: new Date("2026-09-01T05:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 194) });
    const overviewLogin = await loginPairingAdmin(db, {
      formatVersion: 1, accessCredential: overviewCredential.accessCredential
    }, { expectedRaceId: fixture.raceId, expectedCapability: "VIEW_RACE_OVERVIEW", now: usedAt,
      sessionSecretBytes: Buffer.alloc(32, 195), csrfSecretBytes: Buffer.alloc(32, 196) });
    if (overviewLogin.status !== "authenticated") throw new Error("Overviewsession saknas");
    await expect(listReadoutHistoryAsAdmin(db, {
      sessionToken: overviewLogin.sessionToken, raceId: fixture.raceId, limit: 50
    }, usedAt)).resolves.toEqual({ status: "forbidden" });

    const before = await readFootprint(fixture.raceId);
    const results = await Promise.all(Array.from({ length: 100 }, () => listReadoutHistoryAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId, limit: 50
    }, usedAt)));
    expect(results.every((result) => result.status === "ok")).toBe(true);
    expect(await readFootprint(fixture.raceId)).toEqual(before);
  }, 30_000);

  it("stoppar läsning efter capabilitysäker logout och revocation", async () => {
    const fixture = await importedRace();
    const loggedOut = await historyAdmin(fixture.raceId, 201);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: loggedOut.login.sessionToken, raceId: fixture.raceId,
      capability: "VIEW_READOUT_RESULT_HISTORY", csrfCookie: loggedOut.login.csrfToken,
      csrfHeader: loggedOut.login.csrfToken
    }, usedAt)).resolves.toEqual({ status: "logged-out" });
    await expect(listReadoutHistoryAsAdmin(db, {
      sessionToken: loggedOut.login.sessionToken, raceId: fixture.raceId, limit: 50
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const revoked = await historyAdmin(fixture.raceId, 211);
    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: revoked.installation.credentialId,
      capability: "VIEW_READOUT_RESULT_HISTORY"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(listReadoutHistoryAsAdmin(db, {
      sessionToken: revoked.login.sessionToken, raceId: fixture.raceId, limit: 50
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });
  });
});

describe("TASK024 deltagarbunden avläsningshistorik PostgreSQL", () => {
  const now = new Date("2026-09-04T10:00:00Z");
  async function auth(raceId: string, capability: "VIEW_READOUT_RESULT_HISTORY" | "CHANGE_ENTRY_CARD" | "VIEW_RACE_OVERVIEW" = "VIEW_READOUT_RESULT_HISTORY") {
    const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "TASK024 syntetisk historik",
      expiresAt: new Date(now.getTime() + 3600_000) }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
      { now, expectedRaceId: raceId, expectedCapability: capability });
    if (login.status !== "authenticated") throw new Error("Historiksession saknas");
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function footprint(raceId: string) {
    return Promise.all([
      db.select({ value: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)),
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)),
      db.select({ value: count() }).from(schema.deviceIngestOutcomes)
        .innerJoin(schema.rawDeviceMessages, eq(schema.deviceIngestOutcomes.rawMessageId, schema.rawDeviceMessages.id))
        .where(eq(schema.rawDeviceMessages.raceId, raceId))
    ]);
  }
  it("filtrerar före sidgräns bakom 51 andra avläsningar, binder cursor och skriver ingenting", async () => {
    const fixture = await importedRace();
    const ada = fixture.overview.entries.find((entry) => entry.cardNumber === okPayload.cardNumber)!;
    for (let index = 0; index < 3; index++) await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const ownReadouts = await db.select({ id: schema.cardReadouts.id }).from(schema.cardReadouts)
      .where(eq(schema.cardReadouts.raceId, fixture.raceId));
    for (let index = 0; index < 51; index++) await ingestDeviceBatch(db, fixture.raceId,
      batch(crypto.randomUUID(), { ...okPayload, cardNumber: "999999" }));
    const authentication = await auth(fixture.raceId);
    const other = fixture.overview.entries.find((entry) => entry.id !== ada.id)!;
    const foreign = await importedRace();
    const wrongCapability = await auth(fixture.raceId, "VIEW_RACE_OVERVIEW");
    const before = await footprint(fixture.raceId);
    const general = await listReadoutHistoryAsAdmin(db, { ...authentication, limit: 50 }, now);
    if (general.status !== "ok") throw new Error("Generell lista saknas");
    expect(general.response.items).toHaveLength(50);
    expect(general.response.items.every((item) => item.entry === null)).toBe(true);
    const first = await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: ada.id, limit: 2 }, now);
    if (first.status !== "ok") throw new Error("Deltagarsida saknas");
    expect(first.response.entry).toMatchObject({ id: ada.id, displayName: `${ada.givenName} ${ada.familyName}` });
    expect(first.response.page.items).toHaveLength(2);
    expect(first.response.page.items.every((item) => item.entry?.id === ada.id)).toBe(true);
    const cursor = first.response.page.nextCursor!;
    expect(cursor).toBeTypeOf("string");
    const cursorText = Buffer.from(cursor, "base64url").toString("utf8");
    expect(cursorText).toMatch(/\.\d{6}Z/);
    const cursorData = JSON.parse(cursorText) as { receivedAt: string };
    const shifted = await db.execute<{ value: string }>(sql`select to_char(
      (${cursorData.receivedAt}::timestamptz + interval '1 microsecond') at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as value`);
    const microsecondCursor = Buffer.from(JSON.stringify({ ...cursorData, receivedAt: shifted.rows[0]!.value }), "utf8").toString("base64url");
    const microsecondPage = await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: ada.id, limit: 50, cursor: microsecondCursor }, now);
    if (microsecondPage.status !== "ok") throw new Error("Mikrosekundsida saknas");
    expect(microsecondPage.response.page.items.map(item => item.id)).toContain(first.response.page.items.at(-1)!.id);
    const second = await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: ada.id, limit: 2, cursor }, now);
    if (second.status !== "ok") throw new Error("Andra deltagarsida saknas");
    expect(second.response.page.items).toHaveLength(1);
    expect(second.response.page.nextCursor).toBeNull();
    expect([...first.response.page.items, ...second.response.page.items].map((item) => item.id).sort())
      .toEqual(ownReadouts.map((row) => row.id).sort());
    expect((await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: other.id, limit: 2, cursor }, now)).status).toBe("invalid-request");
    expect((await listEntryReadoutHistoryAsAdmin(db, { ...authentication, raceId: foreign.raceId, entryId: ada.id, limit: 2, cursor }, now)).status).toBe("invalid-request");
    expect((await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: ada.id, limit: 2,
      cursor: general.response.nextCursor! }, now)).status).toBe("invalid-request");
    expect((await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: foreign.overview.entries[0]!.id, limit: 2 }, now)).status).toBe("not-found");
    expect((await listEntryReadoutHistoryAsAdmin(db, { ...wrongCapability, entryId: ada.id, limit: 2 }, now)).status).toBe("forbidden");
    const empty = await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: other.id, limit: 2 }, now);
    expect(empty).toMatchObject({ status: "ok", response: { entry: { id: other.id }, page: { items: [], nextCursor: null } } });
    expect(await footprint(fixture.raceId)).toEqual(before);
  }, 30_000);

  it("behåller ursprunglig bindning efter riktigt brickbyte och utesluter senare okänd avläsning", async () => {
    const fixture = await importedRace();
    const ada = fixture.overview.entries.find((entry) => entry.cardNumber === okPayload.cardNumber)!;
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const historyAuth = await auth(fixture.raceId);
    const before = await listEntryReadoutHistoryAsAdmin(db, { ...historyAuth, entryId: ada.id, limit: 50 }, now);
    if (before.status !== "ok") throw new Error("Ursprunglig historik saknas");
    const cardAuth = await auth(fixture.raceId, "CHANGE_ENTRY_CARD");
    const cards = await listEntryCardsAsAdmin(db, cardAuth, now);
    if (cards.status !== "ok") throw new Error("Brickunderlag saknas");
    const entry = cards.response.entries.find((row) => row.id === ada.id)!;
    expect((await changeEntryCardAsAdmin(db, { ...cardAuth, entryId: ada.id,
      idempotencyKey: `entry-card-change:${crypto.randomUUID()}`, request: { formatVersion: 1,
        expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedSnapshotVersion: cards.response.snapshotVersion, expectedAssignment: entry.activeAssignment, cardNumber: "54321" } }, now)).status).toBe("changed");
    const late = await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    expect(late.acknowledgements[0]).toMatchObject({ serverResult: { status: "UNKNOWN_CARD" } });
    const after = await listEntryReadoutHistoryAsAdmin(db, { ...historyAuth, entryId: ada.id, limit: 50 }, now);
    expect(after).toEqual(before);
  });

  it("väljer första CARD_READOUT före entryvillkor, aldrig en senare annan bindning", async () => {
    const fixture = await importedRace();
    const ada = fixture.overview.entries.find((entry) => entry.cardNumber === okPayload.cardNumber)!;
    const other = fixture.overview.entries.find((entry) => entry.id !== ada.id)!;
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const [original] = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, ada.id));
    if (!original) throw new Error("Ursprunglig revision saknas");
    // Synthetic adversarial historical association: no assignment is moved.
    await db.insert(schema.resultRevisions).values({ raceId: fixture.raceId, entryId: other.id,
      readoutId: original.readoutId, revision: 100, cause: "CARD_READOUT", status: original.status,
      reason: original.reason, evaluation: { ...original.evaluation, entryId: other.id }, engineVersion: original.engineVersion,
      snapshotVersion: original.snapshotVersion, courseVersionId: original.courseVersionId, published: false });
    const authentication = await auth(fixture.raceId);
    const first = await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: ada.id, limit: 50 }, now);
    expect(first).toMatchObject({ status: "ok", response: { page: { items: [{ id: original.readoutId, entry: { id: ada.id } }] } } });
    const later = await listEntryReadoutHistoryAsAdmin(db, { ...authentication, entryId: other.id, limit: 50 }, now);
    expect(later).toMatchObject({ status: "ok", response: { entry: { id: other.id }, page: { items: [], nextCursor: null } } });
  });
});

describe("TASK025 exakt allmän historikcursor PostgreSQL", () => {
  it("bevarar mikrosekunder och sidar samma millisekund utan tapp eller dubblering", async () => {
    const { raceId } = await importedRace();
    const now = new Date("2026-09-04T10:00:00Z");
    const issued = await issuePairingAdminAccessCredential(db, { raceId, capability: "VIEW_READOUT_RESULT_HISTORY",
      label: "TASK025 syntetisk sidning", expiresAt: new Date(now.getTime() + 3600_000) }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
      { now, expectedRaceId: raceId, expectedCapability: "VIEW_READOUT_RESULT_HISTORY" });
    if (login.status !== "authenticated") throw new Error("Historiksession saknas");
    const authentication = { raceId, sessionToken: login.sessionToken };
    // Initial synthetic inserts retain exact PostgreSQL precision; immutable rows are never updated.
    const instants = ["2026-08-30T10:41:00.123900Z", "2026-08-30T10:41:00.123800Z",
      "2026-08-30T10:41:00.123800Z", "2026-08-30T10:41:00.123100Z"];
    for (const instant of instants) {
      const deviceId = crypto.randomUUID();
      const [raw] = await db.insert(schema.rawDeviceMessages).values({ raceId, deviceId, sessionId: deviceId,
        localSequence: 1, packageVersion: 3, stationReceivedAt: new Date("2026-08-30T10:41:00Z"),
        serverReceivedAt: sql`${instant}::timestamptz`, transport: "simulator", rawPayload: okPayload,
        contentHash: contentHash(okPayload), parserStatus: "normalized" }).returning({ id: schema.rawDeviceMessages.id });
      if (!raw) throw new Error("Syntetisk råpost saknas");
      await db.insert(schema.cardReadouts).values({ raceId, rawMessageId: raw.id, cardNumber: okPayload.cardNumber,
        startPunchedAt: new Date(okPayload.startPunchedAt), finishPunchedAt: new Date(okPayload.finishPunchedAt),
        punches: okPayload.punches, readAt: new Date("2026-08-30T10:41:00Z") });
    }
    const exactRows = await db.select({ id: schema.cardReadouts.id,
      receivedAt: sql<string>`to_char(${schema.rawDeviceMessages.serverReceivedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    }).from(schema.cardReadouts).innerJoin(schema.rawDeviceMessages, eq(schema.cardReadouts.rawMessageId, schema.rawDeviceMessages.id))
      .where(eq(schema.cardReadouts.raceId, raceId))
      .orderBy(desc(schema.rawDeviceMessages.serverReceivedAt), desc(schema.cardReadouts.id));
    const first = await listReadoutHistoryAsAdmin(db, { ...authentication, limit: 2 }, now);
    if (first.status !== "ok") throw new Error("Första historiksidan saknas");
    expect(first.response.items.map((row) => row.id)).toEqual(exactRows.slice(0, 2).map((row) => row.id));
    const cursor = first.response.nextCursor!;
    expect(cursor).toBeTypeOf("string");
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v: number; raceId: string; receivedAt: string; readoutId: string;
    };
    expect(decoded).toEqual({ v: 2, raceId, receivedAt: exactRows[1]!.receivedAt, readoutId: exactRows[1]!.id });
    expect(decoded.receivedAt).toBe("2026-08-30T10:41:00.123800Z");
    const second = await listReadoutHistoryAsAdmin(db, { ...authentication, limit: 2, cursor }, now);
    if (second.status !== "ok") throw new Error("Andra historiksidan saknas");
    expect(second.response.items.map((row) => row.id)).toEqual(exactRows.slice(2).map((row) => row.id));
    expect(second.response.nextCursor).toBeNull();
    const combined = [...first.response.items, ...second.response.items].map((row) => row.id);
    expect(combined).toEqual(exactRows.map((row) => row.id));
    expect(new Set(combined).size).toBe(4);
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    for (const invalid of [
      { ...decoded, v: 1, receivedAt: "2026-08-30T10:41:00.123Z" },
      { ...decoded, raceId: crypto.randomUUID() },
      { ...decoded, receivedAt: "2026-02-30T10:41:00.123800Z" },
      { ...decoded, receivedAt: "2026-08-30T25:41:00.123800Z" }
    ]) {
      expect(await listReadoutHistoryAsAdmin(db, { ...authentication, limit: 2, cursor: encoded(invalid) }, now))
        .toEqual({ status: "invalid-request" });
    }
  });
});

describe("TASK026 versionsbunden namn- och klubbrättning PostgreSQL", () => {
  const now = new Date("2026-09-09T10:00:00Z");
  async function auth(raceId: string, capability: "CHANGE_ENTRY_IDENTITY" | "IMPORT_IOF" | "VIEW_RACE_OVERVIEW" | "FINALIZE_RESULTS" | "PUBLISH_START_LIST" = "CHANGE_ENTRY_IDENTITY") {
    const issued = await issuePairingAdminAccessCredential(db, { raceId, capability, label: "TASK026 syntetisk rättning",
      expiresAt: new Date(now.getTime() + 3600_000) }, { now });
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: issued.accessCredential },
      { now, expectedRaceId: raceId, expectedCapability: capability });
    if (login.status !== "authenticated") throw new Error("Rättningssession saknas");
    return { raceId, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  }
  async function inputFor(authentication: Awaited<ReturnType<typeof auth>>, entryId: string) {
    const list = await listEntryIdentitiesAsAdmin(db, authentication, now);
    if (list.status !== "ok") throw new Error("Namnunderlag saknas");
    const entry = list.response.entries.find((row) => row.id === entryId)!;
    return { ...authentication, entryId, idempotencyKey: `entry-identity-change:${crypto.randomUUID()}`,
      request: { formatVersion: 1 as const, expectedEntryVersion: entry.version, expectedClassId: entry.classId,
        expectedSnapshotVersion: list.response.snapshotVersion, expectedIdentity: entry.identity,
        identity: { givenName: "Alva", familyName: "Rättad", organisationName: "Ny OK" } } };
  }
  async function state(raceId: string) {
    return Promise.all([
      db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id)),
      db.select().from(schema.races).where(eq(schema.races.id, raceId)),
      db.select().from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId)).orderBy(asc(schema.importFiles.id)),
      db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, raceId)).orderBy(asc(schema.entryIdentityChangeRequests.id)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)).orderBy(asc(schema.auditEvents.id)),
      db.select().from(schema.iofImportRequests).where(eq(schema.iofImportRequests.raceId, raceId)).orderBy(asc(schema.iofImportRequests.requestId))
    ]);
  }

  it("rättar endast identitet/version, bevarar resultat och publicerade bytes samt återger första kvittot efter senare rättning", async () => {
    const { raceId, overview } = await importedRace();
    const ada = overview.entries.find((row) => row.cardNumber === "12345")!;
    for (const cardNumber of ["12345", "67890"]) await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), { ...okPayload, cardNumber }));
    const finalAuth = await auth(raceId, "FINALIZE_RESULTS");
    const candidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (candidates.status !== "ok") throw new Error("Finaliseringsunderlag saknas");
    for (const candidate of candidates.response.classes.filter((row) => row.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      expect((await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: { formatVersion: 1, scope: "CLASS", classId: candidate.classId,
          expectedSnapshotVersion: candidates.response.snapshotVersion, expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null } }, { now })).status).toBe("finalized");
    }
    const ready = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, now);
    if (ready.status !== "ok") throw new Error("Loppunderlag saknas");
    expect((await finalizeResultsAsAdmin(db, { ...finalAuth, idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: { formatVersion: 1, scope: "RACE", classId: null, expectedSnapshotVersion: ready.response.snapshotVersion,
        expectedBasisHash: ready.response.race.basisHash, expectedLatestScopeRevision: null } }, { now })).status).toBe("finalized");
    const startAuth = await auth(raceId, "PUBLISH_START_LIST");
    const preview = await getStartListPublicationPreviewAsAdmin(db, startAuth, now);
    if (preview.status !== "ok" || !preview.response.sourceHash) throw new Error("Startlisteunderlag saknas");
    await decideStartListPublicationAsAdmin(db, { ...startAuth, idempotencyKey: `start-list-publication:${crypto.randomUUID()}`,
      request: { formatVersion: 1, action: "PUBLISH", expectedSnapshotVersion: preview.response.snapshotVersion,
        expectedSourceHash: preview.response.sourceHash, expectedRevision: 0 } }, now);
    const frozenStart = await getPublishedStartListXml(db, raceId);
    expect(frozenStart.status).toBe("exported");
    const unchanged = () => Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)).orderBy(asc(schema.rawDeviceMessages.id)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)).orderBy(asc(schema.cardReadouts.id)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)).orderBy(asc(schema.resultRevisions.id)),
      db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.raceId, raceId)).orderBy(asc(schema.resultFinalizations.id)),
      db.select().from(schema.cardAssignments).where(eq(schema.cardAssignments.raceId, raceId)).orderBy(asc(schema.cardAssignments.id)),
      db.select().from(schema.classes).where(eq(schema.classes.raceId, raceId)).orderBy(asc(schema.classes.id))
    ]);
    const preserved = await unchanged();
    const beforeEntries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    const oldPackage = await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem);
    const authentication = await auth(raceId);
    const input = await inputFor(authentication, ada.id);
    input.request.identity.organisationName = "K".repeat(200);
    const first = await changeEntryIdentityAsAdmin(db, input, now);
    if (first.status !== "changed") throw new Error("Rättning misslyckades");
    expect(first.response).toMatchObject({ replayed: false, previousIdentity: input.request.expectedIdentity,
      identity: input.request.identity, entryVersionAfter: input.request.expectedEntryVersion + 1,
      snapshotVersionAfter: input.request.expectedSnapshotVersion + 1 });
    const afterEntries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId)).orderBy(asc(schema.entries.id));
    expect(afterEntries).toEqual(beforeEntries.map((entry) => entry.id === ada.id
      ? { ...entry, ...input.request.identity, version: entry.version + 1 } : entry));
    const nextPackage = verifySignedStationPackage(await buildSignedStationPackage(db, raceId, stationPackagePrivateKeyPem), stationPackagePublicKeySpkiBase64);
    expect(nextPackage.packageVersion).toBe(input.request.expectedSnapshotVersion + 1);
    expect(nextPackage.raceSnapshot.entries.find((row) => row.id === ada.id)).toMatchObject(input.request.identity);
    expect(verifySignedStationPackage(oldPackage, stationPackagePublicKeySpkiBase64).raceSnapshot.entries.find((row) => row.id === ada.id))
      .toMatchObject({ givenName: ada.givenName, familyName: ada.familyName });
    const next = await inputFor(authentication, ada.id);
    next.request.identity.givenName = "Alice";
    expect((await changeEntryIdentityAsAdmin(db, next, now)).status).toBe("changed");
    const beforeRetry = await state(raceId);
    expect(await changeEntryIdentityAsAdmin(db, { ...input, request: { ...input.request,
      identity: { ...input.request.identity, givenName: " Alva " } } }, now))
      .toEqual({ ...first, response: { ...first.response, replayed: true } });
    expect(await state(raceId)).toEqual(beforeRetry);
    expect(await unchanged()).toEqual(preserved);
    expect(await getPublishedStartListXml(db, raceId)).toEqual(frozenStart);
    const journal = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.entryId, ada.id));
    expect(journal).toHaveLength(2);
    expect(journal.find((row) => row.requestId === first.response.requestId)).toMatchObject({
      previousIdentity: input.request.expectedIdentity, identity: input.request.identity });
    await expect(db.update(schema.entryIdentityChangeRequests).set({ identity: input.request.expectedIdentity })
      .where(eq(schema.entryIdentityChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.id, journal[0]!.id))).rejects.toThrow();
    expect(await state(raceId)).toEqual(beforeRetry);
  });

  it("avvisar stale, no-op, fel actor/target/intent och fel capability utan writes", async () => {
    const { raceId, overview } = await importedRace();
    const authentication = await auth(raceId);
    const otherActor = await auth(raceId);
    const wrongCapability = await auth(raceId, "VIEW_RACE_OVERVIEW");
    const entryId = overview.entries[0]!.id;
    const input = await inputFor(authentication, entryId);
    const baseline = await state(raceId);
    expect((await changeEntryIdentityAsAdmin(db, { ...input, request: { ...input.request,
      identity: { ...input.request.identity, organisationName: "K".repeat(201) } } }, now)).status).toBe("invalid-request");
    for (const request of [
      { ...input.request, identity: input.request.expectedIdentity },
      { ...input.request, expectedEntryVersion: input.request.expectedEntryVersion + 1 },
      { ...input.request, expectedSnapshotVersion: input.request.expectedSnapshotVersion + 1 },
      { ...input.request, expectedIdentity: { ...input.request.expectedIdentity, givenName: "Fel" } }
    ]) expect((await changeEntryIdentityAsAdmin(db, { ...input, request }, now)).status).toBe("conflict");
    expect((await listEntryIdentitiesAsAdmin(db, wrongCapability, now)).status).toBe("forbidden");
    expect((await changeEntryIdentityAsAdmin(db, { ...input, ...wrongCapability }, now)).status).toBe("forbidden");
    expect((await changeEntryIdentityAsAdmin(db, { ...input, csrfHeader: "wrong" }, now)).status).toBe("forbidden");
    expect(await state(raceId)).toEqual(baseline);
    expect((await changeEntryIdentityAsAdmin(db, input, now)).status).toBe("changed");
    const after = await state(raceId);
    for (const attempt of [
      { ...input, ...otherActor },
      { ...input, entryId: overview.entries[1]!.id },
      { ...input, request: { ...input.request, identity: { ...input.request.identity, familyName: "Annan" } } }
    ]) expect((await changeEntryIdentityAsAdmin(db, attempt, now)).status).toBe("conflict");
    expect(await state(raceId)).toEqual(after);
  });

  it("låter exakt en av två aktörer rätta samma versionsgrund", async () => {
    const { raceId, overview } = await importedRace();
    const entryId = overview.entries[0]!.id;
    const firstAuth = await auth(raceId);
    const secondAuth = await auth(raceId);
    const first = await inputFor(firstAuth, entryId);
    const second = await inputFor(secondAuth, entryId);
    second.request.identity.givenName = "Annat val";
    const results = await Promise.all([changeEntryIdentityAsAdmin(db, first, now), changeEntryIdentityAsAdmin(db, second, now)]);
    expect(results.map((result) => result.status).sort()).toEqual(["changed", "conflict"]);
    const journal = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, raceId));
    expect(journal).toHaveLength(1);
    const winner = results.find((result) => result.status === "changed");
    if (!winner || winner.status !== "changed") throw new Error("Vinnande rättning saknas");
    expect(journal[0]).toMatchObject({ identity: winner.response.identity,
      entryVersionAfter: first.request.expectedEntryVersion + 1, snapshotVersionAfter: first.request.expectedSnapshotVersion + 1 });
    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, entryId));
    expect(entry).toMatchObject({ ...winner.response.identity, version: first.request.expectedEntryVersion + 1 });
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    expect(race?.snapshotVersion).toBe(first.request.expectedSnapshotVersion + 1);
  });

  it("läser stabila journalblad utan privata credentials eller writes, även efter senare rättning", async () => {
    const { raceId, overview } = await importedRace();
    const entryId = overview.entries[0]!.id;
    const otherEntryId = overview.entries[1]!.id;
    const authentication = await auth(raceId);
    const wrong = await auth(raceId, "VIEW_RACE_OVERVIEW");
    const requestIds: string[] = [];
    for (const givenName of ["Ett", "Två", "Tre"]) {
      const input = await inputFor(authentication, entryId);
      input.request.identity.givenName = givenName;
      const result = await changeEntryIdentityAsAdmin(db, input, now);
      if (result.status !== "changed") throw new Error("Rättning misslyckades");
      requestIds.push(result.response.requestId);
    }
    const first = await listEntryIdentityHistoryAsAdmin(db, { ...authentication, entryId, limit: 2 }, now);
    if (first.status !== "ok" || first.response.nextCursor === null) throw new Error("Cursor saknas");
    expect(first.response.items.map(item => item.requestId)).toEqual(requestIds.slice(1).reverse());
    expect(first.response.items.map(item => item.identity.givenName)).toEqual(["Tre", "Två"]);
    const later = await inputFor(authentication, entryId);
    later.request.identity.givenName = "Fyra";
    expect((await changeEntryIdentityAsAdmin(db, later, now)).status).toBe("changed");
    const beforeReads = await state(raceId);
    const cursor = first.response.nextCursor;
    const second = await listEntryIdentityHistoryAsAdmin(db, { ...authentication, entryId, limit: 2, cursor }, now);
    if (second.status !== "ok") throw new Error("Äldre sida saknas");
    expect(second.response.items.map(item => item.requestId)).toEqual(requestIds.slice(0, 1));
    expect(second.response.items[0]?.identity.givenName).toBe("Ett");
    expect(second.response.nextCursor).toBeNull();
    const encoded = JSON.stringify(second.response);
    for (const secret of ["actorCredentialId", "sessionToken", "secretHash", authentication.sessionToken]) {
      expect(encoded).not.toContain(secret);
    }
    expect(await listEntryIdentityHistoryAsAdmin(db, { ...authentication, entryId: otherEntryId, limit: 2 }, now))
      .toEqual({ status: "ok", response: { formatVersion: 1, raceId, entryId: otherEntryId, items: [], nextCursor: null } });
    expect((await listEntryIdentityHistoryAsAdmin(db, { ...authentication, entryId: crypto.randomUUID(), limit: 2 }, now)).status).toBe("not-found");
    expect((await listEntryIdentityHistoryAsAdmin(db, { ...wrong, entryId, limit: 2 }, now)).status).toBe("forbidden");
    expect((await listEntryIdentityHistoryAsAdmin(db, { raceId, entryId, limit: 2, sessionToken: null }, now)).status).toBe("unauthorized");
    for (const input of [
      { ...authentication, entryId: otherEntryId, limit: 2, cursor },
      { ...authentication, raceId: crypto.randomUUID(), entryId, limit: 2, cursor },
      { ...authentication, entryId, limit: 51 }, { ...authentication, entryId, limit: 0 },
      { ...authentication, entryId, limit: 2, cursor: `${cursor}=` },
      { ...authentication, entryId, limit: 2, cursor: Buffer.from(JSON.stringify({
        v: 1, kind: "entry-identity-history", raceId, entryId, beforeEntryVersion: 1.5
      })).toString("base64url") }
    ]) expect((await listEntryIdentityHistoryAsAdmin(db, input, now)).status).toBe("invalid-request");
    expect(await state(raceId)).toEqual(beforeReads);
  });

  it("avvisar versionsoverflow utan entry-, journal- eller auditändring", async () => {
    for (const target of ["entry", "race"]) {
      const { raceId, overview } = await importedRace();
      const entryId = overview.entries[0]!.id;
      const authentication = await auth(raceId);
      if (target === "entry") await db.update(schema.entries).set({ version: 2_147_483_647 }).where(eq(schema.entries.id, entryId));
      else await db.update(schema.races).set({ snapshotVersion: 2_147_483_647 }).where(eq(schema.races.id, raceId));
      const input = await inputFor(authentication, entryId);
      const before = await state(raceId);
      expect((await changeEntryIdentityAsAdmin(db, input, now)).status).toBe("conflict");
      expect(await state(raceId)).toEqual(before);
    }
  });

  it("serialiserar samtidig import och rättning till ett helt före- eller efterläge", async () => {
    const { raceId, overview } = await importedRace();
    const bo = overview.entries.find(entry => entry.givenName === "Bo")!;
    const ada = overview.entries.find(entry => entry.givenName === "Ada")!;
    const authentication = await auth(raceId);
    const importer = await auth(raceId, "IMPORT_IOF");
    const input = await inputFor(authentication, bo.id);
    const xml = entryXml.replace("<Given>Ada</Given>", "<Given>Importerad Ada</Given>");
    const [correction, imported] = await Promise.all([
      changeEntryIdentityAsAdmin(db, input, now),
      importIofXmlAsAdmin(db, { ...importer, idempotencyKey: `iof-import:${crypto.randomUUID()}`,
        xmlBytes: Buffer.from(xml, "utf8") }, now)
    ]);
    const correctionWon = correction.status === "changed";
    expect([correction.status, imported.status]).toEqual(correctionWon ? ["changed", "conflict"] : ["conflict", "stored"]);
    const entries = await db.select().from(schema.entries).where(eq(schema.entries.raceId, raceId));
    expect(entries.find(entry => entry.id === bo.id)?.givenName).toBe(correctionWon ? "Alva" : "Bo");
    expect(entries.find(entry => entry.id === ada.id)?.givenName).toBe(correctionWon ? "Ada" : "Importerad Ada");
    const journals = await db.select().from(schema.entryIdentityChangeRequests).where(eq(schema.entryIdentityChangeRequests.raceId, raceId));
    expect(journals).toHaveLength(correctionWon ? 1 : 0);
    const [race] = await db.select().from(schema.races).where(eq(schema.races.id, raceId));
    expect(race?.snapshotVersion).toBe(input.request.expectedSnapshotVersion + 1);
  });

  it("skyddar rättade fält mot ny import med hel rollback men behåller identisk content-retry", async () => {
    const { raceId, overview } = await importedRace();
    // Bo comes last in the fixture, so Ada's earlier update must roll back on Bo's conflict.
    const bo = overview.entries.find((row) => row.givenName === "Bo")!;
    const authentication = await auth(raceId);
    const importAuth = await auth(raceId, "IMPORT_IOF");
    const input = await inputFor(authentication, bo.id);
    expect((await changeEntryIdentityAsAdmin(db, input, now)).status).toBe("changed");
    const before = await state(raceId);
    const conflictingXml = entryXml.replace("<Given>Ada</Given>", "<Given>Felaktig Ada</Given>");
    expect((await importIofXmlAsAdmin(db, { ...importAuth, idempotencyKey: `iof-import:${crypto.randomUUID()}`,
      xmlBytes: Buffer.from(conflictingXml, "utf8") }, now)).status).toBe("conflict");
    expect(await state(raceId)).toEqual(before);
    await expect(importIofXml(db, raceId, conflictingXml)).rejects.toThrow();
    expect(await state(raceId)).toEqual(before);
    await importIofXml(db, raceId, entryXml);
    expect(await state(raceId)).toEqual(before);
    const matching = entryXml.replace("<Given>Bo</Given>", "<Given>Alva</Given>").replace("<Family>Skog</Family>", "<Family>Rättad</Family>")
      .replace(/(<PersonEntry>\s*<Id>entry-bo<\/Id>[\s\S]*?<Organisation><Name>)Centrum OK/, "$1Ny OK");
    await expect(importIofXml(db, raceId, matching.replace("<Organisation><Name>Ny OK</Name></Organisation>", ""))).rejects.toThrow();
    expect(await state(raceId)).toEqual(before);
    await importIofXml(db, raceId, matching);
    const listed = await listEntryIdentitiesAsAdmin(db, authentication, now);
    if (listed.status !== "ok") throw new Error("Namnunderlag saknas efter import");
    expect(listed.response.entries.find((entry) => entry.id === bo.id)?.identity).toEqual(input.request.identity);
  });
});

describe("TASK 006B capability-skyddad IOF ResultList-export PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T22:00:00.000Z");
  const usedAt = new Date("2026-08-31T22:02:00.000Z");

  async function exportAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      label: `Resultatexport ${marker}`,
      expiresAt: new Date("2026-09-01T06:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "EXPORT_IOF_RESULT_LIST",
      now: new Date("2026-08-31T22:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Resultatexportsession kunde inte skapas");
    return { installation, login };
  }

  async function exportFootprint(raceId: string) {
    const [audits, raw, readouts, outcomes, revisions, imports] = await Promise.all([
      db.select({ value: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId)),
      db.select({ value: count() }).from(schema.deviceIngestOutcomes)
        .innerJoin(schema.rawDeviceMessages, eq(schema.deviceIngestOutcomes.rawMessageId, schema.rawDeviceMessages.id))
        .where(eq(schema.rawDeviceMessages.raceId, raceId)),
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)),
      db.select({ value: count() }).from(schema.importFiles).where(eq(schema.importFiles.raceId, raceId))
    ]);
    return [audits[0]?.value, raw[0]?.value, readouts[0]?.value, outcomes[0]?.value,
      revisions[0]?.value, imports[0]?.value];
  }

  it("exporterar senaste publicerade historiska projektion deterministiskt utan writes", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const ada = fixture.overview.entries.find((entry) => entry.cardNumber === okPayload.cardNumber);
    const h21 = fixture.overview.classes.find((raceClass) => raceClass.name === "H21");
    const d21 = fixture.overview.classes.find((raceClass) => raceClass.name === "D21");
    if (!ada || !h21 || !d21) throw new Error("Fixture saknar Ada eller klasser");

    await changeEntryClass(db, fixture.raceId, ada.id, d21.id);
    const historical = await recalculateEntry(db, fixture.raceId, ada.id);
    if (!historical) throw new Error("Historisk resultatrevision saknas");
    await db.insert(schema.resultRevisions).values({
      raceId: historical.raceId,
      entryId: historical.entryId,
      readoutId: historical.readoutId,
      revision: historical.revision + 1,
      cause: "EXPLICIT_RECALCULATION",
      status: historical.status,
      reason: historical.reason,
      evaluation: historical.evaluation,
      engineVersion: historical.engineVersion,
      snapshotVersion: historical.snapshotVersion,
      courseVersionId: historical.courseVersionId,
      published: false
    });
    await changeEntryClass(db, fixture.raceId, ada.id, h21.id);
    const [currentRace] = await db.select({ snapshotVersion: schema.races.snapshotVersion })
      .from(schema.races).where(eq(schema.races.id, fixture.raceId));
    if (!currentRace) throw new Error("Loppet saknas");
    const admin = await exportAdmin(fixture.raceId, 221);

    const before = await exportFootprint(fixture.raceId);
    const exports = await Promise.all(Array.from({ length: 100 }, () => exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt)));
    expect(exports.every((result) => result.status === "ok")).toBe(true);
    expect(await exportFootprint(fixture.raceId)).toEqual(before);
    const first = exports[0];
    if (!first || first.status !== "ok") throw new Error("Resultatexporten saknas");
    expect(first.metadata).toMatchObject({
      formatVersion: 1,
      raceId: fixture.raceId,
      snapshotVersion: currentRace.snapshotVersion,
      classCount: 1,
      resultCount: 1,
      staleResultCount: 1,
      omittedEntryCount: 1
    });
    expect(first.metadata.sha256).toBe(createHash("sha256").update(first.bytes).digest("hex"));
    expect(new Set(exports.map((result) => result.status === "ok" ? result.metadata.sha256 : "fel"))).toEqual(
      new Set([first.metadata.sha256])
    );
    const xml = new TextDecoder().decode(first.bytes);
    expect(xml).toContain("class-d21");
    expect(xml).toContain("entry-ada");
    expect(xml).toContain("Ada");
    expect(xml).not.toContain("class-h21");
    for (const secret of [fixture.raceId, ada.id, d21.id, historical.id,
      admin.installation.accessCredential, admin.login.sessionToken, okPayload.cardNumber]) {
      expect(xml).not.toContain(secret);
    }
  }, 30_000);

  it("visar endast helt före- eller efterläge när en tvåresultatsingest pågår samtidigt", async () => {
    const fixture = await importedRace();
    const admin = await exportAdmin(fixture.raceId, 226);
    const exportOnce = () => exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    const before = await exportOnce();
    expect(before.status === "ok" && before.metadata).toMatchObject({
      resultCount: 0,
      omittedEntryCount: 2
    });

    const boPayload = {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:41:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    };
    const deviceId = crypto.randomUUID();
    const firstWave = Array.from({ length: 50 }, exportOnce);
    const ingest = ingestDeviceBatch(db, fixture.raceId, {
      deviceId,
      sessionId: deviceId,
      packageVersion: 3,
      firstSequence: 1,
      lastSequence: 2,
      events: [okPayload, boPayload].map((payload, index) => ({
        localSequence: index + 1,
        stationReceivedAt: `2026-08-30T10:4${index + 1}:00Z`,
        transport: "simulator" as const,
        payload,
        contentHash: contentHash(payload)
      }))
    });
    const secondWave = Array.from({ length: 50 }, exportOnce);
    const [firstResults, , secondResults] = await Promise.all([
      Promise.all(firstWave),
      ingest,
      Promise.all(secondWave)
    ]);
    const concurrentExports = [...firstResults, ...secondResults];
    expect(concurrentExports.every((result) => result.status === "ok")).toBe(true);
    for (const result of concurrentExports) {
      if (result.status !== "ok") continue;
      expect([0, 2]).toContain(result.metadata.resultCount);
      expect(result.metadata.omittedEntryCount).toBe(2 - result.metadata.resultCount);
    }
    const after = await exportOnce();
    expect(after.status === "ok" && after.metadata).toMatchObject({
      resultCount: 2,
      omittedEntryCount: 0
    });
    if (after.status !== "ok") throw new Error("Resultatexporten saknas");
    const xml = new TextDecoder().decode(after.bytes);
    expect(xml.match(/<Position>1<\/Position>/g)).toHaveLength(2);
    expect(xml.match(/<TimeBehind>0<\/TimeBehind>/g)).toHaveLength(2);
    expect(xml.indexOf("<TimeBehind>0</TimeBehind>")).toBeLessThan(xml.indexOf("<Position>1</Position>"));
    expect(xml.indexOf("<Position>1</Position>")).toBeLessThan(xml.indexOf("<Status>OK</Status>"));
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results).toHaveLength(2);
    expect(publicResponse.results.map((result) => ({
      position: "position" in result ? result.position : undefined,
      timeBehindMs: "timeBehindMs" in result ? result.timeBehindMs : undefined,
      rankingState: result.rankingState
    }))).toEqual([
      { position: 1, timeBehindMs: 0, rankingState: "RANKED" },
      { position: 1, timeBehindMs: 0, rankingState: "RANKED" }
    ]);
    expect(JSON.stringify(publicResponse)).not.toMatch(/entryId|courseVersionId|evaluation|resultRevisionId/);
  }, 30_000);

  it("undertrycker ranking i publik DTO och IOF när OK-resultat använder blandade historiska banversioner", async () => {
    const fixture = await importedRace();
    const boPayload = {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    };
    const deviceId = crypto.randomUUID();
    await ingestDeviceBatch(db, fixture.raceId, {
      deviceId,
      sessionId: deviceId,
      packageVersion: 3,
      firstSequence: 1,
      lastSequence: 2,
      events: [okPayload, boPayload].map((payload, index) => ({
        localSequence: index + 1,
        stationReceivedAt: `2026-08-30T10:4${index + 1}:00Z`,
        transport: "simulator" as const,
        payload,
        contentHash: contentHash(payload)
      }))
    });
    const h21 = fixture.overview.classes.find((raceClass) => raceClass.name === "H21");
    const bo = fixture.overview.entries.find((entry) => entry.cardNumber === "67890");
    if (!h21 || !bo) throw new Error("Fixture saknar H21 eller Bo");
    const [currentVersion] = await db.select().from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, h21.courseVersionId));
    const [latestBo] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, bo.id))
      .orderBy(desc(schema.resultRevisions.revision)).limit(1);
    if (!currentVersion || !latestBo || latestBo.evaluation.status !== "OK") {
      throw new Error("Historiskt OK-resultat eller banversion saknas");
    }
    const [secondVersion] = await db.insert(schema.courseVersions).values({
      courseId: currentVersion.courseId,
      version: currentVersion.version + 1
    }).returning();
    if (!secondVersion) throw new Error("Ny historisk banversion saknas");
    const historicalControls = await db.select({
      controlId: schema.courseControls.controlId,
      sequence: schema.courseControls.sequence
    }).from(schema.courseControls)
      .where(eq(schema.courseControls.courseVersionId, currentVersion.id));
    await db.insert(schema.courseControls).values(historicalControls.map((control) => ({
      courseVersionId: secondVersion.id,
      controlId: control.controlId,
      sequence: control.sequence
    })));
    await db.insert(schema.resultRevisions).values({
      raceId: latestBo.raceId,
      entryId: latestBo.entryId,
      readoutId: latestBo.readoutId,
      revision: latestBo.revision + 1,
      cause: "EXPLICIT_RECALCULATION",
      status: latestBo.status,
      reason: latestBo.reason,
      evaluation: { ...latestBo.evaluation, courseVersionId: secondVersion.id },
      engineVersion: latestBo.engineVersion,
      snapshotVersion: latestBo.snapshotVersion,
      courseVersionId: secondVersion.id,
      published: true
    });

    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results.map((result) => result.rankingState)).toEqual([
      "MIXED_COURSE_VERSIONS",
      "MIXED_COURSE_VERSIONS"
    ]);
    expect(publicResponse.results.every((result) =>
      !("position" in result) && !("timeBehindMs" in result))).toBe(true);
    const admin = await exportAdmin(fixture.raceId, 229);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("Resultatexporten saknas");
    const xml = new TextDecoder().decode(exported.bytes);
    expect(xml).not.toContain("<Position>");
    expect(xml).not.toContain("<TimeBehind>");
    expect(xml.match(/<Status>OK<\/Status>/g)).toHaveLength(2);
  });

  it("isolerar capability och race, stoppar revocation och avvisar flerloppsevent", async () => {
    const fixture = await importedRace();
    const other = await importedRace();
    const admin = await exportAdmin(fixture.raceId, 231);
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: other.raceId
    }, usedAt)).resolves.toEqual({ status: "forbidden" });

    const overviewCredential = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "VIEW_RACE_OVERVIEW",
      label: "Fel exportcapability",
      expiresAt: new Date("2026-09-01T06:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 234) });
    const overviewLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: overviewCredential.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "VIEW_RACE_OVERVIEW",
      now: new Date("2026-08-31T22:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 235),
      csrfSecretBytes: Buffer.alloc(32, 236)
    });
    if (overviewLogin.status !== "authenticated") throw new Error("Felcapabilitysession saknas");
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: overviewLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "forbidden" });

    await expect(revokePairingAdminAccessCredential(db, {
      credentialId: admin.installation.credentialId,
      capability: "EXPORT_IOF_RESULT_LIST"
    }, usedAt)).resolves.toMatchObject({ status: "revoked" });
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "unauthorized" });

    const multi = await importedRace();
    const [multiRace] = await db.select().from(schema.races).where(eq(schema.races.id, multi.raceId));
    if (!multiRace) throw new Error("Flerloppsfixture saknas");
    await db.insert(schema.races).values({
      eventId: multiRace.eventId,
      name: "Etapp 2",
      raceDate: multiRace.raceDate
    });
    const multiAdmin = await exportAdmin(multi.raceId, 241);
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: multiAdmin.login.sessionToken,
      raceId: multi.raceId
    }, usedAt)).resolves.toEqual({ status: "conflict" });
  });
});

describe("TASK 006D immutable individuell resultatfinalisering PostgreSQL", () => {
  const issuedAt = new Date("2026-08-31T23:00:00.000Z");
  const usedAt = new Date("2026-08-31T23:02:00.000Z");

  async function finalizationAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "FINALIZE_RESULTS",
      label: `Finalisering ${marker}`,
      expiresAt: new Date("2026-09-01T07:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-08-31T23:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Finaliseringssession kunde inte skapas");
    return { installation, login };
  }

  async function finalExportAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      label: `Slutexport ${marker}`,
      expiresAt: new Date("2026-09-01T07:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "EXPORT_IOF_RESULT_LIST",
      now: new Date("2026-08-31T23:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Slutexportsession kunde inte skapas");
    return { installation, login };
  }

  async function fullyReadRace() {
    const fixture = await importedRace();
    const boPayload = {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    };
    const deviceId = crypto.randomUUID();
    await ingestDeviceBatch(db, fixture.raceId, {
      deviceId,
      sessionId: deviceId,
      packageVersion: 3,
      firstSequence: 1,
      lastSequence: 2,
      events: [okPayload, boPayload].map((payload, index) => ({
        localSequence: index + 1,
        stationReceivedAt: `2026-08-30T10:4${index + 1}:00Z`,
        transport: "simulator" as const,
        payload,
        contentHash: contentHash(payload)
      }))
    });
    return fixture;
  }

  it("fryser klass och lopp exakt idempotent och behåller gamla Complete-bytes efter senare ändring", async () => {
    const fixture = await fullyReadRace();
    const admin = await finalizationAdmin(fixture.raceId, 31);
    const auth = {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    };
    const initial = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (initial.status !== "ok") throw new Error("Finaliseringskandidaten saknas");
    const readyClass = initial.response.classes.find((candidate) => candidate.entryCount > 0);
    const emptyClass = initial.response.classes.find((candidate) => candidate.entryCount === 0);
    if (!readyClass) throw new Error("Icke-tom klass saknas");
    expect(readyClass.blockerCodes).toEqual([]);
    expect(emptyClass?.blockerCodes).toEqual(["EMPTY_CLASS"]);
    expect(JSON.stringify(initial.response)).not.toMatch(/\b(?:Ada|Bo|12345|67890|punch|evaluation)\b/i);

    const classRequestId = crypto.randomUUID();
    const classFinalizationId = crypto.randomUUID();
    const classRequest = {
      formatVersion: 1 as const,
      scope: "CLASS" as const,
      classId: readyClass.classId,
      expectedSnapshotVersion: initial.response.snapshotVersion,
      expectedBasisHash: readyClass.basisHash,
      expectedLatestScopeRevision: null
    };
    const classResults = await Promise.all(Array.from({ length: 100 }, () => finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: classRequest
    }, { now: usedAt, finalizationId: classFinalizationId })));
    expect(classResults.every((result) => result.status === "finalized")).toBe(true);
    expect(classResults.filter((result) => result.status === "finalized" && !result.response.replayed)).toHaveLength(1);
    expect(classResults.filter((result) => result.status === "finalized" && result.response.replayed)).toHaveLength(99);

    expect(await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: { ...classRequest, expectedBasisHash: "f".repeat(64) }
    }, { now: usedAt })).toEqual({ status: "conflict" });
    const otherActor = await finalizationAdmin(fixture.raceId, 61);
    expect(await finalizeResultsAsAdmin(db, {
      sessionToken: otherActor.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: otherActor.login.csrfToken,
      csrfHeader: otherActor.login.csrfToken,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: classRequest
    }, { now: usedAt })).toEqual({ status: "conflict" });

    const afterFirstClass = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (afterFirstClass.status !== "ok") throw new Error("Andra klasskandidaten saknas");
    expect(afterFirstClass.response.race.blockerCodes).toEqual([]);
    const currentClass = afterFirstClass.response.classes.find((candidate) => candidate.classId === readyClass.classId);
    if (!currentClass) throw new Error("Aktuell klasskandidat saknas");
    const secondClass = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        ...classRequest,
        expectedBasisHash: currentClass.basisHash,
        expectedLatestScopeRevision: 1
      }
    }, { now: new Date(usedAt.getTime() + 1) });
    expect(secondClass.status === "finalized" && secondClass.response.finalization.scopeRevision).toBe(2);

    const afterClass = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (afterClass.status !== "ok") throw new Error("Loppskandidaten saknas");
    expect(afterClass.response.race.blockerCodes).toEqual([]);
    const raceRequestId = crypto.randomUUID();
    const raceFinalizationId = crypto.randomUUID();
    const raceResult = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${raceRequestId}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: afterClass.response.snapshotVersion,
        expectedBasisHash: afterClass.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt, finalizationId: raceFinalizationId });
    if (raceResult.status !== "finalized" || raceResult.response.finalization.scope !== "RACE") {
      throw new Error("Loppsfinaliseringen saknas");
    }
    expect(raceResult.response.finalization).toMatchObject({
      id: raceFinalizationId,
      entryCount: 2,
      classCount: 1,
      scopeRevision: 1
    });

    const exporter = await finalExportAdmin(fixture.raceId, 41);
    const exportAuth = { sessionToken: exporter.login.sessionToken, raceId: fixture.raceId };
    const listed = await listFrozenRaceFinalizationsAsAdmin(db, exportAuth, usedAt);
    expect(listed.status === "ok" && listed.response.finalizations).toHaveLength(1);
    const frozenExports = await Promise.all(Array.from({ length: 100 }, () =>
      exportFrozenIofResultListAsAdmin(db, {
        ...exportAuth,
        finalizationId: raceFinalizationId
      }, usedAt)
    ));
    expect(frozenExports.every((result) => result.status === "ok")).toBe(true);
    const first = frozenExports[0];
    if (!first || first.status !== "ok") throw new Error("Fryst export saknas");
    const originalBytes = Buffer.from(first.bytes);
    const originalXml = originalBytes.toString("utf8");
    expect(originalXml).toContain('status="Complete"');
    expect(originalXml.match(/<PersonResult>/g)).toHaveLength(2);
    expect(first.finalization.completeXmlSha256).toBe(createHash("sha256").update(originalBytes).digest("hex"));
    expect(new Set(frozenExports.map((result) => result.status === "ok"
      ? createHash("sha256").update(result.bytes).digest("hex") : "fel"))).toEqual(
      new Set([first.finalization.completeXmlSha256])
    );

    const live = await exportIofResultListAsAdmin(db, exportAuth, usedAt);
    if (live.status !== "ok") throw new Error("Liveexport saknas");
    expect(new TextDecoder().decode(live.bytes)).toContain('status="Snapshot"');

    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.raceId, fixture.raceId)).limit(1);
    const [control] = await db.select().from(schema.controls).where(eq(schema.controls.raceId, fixture.raceId)).limit(1);
    if (!entry || !control) throw new Error("Display- eller kontrolldata saknas");
    await db.update(schema.entries).set({ givenName: "Ändrat namn" }).where(eq(schema.entries.id, entry.id));
    await db.update(schema.controls).set({ code: control.code + 1000 }).where(eq(schema.controls.id, control.id));
    const afterMutation = await exportFrozenIofResultListAsAdmin(db, {
      ...exportAuth,
      finalizationId: raceFinalizationId
    }, usedAt);
    expect(afterMutation.status === "ok" && Buffer.from(afterMutation.bytes)).toEqual(originalBytes);

    const staleCandidate = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (staleCandidate.status !== "ok") throw new Error("Stale kandidat saknas");
    expect(staleCandidate.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");

    const historicalReplay = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${classRequestId}`,
      request: classRequest
    }, { now: new Date(usedAt.getTime() + 10_000) });
    expect(historicalReplay.status === "finalized" && historicalReplay.response).toMatchObject({
      replayed: true,
      finalization: { id: classFinalizationId, scopeRevision: 1, basisHash: classRequest.expectedBasisHash }
    });

    const rows = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.raceId, fixture.raceId));
    expect(rows).toHaveLength(3);
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      sql`${schema.auditEvents.action} in ('RESULT_CLASS_FINALIZED', 'RESULT_RACE_FINALIZED')`
    ));
    expect(audits).toHaveLength(3);
    expect(JSON.stringify(audits)).not.toMatch(/\b(?:Ada|Bo|12345|67890)\b/);
    await expect(db.update(schema.resultFinalizations).set({ sourceHash: "f".repeat(64) })
      .where(eq(schema.resultFinalizations.id, classFinalizationId))).rejects.toThrow();
    await expect(db.delete(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, classFinalizationId))).rejects.toThrow();
  }, 45_000);

  it("blockerar ofullständig, opublicerad och olöst okänd grund utan finaliseringswrite", async () => {
    const fixture = await importedRace();
    const admin = await finalizationAdmin(fixture.raceId, 51);
    const auth = {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    };
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "999999",
      finishPunchedAt: "2026-08-30T10:45:00Z"
    }));
    const [latest] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, fixture.raceId)).orderBy(desc(schema.resultRevisions.revision)).limit(1);
    if (!latest) throw new Error("Resultatrevision saknas");
    await db.insert(schema.resultRevisions).values({
      raceId: latest.raceId,
      entryId: latest.entryId,
      readoutId: latest.readoutId,
      revision: latest.revision + 1,
      cause: "EXPLICIT_RECALCULATION",
      status: latest.status,
      reason: latest.reason,
      evaluation: latest.evaluation,
      engineVersion: latest.engineVersion,
      snapshotVersion: latest.snapshotVersion,
      courseVersionId: latest.courseVersionId,
      published: false
    });

    const candidate = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (candidate.status !== "ok") throw new Error("Blockerad kandidat saknas");
    const nonEmpty = candidate.response.classes.find((item) => item.entryCount > 0);
    if (!nonEmpty) throw new Error("Icke-tom klass saknas");
    expect(nonEmpty.blockerCodes).toEqual(expect.arrayContaining([
      "MISSING_RESULT_REVISION",
      "LATEST_RESULT_UNPUBLISHED"
    ]));
    expect(candidate.response.race.blockerCodes).toEqual(expect.arrayContaining([
      "UNKNOWN_CARD_UNRESOLVED",
      "MISSING_CLASS_FINALIZATION"
    ]));

    const result = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: nonEmpty.classId,
        expectedSnapshotVersion: candidate.response.snapshotVersion,
        expectedBasisHash: nonEmpty.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(result).toEqual({ status: "conflict" });
    const stored = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.raceId, fixture.raceId));
    expect(stored).toHaveLength(0);
  });

  it("serialiserar samtidig loppsfinalisering och sen okänd ingest till ett helt före- eller efterläge", async () => {
    const fixture = await fullyReadRace();
    const admin = await finalizationAdmin(fixture.raceId, 71);
    const auth = {
      sessionToken: admin.login.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: admin.login.csrfToken,
      csrfHeader: admin.login.csrfToken
    };
    const initial = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (initial.status !== "ok") throw new Error("Finaliseringskandidaten saknas");
    const classCandidate = initial.response.classes.find((candidate) => candidate.entryCount > 0);
    if (!classCandidate) throw new Error("Klasskandidaten saknas");
    const classResult = await finalizeResultsAsAdmin(db, {
      ...auth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: classCandidate.classId,
        expectedSnapshotVersion: initial.response.snapshotVersion,
        expectedBasisHash: classCandidate.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(classResult.status).toBe("finalized");
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppskandidaten saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));

    const unknownPayload = {
      ...okPayload,
      cardNumber: "999998",
      finishPunchedAt: "2026-08-30T10:55:00Z"
    };
    const [finalization, ingest] = await Promise.all([
      finalizeResultsAsAdmin(db, {
        ...auth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "RACE",
          classId: null,
          expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
          expectedBasisHash: raceCandidate.response.race.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt }),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), unknownPayload))
    ]);
    const unknownAcknowledgement = ingest.acknowledgements[0];
    if (!unknownAcknowledgement || unknownAcknowledgement.status !== "stored") {
      throw new Error("Samtidig okänd avläsning lagrades inte");
    }
    expect(unknownAcknowledgement.serverResult).toMatchObject({ status: "UNKNOWN_CARD" });
    expect(["finalized", "conflict"]).toContain(finalization.status);

    const finalRows = await db.select().from(schema.resultFinalizations).where(and(
      eq(schema.resultFinalizations.raceId, fixture.raceId),
      eq(schema.resultFinalizations.scope, "RACE")
    ));
    expect(finalRows).toHaveLength(finalization.status === "finalized" ? 1 : 0);
    if (finalization.status === "finalized") {
      expect(finalRows[0]?.completeXml).toContain('status="Complete"');
    }
    const after = await listResultFinalizationCandidatesAsAdmin(db, auth, usedAt);
    if (after.status !== "ok") throw new Error("Kandidaten efter ingest saknas");
    expect(after.response.race.blockerCodes).toContain("UNKNOWN_CARD_UNRESOLVED");
    const [raceAfter] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
  });
});

describe("TASK 006E explicit individuellt ej-startbeslut PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T08:00:00.000Z");
  const usedAt = new Date("2026-09-01T08:02:00.000Z");

  async function dnsAdmin(raceId: string, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability: "DECIDE_DID_NOT_START",
      label: `Ej start ${marker}`,
      expiresAt: new Date("2026-09-01T16:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "DECIDE_DID_NOT_START",
      now: new Date("2026-09-01T08:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("DNS-session kunde inte skapas");
    return { installation, login };
  }

  function dnsAuth(raceId: string, login: Awaited<ReturnType<typeof dnsAdmin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  function dnsRequest(candidate: {
    entryVersion: number;
    classId: string;
    courseVersionId: string;
  }, snapshotVersion: number, policyVersion = "did-not-start-v1" as const) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedLatestResultRevision: null,
      policyVersion
    };
  }

  async function decideFirstReady(raceId: string, marker: number) {
    const admin = await dnsAdmin(raceId, marker);
    const auth = dnsAuth(raceId, admin.login);
    const candidates = await listDidNotStartCandidatesAsAdmin(db, auth, usedAt);
    if (candidates.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = candidates.response.entries.find((entry) => entry.readiness === "READY");
    if (!candidate) throw new Error("Ingen DNS-kandidat är redo");
    const requestId = crypto.randomUUID();
    const result = await decideDidNotStartAsAdmin(db, {
      ...auth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start:${requestId}`,
      request: dnsRequest(candidate, candidates.response.snapshotVersion)
    }, usedAt);
    if (result.status !== "decided") throw new Error("DNS-beslutet misslyckades");
    return { admin, auth, candidate, candidates: candidates.response, requestId, result };
  }

  it("skapar ett immutable DNS-beslut exakt idempotent utan rawdata eller readout", async () => {
    const fixture = await importedRace();
    const admin = await dnsAdmin(fixture.raceId, 51);
    const auth = dnsAuth(fixture.raceId, admin.login);
    const listed = await listDidNotStartCandidatesAsAdmin(db, auth, usedAt);
    if (listed.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = listed.response.entries[0];
    if (!candidate || candidate.readiness !== "READY") throw new Error("DNS-kandidat saknas");
    const requestId = crypto.randomUUID();
    const input = {
      ...auth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start:${requestId}`,
      request: dnsRequest(candidate, listed.response.snapshotVersion)
    };
    const before = await Promise.all([
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId))
    ]);
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      decideDidNotStartAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "decided")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "decided" ? [attempt.response] : []);
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);

    const [decisions, revisions, audits, afterRaw, afterReadouts] = await Promise.all([
      db.select().from(schema.didNotStartDecisions).where(eq(schema.didNotStartDecisions.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId))
    ]);
    expect(decisions).toHaveLength(1);
    expect(revisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revision: 1,
      cause: "MANUAL_DID_NOT_START",
      status: "DNS",
      reason: "DID_NOT_START",
      readoutId: null,
      didNotStartDecisionId: decisions[0]!.id,
      published: true
    });
    expect(revisions[0]?.evaluation).toEqual({
      status: "DNS",
      reason: "DID_NOT_START",
      entryId: candidate.id,
      classId: candidate.classId,
      courseVersionId: candidate.courseVersionId
    });
    expect(afterRaw[0]?.value).toBe(before[0][0]?.value);
    expect(afterReadouts[0]?.value).toBe(before[1][0]?.value);
    await expect(db.update(schema.didNotStartDecisions).set({ status: "DNS" })
      .where(eq(schema.didNotStartDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.resultRevisions).where(eq(schema.resultRevisions.id, revisions[0]!.id)))
      .rejects.toThrow();

    await expect(decideDidNotStartAsAdmin(db, {
      ...input,
      request: { ...input.request, expectedEntryVersion: candidate.entryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await dnsAdmin(fixture.raceId, 57);
    await expect(decideDidNotStartAsAdmin(db, {
      ...dnsAuth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results).toContainEqual(expect.objectContaining({
      status: "DNS",
      reason: "DID_NOT_START",
      rankingState: "NOT_RANKABLE_STATUS",
      splits: []
    }));
    expect(publicResponse.results[0]).not.toHaveProperty("position");
  });

  it("serialiserar samtidig ingest och DNS till ett helt före- eller efterläge", async () => {
    const fixture = await importedRace();
    const admin = await dnsAdmin(fixture.raceId, 61);
    const auth = dnsAuth(fixture.raceId, admin.login);
    const listed = await listDidNotStartCandidatesAsAdmin(db, auth, usedAt);
    if (listed.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate) throw new Error("Ada saknas");
    const [decision, ingest] = await Promise.all([
      decideDidNotStartAsAdmin(db, {
        ...auth,
        entryId: candidate.id,
        idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
        request: dnsRequest(candidate, listed.response.snapshotVersion)
      }, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["decided", "conflict"]).toContain(decision.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(decision.status === "decided" ? [1, 2] : [1]);
    if (decision.status === "decided") {
      expect(revisions.map((revision) => revision.cause))
        .toEqual(["MANUAL_DID_NOT_START", "CARD_READOUT"]);
    } else {
      expect(revisions[0]?.cause).toBe("CARD_READOUT");
    }
  });

  it("låter OK och explicit DNS bli ett fryst status-only Complete", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const dns = await decideFirstReady(fixture.raceId, 71);
    const finalAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "FINALIZE_RESULTS",
      label: "DNS-finalisering",
      expiresAt: new Date("2026-09-01T16:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 73) });
    const finalLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: finalAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-09-01T08:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 74),
      csrfSecretBytes: Buffer.alloc(32, 75)
    });
    if (finalLogin.status !== "authenticated") throw new Error("Finaliseringssession saknas");
    const finalAuth = {
      sessionToken: finalLogin.sessionToken,
      raceId: fixture.raceId,
      csrfCookie: finalLogin.csrfToken,
      csrfHeader: finalLogin.csrfToken
    };
    const candidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (candidate.status !== "ok") throw new Error("Finaliseringskandidat saknas");
    const raceClass = candidate.response.classes.find(({ entryCount }) => entryCount > 0);
    if (!raceClass) throw new Error("Finaliseringsklass med deltagare saknas");
    expect(raceClass.blockerCodes).toEqual([]);
    const classResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: raceClass.classId,
        expectedSnapshotVersion: candidate.response.snapshotVersion,
        expectedBasisHash: raceClass.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(classResult.status).toBe("finalized");
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppskandidat saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const raceResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
        expectedBasisHash: raceCandidate.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    if (raceResult.status !== "finalized") throw new Error("Loppet finaliserades inte");
    const [stored] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    expect(stored?.completeXml).toContain('<ResultList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" creator="O-Tid" status="Complete">');
    expect(stored?.completeXml).toContain("<Status>DidNotStart</Status>");
    expect(stored?.completeXml?.match(/<SplitTime /g)).toHaveLength(3);
    expect(dns.result.response.status).toBe("DNS");
  });
});

describe("TASK 006F explicit återtagande av manuellt ej-startbeslut PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T09:00:00.000Z");
  const usedAt = new Date("2026-09-01T09:02:00.000Z");

  async function admin(raceId: string, capability: "DECIDE_DID_NOT_START" | "WITHDRAW_DID_NOT_START", marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T09:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
    return { installation, login };
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  async function manualDns(raceId: string, marker: number, name?: string) {
    const dns = await admin(raceId, "DECIDE_DID_NOT_START", marker);
    const dnsAuth = auth(raceId, dns.login);
    const candidates = await listDidNotStartCandidatesAsAdmin(db, dnsAuth, usedAt);
    if (candidates.status !== "ok") throw new Error("DNS-kandidater saknas");
    const candidate = name === undefined
      ? candidates.response.entries.find((entry) => entry.readiness === "READY")
      : candidates.response.entries.find((entry) => entry.readiness === "READY" && entry.displayName.includes(name));
    if (!candidate) throw new Error("DNS-kandidat saknas");
    const result = await decideDidNotStartAsAdmin(db, {
      ...dnsAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: candidates.response.snapshotVersion,
        expectedLatestResultRevision: null,
        policyVersion: "did-not-start-v1"
      }
    }, usedAt);
    if (result.status !== "decided") throw new Error("DNS-beslutet misslyckades");
    return { candidate, result };
  }

  function withdrawalRequest(entry: {
    entryVersion: number;
    classId: string;
    courseVersionId: string;
    didNotStartDecisionId: string;
    targetResultRevision: { id: string; revision: number };
  }, snapshotVersion: number) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: entry.entryVersion,
      expectedClassId: entry.classId,
      expectedCourseVersionId: entry.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedDidNotStartDecisionId: entry.didNotStartDecisionId,
      expectedResultRevision: {
        id: entry.targetResultRevision.id,
        revision: entry.targetResultRevision.revision
      },
      policyVersion: "did-not-start-withdrawal-v1" as const
    };
  }

  it("appendar exakt ett immutable återtagande utan resultatrevision och döljer DNS utan fallback", async () => {
    const fixture = await importedRace();
    const dns = await manualDns(fixture.raceId, 101);
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 111);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === dns.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    expect(candidate.state).toBe("WITHDRAWABLE");

    const requestId = crypto.randomUUID();
    const input = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${requestId}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    };
    const [raceBefore] = await db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId));
    const before = await Promise.all([
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId))
    ]);
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawDidNotStartAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(new Set(responses.map((response) => response.withdrawalId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);

    const [withdrawals, audits, revisionsAfter, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.didNotStartWithdrawals).where(eq(schema.didNotStartWithdrawals.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select({ value: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id)),
      db.select({ value: count() }).from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select({ value: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorKind: "DID_NOT_START_WITHDRAWAL_ACCESS_CREDENTIAL",
      action: "DID_NOT_START_WITHDRAWN"
    });
    expect(revisionsAfter[0]?.value).toBe(before[0][0]?.value);
    expect(rawAfter[0]?.value).toBe(before[1][0]?.value);
    expect(readoutsAfter[0]?.value).toBe(before[2][0]?.value);
    expect(raceAfter[0]?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    await expect(db.update(schema.didNotStartWithdrawals).set({ reason: "ERRONEOUS_MANUAL_DNS" })
      .where(eq(schema.didNotStartWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.didNotStartWithdrawals)
      .where(eq(schema.didNotStartWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();

    const afterList = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (afterList.status !== "ok") throw new Error("Återtagningslistan efter commit saknas");
    expect(afterList.response.entries.find((entry) => entry.id === candidate.id)?.state).toBe("WITHDRAWN");
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results.some((result) =>
      result.givenName === dns.candidate.displayName.split(" ")[0] && result.status === "DNS"
    )).toBe(false);

    const exportAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "EXPORT_IOF_RESULT_LIST",
      label: "Snapshot efter återtagande",
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 181) });
    const exportLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: exportAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "EXPORT_IOF_RESULT_LIST",
      now: new Date("2026-09-01T09:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 182),
      csrfSecretBytes: Buffer.alloc(32, 183)
    });
    if (exportLogin.status !== "authenticated") throw new Error("Exportsession saknas");
    const snapshot = await exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (snapshot.status !== "ok") throw new Error("Snapshotexport efter återtagande misslyckades");
    expect(new TextDecoder().decode(snapshot.bytes)).not.toContain("DidNotStart");
    expect(snapshot.metadata).toMatchObject({ resultCount: 0, omittedEntryCount: 2 });

    await expect(withdrawDidNotStartAsAdmin(db, {
      ...input,
      request: { ...input.request, expectedEntryVersion: candidate.entryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 121);
    await expect(withdrawDidNotStartAsAdmin(db, {
      ...auth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    await expect(withdrawDidNotStartAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
  });

  it("serialiserar återtagande mot ingest och visar senare kortrevision utan att ändra exact replay", async () => {
    const fixture = await importedRace();
    await manualDns(fixture.raceId, 131, "Ada");
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 141);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.state === "WITHDRAWABLE" && entry.displayName.includes("Ada"));
    if (!candidate) throw new Error("Ada saknas som återtagningskandidat");
    const requestId = crypto.randomUUID();
    const input = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${requestId}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    };
    const [withdrawal, ingest] = await Promise.all([
      withdrawDidNotStartAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawal.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id)).orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawal.status === "withdrawn"
        ? ["MANUAL_DID_NOT_START", "CARD_READOUT"]
        : ["MANUAL_DID_NOT_START", "CARD_READOUT"]
    );
    if (withdrawal.status === "withdrawn") {
      const replay = await withdrawDidNotStartAsAdmin(db, input, usedAt);
      expect(replay).toMatchObject({ status: "withdrawn", response: { replayed: true } });
    }
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      status: "OK",
      revision: 2
    }));
  });

  it("gör aktuell klassgrund ofinaliserbar med en explicit blocker", async () => {
    const fixture = await importedRace();
    const dns = await manualDns(fixture.raceId, 151);
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 161);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === dns.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    const withdrawn = await withdrawDidNotStartAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    }, usedAt);
    expect(withdrawn.status).toBe("withdrawn");

    const finalAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "FINALIZE_RESULTS",
      label: "Efter återtagande",
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 171) });
    const finalLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: finalAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-09-01T09:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 172),
      csrfSecretBytes: Buffer.alloc(32, 173)
    });
    if (finalLogin.status !== "authenticated") throw new Error("Finaliseringssession saknas");
    const finalCandidates = await listResultFinalizationCandidatesAsAdmin(db, auth(fixture.raceId, finalLogin), usedAt);
    if (finalCandidates.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    expect(finalCandidates.response.classes.find((raceClass) =>
      raceClass.classId === dns.candidate.classId
    )?.blockerCodes).toContain("WITHDRAWN_DID_NOT_START");
  });

  it("bevarar äldre fryst Complete byte-exakt men gör aktuell finaliseringsbasis inaktuell", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const dns = await manualDns(fixture.raceId, 191);
    const finalAdmin = await issuePairingAdminAccessCredential(db, {
      raceId: fixture.raceId,
      capability: "FINALIZE_RESULTS",
      label: "Frys före återtagande",
      expiresAt: new Date("2026-09-01T17:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 201) });
    const finalLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: finalAdmin.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "FINALIZE_RESULTS",
      now: new Date("2026-09-01T09:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, 202),
      csrfSecretBytes: Buffer.alloc(32, 203)
    });
    if (finalLogin.status !== "authenticated") throw new Error("Finaliseringssession saknas");
    const finalAuth = auth(fixture.raceId, finalLogin);
    const beforeClass = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (beforeClass.status !== "ok") throw new Error("Klassunderlaget saknas");
    const raceClass = beforeClass.response.classes.find((item) => item.classId === dns.candidate.classId);
    if (!raceClass || raceClass.blockerCodes.length > 0) throw new Error("Klassunderlaget kan inte frysas");
    const classResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "CLASS",
        classId: raceClass.classId,
        expectedSnapshotVersion: beforeClass.response.snapshotVersion,
        expectedBasisHash: raceClass.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    expect(classResult.status).toBe("finalized");
    const beforeRace = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (beforeRace.status !== "ok") throw new Error("Loppsunderlaget saknas");
    expect(beforeRace.response.race.blockerCodes).toEqual([]);
    const raceResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: beforeRace.response.snapshotVersion,
        expectedBasisHash: beforeRace.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    if (raceResult.status !== "finalized") throw new Error("Loppet kunde inte frysas");
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    if (!frozenBefore?.completeXml || !frozenBefore.completeXmlHash) throw new Error("Complete-bytes saknas");

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_START", 211);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotStartWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningslistan saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === dns.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    const withdrawn = await withdrawDidNotStartAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-start-withdrawal:${crypto.randomUUID()}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    }, usedAt);
    expect(withdrawn.status).toBe("withdrawn");

    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Aktuellt finaliseringsunderlag saknas");
    expect(after.response.classes.find((item) => item.classId === dns.candidate.classId)?.blockerCodes)
      .toContain("WITHDRAWN_DID_NOT_START");
    expect(after.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
    expect(after.response.race.basisHash).not.toBe(beforeRace.response.race.basisHash);
  });
});

describe("TASK 006G manuell resultatdiskvalifikation och append-only återtagande PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T10:00:00.000Z");
  const usedAt = new Date("2026-09-01T10:02:00.000Z");

  type Capability =
    | "DISQUALIFY_RESULT"
    | "WITHDRAW_DISQUALIFICATION"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS"
    | "DECIDE_DID_NOT_START"
    | "VIEW_READOUT_RESULT_HISTORY";

  async function admin(raceId: string, capability: Capability, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T18:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T10:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
    return { installation, login };
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  async function disqualifyAda(raceId: string, marker: number) {
    const resultAdmin = await admin(raceId, "DISQUALIFY_RESULT", marker);
    const resultAuth = auth(raceId, resultAdmin.login);
    const listed = await listResultDisqualificationCandidatesAsAdmin(db, resultAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Diskvalifikationskandidater saknas");
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som diskvalifikationskandidat");
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision,
        status: candidate.targetResultRevision.status
      },
      policyVersion: "manual-disqualification-v1" as const
    };
    return { candidate, request, resultAuth };
  }

  function withdrawalRequest(
    entry: ResultDisqualificationWithdrawalListResponse["entries"][number],
    snapshotVersion: number
  ) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: entry.entryVersion,
      expectedClassId: entry.classId,
      expectedCourseVersionId: entry.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedResultDisqualificationDecisionId: entry.resultDisqualificationDecisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedDisqualifiedResultRevision: entry.disqualifiedResultRevision,
      expectedAbsoluteResultRevision: entry.absoluteResultRevision,
      expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
      policyVersion: "manual-disqualification-withdrawal-v1" as const
    };
  }

  it("bevarar aktiv DSQ över senare readout och återställer exakt källa med full historik", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const prepared = await disqualifyAda(fixture.raceId, 31);
    const requestId = crypto.randomUUID();
    const disqualificationInput = {
      ...prepared.resultAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-disqualification:${requestId}`,
      request: prepared.request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      disqualifyResultAsAdmin(db, disqualificationInput, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "disqualified")).toBe(true);
    const responses = attempts.flatMap((attempt) =>
      attempt.status === "disqualified" ? [attempt.response] : []
    );
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);

    const [decisions, decisionAudits, afterDecision] = await Promise.all([
      db.select().from(schema.resultDisqualificationDecisions)
        .where(eq(schema.resultDisqualificationDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision))
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisionAudits).toHaveLength(1);
    expect(afterDecision.map((revision) => [revision.revision, revision.cause, revision.readoutId])).toEqual([
      [1, "CARD_READOUT", expect.any(String)],
      [2, "MANUAL_DISQUALIFICATION", null]
    ]);
    expect(afterDecision[1]).toMatchObject({
      status: "DSQ",
      reason: "MANUAL_DISQUALIFICATION",
      disqualificationDecisionId: decisions[0]!.id,
      published: true
    });
    expect(afterDecision[1]?.evaluation).toEqual({
      ...afterDecision[0]!.evaluation,
      status: "DSQ",
      reason: "MANUAL_DISQUALIFICATION"
    });

    const publicDisqualified = await publicResults(db, fixture.raceId);
    expect(publicDisqualified.formatVersion).toBe(7);
    expect(publicDisqualified.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "DSQ",
      reason: "MANUAL_DISQUALIFICATION",
      rankingState: "NOT_RANKABLE_STATUS"
    }));
    expect(publicDisqualified.results.find((result) => result.givenName === "Ada"))
      .not.toHaveProperty("position");

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 41);
    const snapshot = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (snapshot.status !== "ok") throw new Error("DSQ-snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(snapshot.bytes);
    expect(snapshotXml).toContain("<Status>Disqualified</Status>");
    expect(snapshotXml).not.toContain("<Position>");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const stillDisqualified = await publicResults(db, fixture.raceId);
    expect(stillDisqualified.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "DSQ"
    }));

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DISQUALIFICATION", 51);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listResultDisqualificationWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Diskvalifikationsåtertaganden saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate) throw new Error("Återtagningskandidaten saknas");
    expect(candidate).toMatchObject({
      state: "WITHDRAWABLE",
      disqualifiedResultRevision: { revision: 2 },
      absoluteResultRevision: { revision: 3 },
      restorationSourceResultRevision: { revision: 3, status: "OK", reason: "COMPLETE" }
    });
    const withdrawalRequestId = crypto.randomUUID();
    const withdrawalInput = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-disqualification-withdrawal:${withdrawalRequestId}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    };
    const withdrawals = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawResultDisqualificationAsAdmin(db, withdrawalInput, usedAt)
    ));
    expect(withdrawals.every((withdrawal) => withdrawal.status === "withdrawn")).toBe(true);
    const withdrawalResponses = withdrawals.flatMap((withdrawal) =>
      withdrawal.status === "withdrawn" ? [withdrawal.response] : []
    );
    expect(new Set(withdrawalResponses.map((response) => response.restorationResultRevisionId)).size).toBe(1);
    expect(withdrawalResponses.filter((response) => !response.replayed)).toHaveLength(1);

    const [storedWithdrawals, withdrawalAudits, history] = await Promise.all([
      db.select().from(schema.resultDisqualificationWithdrawals)
        .where(eq(schema.resultDisqualificationWithdrawals.requestId, withdrawalRequestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, withdrawalRequestId)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision))
    ]);
    expect(storedWithdrawals).toHaveLength(1);
    expect(withdrawalAudits).toHaveLength(1);
    expect(history.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_DISQUALIFICATION",
      "CARD_READOUT",
      "MANUAL_DISQUALIFICATION_WITHDRAWAL"
    ]);
    expect(history[3]).toMatchObject({
      revision: 4,
      readoutId: null,
      disqualificationWithdrawalId: storedWithdrawals[0]!.id,
      status: "OK",
      reason: "COMPLETE"
    });
    expect(history[3]?.evaluation).toEqual(history[2]?.evaluation);
    await expect(db.update(schema.resultDisqualificationDecisions).set({ status: "DSQ" })
      .where(eq(schema.resultDisqualificationDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.resultDisqualificationWithdrawals)
      .where(eq(schema.resultDisqualificationWithdrawals.id, storedWithdrawals[0]!.id))).rejects.toThrow();

    const restoredPublic = await publicResults(db, fixture.raceId);
    expect(restoredPublic.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 4,
      status: "OK"
    }));
    const historyAdmin = await admin(fixture.raceId, "VIEW_READOUT_RESULT_HISTORY", 61);
    const detail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: historyAdmin.login.sessionToken,
      raceId: fixture.raceId,
      readoutId: history[0]!.readoutId!,
      limit: 50
    }, usedAt);
    if (detail.status !== "ok") throw new Error("Resultathistoriken saknas");
    if (detail.response.formatVersion !== 15) throw new Error("Resultathistoriken använder inte format 15");
    expect(detail.response.history.items.map((revision) => revision.source.kind)).toEqual([
      "READOUT_RESULT",
      "MANUAL_DISQUALIFICATION",
      "READOUT_RESULT",
      "MANUAL_DISQUALIFICATION_WITHDRAWAL"
    ]);
  }, 30_000);

  it("fryser DSQ som IOF Complete och lämnar de frysta bytesen oförändrade efter återtagande", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const prepared = await disqualifyAda(fixture.raceId, 71);
    const disqualified = await disqualifyResultAsAdmin(db, {
      ...prepared.resultAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-disqualification:${crypto.randomUUID()}`,
      request: prepared.request
    }, usedAt);
    if (disqualified.status !== "disqualified") throw new Error("Ada diskvalificerades inte");

    const dnsAdmin = await admin(fixture.raceId, "DECIDE_DID_NOT_START", 81);
    const dnsAuth = auth(fixture.raceId, dnsAdmin.login);
    const dnsCandidates = await listDidNotStartCandidatesAsAdmin(db, dnsAuth, usedAt);
    if (dnsCandidates.status !== "ok") throw new Error("DNS-kandidater saknas");
    const dnsCandidate = dnsCandidates.response.entries.find((entry) => entry.readiness === "READY");
    if (!dnsCandidate) throw new Error("Den andra deltagaren saknas");
    const dns = await decideDidNotStartAsAdmin(db, {
      ...dnsAuth,
      entryId: dnsCandidate.id,
      idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: dnsCandidate.entryVersion,
        expectedClassId: dnsCandidate.classId,
        expectedCourseVersionId: dnsCandidate.courseVersionId,
        expectedSnapshotVersion: dnsCandidates.response.snapshotVersion,
        expectedLatestResultRevision: null,
        policyVersion: "did-not-start-v1"
      }
    }, usedAt);
    if (dns.status !== "decided") throw new Error("DNS-beslutet misslyckades");

    const finalAdmin = await admin(fixture.raceId, "FINALIZE_RESULTS", 91);
    const finalAuth = auth(fixture.raceId, finalAdmin.login);
    const classCandidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classCandidates.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    for (const candidate of classCandidates.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const result = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classCandidates.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt });
      expect(result.status).toBe("finalized");
    }
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppskandidaten saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const raceResult = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
        expectedBasisHash: raceCandidate.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    if (raceResult.status !== "finalized") throw new Error("Loppet finaliserades inte");
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    if (!frozenBefore?.completeXml) throw new Error("Fryst Complete saknas");
    expect(frozenBefore.completeXml).toContain("<Status>Disqualified</Status>");
    expect(frozenBefore.completeXml).toContain("<Status>DidNotStart</Status>");
    expect(frozenBefore.completeXml).not.toContain("<Position>");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_DISQUALIFICATION"');

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DISQUALIFICATION", 101);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listResultDisqualificationWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Återtagningskandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate) throw new Error("DSQ-återtagningskandidaten saknas");
    const withdrawn = await withdrawResultDisqualificationAsAdmin(db, {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-disqualification-withdrawal:${crypto.randomUUID()}`,
      request: withdrawalRequest(candidate, listed.response.snapshotVersion)
    }, usedAt);
    expect(withdrawn.status).toBe("withdrawn");

    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, raceResult.response.finalization.id));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
    const current = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (current.status !== "ok") throw new Error("Aktuell finaliseringsbasis saknas");
    expect(current.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
  });
});

describe("TASK 006H manuellt resultatgodkännande och exakt återtagande PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T11:00:00.000Z");
  const usedAt = new Date("2026-09-01T11:02:00.000Z");
  const missingControlPayload = {
    ...okPayload,
    punches: [31, 33].map((code, index) => ({
      code,
      punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
    }))
  };

  type Capability =
    | "APPROVE_RESULT"
    | "WITHDRAW_RESULT_APPROVAL"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS"
    | "DECIDE_DID_NOT_START"
    | "VIEW_READOUT_RESULT_HISTORY";

  async function admin(raceId: string, capability: Capability, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T19:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T11:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
    return { installation, login };
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  function withdrawalRequest(
    entry: ResultApprovalWithdrawalListResponse["entries"][number],
    snapshotVersion: number
  ) {
    return {
      formatVersion: 1 as const,
      expectedEntryVersion: entry.entryVersion,
      expectedClassId: entry.classId,
      expectedCourseVersionId: entry.courseVersionId,
      expectedSnapshotVersion: snapshotVersion,
      expectedResultApprovalDecisionId: entry.resultApprovalDecisionId,
      expectedTargetResultRevision: entry.targetResultRevision,
      expectedApprovedResultRevision: entry.approvedResultRevision,
      expectedAbsoluteResultRevision: entry.absoluteResultRevision,
      expectedRestorationSourceResultRevision: entry.restorationSourceResultRevision,
      policyVersion: "manual-result-approval-withdrawal-v1" as const
    };
  }

  async function finalizeAll(raceId: string, marker: number) {
    const finalAdmin = await admin(raceId, "FINALIZE_RESULTS", marker);
    const finalAuth = auth(raceId, finalAdmin.login);
    const classes = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classes.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    for (const candidate of classes.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const finalized = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classes.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: candidate.latestFinalization?.scopeRevision ?? null
        }
      }, { now: usedAt });
      expect(finalized.status).toBe("finalized");
    }
    const race = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (race.status !== "ok") throw new Error("Loppsfinaliseringskandidat saknas");
    expect(race.response.race.blockerCodes).toEqual([]);
    const finalizedRace = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: race.response.snapshotVersion,
        expectedBasisHash: race.response.race.basisHash,
        expectedLatestScopeRevision: race.response.race.latestFinalization?.scopeRevision ?? null
      }
    }, { now: usedAt });
    if (finalizedRace.status !== "finalized") throw new Error("Loppet finaliserades inte");
    return finalizedRace.response.finalization.id;
  }

  it("godkänner tidsatt MP/MISSING_CONTROL exakt en gång, bevarar overlay över ingest och återställer exakt senaste tekniska huvud", async () => {
    const fixture = await importedRace();
    const firstIngest = await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    expect(firstIngest.acknowledgements[0]?.status).toBe("stored");
    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 31);
    const approvalAuth = auth(fixture.raceId, approvalAdmin.login);
    const listed = await listResultApprovalCandidatesAsAdmin(db, approvalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`Godkännandekandidater saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som godkännandekandidat");
    expect(candidate.targetResultRevision).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });

    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const approvalInput = {
      ...approvalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-result-approval:${requestId}`,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: {
          id: candidate.targetResultRevision.id,
          revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status,
          reason: candidate.targetResultRevision.reason
        },
        policyVersion: "manual-result-approval-v1" as const
      }
    };
    const approvals = await Promise.all(Array.from({ length: 100 }, () =>
      approveResultAsAdmin(db, approvalInput, usedAt)
    ));
    expect(approvals.every((approval) => approval.status === "approved")).toBe(true);
    const approvalResponses = approvals.flatMap((approval) => approval.status === "approved" ? [approval.response] : []);
    expect(new Set(approvalResponses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(approvalResponses.filter((response) => !response.replayed)).toHaveLength(1);

    const [decisions, decisionAudits, approvedHistory, rawAfterApproval, readoutsAfterApproval, raceAfterApproval] = await Promise.all([
      db.select().from(schema.resultApprovalDecisions).where(eq(schema.resultApprovalDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisionAudits).toHaveLength(1);
    expect(approvedHistory).toHaveLength(2);
    expect(approvedHistory[1]).toMatchObject({
      revision: 2,
      cause: "MANUAL_RESULT_APPROVAL",
      status: "OK",
      reason: "MANUAL_APPROVAL",
      approvalDecisionId: decisions[0]!.id,
      readoutId: null,
      published: true
    });
    expect(approvedHistory[1]?.evaluation).toEqual({
      ...approvedHistory[0]!.evaluation,
      status: "OK",
      reason: "MANUAL_APPROVAL"
    });
    expect(rawAfterApproval).toEqual(rawBefore);
    expect(readoutsAfterApproval).toEqual(readoutsBefore);
    expect(raceAfterApproval?.snapshotVersion).toBe(raceBefore?.snapshotVersion);

    const afterApproval = await publicResults(db, fixture.raceId);
    expect(afterApproval.formatVersion).toBe(7);
    expect(afterApproval.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "OK",
      reason: "MANUAL_APPROVAL",
      missingControls: [32],
      rankingState: "RANKED",
      position: 1
    }));

    const secondIngest = await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    expect(secondIngest.acknowledgements[0]?.status).toBe("stored");
    const stillApproved = await publicResults(db, fixture.raceId);
    expect(stillApproved.results).toContainEqual(expect.objectContaining({
      givenName: "Ada", revision: 2, status: "OK", reason: "MANUAL_APPROVAL"
    }));

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_RESULT_APPROVAL", 41);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const withdrawalList = await listResultApprovalWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (withdrawalList.status !== "ok") throw new Error("Godkännandeåtertaganden saknas");
    const withdrawalCandidate = withdrawalList.response.entries.find((entry) => entry.id === candidate.id);
    if (!withdrawalCandidate) throw new Error("Ada saknas som återtagningskandidat");
    expect(withdrawalCandidate).toMatchObject({
      state: "WITHDRAWABLE",
      targetResultRevision: { revision: 1, status: "MP", reason: "MISSING_CONTROL" },
      approvedResultRevision: { revision: 2 },
      absoluteResultRevision: { revision: 3 },
      restorationSourceResultRevision: { revision: 3, status: "OK", reason: "COMPLETE" }
    });

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 51);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("IOF-snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    expect(snapshotXml).toContain("<Status>OK</Status>");
    expect(snapshotXml).toContain('<SplitTime status="Missing">');
    expect(snapshotXml).not.toContain(decisions[0]!.id);
    expect(snapshotXml).not.toContain(candidate.targetResultRevision.id);
    expect(snapshotXml).not.toContain("MANUAL_APPROVAL");

    const dnsAdmin = await admin(fixture.raceId, "DECIDE_DID_NOT_START", 61);
    const dnsAuth = auth(fixture.raceId, dnsAdmin.login);
    const dnsList = await listDidNotStartCandidatesAsAdmin(db, dnsAuth, usedAt);
    if (dnsList.status !== "ok") throw new Error("DNS-kandidater saknas");
    const dnsCandidate = dnsList.response.entries.find((entry) => entry.readiness === "READY");
    if (!dnsCandidate) throw new Error("Den andra deltagaren saknas");
    const dns = await decideDidNotStartAsAdmin(db, {
      ...dnsAuth,
      entryId: dnsCandidate.id,
      idempotencyKey: `did-not-start:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: dnsCandidate.entryVersion,
        expectedClassId: dnsCandidate.classId,
        expectedCourseVersionId: dnsCandidate.courseVersionId,
        expectedSnapshotVersion: dnsList.response.snapshotVersion,
        expectedLatestResultRevision: null,
        policyVersion: "did-not-start-v1"
      }
    }, usedAt);
    expect(dns.status).toBe("decided");

    const frozenFinalizationId = await finalizeAll(fixture.raceId, 71);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, frozenFinalizationId));
    if (!frozenBefore?.completeXml) throw new Error("Fryst Complete saknas");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_RESULT_APPROVAL"');
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(decisions[0]!.id);
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(withdrawalCandidate.absoluteResultRevision.id);
    expect(frozenBefore.completeXml).toContain("<Status>OK</Status>");
    expect(frozenBefore.completeXml).toContain('<SplitTime status="Missing">');
    expect(frozenBefore.completeXml).not.toContain(decisions[0]!.id);

    const withdrawalRequestId = crypto.randomUUID();
    const withdrawalInput = {
      ...withdrawalAuth,
      entryId: withdrawalCandidate.id,
      idempotencyKey: `manual-result-approval-withdrawal:${withdrawalRequestId}`,
      request: withdrawalRequest(withdrawalCandidate, withdrawalList.response.snapshotVersion)
    };
    const withdrawals = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawResultApprovalAsAdmin(db, withdrawalInput, usedAt)
    ));
    expect(withdrawals.every((withdrawal) => withdrawal.status === "withdrawn")).toBe(true);
    const withdrawalResponses = withdrawals.flatMap((withdrawal) => withdrawal.status === "withdrawn" ? [withdrawal.response] : []);
    expect(new Set(withdrawalResponses.map((response) => response.restorationResultRevisionId)).size).toBe(1);
    expect(withdrawalResponses.filter((response) => !response.replayed)).toHaveLength(1);

    const [storedWithdrawals, withdrawalAudits, history, frozenAfter] = await Promise.all([
      db.select().from(schema.resultApprovalWithdrawals).where(eq(schema.resultApprovalWithdrawals.requestId, withdrawalRequestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, withdrawalRequestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, frozenFinalizationId)).then((rows) => rows[0])
    ]);
    expect(storedWithdrawals).toHaveLength(1);
    expect(withdrawalAudits).toHaveLength(1);
    expect(history.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_RESULT_APPROVAL",
      "CARD_READOUT",
      "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
    ]);
    expect(history[3]).toMatchObject({
      revision: 4,
      readoutId: null,
      approvalWithdrawalId: storedWithdrawals[0]!.id,
      status: "OK",
      reason: "COMPLETE"
    });
    expect(history[3]?.evaluation).toEqual(history[2]?.evaluation);
    await expect(db.update(schema.resultApprovalDecisions).set({ status: "OK" })
      .where(eq(schema.resultApprovalDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.resultApprovalWithdrawals)
      .where(eq(schema.resultApprovalWithdrawals.id, storedWithdrawals[0]!.id))).rejects.toThrow();

    const historyAdmin = await admin(fixture.raceId, "VIEW_READOUT_RESULT_HISTORY", 81);
    const detail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: historyAdmin.login.sessionToken,
      raceId: fixture.raceId,
      readoutId: history[0]!.readoutId!,
      limit: 50
    }, usedAt);
    if (detail.status !== "ok" || detail.response.formatVersion !== 15) {
      throw new Error("Resultathistoriken använder inte format 15");
    }
    expect(detail.response.history.items.map((revision) => revision.source.kind)).toEqual([
      "READOUT_RESULT",
      "MANUAL_RESULT_APPROVAL",
      "READOUT_RESULT",
      "MANUAL_RESULT_APPROVAL_WITHDRAWAL"
    ]);
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
  }, 30_000);

  it("fail-closed för ett tekniskt OK som inte är ett godkännandekandidatutfall", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 91);
    const listed = await listResultApprovalCandidatesAsAdmin(db, auth(fixture.raceId, approvalAdmin.login), usedAt);
    if (listed.status !== "ok") throw new Error(`Godkännandekandidater saknas: ${listed.status}`);
    const ada = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    expect(ada).toMatchObject({ readiness: "UNSUPPORTED_RESULT", targetResultRevision: null });
  });
});

describe("TASK 006I/006J explicit DNF lifecycle PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T12:00:00.000Z");
  const usedAt = new Date("2026-09-01T12:02:00.000Z");
  const missingControlPayload = {
    ...okPayload,
    punches: [31, 33].map((code, index) => ({
      code,
      punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
    }))
  };

  type Capability =
    | "DECIDE_DID_NOT_FINISH"
    | "WITHDRAW_DID_NOT_FINISH"
    | "APPROVE_RESULT"
    | "DISQUALIFY_RESULT"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS"
    | "VIEW_READOUT_RESULT_HISTORY";

  async function admin(raceId: string, capability: Capability, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T20:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T12:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("Arrangörssession saknas");
    return { installation, login };
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  async function readyDidNotFinish(raceId: string, marker: number) {
    const dnfAdmin = await admin(raceId, "DECIDE_DID_NOT_FINISH", marker);
    const dnfAuth = auth(raceId, dnfAdmin.login);
    const listed = await listDidNotFinishCandidatesAsAdmin(db, dnfAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`DNF-kandidater saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som DNF-kandidat");
    return {
      dnfAuth,
      candidate,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: {
          id: candidate.targetResultRevision.id,
          revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status
        },
        policyVersion: "did-not-finish-v1" as const
      }
    };
  }

  async function activeDidNotFinishForWithdrawal(raceId: string, marker: number) {
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), missingControlPayload));
    const prepared = await readyDidNotFinish(raceId, marker);
    const decided = await decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${crypto.randomUUID()}`,
      request: prepared.request
    }, usedAt);
    if (decided.status !== "did-not-finish") throw new Error("DNF-beslutet skapades inte");
    const withdrawalAdmin = await admin(raceId, "WITHDRAW_DID_NOT_FINISH", marker + 3);
    const withdrawalAuth = auth(raceId, withdrawalAdmin.login);
    const listed = await listDidNotFinishWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`DNF-återtaganden saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Aktivt DNF kan inte återtas");
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedDidNotFinishDecisionId: candidate.didNotFinishDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedDidNotFinishResultRevision: candidate.didNotFinishResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-withdrawal-v1" as const
    };
    return { prepared, withdrawalAuth, candidate, request };
  }

  function personResultBody(xml: string, givenName: string): string {
    const match = xml.match(new RegExp(
      `<PersonResult>[\\s\\S]*?<Given>${givenName}</Given>[\\s\\S]*?<Result>([\\s\\S]*?)</Result>[\\s\\S]*?</PersonResult>`
    ));
    if (!match?.[1]) throw new Error(`${givenName} saknas i IOF-exporten`);
    return match[1];
  }

  async function finalizeAll(raceId: string, marker: number) {
    const finalAdmin = await admin(raceId, "FINALIZE_RESULTS", marker);
    const finalAuth = auth(raceId, finalAdmin.login);
    const classes = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classes.status !== "ok") throw new Error("Finaliseringskandidater saknas");
    for (const candidate of classes.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const finalized = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classes.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: candidate.latestFinalization?.scopeRevision ?? null
        }
      }, { now: usedAt });
      expect(finalized.status).toBe("finalized");
    }
    const race = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (race.status !== "ok") throw new Error("Loppsfinaliseringskandidat saknas");
    expect(race.response.race.blockerCodes).toEqual([]);
    const finalizedRace = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: race.response.snapshotVersion,
        expectedBasisHash: race.response.race.basisHash,
        expectedLatestScopeRevision: race.response.race.latestFinalization?.scopeRevision ?? null
      }
    }, { now: usedAt });
    if (finalizedRace.status !== "finalized") throw new Error("Loppet finaliserades inte");
    return finalizedRace.response.finalization.id;
  }

  it("skriver DNF exakt en gång, bevarar overlay över ingest och fryser status-only DidNotFinish", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    const prepared = await readyDidNotFinish(fixture.raceId, 111);
    expect(prepared.candidate.targetResultRevision).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });

    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const dnfInput = {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${requestId}`,
      request: prepared.request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      decideDidNotFinishAsAdmin(db, dnfInput, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "did-not-finish")).toBe(true);
    const responses = attempts.flatMap((attempt) =>
      attempt.status === "did-not-finish" ? [attempt.response] : []
    );
    expect(new Set(responses.map((response) => response.didNotFinishDecisionId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);

    const [decisions, decisionAudits, history, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.didNotFinishDecisions).where(eq(schema.didNotFinishDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisionAudits).toHaveLength(1);
    expect(decisionAudits[0]).toMatchObject({
      action: "DID_NOT_FINISH_DECIDED",
      actorKind: "DID_NOT_FINISH_ACCESS_CREDENTIAL"
    });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      revision: 2,
      cause: "MANUAL_DID_NOT_FINISH",
      status: "DNF",
      reason: "DID_NOT_FINISH",
      didNotFinishDecisionId: decisions[0]!.id,
      readoutId: null,
      published: true
    });
    expect(history[1]?.evaluation).toEqual({
      status: "DNF",
      reason: "DID_NOT_FINISH",
      entryId: prepared.candidate.id,
      classId: prepared.candidate.classId,
      courseVersionId: prepared.candidate.courseVersionId
    });
    await expect(db.update(schema.didNotFinishDecisions).set({ status: "DNF" })
      .where(eq(schema.didNotFinishDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.didNotFinishDecisions)
      .where(eq(schema.didNotFinishDecisions.id, decisions[0]!.id))).rejects.toThrow();
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);

    await expect(decideDidNotFinishAsAdmin(db, {
      ...dnfInput,
      request: {
        ...prepared.request,
        expectedResultRevision: { ...prepared.request.expectedResultRevision, status: "OK" as const }
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await decideDidNotFinishAsAdmin(db, dnfInput, usedAt)).toMatchObject({
      status: "did-not-finish",
      response: { replayed: true, didNotFinishDecisionId: decisions[0]!.id }
    });

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const publicDnf = await publicResults(db, fixture.raceId);
    expect(publicDnf.formatVersion).toBe(7);
    expect(publicDnf.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 2,
      status: "DNF",
      reason: "DID_NOT_FINISH",
      missingControls: [],
      extraPunches: [],
      splits: [],
      rankingState: "NOT_RANKABLE_STATUS"
    }));
    expect(publicDnf.results.find((result) => result.givenName === "Ada")).not.toHaveProperty("elapsedMs");

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 121);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("IOF-snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    expect(snapshotXml).toContain('status="Snapshot"');
    const snapshotDnf = personResultBody(snapshotXml, "Ada");
    expect(snapshotDnf).toContain("<Status>DidNotFinish</Status>");
    expect(snapshotDnf).not.toMatch(/<(StartTime|FinishTime|Time|TimeBehind|Position|SplitTime)(?:\s|>)/);

    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 131);
    const approvalAuth = auth(fixture.raceId, approvalAdmin.login);
    const approvalList = await listResultApprovalCandidatesAsAdmin(db, approvalAuth, usedAt);
    if (approvalList.status !== "ok") throw new Error("Godkännandekandidater saknas");
    expect(approvalList.response.entries.find((entry) => entry.id === prepared.candidate.id)).toMatchObject({
      readiness: "ACTIVE_DID_NOT_FINISH",
      targetResultRevision: null
    });

    const disqualificationAdmin = await admin(fixture.raceId, "DISQUALIFY_RESULT", 141);
    const disqualificationAuth = auth(fixture.raceId, disqualificationAdmin.login);
    const disqualificationList = await listResultDisqualificationCandidatesAsAdmin(db, disqualificationAuth, usedAt);
    if (disqualificationList.status !== "ok") throw new Error("Diskvalifikationskandidater saknas");
    expect(disqualificationList.response.entries.find((entry) => entry.id === prepared.candidate.id)).toMatchObject({
      readiness: "ACTIVE_DID_NOT_FINISH",
      targetResultRevision: null
    });

    const latestTechnical = (await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
      .orderBy(desc(schema.resultRevisions.revision)))[0]!;
    expect(latestTechnical).toMatchObject({ revision: 3, status: "MP", reason: "MISSING_CONTROL" });
    const approvalRequestId = crypto.randomUUID();
    await expect(approveResultAsAdmin(db, {
      ...approvalAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-result-approval:${approvalRequestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: prepared.candidate.entryVersion,
        expectedClassId: prepared.candidate.classId,
        expectedCourseVersionId: prepared.candidate.courseVersionId,
        expectedSnapshotVersion: prepared.request.expectedSnapshotVersion,
        expectedResultRevision: {
          id: latestTechnical.id,
          revision: latestTechnical.revision,
          status: "MP",
          reason: "MISSING_CONTROL"
        },
        policyVersion: "manual-result-approval-v1"
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const disqualificationRequestId = crypto.randomUUID();
    await expect(disqualifyResultAsAdmin(db, {
      ...disqualificationAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `manual-disqualification:${disqualificationRequestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: prepared.candidate.entryVersion,
        expectedClassId: prepared.candidate.classId,
        expectedCourseVersionId: prepared.candidate.courseVersionId,
        expectedSnapshotVersion: prepared.request.expectedSnapshotVersion,
        expectedResultRevision: {
          id: latestTechnical.id,
          revision: latestTechnical.revision,
          status: "MP"
        },
        policyVersion: "manual-disqualification-v1"
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.resultApprovalDecisions)
      .where(eq(schema.resultApprovalDecisions.requestId, approvalRequestId))).toHaveLength(0);
    expect(await db.select().from(schema.resultDisqualificationDecisions)
      .where(eq(schema.resultDisqualificationDecisions.requestId, disqualificationRequestId))).toHaveLength(0);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalizationId = await finalizeAll(fixture.raceId, 151);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozenBefore?.completeXml) throw new Error("Fryst Complete saknas");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_DID_NOT_FINISH"');
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(decisions[0]!.id);
    expect(frozenBefore.completeXml).toContain('status="Complete"');
    const completeDnf = personResultBody(frozenBefore.completeXml, "Ada");
    expect(completeDnf).toContain("<Status>DidNotFinish</Status>");
    expect(completeDnf).not.toMatch(/<(StartTime|FinishTime|Time|TimeBehind|Position|SplitTime)(?:\s|>)/);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:42:00Z"
    }));
    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
  }, 30_000);

  it("återtar DNF exakt append-only, restaurerar senaste tekniska källa och tillåter nytt DNF först efter ny teknik", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    const prepared = await readyDidNotFinish(fixture.raceId, 191);
    const decided = await decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${crypto.randomUUID()}`,
      request: prepared.request
    }, usedAt);
    if (decided.status !== "did-not-finish") throw new Error("DNF-beslutet skapades inte");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const frozenId = await finalizeAll(fixture.raceId, 201);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, frozenId));
    if (!frozenBefore?.completeXml || !frozenBefore.completeXmlHash) {
      throw new Error("Fryst DNF-Complete saknas");
    }
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(personResultBody(frozenBefore.completeXml, "Ada")).toContain("<Status>DidNotFinish</Status>");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_DID_NOT_FINISH", 211);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listDidNotFinishWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`DNF-återtaganden saknas: ${listed.status}`);
    const candidate: DidNotFinishWithdrawalListResponse["entries"][number] | undefined =
      listed.response.entries.find((entry) => entry.id === prepared.candidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Ada kan inte återtas från DNF");
    expect(candidate.restorationSourceResultRevision).toMatchObject(candidate.absoluteResultRevision);
    expect(candidate.restorationSourceResultRevision).toMatchObject({ status: "MP", reason: "MISSING_CONTROL" });

    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const withdrawalRequest = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedDidNotFinishDecisionId: candidate.didNotFinishDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedDidNotFinishResultRevision: candidate.didNotFinishResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-withdrawal-v1" as const
    };
    const withdrawalInput = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `did-not-finish-withdrawal:${requestId}`,
      request: withdrawalRequest
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawDidNotFinishAsAdmin(db, withdrawalInput, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(new Set(responses.map((response) => response.didNotFinishWithdrawalId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.restorationResultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);

    const [withdrawals, audits, history, rawAfter, readoutsAfter, raceAfter, frozenAfter] = await Promise.all([
      db.select().from(schema.didNotFinishWithdrawals).where(eq(schema.didNotFinishWithdrawals.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0]),
      db.select().from(schema.resultFinalizations).where(eq(schema.resultFinalizations.id, frozenId)).then((rows) => rows[0])
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "DID_NOT_FINISH_WITHDRAWN",
      actorKind: "DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL"
    });
    expect(history.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_DID_NOT_FINISH",
      "CARD_READOUT",
      "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
    ]);
    expect(history[3]).toMatchObject({
      status: "MP",
      reason: "MISSING_CONTROL",
      readoutId: null,
      didNotFinishDecisionId: null,
      didNotFinishWithdrawalId: withdrawals[0]!.id,
      published: true
    });
    expect(history[3]!.evaluation).toEqual(history[2]!.evaluation);
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
    await expect(db.update(schema.didNotFinishWithdrawals).set({ reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" })
      .where(eq(schema.didNotFinishWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.didNotFinishWithdrawals)
      .where(eq(schema.didNotFinishWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(withdrawDidNotFinishAsAdmin(db, {
      ...withdrawalInput,
      request: { ...withdrawalRequest, expectedEntryVersion: withdrawalRequest.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const publicRestored = await publicResults(db, fixture.raceId);
    expect(publicRestored.formatVersion).toBe(7);
    expect(publicRestored.results).toContainEqual(expect.objectContaining({
      givenName: "Ada",
      revision: 4,
      status: "MP",
      reason: "MISSING_CONTROL",
      rankingState: "NOT_RANKABLE_STATUS"
    }));
    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 221);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("Restaurerad IOF Snapshot saknas");
    const restoredXml = new TextDecoder().decode(exported.bytes);
    expect(personResultBody(restoredXml, "Ada")).toContain("<Status>MissingPunch</Status>");
    expect(restoredXml).not.toContain(withdrawals[0]!.id);

    const historyAdmin = await admin(fixture.raceId, "VIEW_READOUT_RESULT_HISTORY", 231);
    const detail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: historyAdmin.login.sessionToken,
      raceId: fixture.raceId,
      readoutId: history[0]!.readoutId!,
      limit: 50
    }, usedAt);
    if (detail.status !== "ok" || detail.response.formatVersion !== 15) {
      throw new Error("DNF-historiken använder inte format 15");
    }
    expect(detail.response.history.items.map((revision) => revision.source.kind)).toEqual([
      "READOUT_RESULT",
      "MANUAL_DID_NOT_FINISH",
      "READOUT_RESULT",
      "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
    ]);

    const restoredFinalizationId = await finalizeAll(fixture.raceId, 241);
    const [restoredFinalization] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, restoredFinalizationId));
    if (!restoredFinalization?.completeXml) throw new Error("Restaurerad Complete saknas");
    expect(restoredFinalization.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(restoredFinalization.frozenProjection))
      .toContain('"kind":"MANUAL_DID_NOT_FINISH_WITHDRAWAL"');
    expect(personResultBody(restoredFinalization.completeXml, "Ada"))
      .toContain("<Status>MissingPunch</Status>");
    const [frozenStillStable] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, frozenId));
    expect(frozenStillStable?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenStillStable?.completeXmlHash).toBe(frozenBefore.completeXmlHash);

    const immediateCandidates = await listDidNotFinishCandidatesAsAdmin(db, prepared.dnfAuth, usedAt);
    if (immediateCandidates.status !== "ok") throw new Error("DNF-kandidater saknas efter återtagande");
    expect(immediateCandidates.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "UNSUPPORTED_RESULT",
      targetResultRevision: null
    });
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...missingControlPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z"
    }));
    const laterCandidates = await listDidNotFinishCandidatesAsAdmin(db, prepared.dnfAuth, usedAt);
    if (laterCandidates.status !== "ok") throw new Error("Nya tekniska DNF-kandidater saknas");
    const later = laterCandidates.response.entries.find((entry) => entry.id === candidate.id);
    if (!later?.targetResultRevision) throw new Error("Ny direkt teknisk DNF-källa saknas");
    expect(later).toMatchObject({ readiness: "READY", targetResultRevision: { revision: 5 } });
    const secondDnf = await decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: later.id,
      idempotencyKey: `did-not-finish:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: later.entryVersion,
        expectedClassId: later.classId,
        expectedCourseVersionId: later.courseVersionId,
        expectedSnapshotVersion: laterCandidates.response.snapshotVersion,
        expectedResultRevision: {
          id: later.targetResultRevision.id,
          revision: later.targetResultRevision.revision,
          status: later.targetResultRevision.status
        },
        policyVersion: "did-not-finish-v1"
      }
    }, usedAt);
    expect(secondDnf.status).toBe("did-not-finish");
    expect(await db.select().from(schema.didNotFinishDecisions)
      .where(eq(schema.didNotFinishDecisions.entryId, candidate.id))).toHaveLength(2);
  }, 30_000);

  it("ger exakt en vinnare för två samtidiga DNF-återtaganden med olika request-id", async () => {
    const fixture = await importedRace();
    const active = await activeDidNotFinishForWithdrawal(fixture.raceId, 41);
    const [first, second] = await Promise.all([
      withdrawDidNotFinishAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt),
      withdrawDidNotFinishAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt)
    ]);
    expect([first.status, second.status].sort()).toEqual(["conflict", "withdrawn"]);
    const [withdrawals, revisions, audits] = await Promise.all([
      db.select().from(schema.didNotFinishWithdrawals)
        .where(eq(schema.didNotFinishWithdrawals.entryId, active.candidate.id)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, active.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(and(
        eq(schema.auditEvents.raceId, fixture.raceId),
        eq(schema.auditEvents.action, "DID_NOT_FINISH_WITHDRAWN")
      ))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(revisions.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_DID_NOT_FINISH",
      "MANUAL_DID_NOT_FINISH_WITHDRAWAL"
    ]);
  });

  it("serialiserar samtidig DNF-withdrawal och ingest utan källbyte eller revisionslucka", async () => {
    const fixture = await importedRace();
    const active = await activeDidNotFinishForWithdrawal(fixture.raceId, 51);
    const input = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, ingest] = await Promise.all([
      withdrawDidNotFinishAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...missingControlPayload,
        finishPunchedAt: "2026-08-30T10:43:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawal.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, active.candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision)).toEqual(
      revisions.map((_revision, index) => index + 1)
    );
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawal.status === "withdrawn"
        ? [
            "CARD_READOUT",
            "MANUAL_DID_NOT_FINISH",
            "MANUAL_DID_NOT_FINISH_WITHDRAWAL",
            "CARD_READOUT"
          ]
        : ["CARD_READOUT", "MANUAL_DID_NOT_FINISH", "CARD_READOUT"]
    );
    if (withdrawal.status === "withdrawn") {
      await expect(withdrawDidNotFinishAsAdmin(db, input, usedAt)).resolves.toMatchObject({
        status: "withdrawn",
        response: { replayed: true }
      });
    }
    const audits = await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "DID_NOT_FINISH_WITHDRAWN")
    ));
    expect(audits).toHaveLength(withdrawal.status === "withdrawn" ? 1 : 0);
  });

  it("serialiserar samtidig DNF-withdrawal och loppsfinalisering till ett helt före- eller efterläge", async () => {
    const fixture = await importedRace();
    const active = await activeDidNotFinishForWithdrawal(fixture.raceId, 61);
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalAdmin = await admin(fixture.raceId, "FINALIZE_RESULTS", 67);
    const finalAuth = auth(fixture.raceId, finalAdmin.login);
    const classCandidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classCandidates.status !== "ok") throw new Error("Klassfinaliseringskandidater saknas");
    for (const candidate of classCandidates.response.classes.filter((item) => item.entryCount > 0)) {
      const finalized = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classCandidates.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt });
      expect(finalized.status).toBe("finalized");
    }
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppsfinaliseringskandidat saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const withdrawalInput = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `did-not-finish-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, finalization] = await Promise.all([
      withdrawDidNotFinishAsAdmin(db, withdrawalInput, usedAt),
      finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "RACE",
          classId: null,
          expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
          expectedBasisHash: raceCandidate.response.race.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt })
    ]);
    expect(withdrawal.status).toBe("withdrawn");
    expect(["finalized", "conflict"]).toContain(finalization.status);
    const raceFinalizations = await db.select().from(schema.resultFinalizations).where(and(
      eq(schema.resultFinalizations.raceId, fixture.raceId),
      eq(schema.resultFinalizations.scope, "RACE")
    ));
    expect(raceFinalizations).toHaveLength(finalization.status === "finalized" ? 1 : 0);
    if (finalization.status === "finalized") {
      expect(raceFinalizations[0]?.completeXml).toContain("<Status>DidNotFinish</Status>");
    }
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Finaliseringsunderlaget efter withdrawal saknas");
    expect(after.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
  });

  it("avvisar stale DNF efter senare ingest utan beslut, audit eller resultatrevision", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const prepared = await readyDidNotFinish(fixture.raceId, 161);
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const requestId = crypto.randomUUID();
    const [historyBefore, raceBefore] = await Promise.all([
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    await expect(decideDidNotFinishAsAdmin(db, {
      ...prepared.dnfAuth,
      entryId: prepared.candidate.id,
      idempotencyKey: `did-not-finish:${requestId}`,
      request: prepared.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const [decisions, audits, historyAfter, raceAfter] = await Promise.all([
      db.select().from(schema.didNotFinishDecisions).where(eq(schema.didNotFinishDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, prepared.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(historyAfter).toEqual(historyBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
  });

  it("låter inte en senare teknisk revision kringgå ett aktivt approval vid DSQ", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), missingControlPayload));
    const approvalAdmin = await admin(fixture.raceId, "APPROVE_RESULT", 171);
    const approvalAuth = auth(fixture.raceId, approvalAdmin.login);
    const listed = await listResultApprovalCandidatesAsAdmin(db, approvalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Godkännandekandidater saknas");
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som godkännandekandidat");
    const approval = await approveResultAsAdmin(db, {
      ...approvalAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-result-approval:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: {
          id: candidate.targetResultRevision.id,
          revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status,
          reason: candidate.targetResultRevision.reason
        },
        policyVersion: "manual-result-approval-v1"
      }
    }, usedAt);
    expect(approval.status).toBe("approved");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const disqualificationAdmin = await admin(fixture.raceId, "DISQUALIFY_RESULT", 181);
    const disqualificationAuth = auth(fixture.raceId, disqualificationAdmin.login);
    const listedDisqualification = await listResultDisqualificationCandidatesAsAdmin(db, disqualificationAuth, usedAt);
    if (listedDisqualification.status !== "ok") throw new Error("Diskvalifikationskandidater saknas");
    expect(listedDisqualification.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "ACTIVE_APPROVAL",
      targetResultRevision: null
    });
    const latestTechnical = (await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))
      .orderBy(desc(schema.resultRevisions.revision)))[0]!;
    expect(latestTechnical).toMatchObject({ revision: 3, status: "OK", reason: "COMPLETE" });
    const disqualificationRequestId = crypto.randomUUID();
    await expect(disqualifyResultAsAdmin(db, {
      ...disqualificationAuth,
      entryId: candidate.id,
      idempotencyKey: `manual-disqualification:${disqualificationRequestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: {
          id: latestTechnical.id,
          revision: latestTechnical.revision,
          status: "OK"
        },
        policyVersion: "manual-disqualification-v1"
      }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.resultDisqualificationDecisions)
      .where(eq(schema.resultDisqualificationDecisions.requestId, disqualificationRequestId))).toHaveLength(0);
    expect(await db.select().from(schema.auditEvents)
      .where(eq(schema.auditEvents.requestId, disqualificationRequestId))).toHaveLength(0);
    expect(await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))).toHaveLength(3);
  });
});

describe("TASK 006K/006L explicit individuellt utom tävlan-livscykel PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T14:00:00.000Z");
  const usedAt = new Date("2026-09-01T14:02:00.000Z");

  type Capability =
    | "DECIDE_OUT_OF_COMPETITION"
    | "WITHDRAW_OUT_OF_COMPETITION"
    | "DECIDE_DID_NOT_FINISH"
    | "APPROVE_RESULT"
    | "DISQUALIFY_RESULT"
    | "EXPORT_IOF_RESULT_LIST"
    | "FINALIZE_RESULTS"
    | "VIEW_READOUT_RESULT_HISTORY";

  async function admin(raceId: string, capability: Capability, marker: number) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T22:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T14:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("OOC-testets arrangörssession saknas");
    return { installation, login };
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>["login"]) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  async function finalizeAll(raceId: string, marker: number) {
    const finalAdmin = await admin(raceId, "FINALIZE_RESULTS", marker);
    const finalAuth = auth(raceId, finalAdmin.login);
    const classes = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classes.status !== "ok") throw new Error("OOC-finaliseringskandidater saknas");
    for (const candidate of classes.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const finalized = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classes.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: candidate.latestFinalization?.scopeRevision ?? null
        }
      }, { now: usedAt });
      expect(finalized.status).toBe("finalized");
    }
    const race = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (race.status !== "ok") throw new Error("OOC-loppsfinaliseringskandidat saknas");
    expect(race.response.race.blockerCodes).toEqual([]);
    const finalized = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: race.response.snapshotVersion,
        expectedBasisHash: race.response.race.basisHash,
        expectedLatestScopeRevision: race.response.race.latestFinalization?.scopeRevision ?? null
      }
    }, { now: usedAt });
    if (finalized.status !== "finalized") throw new Error("OOC-loppet finaliserades inte");
    return finalized.response.finalization.id;
  }

  function personResultBody(xml: string, givenName: string): string {
    const match = xml.match(new RegExp(
      `<PersonResult>[\\s\\S]*?<Given>${givenName}</Given>[\\s\\S]*?<Result>([\\s\\S]*?)</Result>[\\s\\S]*?</PersonResult>`
    ));
    if (!match?.[1]) throw new Error(`${givenName} saknas i OOC-exporten`);
    return match[1];
  }

  async function activeOutOfCompetitionForWithdrawal(raceId: string, marker: number) {
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(raceId, "DECIDE_OUT_OF_COMPETITION", marker);
    const oocAuth = auth(raceId, oocAdmin.login);
    const oocList = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (oocList.status !== "ok") throw new Error("OOC-kandidater saknas för concurrencytest");
    const oocCandidate = oocList.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!oocCandidate?.targetResultRevision) throw new Error("OOC-target saknas för concurrencytest");
    const decision = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: oocCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: oocCandidate.entryVersion,
        expectedClassId: oocCandidate.classId,
        expectedCourseVersionId: oocCandidate.courseVersionId,
        expectedSnapshotVersion: oocList.response.snapshotVersion,
        expectedResultRevision: {
          id: oocCandidate.targetResultRevision.id,
          revision: oocCandidate.targetResultRevision.revision,
          status: oocCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    if (decision.status !== "out-of-competition") throw new Error("OOC-beslut saknas för concurrencytest");
    const withdrawalAdmin = await admin(raceId, "WITHDRAW_OUT_OF_COMPETITION", marker + 3);
    const withdrawalAuth = auth(raceId, withdrawalAdmin.login);
    const list = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (list.status !== "ok") throw new Error("OOC-återtaganden saknas för concurrencytest");
    const candidate = list.response.entries.find((entry) => entry.id === oocCandidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") {
      throw new Error("Aktiv OOC saknas för concurrencytest");
    }
    return {
      candidate,
      withdrawalAuth,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: list.response.snapshotVersion,
        expectedNotCompetingDecisionId: candidate.notCompetingDecisionId,
        expectedTargetResultRevision: candidate.targetResultRevision,
        expectedOutOfCompetitionResultRevision: candidate.outOfCompetitionResultRevision,
        expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
        expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
        reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
        policyVersion: "out-of-competition-withdrawal-v1" as const
      }
    };
  }

  it("skriver OOC exakt idempotent, bevarar tekniska fakta och håller permanent overlay genom export och finalisering", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 31);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const listed = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`OOC-kandidater saknas: ${listed.status}`);
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknas som OOC-kandidat");
    const target = (await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, candidate.targetResultRevision.id)))[0]!;
    const requestId = crypto.randomUUID();
    const input = {
      ...oocAuth,
      entryId: candidate.id,
      idempotencyKey: `out-of-competition:${requestId}`,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: {
          id: candidate.targetResultRevision.id,
          revision: candidate.targetResultRevision.revision,
          status: candidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1" as const
      }
    };
    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const attempts = await Promise.all(Array.from({ length: 50 }, () =>
      decideOutOfCompetitionAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "out-of-competition")).toBe(true);
    const responses = attempts.flatMap((attempt) =>
      attempt.status === "out-of-competition" ? [attempt.response] : []
    );
    expect(new Set(responses.map((response) => response.notCompetingDecisionId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.resultRevisionId)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(49);

    const [decisions, audits, history, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.notCompetingDecisions).where(eq(schema.notCompetingDecisions.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(decisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "OUT_OF_COMPETITION_DECIDED",
      actorKind: "OUT_OF_COMPETITION_ACCESS_CREDENTIAL"
    });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      revision: target.revision + 1,
      cause: "MANUAL_OUT_OF_COMPETITION",
      status: "OOC",
      reason: "OUT_OF_COMPETITION",
      notCompetingDecisionId: decisions[0]!.id,
      readoutId: null,
      published: true
    });
    expect(history[1]?.evaluation).toEqual({
      ...(target.evaluation as unknown as Record<string, unknown>),
      status: "OOC",
      reason: "OUT_OF_COMPETITION"
    });
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    await expect(db.update(schema.notCompetingDecisions).set({ status: "OOC" })
      .where(eq(schema.notCompetingDecisions.id, decisions[0]!.id))).rejects.toThrow();

    await expect(decideOutOfCompetitionAsAdmin(db, {
      ...input,
      request: { ...input.request, expectedEntryVersion: candidate.entryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 41);
    await expect(decideOutOfCompetitionAsAdmin(db, {
      ...auth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request: input.request
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.formatVersion).toBe(7);
    const publicAda = publicResponse.results.find((result) => result.givenName === "Ada");
    expect(publicAda).toMatchObject({
      revision: target.revision + 1,
      status: "OOC",
      reason: "OUT_OF_COMPETITION",
      elapsedMs: 2_400_000,
      rankingState: "NOT_RANKABLE_STATUS"
    });
    expect(publicAda).not.toHaveProperty("position");
    expect(publicAda).not.toHaveProperty("timeBehindMs");

    const [dnfAdmin, approvalAdmin, disqualificationAdmin] = await Promise.all([
      admin(fixture.raceId, "DECIDE_DID_NOT_FINISH", 51),
      admin(fixture.raceId, "APPROVE_RESULT", 61),
      admin(fixture.raceId, "DISQUALIFY_RESULT", 71)
    ]);
    const [dnfCandidates, approvalCandidates, disqualificationCandidates] = await Promise.all([
      listDidNotFinishCandidatesAsAdmin(db, auth(fixture.raceId, dnfAdmin.login), usedAt),
      listResultApprovalCandidatesAsAdmin(db, auth(fixture.raceId, approvalAdmin.login), usedAt),
      listResultDisqualificationCandidatesAsAdmin(db, auth(fixture.raceId, disqualificationAdmin.login), usedAt)
    ]);
    expect(dnfCandidates.status === "ok"
      ? dnfCandidates.response.entries.find((entry) => entry.id === candidate.id)?.readiness
      : dnfCandidates.status).toBe("ACTIVE_OUT_OF_COMPETITION");
    expect(approvalCandidates.status === "ok"
      ? approvalCandidates.response.entries.find((entry) => entry.id === candidate.id)?.readiness
      : approvalCandidates.status).toBe("ACTIVE_OUT_OF_COMPETITION");
    expect(disqualificationCandidates.status === "ok"
      ? disqualificationCandidates.response.entries.find((entry) => entry.id === candidate.id)?.readiness
      : disqualificationCandidates.status).toBe("ACTIVE_OUT_OF_COMPETITION");

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 81);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("OOC Snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    const snapshotAda = personResultBody(snapshotXml, "Ada");
    expect(snapshotAda).toContain("<Status>NotCompeting</Status>");
    expect(snapshotAda).toContain("<Time>2400</Time>");
    expect(snapshotAda).toContain("<SplitTime");
    expect(snapshotAda).not.toMatch(/<(Position|TimeBehind)(?:\s|>)/);
    expect(snapshotXml).not.toContain(decisions[0]!.id);

    const historyAdmin = await admin(fixture.raceId, "VIEW_READOUT_RESULT_HISTORY", 91);
    const detail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: historyAdmin.login.sessionToken,
      raceId: fixture.raceId,
      readoutId: target.readoutId!,
      limit: 50
    }, usedAt);
    if (detail.status !== "ok" || detail.response.formatVersion !== 15) {
      throw new Error("OOC-historiken använder inte format 15");
    }
    expect(detail.response.history.items.map((revision) => revision.source.kind)).toEqual([
      "READOUT_RESULT",
      "MANUAL_OUT_OF_COMPETITION",
      "READOUT_RESULT"
    ]);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalizationId = await finalizeAll(fixture.raceId, 101);
    const [frozenBefore] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozenBefore?.completeXml) throw new Error("Fryst OOC Complete saknas");
    expect(frozenBefore.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain('"kind":"MANUAL_OUT_OF_COMPETITION"');
    expect(JSON.stringify(frozenBefore.frozenProjection)).toContain(decisions[0]!.id);
    const completeAda = personResultBody(frozenBefore.completeXml, "Ada");
    expect(completeAda).toContain("<Status>NotCompeting</Status>");
    expect(completeAda).not.toMatch(/<(Position|TimeBehind)(?:\s|>)/);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z"
    }));
    const [frozenAfter] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    expect(frozenAfter?.completeXml).toBe(frozenBefore.completeXml);
    expect(frozenAfter?.completeXmlHash).toBe(frozenBefore.completeXmlHash);
    expect(frozenAfter?.frozenProjection).toEqual(frozenBefore.frozenProjection);
  }, 30_000);

  it("avvisar stale OOC efter senare ingest och serialiserar samtidig ingest till exakt ett helt utfall", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 111);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const listed = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Stale OOC-kandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate?.targetResultRevision) throw new Error("Stale OOC-target saknas");
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision,
        status: candidate.targetResultRevision.status
      },
      policyVersion: "out-of-competition-v1" as const
    };
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const staleRequestId = crypto.randomUUID();
    await expect(decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: candidate.id,
      idempotencyKey: `out-of-competition:${staleRequestId}`,
      request
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.notCompetingDecisions)
      .where(eq(schema.notCompetingDecisions.requestId, staleRequestId))).toHaveLength(0);

    const fresh = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (fresh.status !== "ok") throw new Error("Ny OOC-kandidat saknas");
    const freshCandidate = fresh.response.entries.find((entry) => entry.id === candidate.id);
    if (!freshCandidate?.targetResultRevision) throw new Error("Ny OOC-target saknas");
    const concurrentRequestId = crypto.randomUUID();
    const [decision, ingest] = await Promise.all([
      decideOutOfCompetitionAsAdmin(db, {
        ...oocAuth,
        entryId: freshCandidate.id,
        idempotencyKey: `out-of-competition:${concurrentRequestId}`,
        request: {
          formatVersion: 1,
          expectedEntryVersion: freshCandidate.entryVersion,
          expectedClassId: freshCandidate.classId,
          expectedCourseVersionId: freshCandidate.courseVersionId,
          expectedSnapshotVersion: fresh.response.snapshotVersion,
          expectedResultRevision: {
            id: freshCandidate.targetResultRevision.id,
            revision: freshCandidate.targetResultRevision.revision,
            status: freshCandidate.targetResultRevision.status
          },
          policyVersion: "out-of-competition-v1"
        }
      }, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:42:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["out-of-competition", "conflict"]).toContain(decision.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(Array.from({ length: decision.status === "out-of-competition" ? 4 : 3 }, (_, index) => index + 1));
    expect(await db.select().from(schema.notCompetingDecisions)
      .where(eq(schema.notCompetingDecisions.requestId, concurrentRequestId)))
      .toHaveLength(decision.status === "out-of-competition" ? 1 : 0);
  }, 30_000);

  it("återtar aktiv OOC append-only, restaurerar exakt target och projicerar full v7-proveniens", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 131);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const listedOoc = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (listedOoc.status !== "ok") throw new Error("OOC-kandidater saknas för återtagande");
    const oocCandidate = listedOoc.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!oocCandidate?.targetResultRevision) throw new Error("Ada saknar OOC-target för återtagande");
    const [technicalTarget] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, oocCandidate.targetResultRevision.id));
    if (!technicalTarget?.readoutId) throw new Error("OOC-targetets avläsning saknas");
    const decided = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: oocCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: oocCandidate.entryVersion,
        expectedClassId: oocCandidate.classId,
        expectedCourseVersionId: oocCandidate.courseVersionId,
        expectedSnapshotVersion: listedOoc.response.snapshotVersion,
        expectedResultRevision: {
          id: oocCandidate.targetResultRevision.id,
          revision: oocCandidate.targetResultRevision.revision,
          status: oocCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    if (decided.status !== "out-of-competition") throw new Error("OOC-beslutet skapades inte");

    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_OUT_OF_COMPETITION", 141);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error(`OOC-återtagandelistan saknas: ${listed.status}`);
    const candidate: OutOfCompetitionWithdrawalListResponse["entries"][number] | undefined =
      listed.response.entries.find((entry) => entry.id === oocCandidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Aktiv OOC kan inte återtas");
    expect(candidate.absoluteResultRevision).toEqual(candidate.outOfCompetitionResultRevision);
    expect(candidate.restorationSourceResultRevision).toMatchObject({
      id: technicalTarget.id,
      revision: technicalTarget.revision,
      status: "OK",
      reason: "COMPLETE",
      cause: "CARD_READOUT"
    });

    const requestId = crypto.randomUUID();
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedNotCompetingDecisionId: candidate.notCompetingDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedOutOfCompetitionResultRevision: candidate.outOfCompetitionResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
      policyVersion: "out-of-competition-withdrawal-v1" as const
    };
    const input = {
      ...withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${requestId}`,
      request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawOutOfCompetitionAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);
    expect(new Set(responses.map((response) => response.outOfCompetitionWithdrawalId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.restorationResultRevisionId)).size).toBe(1);

    const [withdrawals, audits, revisions] = await Promise.all([
      db.select().from(schema.notCompetingWithdrawals).where(eq(schema.notCompetingWithdrawals.requestId, requestId)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "OUT_OF_COMPETITION_WITHDRAWN",
      actorKind: "OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL"
    });
    expect(revisions).toHaveLength(3);
    expect(revisions[2]).toMatchObject({
      revision: technicalTarget.revision + 2,
      cause: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
      status: "OK",
      reason: "COMPLETE",
      readoutId: null,
      notCompetingDecisionId: null,
      notCompetingWithdrawalId: withdrawals[0]!.id,
      published: true
    });
    expect(revisions[2]!.evaluation).toEqual(technicalTarget.evaluation);
    await expect(db.update(schema.notCompetingWithdrawals).set({ reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" })
      .where(eq(schema.notCompetingWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(db.delete(schema.notCompetingWithdrawals)
      .where(eq(schema.notCompetingWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();
    await expect(withdrawOutOfCompetitionAsAdmin(db, {
      ...input,
      request: { ...request, expectedEntryVersion: request.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    const otherActor = await admin(fixture.raceId, "WITHDRAW_OUT_OF_COMPETITION", 151);
    await expect(withdrawOutOfCompetitionAsAdmin(db, {
      ...auth(fixture.raceId, otherActor.login),
      entryId: candidate.id,
      idempotencyKey: input.idempotencyKey,
      request
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const listedAfter = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listedAfter.status !== "ok") throw new Error("Återtagen OOC-livscykel saknas");
    expect(listedAfter.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      state: "WITHDRAWN",
      withdrawal: {
        id: withdrawals[0]!.id,
        restorationResultRevision: { id: revisions[2]!.id, revision: revisions[2]!.revision }
      }
    });
    const oocAfter = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (oocAfter.status !== "ok") throw new Error("OOC-kandidatlista efter återtagande saknas");
    expect(oocAfter.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "UNSUPPORTED_RESULT",
      targetResultRevision: null
    });

    const publicResponse = await publicResults(db, fixture.raceId);
    expect(publicResponse.formatVersion).toBe(7);
    expect(publicResponse.results.find((result) => result.givenName === "Ada")).toMatchObject({
      revision: revisions[2]!.revision,
      status: "OK",
      reason: "COMPLETE",
      elapsedMs: 2_400_000
    });
    const historyAdmin = await admin(fixture.raceId, "VIEW_READOUT_RESULT_HISTORY", 161);
    const detail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: historyAdmin.login.sessionToken,
      raceId: fixture.raceId,
      readoutId: technicalTarget.readoutId,
      limit: 50
    }, usedAt);
    if (detail.status !== "ok" || detail.response.formatVersion !== 15) {
      throw new Error("OOC-återtagandehistoriken använder inte format 15");
    }
    expect(detail.response.history.items.map((revision) => revision.source.kind)).toEqual([
      "READOUT_RESULT",
      "MANUAL_OUT_OF_COMPETITION",
      "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
    ]);
    expect(detail.response.history.items[2]?.source).toEqual({
      kind: "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
      notCompetingWithdrawalId: withdrawals[0]!.id,
      notCompetingDecisionId: decided.response.notCompetingDecisionId,
      targetResultRevisionId: technicalTarget.id,
      outOfCompetitionResultRevisionId: decided.response.resultRevisionId,
      absoluteResultRevisionId: decided.response.resultRevisionId,
      absoluteResultRevision: technicalTarget.revision + 1,
      restorationSourceResultRevisionId: technicalTarget.id
    });

    const exportAdmin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 171);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportAdmin.login.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    if (exported.status !== "ok") throw new Error("Restaurerad OOC Snapshot kunde inte exporteras");
    const snapshotXml = new TextDecoder().decode(exported.bytes);
    expect(personResultBody(snapshotXml, "Ada")).toContain("<Status>OK</Status>");
    expect(snapshotXml).not.toContain(withdrawals[0]!.id);

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalizationId = await finalizeAll(fixture.raceId, 181);
    const [frozen] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizationId));
    if (!frozen?.completeXml) throw new Error("Restaurerad OOC Complete saknas");
    expect(frozen.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozen.frozenProjection)).toContain('"kind":"MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"');
    expect(JSON.stringify(frozen.frozenProjection)).toContain(withdrawals[0]!.id);
    expect(personResultBody(frozen.completeXml, "Ada")).toContain("<Status>OK</Status>");
    expect(frozen.completeXml).not.toContain(withdrawals[0]!.id);
  }, 30_000);

  it("låser en senare teknisk källa, avvisar stale intent och kräver ny teknik före nästa OOC", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const oocAdmin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 191);
    const oocAuth = auth(fixture.raceId, oocAdmin.login);
    const initial = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (initial.status !== "ok") throw new Error("Initial OOC-kandidatlista saknas");
    const initialCandidate = initial.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!initialCandidate?.targetResultRevision) throw new Error("Initial OOC-target saknas");
    const firstDecision = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: initialCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: initialCandidate.entryVersion,
        expectedClassId: initialCandidate.classId,
        expectedCourseVersionId: initialCandidate.courseVersionId,
        expectedSnapshotVersion: initial.response.snapshotVersion,
        expectedResultRevision: {
          id: initialCandidate.targetResultRevision.id,
          revision: initialCandidate.targetResultRevision.revision,
          status: initialCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    if (firstDecision.status !== "out-of-competition") throw new Error("Initialt OOC-beslut saknas");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const withdrawalAdmin = await admin(fixture.raceId, "WITHDRAW_OUT_OF_COMPETITION", 201);
    const withdrawalAuth = auth(fixture.raceId, withdrawalAdmin.login);
    const listed = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("Sen OOC-återtagandelista saknas");
    const staleCandidate = listed.response.entries.find((entry) => entry.id === initialCandidate.id);
    if (!staleCandidate || staleCandidate.state !== "WITHDRAWABLE") {
      throw new Error("Sen OOC-källa är inte återtagbar");
    }
    expect(staleCandidate.absoluteResultRevision).toEqual({
      id: staleCandidate.restorationSourceResultRevision.id,
      revision: staleCandidate.restorationSourceResultRevision.revision
    });
    expect(staleCandidate.restorationSourceResultRevision).toMatchObject({
      status: "OK",
      reason: "COMPLETE",
      cause: "CARD_READOUT"
    });
    expect(staleCandidate.restorationSourceResultRevision.id)
      .not.toBe(staleCandidate.targetResultRevision.id);

    const requestFor = (candidate: NonNullable<typeof staleCandidate>) => ({
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedNotCompetingDecisionId: candidate.notCompetingDecisionId,
      expectedTargetResultRevision: candidate.targetResultRevision,
      expectedOutOfCompetitionResultRevision: candidate.outOfCompetitionResultRevision,
      expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
      policyVersion: "out-of-competition-withdrawal-v1" as const
    });
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:42:00Z"
    }));
    const staleRequestId = crypto.randomUUID();
    await expect(withdrawOutOfCompetitionAsAdmin(db, {
      ...withdrawalAuth,
      entryId: staleCandidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${staleRequestId}`,
      request: requestFor(staleCandidate)
    }, usedAt)).resolves.toEqual({ status: "conflict" });
    expect(await db.select().from(schema.notCompetingWithdrawals)
      .where(eq(schema.notCompetingWithdrawals.requestId, staleRequestId))).toHaveLength(0);

    const freshList = await listOutOfCompetitionWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (freshList.status !== "ok") throw new Error("Uppdaterad OOC-återtagandelista saknas");
    const freshCandidate = freshList.response.entries.find((entry) => entry.id === initialCandidate.id);
    if (!freshCandidate || freshCandidate.state !== "WITHDRAWABLE") {
      throw new Error("Uppdaterad OOC-källa är inte återtagbar");
    }
    const freshRequest = {
      formatVersion: 1 as const,
      expectedEntryVersion: freshCandidate.entryVersion,
      expectedClassId: freshCandidate.classId,
      expectedCourseVersionId: freshCandidate.courseVersionId,
      expectedSnapshotVersion: freshList.response.snapshotVersion,
      expectedNotCompetingDecisionId: freshCandidate.notCompetingDecisionId,
      expectedTargetResultRevision: freshCandidate.targetResultRevision,
      expectedOutOfCompetitionResultRevision: freshCandidate.outOfCompetitionResultRevision,
      expectedAbsoluteResultRevision: freshCandidate.absoluteResultRevision,
      expectedRestorationSourceResultRevision: freshCandidate.restorationSourceResultRevision,
      reason: "ERRONEOUS_MANUAL_OUT_OF_COMPETITION" as const,
      policyVersion: "out-of-competition-withdrawal-v1" as const
    };
    const withdrawn = await withdrawOutOfCompetitionAsAdmin(db, {
      ...withdrawalAuth,
      entryId: freshCandidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
      request: freshRequest
    }, usedAt);
    if (withdrawn.status !== "withdrawn") throw new Error("Sen teknisk OOC-källa restaurerades inte");
    expect(withdrawn.response.restorationSourceResultRevisionId)
      .toBe(freshCandidate.absoluteResultRevision.id);
    const [restored] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, withdrawn.response.restorationResultRevisionId));
    const [source] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, freshCandidate.absoluteResultRevision.id));
    expect(restored?.evaluation).toEqual(source?.evaluation);

    const beforeNewTechnical = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (beforeNewTechnical.status !== "ok") throw new Error("OOC-lista efter sen restaurering saknas");
    expect(beforeNewTechnical.response.entries.find((entry) => entry.id === initialCandidate.id)?.readiness)
      .toBe("UNSUPPORTED_RESULT");
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z"
    }));
    const afterNewTechnical = await listOutOfCompetitionCandidatesAsAdmin(db, oocAuth, usedAt);
    if (afterNewTechnical.status !== "ok") throw new Error("OOC-lista efter ny teknik saknas");
    const nextCandidate = afterNewTechnical.response.entries.find((entry) => entry.id === initialCandidate.id);
    if (!nextCandidate?.targetResultRevision || nextCandidate.readiness !== "READY") {
      throw new Error("Ny direkt teknisk revision öppnade inte ny OOC-livscykel");
    }
    const secondDecision = await decideOutOfCompetitionAsAdmin(db, {
      ...oocAuth,
      entryId: nextCandidate.id,
      idempotencyKey: `out-of-competition:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: nextCandidate.entryVersion,
        expectedClassId: nextCandidate.classId,
        expectedCourseVersionId: nextCandidate.courseVersionId,
        expectedSnapshotVersion: afterNewTechnical.response.snapshotVersion,
        expectedResultRevision: {
          id: nextCandidate.targetResultRevision.id,
          revision: nextCandidate.targetResultRevision.revision,
          status: nextCandidate.targetResultRevision.status
        },
        policyVersion: "out-of-competition-v1"
      }
    }, usedAt);
    expect(secondDecision.status).toBe("out-of-competition");
    expect(await db.select().from(schema.notCompetingDecisions)
      .where(eq(schema.notCompetingDecisions.entryId, initialCandidate.id))).toHaveLength(2);
    expect(await db.select().from(schema.notCompetingWithdrawals)
      .where(eq(schema.notCompetingWithdrawals.entryId, initialCandidate.id))).toHaveLength(1);
  }, 30_000);

  it("ger exakt en vinnare för två samtidiga OOC-återtaganden med olika request-id", async () => {
    const fixture = await importedRace();
    const active = await activeOutOfCompetitionForWithdrawal(fixture.raceId, 211);
    const [first, second] = await Promise.all([
      withdrawOutOfCompetitionAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt),
      withdrawOutOfCompetitionAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt)
    ]);
    expect([first.status, second.status].sort()).toEqual(["conflict", "withdrawn"]);
    const [withdrawals, revisions, audits] = await Promise.all([
      db.select().from(schema.notCompetingWithdrawals)
        .where(eq(schema.notCompetingWithdrawals.entryId, active.candidate.id)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, active.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(and(
        eq(schema.auditEvents.raceId, fixture.raceId),
        eq(schema.auditEvents.action, "OUT_OF_COMPETITION_WITHDRAWN")
      ))
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(revisions.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_OUT_OF_COMPETITION",
      "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL"
    ]);
  });

  it("serialiserar samtidig OOC-withdrawal och ingest utan källbyte eller revisionslucka", async () => {
    const fixture = await importedRace();
    const active = await activeOutOfCompetitionForWithdrawal(fixture.raceId, 221);
    const input = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, ingest] = await Promise.all([
      withdrawOutOfCompetitionAsAdmin(db, input, usedAt),
      ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:43:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawal.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, active.candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(revisions.map((_revision, index) => index + 1));
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawal.status === "withdrawn"
        ? [
            "CARD_READOUT",
            "MANUAL_OUT_OF_COMPETITION",
            "MANUAL_OUT_OF_COMPETITION_WITHDRAWAL",
            "CARD_READOUT"
          ]
        : ["CARD_READOUT", "MANUAL_OUT_OF_COMPETITION", "CARD_READOUT"]
    );
    if (withdrawal.status === "withdrawn") {
      await expect(withdrawOutOfCompetitionAsAdmin(db, input, usedAt)).resolves.toMatchObject({
        status: "withdrawn",
        response: { replayed: true }
      });
    }
    expect(await db.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.raceId, fixture.raceId),
      eq(schema.auditEvents.action, "OUT_OF_COMPETITION_WITHDRAWN")
    ))).toHaveLength(withdrawal.status === "withdrawn" ? 1 : 0);
  });

  it("serialiserar samtidig OOC-withdrawal och loppsfinalisering till helt före eller efter", async () => {
    const fixture = await importedRace();
    const active = await activeOutOfCompetitionForWithdrawal(fixture.raceId, 231);
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalAdmin = await admin(fixture.raceId, "FINALIZE_RESULTS", 241);
    const finalAuth = auth(fixture.raceId, finalAdmin.login);
    const classCandidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (classCandidates.status !== "ok") throw new Error("OOC-klassfinaliseringskandidater saknas");
    for (const candidate of classCandidates.response.classes.filter((item) => item.entryCount > 0)) {
      const finalized = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: classCandidates.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt });
      expect(finalized.status).toBe("finalized");
    }
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("OOC-loppsfinaliseringskandidat saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const withdrawalInput = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `out-of-competition-withdrawal:${crypto.randomUUID()}`,
      request: active.request
    };
    const [withdrawal, finalization] = await Promise.all([
      withdrawOutOfCompetitionAsAdmin(db, withdrawalInput, usedAt),
      finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "RACE",
          classId: null,
          expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
          expectedBasisHash: raceCandidate.response.race.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt })
    ]);
    expect(withdrawal.status).toBe("withdrawn");
    expect(["finalized", "conflict"]).toContain(finalization.status);
    const raceFinalizations = await db.select().from(schema.resultFinalizations).where(and(
      eq(schema.resultFinalizations.raceId, fixture.raceId),
      eq(schema.resultFinalizations.scope, "RACE")
    ));
    expect(raceFinalizations).toHaveLength(finalization.status === "finalized" ? 1 : 0);
    if (finalization.status === "finalized") {
      const frozenXml = raceFinalizations[0]?.completeXml;
      expect(frozenXml).toContain("<Status>NotCompeting</Status>");
      await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:44:00Z"
      }));
      const [unchanged] = await db.select().from(schema.resultFinalizations)
        .where(eq(schema.resultFinalizations.id, raceFinalizations[0]!.id));
      expect(unchanged?.completeXml).toBe(frozenXml);
      expect(unchanged?.completeXmlHash).toBe(raceFinalizations[0]?.completeXmlHash);
    }
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Finaliseringsunderlaget efter OOC-withdrawal saknas");
    expect(after.response.race.blockerCodes).toContain("CLASS_FINALIZATION_OUTDATED");
  }, 30_000);
});

describe("TASK 006M/006N explicit individuellt utan-tidtagning-livscykel PostgreSQL", () => {
  const issuedAt = new Date("2026-09-01T14:00:00.000Z");
  const usedAt = new Date("2026-09-01T14:02:00.000Z");

  async function admin(
    raceId: string,
    capability: "DECIDE_WITHOUT_TIMING" | "DECIDE_OUT_OF_COMPETITION" |
      "WITHDRAW_WITHOUT_TIMING" | "EXPORT_IOF_RESULT_LIST" | "FINALIZE_RESULTS" |
      "VIEW_READOUT_RESULT_HISTORY",
    marker: number
  ) {
    const installation = await issuePairingAdminAccessCredential(db, {
      raceId,
      capability,
      label: `${capability} ${marker}`,
      expiresAt: new Date("2026-09-01T22:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: capability,
      now: new Date("2026-09-01T14:01:00.000Z"),
      sessionSecretBytes: Buffer.alloc(32, marker + 1),
      csrfSecretBytes: Buffer.alloc(32, marker + 2)
    });
    if (login.status !== "authenticated") throw new Error("NT-testets arrangörssession saknas");
    return login;
  }

  function auth(raceId: string, login: Awaited<ReturnType<typeof admin>>) {
    return {
      sessionToken: login.sessionToken,
      raceId,
      csrfCookie: login.csrfToken,
      csrfHeader: login.csrfToken
    };
  }

  async function activeWithoutTimingForWithdrawal(raceId: string, marker: number) {
    await ingestDeviceBatch(db, raceId, batch(crypto.randomUUID(), okPayload));
    const ntLogin = await admin(raceId, "DECIDE_WITHOUT_TIMING", marker);
    const ntAuth = auth(raceId, ntLogin);
    const ntList = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, usedAt);
    if (ntList.status !== "ok") throw new Error("NT-kandidater saknas för återtagande");
    const ntCandidate = ntList.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!ntCandidate?.targetResultRevision) throw new Error("Aktivt NT-target saknas för återtagande");
    const decided = await decideWithoutTimingAsAdmin(db, {
      ...ntAuth,
      entryId: ntCandidate.id,
      idempotencyKey: `without-timing:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: ntCandidate.entryVersion,
        expectedClassId: ntCandidate.classId,
        expectedCourseVersionId: ntCandidate.courseVersionId,
        expectedSnapshotVersion: ntList.response.snapshotVersion,
        expectedResultRevision: {
          id: ntCandidate.targetResultRevision.id,
          revision: ntCandidate.targetResultRevision.revision,
          status: "OK",
          reason: "COMPLETE"
        },
        policyVersion: "without-timing-v1"
      }
    }, usedAt);
    if (decided.status !== "without-timing") throw new Error("NT-beslut saknas för återtagande");

    const withdrawalLogin = await admin(raceId, "WITHDRAW_WITHOUT_TIMING", marker + 3);
    const withdrawalAuth = auth(raceId, withdrawalLogin);
    const listed = await listWithoutTimingWithdrawalsAsAdmin(db, withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("NT-återtagandekandidater saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === ntCandidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") {
      throw new Error("Aktivt NT saknas i återtagandelistan");
    }
    return {
      candidate,
      withdrawalAuth,
      request: {
        formatVersion: 1 as const,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedWithoutTimingDecisionId: candidate.withoutTimingDecisionId,
        expectedTargetResultRevision: candidate.targetResultRevision,
        expectedWithoutTimingResultRevision: candidate.withoutTimingResultRevision,
        expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
        expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
        reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING" as const,
        policyVersion: "without-timing-withdrawal-v1" as const
      }
    };
  }

  it("skapar exakt ett permanent status-only NT, bevarar senare teknik och blockerar IOF/finalisering", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const ntLogin = await admin(fixture.raceId, "DECIDE_WITHOUT_TIMING", 11);
    const ntAuth = auth(fixture.raceId, ntLogin);
    const listed = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, usedAt);
    if (listed.status !== "ok") throw new Error("NT-kandidater saknas");
    const candidate = listed.response.entries.find((entry) =>
      entry.readiness === "READY" && entry.displayName.includes("Ada")
    );
    if (!candidate?.targetResultRevision) throw new Error("Ada saknar NT-target");
    expect(candidate.targetResultRevision).toMatchObject({ status: "OK", reason: "COMPLETE" });
    const [technicalTarget] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, candidate.targetResultRevision.id));
    if (!technicalTarget?.readoutId) throw new Error("NT-targetets readout saknas");

    const requestId = crypto.randomUUID();
    const request = {
      formatVersion: 1 as const,
      expectedEntryVersion: candidate.entryVersion,
      expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId,
      expectedSnapshotVersion: listed.response.snapshotVersion,
      expectedResultRevision: {
        id: candidate.targetResultRevision.id,
        revision: candidate.targetResultRevision.revision,
        status: "OK" as const,
        reason: "COMPLETE" as const
      },
      policyVersion: "without-timing-v1" as const
    };
    const input = {
      ...ntAuth,
      entryId: candidate.id,
      idempotencyKey: `without-timing:${requestId}`,
      request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      decideWithoutTimingAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "without-timing")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "without-timing" ? [attempt.response] : []);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);

    const [decisions, revisions, audits] = await Promise.all([
      db.select().from(schema.withoutTimingDecisions).where(eq(schema.withoutTimingDecisions.requestId, requestId)),
      db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId))
    ]);
    expect(decisions).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "WITHOUT_TIMING_DECIDED",
      actorKind: "WITHOUT_TIMING_ACCESS_CREDENTIAL"
    });
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({
      revision: technicalTarget.revision + 1,
      cause: "MANUAL_WITHOUT_TIMING",
      status: "NT",
      reason: "WITHOUT_TIMING",
      readoutId: null,
      withoutTimingDecisionId: decisions[0]!.id,
      published: true,
      evaluation: {
        status: "NT",
        reason: "WITHOUT_TIMING",
        entryId: candidate.id,
        classId: candidate.classId,
        courseVersionId: candidate.courseVersionId
      }
    });
    expect(revisions[1]!.evaluation).not.toHaveProperty("elapsedMs");
    await expect(db.update(schema.withoutTimingDecisions).set({ policyVersion: "without-timing-v1" })
      .where(eq(schema.withoutTimingDecisions.id, decisions[0]!.id))).rejects.toThrow();
    await expect(decideWithoutTimingAsAdmin(db, {
      ...input,
      request: { ...request, expectedEntryVersion: request.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const publicBefore = await publicResults(db, fixture.raceId);
    expect(publicBefore.formatVersion).toBe(7);
    const publicAda = publicBefore.results.find((result) => result.givenName === "Ada");
    expect(publicAda).toMatchObject({ status: "NT", reason: "WITHOUT_TIMING", rankingState: "NOT_RANKABLE_STATUS" });
    expect(publicAda).not.toHaveProperty("elapsedMs");
    expect(publicAda).not.toHaveProperty("position");
    expect(publicAda).not.toHaveProperty("splits");

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:41:00Z"
    }));
    const publicAfter = await publicResults(db, fixture.raceId);
    expect(publicAfter.results.find((result) => result.givenName === "Ada")).toMatchObject({
      revision: technicalTarget.revision + 1,
      status: "NT",
      reason: "WITHOUT_TIMING"
    });
    await expect(decideWithoutTimingAsAdmin(db, input, usedAt)).resolves.toMatchObject({
      status: "without-timing",
      response: { replayed: true, withoutTimingDecisionId: decisions[0]!.id }
    });

    const oocLogin = await admin(fixture.raceId, "DECIDE_OUT_OF_COMPETITION", 21);
    const oocCandidates = await listOutOfCompetitionCandidatesAsAdmin(
      db,
      auth(fixture.raceId, oocLogin),
      usedAt
    );
    if (oocCandidates.status !== "ok") throw new Error("OOC-kandidatlista efter NT saknas");
    expect(oocCandidates.response.entries.find((entry) => entry.id === candidate.id)).toMatchObject({
      readiness: "ACTIVE_WITHOUT_TIMING",
      targetResultRevision: null
    });

    const exportLogin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 31);
    await expect(exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const finalLogin = await admin(fixture.raceId, "FINALIZE_RESULTS", 41);
    const finalCandidates = await listResultFinalizationCandidatesAsAdmin(
      db,
      auth(fixture.raceId, finalLogin),
      usedAt
    );
    if (finalCandidates.status !== "ok") throw new Error("Finaliseringsunderlag efter NT saknas");
    expect(finalCandidates.response.classes.find((item) => item.classId === candidate.classId)?.blockerCodes)
      .toContain("INVALID_RESULT_REVISION");

    const historyLogin = await admin(fixture.raceId, "VIEW_READOUT_RESULT_HISTORY", 51);
    const detail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: historyLogin.sessionToken,
      raceId: fixture.raceId,
      readoutId: technicalTarget.readoutId,
      limit: 50
    }, usedAt);
    if (detail.status !== "ok" || detail.response.formatVersion !== 15) {
      throw new Error("NT-historiken använder inte format 15");
    }
    expect(detail.response.history.items.map((revision) => revision.source.kind)).toEqual([
      "READOUT_RESULT",
      "MANUAL_WITHOUT_TIMING",
      "READOUT_RESULT"
    ]);
    expect(detail.response.history.items[1]?.source).toEqual({
      kind: "MANUAL_WITHOUT_TIMING",
      withoutTimingDecisionId: decisions[0]!.id,
      targetResultRevisionId: technicalTarget.id
    });
  }, 30_000);

  it("avvisar MP som NT-target utan beslut, revision eller audit", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      punches: [31, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
      }))
    }));
    const ntLogin = await admin(fixture.raceId, "DECIDE_WITHOUT_TIMING", 61);
    const ntAuth = auth(fixture.raceId, ntLogin);
    const listed = await listWithoutTimingCandidatesAsAdmin(db, ntAuth, usedAt);
    if (listed.status !== "ok") throw new Error("MP/NT-kandidatlista saknas");
    const candidate = listed.response.entries.find((entry) => entry.displayName.includes("Ada"));
    if (!candidate) throw new Error("Ada saknas i MP/NT-kandidatlistan");
    expect(candidate).toMatchObject({ readiness: "UNSUPPORTED_RESULT", targetResultRevision: null });
    const [mp] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id));
    if (!mp) throw new Error("MP-revisionen saknas");
    const requestId = crypto.randomUUID();
    const result = await decideWithoutTimingAsAdmin(db, {
      ...ntAuth,
      entryId: candidate.id,
      idempotencyKey: `without-timing:${requestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedResultRevision: { id: mp.id, revision: mp.revision, status: "OK", reason: "COMPLETE" },
        policyVersion: "without-timing-v1"
      }
    }, usedAt);
    expect(result).toEqual({ status: "conflict" });
    expect(await db.select().from(schema.withoutTimingDecisions)
      .where(eq(schema.withoutTimingDecisions.requestId, requestId))).toHaveLength(0);
    expect(await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId))).toHaveLength(0);
    expect(await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, candidate.id))).toHaveLength(1);
  });

  it("återtar aktivt NT exakt idempotent till originaltarget och öppnar publik, IOF och finalisering", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 71);
    expect(active.candidate.restorationSourceResultRevision).toMatchObject({
      ...active.candidate.targetResultRevision,
      status: "OK",
      reason: "COMPLETE",
      cause: "CARD_READOUT"
    });
    const [source] = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.id, active.candidate.restorationSourceResultRevision.id));
    if (!source?.readoutId) throw new Error("NT-återtagandets tekniska källa saknar readout");
    const [rawBefore, readoutsBefore, raceBefore] = await Promise.all([
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    const requestId = crypto.randomUUID();
    const input = {
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `without-timing-withdrawal:${requestId}`,
      request: active.request
    };
    const attempts = await Promise.all(Array.from({ length: 100 }, () =>
      withdrawWithoutTimingAsAdmin(db, input, usedAt)
    ));
    expect(attempts.every((attempt) => attempt.status === "withdrawn")).toBe(true);
    const responses = attempts.flatMap((attempt) => attempt.status === "withdrawn" ? [attempt.response] : []);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(responses.filter((response) => response.replayed)).toHaveLength(99);
    expect(new Set(responses.map((response) => response.withoutTimingWithdrawalId)).size).toBe(1);
    expect(new Set(responses.map((response) => response.restorationResultRevisionId)).size).toBe(1);

    const [withdrawals, revisions, audits, rawAfter, readoutsAfter, raceAfter] = await Promise.all([
      db.select().from(schema.withoutTimingWithdrawals)
        .where(eq(schema.withoutTimingWithdrawals.requestId, requestId)),
      db.select().from(schema.resultRevisions)
        .where(eq(schema.resultRevisions.entryId, active.candidate.id))
        .orderBy(asc(schema.resultRevisions.revision)),
      db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId)),
      db.select().from(schema.rawDeviceMessages).where(eq(schema.rawDeviceMessages.raceId, fixture.raceId)),
      db.select().from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, fixture.raceId)),
      db.select().from(schema.races).where(eq(schema.races.id, fixture.raceId)).then((rows) => rows[0])
    ]);
    expect(withdrawals).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "WITHOUT_TIMING_WITHDRAWN",
      actorKind: "WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL"
    });
    expect(revisions.map((revision) => revision.cause)).toEqual([
      "CARD_READOUT",
      "MANUAL_WITHOUT_TIMING",
      "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
    ]);
    expect(revisions[2]).toMatchObject({
      readoutId: null,
      withoutTimingDecisionId: null,
      withoutTimingWithdrawalId: withdrawals[0]!.id,
      status: source.status,
      reason: source.reason,
      evaluation: source.evaluation,
      published: true
    });
    expect(rawAfter).toEqual(rawBefore);
    expect(readoutsAfter).toEqual(readoutsBefore);
    expect(raceAfter?.snapshotVersion).toBe(raceBefore?.snapshotVersion);
    await expect(db.update(schema.withoutTimingWithdrawals)
      .set({ policyVersion: "without-timing-withdrawal-v1" })
      .where(eq(schema.withoutTimingWithdrawals.id, withdrawals[0]!.id))).rejects.toThrow();

    const listedAfter = await listWithoutTimingWithdrawalsAsAdmin(db, active.withdrawalAuth, usedAt);
    if (listedAfter.status !== "ok") throw new Error("NT-återtagandelistan saknas efter commit");
    expect(listedAfter.response.entries.find((entry) => entry.id === active.candidate.id)).toMatchObject({
      state: "WITHDRAWN",
      withdrawal: { id: withdrawals[0]!.id, reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING" }
    });
    const publicList = await publicResults(db, fixture.raceId);
    expect(publicList.formatVersion).toBe(7);
    expect(publicList.results.find((result) => result.givenName === "Ada")).toMatchObject({
      status: "OK",
      reason: "COMPLETE",
      rankingState: "RANKED"
    });
    const exportLogin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 81);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    expect(exported.status).toBe("ok");
    if (exported.status === "ok") {
      const xml = new TextDecoder().decode(exported.bytes);
      expect(xml).toContain("<Status>OK</Status>");
      expect(xml).not.toContain("WITHOUT_TIMING");
    }
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      cardNumber: "67890",
      startPunchedAt: "2026-08-30T10:01:00Z",
      finishPunchedAt: "2026-08-30T10:42:00Z",
      punches: [31, 32, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${11 + index * 10}:00Z`
      }))
    }));
    const finalLogin = await admin(fixture.raceId, "FINALIZE_RESULTS", 91);
    const finalAuth = auth(fixture.raceId, finalLogin);
    const finalCandidates = await listResultFinalizationCandidatesAsAdmin(
      db,
      finalAuth,
      usedAt
    );
    if (finalCandidates.status !== "ok") throw new Error("Finaliseringsunderlag efter NT-återtagande saknas");
    for (const candidate of finalCandidates.response.classes.filter((item) => item.entryCount > 0)) {
      expect(candidate.blockerCodes).toEqual([]);
      const finalizedClass = await finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: candidate.classId,
          expectedSnapshotVersion: finalCandidates.response.snapshotVersion,
          expectedBasisHash: candidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt });
      expect(finalizedClass.status).toBe("finalized");
    }
    const raceCandidate = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (raceCandidate.status !== "ok") throw new Error("Loppsfinalisering efter NT-återtagande saknas");
    expect(raceCandidate.response.race.blockerCodes).toEqual([]);
    const finalizedRace = await finalizeResultsAsAdmin(db, {
      ...finalAuth,
      idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        scope: "RACE",
        classId: null,
        expectedSnapshotVersion: raceCandidate.response.snapshotVersion,
        expectedBasisHash: raceCandidate.response.race.basisHash,
        expectedLatestScopeRevision: null
      }
    }, { now: usedAt });
    if (finalizedRace.status !== "finalized") throw new Error("Loppet finaliserades inte efter NT-återtagande");
    const [frozen] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizedRace.response.finalization.id));
    expect(frozen?.frozenProjection).toMatchObject({ formatVersion: 9 });
    expect(JSON.stringify(frozen?.frozenProjection)).toContain("MANUAL_WITHOUT_TIMING_WITHDRAWAL");
    const frozenXml = frozen?.completeXml;
    const frozenHash = frozen?.completeXmlHash;

    const historyLogin = await admin(fixture.raceId, "VIEW_READOUT_RESULT_HISTORY", 101);
    const detail = await getReadoutHistoryAsAdmin(db, {
      sessionToken: historyLogin.sessionToken,
      raceId: fixture.raceId,
      readoutId: source.readoutId,
      limit: 50
    }, usedAt);
    if (detail.status !== "ok" || detail.response.formatVersion !== 15) {
      throw new Error("NT-återtagandehistoriken använder inte format 15");
    }
    expect(detail.response.history.items.map((revision) => revision.source.kind)).toEqual([
      "READOUT_RESULT",
      "MANUAL_WITHOUT_TIMING",
      "MANUAL_WITHOUT_TIMING_WITHDRAWAL"
    ]);
    expect(detail.response.history.items[2]?.source).toMatchObject({
      kind: "MANUAL_WITHOUT_TIMING_WITHDRAWAL",
      withoutTimingWithdrawalId: withdrawals[0]!.id,
      withoutTimingDecisionId: active.candidate.withoutTimingDecisionId,
      restorationSourceResultRevisionId: source.id
    });

    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:45:00Z"
    }));
    const [unchangedFrozen] = await db.select().from(schema.resultFinalizations)
      .where(eq(schema.resultFinalizations.id, finalizedRace.response.finalization.id));
    expect(unchangedFrozen?.completeXml).toBe(frozenXml);
    expect(unchangedFrozen?.completeXmlHash).toBe(frozenHash);
    await expect(withdrawWithoutTimingAsAdmin(db, input, usedAt)).resolves.toMatchObject({
      status: "withdrawn",
      response: {
        replayed: true,
        withoutTimingWithdrawalId: withdrawals[0]!.id,
        restorationResultRevisionId: revisions[2]!.id
      }
    });
    await expect(withdrawWithoutTimingAsAdmin(db, {
      ...input,
      request: { ...active.request, expectedEntryVersion: active.request.expectedEntryVersion + 1 }
    }, usedAt)).resolves.toEqual({ status: "conflict" });

    const nextNtLogin = await admin(fixture.raceId, "DECIDE_WITHOUT_TIMING", 104);
    const nextNtAuth = auth(fixture.raceId, nextNtLogin);
    const nextNtList = await listWithoutTimingCandidatesAsAdmin(db, nextNtAuth, usedAt);
    if (nextNtList.status !== "ok") throw new Error("Ny NT-kandidatlista efter ny teknik saknas");
    const nextCandidate = nextNtList.response.entries.find((entry) => entry.id === active.candidate.id);
    if (nextCandidate?.readiness !== "READY" || !nextCandidate.targetResultRevision) {
      throw new Error("Ny direkt teknik öppnade inte en ny NT-livscykel");
    }
    expect(nextCandidate.targetResultRevision.id).not.toBe(revisions[2]!.id);
    const secondDecision = await decideWithoutTimingAsAdmin(db, {
      ...nextNtAuth,
      entryId: nextCandidate.id,
      idempotencyKey: `without-timing:${crypto.randomUUID()}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: nextCandidate.entryVersion,
        expectedClassId: nextCandidate.classId,
        expectedCourseVersionId: nextCandidate.courseVersionId,
        expectedSnapshotVersion: nextNtList.response.snapshotVersion,
        expectedResultRevision: {
          id: nextCandidate.targetResultRevision.id,
          revision: nextCandidate.targetResultRevision.revision,
          status: "OK",
          reason: "COMPLETE"
        },
        policyVersion: "without-timing-v1"
      }
    }, usedAt);
    expect(secondDecision.status).toBe("without-timing");
    expect(await db.select().from(schema.withoutTimingDecisions)
      .where(eq(schema.withoutTimingDecisions.entryId, active.candidate.id))).toHaveLength(2);
  }, 30_000);

  it("återställer exakt ett senare direkt tekniskt MP-huvud utan ranking", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 111);
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), {
      ...okPayload,
      finishPunchedAt: "2026-08-30T10:43:00Z",
      punches: [31, 33].map((code, index) => ({
        code,
        punchedAt: `2026-08-30T10:${10 + index * 20}:00Z`
      }))
    }));
    const listed = await listWithoutTimingWithdrawalsAsAdmin(db, active.withdrawalAuth, usedAt);
    if (listed.status !== "ok") throw new Error("NT-återtagandelista med senare MP saknas");
    const candidate = listed.response.entries.find((entry) => entry.id === active.candidate.id);
    if (!candidate || candidate.state !== "WITHDRAWABLE") throw new Error("Senare MP är inte återtagbar");
    expect(candidate.absoluteResultRevision).toEqual({
      id: candidate.restorationSourceResultRevision.id,
      revision: candidate.restorationSourceResultRevision.revision
    });
    expect(candidate.restorationSourceResultRevision).toMatchObject({
      status: "MP",
      reason: "MISSING_CONTROL",
      cause: "CARD_READOUT"
    });
    const requestId = crypto.randomUUID();
    const withdrawn = await withdrawWithoutTimingAsAdmin(db, {
      ...active.withdrawalAuth,
      entryId: candidate.id,
      idempotencyKey: `without-timing-withdrawal:${requestId}`,
      request: {
        formatVersion: 1,
        expectedEntryVersion: candidate.entryVersion,
        expectedClassId: candidate.classId,
        expectedCourseVersionId: candidate.courseVersionId,
        expectedSnapshotVersion: listed.response.snapshotVersion,
        expectedWithoutTimingDecisionId: candidate.withoutTimingDecisionId,
        expectedTargetResultRevision: candidate.targetResultRevision,
        expectedWithoutTimingResultRevision: candidate.withoutTimingResultRevision,
        expectedAbsoluteResultRevision: candidate.absoluteResultRevision,
        expectedRestorationSourceResultRevision: candidate.restorationSourceResultRevision,
        reason: "ERRONEOUS_MANUAL_WITHOUT_TIMING",
        policyVersion: "without-timing-withdrawal-v1"
      }
    }, usedAt);
    expect(withdrawn).toMatchObject({ status: "withdrawn", response: { status: "MP", reason: "MISSING_CONTROL" } });
    const publicAda = (await publicResults(db, fixture.raceId)).results
      .find((result) => result.givenName === "Ada");
    expect(publicAda).toMatchObject({ status: "MP", reason: "MISSING_CONTROL", rankingState: "NOT_RANKABLE_STATUS" });
    expect(publicAda).not.toHaveProperty("position");
    const exportLogin = await admin(fixture.raceId, "EXPORT_IOF_RESULT_LIST", 121);
    const exported = await exportIofResultListAsAdmin(db, {
      sessionToken: exportLogin.sessionToken,
      raceId: fixture.raceId
    }, usedAt);
    expect(exported.status).toBe("ok");
    if (exported.status === "ok") {
      expect(new TextDecoder().decode(exported.bytes)).toContain("<Status>MissingPunch</Status>");
    }
  }, 30_000);

  it("ger en vinnare för två request-id:n och serialiserar samtidig ingest utan revisionslucka", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 131);
    const requestFor = (requestId: string) => ({
      ...active.withdrawalAuth,
      entryId: active.candidate.id,
      idempotencyKey: `without-timing-withdrawal:${requestId}`,
      request: active.request
    });
    const [first, second] = await Promise.all([
      withdrawWithoutTimingAsAdmin(db, requestFor(crypto.randomUUID()), usedAt),
      withdrawWithoutTimingAsAdmin(db, requestFor(crypto.randomUUID()), usedAt)
    ]);
    expect([first.status, second.status].sort()).toEqual(["conflict", "withdrawn"]);
    expect(await db.select().from(schema.withoutTimingWithdrawals)
      .where(eq(schema.withoutTimingWithdrawals.entryId, active.candidate.id))).toHaveLength(1);

    const next = await importedRace();
    const concurrent = await activeWithoutTimingForWithdrawal(next.raceId, 141);
    const concurrentInput = {
      ...concurrent.withdrawalAuth,
      entryId: concurrent.candidate.id,
      idempotencyKey: `without-timing-withdrawal:${crypto.randomUUID()}`,
      request: concurrent.request
    };
    const [withdrawalResult, ingest] = await Promise.all([
      withdrawWithoutTimingAsAdmin(db, concurrentInput, usedAt),
      ingestDeviceBatch(db, next.raceId, batch(crypto.randomUUID(), {
        ...okPayload,
        finishPunchedAt: "2026-08-30T10:46:00Z"
      }))
    ]);
    expect(ingest.acknowledgements[0]?.status).toBe("stored");
    expect(["withdrawn", "conflict"]).toContain(withdrawalResult.status);
    const revisions = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.entryId, concurrent.candidate.id))
      .orderBy(asc(schema.resultRevisions.revision));
    expect(revisions.map((revision) => revision.revision))
      .toEqual(revisions.map((_revision, index) => index + 1));
    expect(revisions.map((revision) => revision.cause)).toEqual(
      withdrawalResult.status === "withdrawn"
        ? ["CARD_READOUT", "MANUAL_WITHOUT_TIMING", "MANUAL_WITHOUT_TIMING_WITHDRAWAL", "CARD_READOUT"]
        : ["CARD_READOUT", "MANUAL_WITHOUT_TIMING", "CARD_READOUT"]
    );
  }, 30_000);

  it("serialiserar samtidig NT-withdrawal och finaliseringsförsök till ett helt efterläge", async () => {
    const fixture = await importedRace();
    const active = await activeWithoutTimingForWithdrawal(fixture.raceId, 151);
    const finalLogin = await admin(fixture.raceId, "FINALIZE_RESULTS", 161);
    const finalAuth = auth(fixture.raceId, finalLogin);
    const candidates = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (candidates.status !== "ok") throw new Error("Finaliseringsunderlag under aktiv NT saknas");
    const classCandidate = candidates.response.classes.find((item) => item.classId === active.candidate.classId);
    if (!classCandidate) throw new Error("NT-klassen saknas i finaliseringsunderlaget");
    expect(classCandidate.blockerCodes).toContain("INVALID_RESULT_REVISION");
    const [withdrawal, finalization] = await Promise.all([
      withdrawWithoutTimingAsAdmin(db, {
        ...active.withdrawalAuth,
        entryId: active.candidate.id,
        idempotencyKey: `without-timing-withdrawal:${crypto.randomUUID()}`,
        request: active.request
      }, usedAt),
      finalizeResultsAsAdmin(db, {
        ...finalAuth,
        idempotencyKey: `result-finalization:${crypto.randomUUID()}`,
        request: {
          formatVersion: 1,
          scope: "CLASS",
          classId: classCandidate.classId,
          expectedSnapshotVersion: candidates.response.snapshotVersion,
          expectedBasisHash: classCandidate.basisHash,
          expectedLatestScopeRevision: null
        }
      }, { now: usedAt })
    ]);
    expect(withdrawal.status).toBe("withdrawn");
    expect(finalization.status).toBe("conflict");
    expect(await db.select().from(schema.resultFinalizations).where(and(
      eq(schema.resultFinalizations.raceId, fixture.raceId),
      eq(schema.resultFinalizations.scope, "CLASS")
    ))).toHaveLength(0);
    expect(await db.select().from(schema.withoutTimingWithdrawals)
      .where(eq(schema.withoutTimingWithdrawals.entryId, active.candidate.id))).toHaveLength(1);
    const after = await listResultFinalizationCandidatesAsAdmin(db, finalAuth, usedAt);
    if (after.status !== "ok") throw new Error("Finaliseringsunderlag efter NT-withdrawal saknas");
    expect(after.response.classes.find((item) => item.classId === classCandidate.classId)?.basisHash)
      .not.toBe(classCandidate.basisHash);
  }, 30_000);
});
