import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import {
  createEvent,
  issuePairingAdminAccessCredential,
  issuePairingGrantAsAdmin,
  listPairingGrantsAsAdmin,
  loginPairingAdmin
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => { await pool.end(); });

type Capability = "PAIR_STATION" | "VIEW_RACE_OVERVIEW";
type RevocationKind = "credential" | "session";

async function access(raceId: string, capability: Capability, now: Date, expiresAt = new Date(now.getTime() + 3_600_000)) {
  const installation = await issuePairingAdminAccessCredential(db, {
    raceId, capability, label: `TASK012 ${capability}`, expiresAt
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, {
    now, expectedRaceId: raceId, expectedCapability: capability
  });
  if (login.status !== "authenticated") throw new Error("Testsession saknas");
  return { installation, input: { raceId, sessionToken: login.sessionToken, capability }, csrfToken: login.csrfToken };
}

async function fixture(now: Date) {
  const { race } = await createEvent(db, {
    name: "TASK012 parkopplingslista",
    raceName: "Lång",
    raceDate: "2026-08-30",
    timeZone: "Europe/Stockholm"
  });
  const admin = await access(race.id, "PAIR_STATION", now);
  const grantId = randomUUID();
  const issued = await issuePairingGrantAsAdmin(db, {
    ...admin.input,
    csrfCookie: admin.csrfToken,
    csrfHeader: admin.csrfToken,
    idempotencyKey: `pairing-grant:${grantId}`,
    readBody: async () => ({
      formatVersion: 1,
      grantId,
      grantSecretHash: "a".repeat(64),
      credentialLifetimeHours: 8
    })
  }, now);
  if (issued.status !== "stored") throw new Error("Testgrant saknas");
  return { raceId: race.id, admin, grant: issued.response.grant };
}

async function waitForBlock(
  blockerPid: number,
  blockedPid?: number,
  settled?: () => boolean
): Promise<"blocked" | "settled"> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query<{ blocked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))
        ${blockedPid === undefined ? "" : "AND pid = $2::integer"}) AS blocked`,
      blockedPid === undefined ? [blockerPid] : [blockerPid, blockedPid]
    );
    if (result.rows[0]?.blocked) return "blocked";
    if (settled?.()) return "settled";
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Förväntad PostgreSQL-låsväntan observerades inte");
}

async function readerBlockedBy(blockerPid: number): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid)) ORDER BY pid LIMIT 1", [blockerPid]
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Läsarens backend-pid saknas");
}

async function insertRevocation(
  client: { query(text: string, values: unknown[]): Promise<unknown> },
  kind: RevocationKind,
  id: string,
  now: Date
) {
  if (kind === "credential") {
    await client.query("INSERT INTO pairing_admin_access_credential_revocation (credential_id, revoked_at, reason) VALUES ($1, $2, $3)",
      [id, now, "TASK012_CONCURRENT_REVOKE"]);
  } else {
    await client.query("INSERT INTO pairing_admin_session_revocation (session_id, revoked_at, reason) VALUES ($1, $2, $3)",
      [id, now, "TASK012_CONCURRENT_LOGOUT"]);
  }
}

describe("TASK012 protected station-pairing grant list PostgreSQL", () => {
  it("keeps scoped minimal grant metadata deterministic and writeless", async () => {
    const now = new Date();
    const first = await fixture(now);
    const { raceId: otherRaceId } = await fixture(now);
    const wrongCapability = await access(first.raceId, "VIEW_RACE_OVERVIEW", now);
    const expired = await access(first.raceId, "PAIR_STATION", now, new Date(now.getTime() + 1));
    const before = await Promise.all([
      db.select({ total: count() }).from(schema.stationPairingGrants).where(eq(schema.stationPairingGrants.raceId, first.raceId)),
      db.select({ total: count() }).from(schema.stationPairingGrantRevocations).where(eq(schema.stationPairingGrantRevocations.grantId, first.grant.grantId)),
      db.select({ total: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, first.raceId))
    ]);
    const listed = await listPairingGrantsAsAdmin(db, first.admin.input, now);
    if (listed.status !== "ok") throw new Error("Behörig parkopplingslista saknas");
    expect(listed.response).toEqual({ formatVersion: 1, grants: [first.grant] });
    expect(JSON.stringify(listed.response)).not.toMatch(/secretHash|issuerCredentialId|accessCredential|token/i);
    await expect(listPairingGrantsAsAdmin(db, wrongCapability.input, now)).resolves.toEqual({ status: "forbidden" });
    await expect(listPairingGrantsAsAdmin(db, { ...first.admin.input, raceId: otherRaceId }, now)).resolves.toEqual({ status: "forbidden" });
    await expect(listPairingGrantsAsAdmin(db, expired.input, new Date(now.getTime() + 1))).resolves.toEqual({ status: "unauthorized" });
    const after = await Promise.all([
      db.select({ total: count() }).from(schema.stationPairingGrants).where(eq(schema.stationPairingGrants.raceId, first.raceId)),
      db.select({ total: count() }).from(schema.stationPairingGrantRevocations).where(eq(schema.stationPairingGrantRevocations.grantId, first.grant.grantId)),
      db.select({ total: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, first.raceId))
    ]);
    expect(after).toEqual(before);
  });

  it.each(["credential", "session"] as const)("rejects when %s revocation wins before grant metadata", async (kind) => {
    const now = new Date(), { admin } = await fixture(now);
    const blocker = await pool.connect();
    let pending: ReturnType<typeof listPairingGrantsAsAdmin> | undefined;
    let blockerTransactionOpen = false;
    try {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      const sessionId = admin.input.sessionToken.split(".")[1]!;
      const id = kind === "credential" ? admin.installation.credentialId : sessionId;
      const table = kind === "credential" ? "pairing_admin_access_credential" : "pairing_admin_session";
      await blocker.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = listPairingGrantsAsAdmin(db, admin.input, now);
      await waitForBlock(pid);
      await insertRevocation(blocker, kind, id, now);
      await blocker.query("COMMIT");
      blockerTransactionOpen = false;
      await expect(pending).resolves.toEqual({ status: "unauthorized" });
    } finally {
      if (blockerTransactionOpen) await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
    }
  });

  it.each(["credential", "session"] as const)("lets an already authorized metadata reader win before concurrent %s revocation", async (kind) => {
    const now = new Date(), { admin } = await fixture(now);
    const tableLocker = await pool.connect();
    const revoker = await pool.connect();
    let pending: ReturnType<typeof listPairingGrantsAsAdmin> | undefined;
    let revocation: Promise<unknown> | undefined;
    let tableLockerTransactionOpen = false;
    let revokerTransactionOpen = false;
    let revocationSettled = false;
    try {
      await tableLocker.query("BEGIN");
      tableLockerTransactionOpen = true;
      await tableLocker.query("LOCK TABLE station_pairing_redemption IN ACCESS EXCLUSIVE MODE");
      const tableLockerPid = (await tableLocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = listPairingGrantsAsAdmin(db, admin.input, now);
      const readerPid = await readerBlockedBy(tableLockerPid);

      await revoker.query("BEGIN");
      revokerTransactionOpen = true;
      const revokerPid = (await revoker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const sessionId = admin.input.sessionToken.split(".")[1]!;
      revocation = insertRevocation(revoker, kind, kind === "credential" ? admin.installation.credentialId : sessionId, now)
        .finally(() => { revocationSettled = true; });
      const revocationOrder = await waitForBlock(readerPid, revokerPid, () => revocationSettled);
      if (revocationOrder === "settled") {
        await revocation;
        await revoker.query("COMMIT");
        revokerTransactionOpen = false;
        await tableLocker.query("COMMIT");
        tableLockerTransactionOpen = false;
        await expect(pending).resolves.toEqual({ status: "unauthorized" });
        return;
      }
      await tableLocker.query("COMMIT");
      tableLockerTransactionOpen = false;
      await expect(pending).resolves.toMatchObject({ status: "ok" });
      await revocation;
      await revoker.query("COMMIT");
      revokerTransactionOpen = false;
      await expect(listPairingGrantsAsAdmin(db, admin.input, now)).resolves.toEqual({ status: "unauthorized" });
    } finally {
      if (tableLockerTransactionOpen) await tableLocker.query("ROLLBACK");
      if (revokerTransactionOpen) await revoker.query("ROLLBACK");
      tableLocker.release();
      revoker.release();
      if (pending) await pending;
      if (revocation) await revocation;
    }
  });
});
