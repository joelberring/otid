import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { migrate } from "@o-tid/database";
import { createDatabase, schema } from "@o-tid/database";
import {
  createEvent,
  changeEntryClass,
  importIofXml,
  issuePairingAdminAccessCredential,
  listEntryClassesAsAdmin,
  loginPairingAdmin
} from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => { await pool.end(); });

type Capability = "CHANGE_ENTRY_CLASS" | "VIEW_RACE_OVERVIEW";

async function fixture() {
  const { race } = await createEvent(db, {
    name: "TASK009 klasslista",
    raceName: "Lång",
    raceDate: "2026-08-30",
    timeZone: "Europe/Stockholm"
  });
  for (const file of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(db, race.id, await readFile(new URL(`../../../../fixtures/iof/${file}`, import.meta.url), "utf8"));
  }
  return race.id;
}

async function access(raceId: string, capability: Capability, now: Date, expiresAt = new Date(now.getTime() + 3_600_000)) {
  const installation = await issuePairingAdminAccessCredential(db, {
    raceId, capability, label: `TASK009 ${capability}`, expiresAt
  }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential }, {
    now, expectedRaceId: raceId, expectedCapability: capability
  });
  if (login.status !== "authenticated") throw new Error("Testsession saknas");
  return { installation, input: { raceId, sessionToken: login.sessionToken } };
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

async function waitForQueuedWriter(raceLockerPid: number, readerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    // PostgreSQL may report the queued reader as the writer's immediate
    // blocker rather than the transaction holding the original race lock.
    const result = await pool.query<{ blocked: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> $2::integer AND pg_blocking_pids(pid) && $1::integer[]) AS blocked",
      [[raceLockerPid, readerPid], readerPid]
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Klassändringen väntade inte på den observerade racelåskedjan");
}

async function classChange(raceId: string) {
  const entries = await db.select({ id: schema.entries.id, classId: schema.entries.classId })
    .from(schema.entries).where(eq(schema.entries.raceId, raceId));
  const entry = entries[0];
  if (!entry) throw new Error("Testdeltagare saknas");
  const classes = await db.select({ id: schema.classes.id }).from(schema.classes)
    .where(eq(schema.classes.raceId, raceId));
  const target = classes.find((raceClass) => raceClass.id !== entry.classId);
  if (!target) throw new Error("Målklass saknas");
  return { entry, targetClassId: target.id };
}

async function insertRevocation(
  client: { query(text: string, values: unknown[]): Promise<unknown> },
  kind: "credential" | "session", id: string, now: Date
) {
  if (kind === "credential") {
    await client.query("INSERT INTO pairing_admin_access_credential_revocation (credential_id, revoked_at, reason) VALUES ($1, $2, $3)",
      [id, now, "TASK009_CONCURRENT_REVOKE"]);
  } else {
    await client.query("INSERT INTO pairing_admin_session_revocation (session_id, revoked_at, reason) VALUES ($1, $2, $3)",
      [id, now, "TASK009_CONCURRENT_LOGOUT"]);
  }
}

describe("TASK009 class-list protected read PostgreSQL", () => {
  it("keeps the class DTO deterministic, scoped, expired/revoked-safe, and writeless", async () => {
    const now = new Date();
    const raceId = await fixture();
    const otherRaceId = await fixture();
    const allowed = await access(raceId, "CHANGE_ENTRY_CLASS", now);
    const wrongCapability = await access(raceId, "VIEW_RACE_OVERVIEW", now);
    const expired = await access(raceId, "CHANGE_ENTRY_CLASS", now, new Date(now.getTime() + 1));
    const before = await Promise.all([
      db.select({ total: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)),
      db.select({ total: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)),
      db.select({ total: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId))
    ]);
    const listed = await listEntryClassesAsAdmin(db, allowed.input, now);
    if (listed.status !== "ok") throw new Error("Behörig klasslista saknas");
    expect(listed.response.classes.map((item) => item.name)).toEqual(["D21", "H21"]);
    expect(listed.response.entries.map((item) => item.displayName)).toEqual(["Ada Löpare", "Bo Skog"]);
    expect(JSON.stringify(listed.response)).not.toMatch(/cardNumber|readout|resultRevision|raw|audit/i);
    await expect(listEntryClassesAsAdmin(db, wrongCapability.input, now)).resolves.toEqual({ status: "forbidden" });
    await expect(listEntryClassesAsAdmin(db, { ...allowed.input, raceId: otherRaceId }, now)).resolves.toEqual({ status: "forbidden" });
    await expect(listEntryClassesAsAdmin(db, expired.input, new Date(now.getTime() + 1))).resolves.toEqual({ status: "unauthorized" });
    const after = await Promise.all([
      db.select({ total: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId)),
      db.select({ total: count() }).from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)),
      db.select({ total: count() }).from(schema.cardReadouts).where(eq(schema.cardReadouts.raceId, raceId))
    ]);
    expect(after).toEqual(before);
  });

  it.each(["credential", "session"] as const)("rejects when %s revocation wins before the auth gate", async (kind) => {
    const now = new Date(), raceId = await fixture(), auth = await access(raceId, "CHANGE_ENTRY_CLASS", now);
    const blocker = await pool.connect();
    let pending: ReturnType<typeof listEntryClassesAsAdmin> | undefined;
    let blockerTransactionOpen = false;
    try {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      const sessionId = auth.input.sessionToken.split(".")[1]!;
      const id = kind === "credential" ? auth.installation.credentialId : sessionId;
      const table = kind === "credential" ? "pairing_admin_access_credential" : "pairing_admin_session";
      await blocker.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = listEntryClassesAsAdmin(db, auth.input, now);
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

  it.each(["credential", "session"] as const)("lets an already authorized reader win before concurrent %s revocation", async (kind) => {
    const now = new Date(), raceId = await fixture(), auth = await access(raceId, "CHANGE_ENTRY_CLASS", now);
    const raceLocker = await pool.connect();
    const revoker = await pool.connect();
    let pending: ReturnType<typeof listEntryClassesAsAdmin> | undefined;
    let revocation: Promise<unknown> | undefined;
    let raceLockerTransactionOpen = false;
    let revokerTransactionOpen = false;
    let revocationSettled = false;
    try {
      await raceLocker.query("BEGIN");
      raceLockerTransactionOpen = true;
      await raceLocker.query("SELECT id FROM race WHERE id = $1 FOR UPDATE", [raceId]);
      const raceLockerPid = (await raceLocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pending = listEntryClassesAsAdmin(db, auth.input, now);
      const readerPid = await readerBlockedBy(raceLockerPid);

      await revoker.query("BEGIN");
      revokerTransactionOpen = true;
      const revokerPid = (await revoker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const sessionId = auth.input.sessionToken.split(".")[1]!;
      revocation = insertRevocation(revoker, kind, kind === "credential" ? auth.installation.credentialId : sessionId, now)
        .finally(() => { revocationSettled = true; });
      const revocationOrder = await waitForBlock(readerPid, revokerPid, () => revocationSettled);
      if (revocationOrder === "settled") {
        await revocation;
        await revoker.query("COMMIT");
        revokerTransactionOpen = false;
        await raceLocker.query("COMMIT");
        raceLockerTransactionOpen = false;
        await expect(pending).resolves.toEqual({ status: "unauthorized" });
        return;
      }
      await raceLocker.query("COMMIT");
      raceLockerTransactionOpen = false;
      await expect(pending).resolves.toMatchObject({ status: "ok" });
      await revocation;
      await revoker.query("COMMIT");
      revokerTransactionOpen = false;
      await expect(listEntryClassesAsAdmin(db, auth.input, now)).resolves.toEqual({ status: "unauthorized" });
    } finally {
      if (raceLockerTransactionOpen) await raceLocker.query("ROLLBACK");
      if (revokerTransactionOpen) await revoker.query("ROLLBACK");
      raceLocker.release();
      revoker.release();
      if (pending) await pending;
      if (revocation) await revocation;
    }
  });

  it("serializes a real class change with the private class-list race snapshot", async () => {
    const now = new Date(), raceId = await fixture(), auth = await access(raceId, "CHANGE_ENTRY_CLASS", now);
    const { entry, targetClassId } = await classChange(raceId);
    const before = await listEntryClassesAsAdmin(db, auth.input, now);
    if (before.status !== "ok") throw new Error("Ursprunglig klasslista saknas");
    const raceLocker = await pool.connect();
    let raceLockerTransactionOpen = false;
    let pendingList: ReturnType<typeof listEntryClassesAsAdmin> | undefined;
    let pendingChange: ReturnType<typeof changeEntryClass> | undefined;
    try {
      await raceLocker.query("BEGIN");
      raceLockerTransactionOpen = true;
      await raceLocker.query("SELECT id FROM race WHERE id = $1 FOR UPDATE", [raceId]);
      const raceLockerPid = (await raceLocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      pendingList = listEntryClassesAsAdmin(db, auth.input, now);
      const readerPid = await readerBlockedBy(raceLockerPid);
      pendingChange = changeEntryClass(db, raceId, entry.id, targetClassId);
      await waitForQueuedWriter(raceLockerPid, readerPid);
      await raceLocker.query("COMMIT");
      raceLockerTransactionOpen = false;
      const listed = await pendingList;
      if (listed.status !== "ok") throw new Error("Köad klasslista saknas");
      expect(listed.response.snapshotVersion).toBe(before.response.snapshotVersion);
      expect(listed.response.entries.find((item) => item.id === entry.id)?.classId).toBe(entry.classId);
      await pendingChange;
      const fresh = await listEntryClassesAsAdmin(db, auth.input, now);
      if (fresh.status !== "ok") throw new Error("Färsk klasslista saknas");
      expect(fresh.response.entries.find((item) => item.id === entry.id)?.classId).toBe(targetClassId);
      expect(fresh.response.snapshotVersion).toBe(before.response.snapshotVersion + 1);
    } finally {
      if (raceLockerTransactionOpen) await raceLocker.query("ROLLBACK");
      raceLocker.release();
      if (pendingList) await pendingList;
      if (pendingChange) await pendingChange;
    }
  });
});
