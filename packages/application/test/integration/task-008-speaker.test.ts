import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, schema } from "@o-tid/database";
import { contentHash, createEvent, importIofXml, ingestDeviceBatch,
  issuePairingAdminAccessCredential, loginPairingAdmin, listSpeakerBoardAsAdmin,
  revokePairingAdminAccessCredential } from "../../src";
import { authenticatePairingAdminSessionForProtectedRead } from "../../src/pairing-admin";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-06T12:00:00.000Z");
beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => { await pool.end(); });

async function fixture() {
  const { race } = await createEvent(db, { name: "Syntetiskt speakertest", raceName: "Lång",
    raceDate: "2026-08-30", timeZone: "Europe/Stockholm" });
  for (const file of ["course-data.xml", "entry-list.xml"]) {
    await importIofXml(db, race.id, await readFile(new URL(`../../../../fixtures/iof/${file}`, import.meta.url), "utf8"));
  }
  return race.id;
}

async function access(raceId: string, capability: "VIEW_SPEAKER_BOARD" | "VIEW_RACE_OVERVIEW" = "VIEW_SPEAKER_BOARD") {
  const installation = await issuePairingAdminAccessCredential(db, { raceId, capability,
    label: "Syntetisk speaker", expiresAt: new Date(now.getTime() + 8 * 3600_000) }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
    { now, expectedRaceId: raceId, expectedCapability: capability });
  if (login.status !== "authenticated") throw new Error("Testinloggning misslyckades");
  return { installation, input: { raceId, sessionToken: login.sessionToken } };
}

function batch() {
  const payload = { cardNumber: "12345", startPunchedAt: "2026-08-30T10:00:00Z",
    finishPunchedAt: "2026-08-30T10:40:00Z", punches: [31, 32, 33].map((code, index) => ({
      code, punchedAt: `2026-08-30T10:${10 + index * 10}:00Z`
    })) };
  return { deviceId: crypto.randomUUID(), sessionId: crypto.randomUUID(), packageVersion: 3,
    firstSequence: 1, lastSequence: 1, events: [{ localSequence: 1,
      stationReceivedAt: "2026-08-30T10:41:00Z", transport: "simulator" as const,
      payload, contentHash: contentHash(payload) }] };
}

describe("TASK 008 skyddad speakerläsning PostgreSQL", () => {
  it("läser tomt/publicerat underlag skrivfritt och återger retry utan ny rad", async () => {
    const raceId = await fixture();
    const auth = await access(raceId);
    await expect(listSpeakerBoardAsAdmin(db, auth.input, now)).resolves.toMatchObject({ status: "ok", response: { rows: [] } });
    const source = batch();
    expect((await ingestDeviceBatch(db, raceId, source)).acknowledgements[0]?.status).toBe("stored");
    const audits = async () => db.select({ value: count() }).from(schema.auditEvents).where(eq(schema.auditEvents.raceId, raceId));
    const before = await audits();
    const result = await listSpeakerBoardAsAdmin(db, auth.input, now);
    if (result.status !== "ok") throw new Error("Underlag saknas");
    expect(result.response.rows).toHaveLength(1);
    expect(result.response.rows[0]).toMatchObject({ slot: 1, givenName: "Ada", familyName: "Löpare",
      selectedRevision: 1, state: "ACTIVE_RESULT", result: { revision: 1, status: "OK", reason: "COMPLETE", elapsedMs: 2400_000 } });
    const json = JSON.stringify(result.response);
    for (const field of ["entryId", "readoutId", "cardNumber", "evaluation", "splits", "secretHash", "rawPayload"]) {
      expect(json).not.toContain(`"${field}"`);
    }
    expect((await ingestDeviceBatch(db, raceId, source)).acknowledgements[0]?.status).toBe("duplicate");
    expect(await listSpeakerBoardAsAdmin(db, auth.input, now)).toEqual(result);
    expect(await audits()).toEqual(before);
  });

  it("avvisar fel scope/capability, expiry och spärrad credential", async () => {
    const raceId = await fixture(), otherId = await fixture();
    const auth = await access(raceId), otherRole = await access(raceId, "VIEW_RACE_OVERVIEW");
    await expect(listSpeakerBoardAsAdmin(db, otherRole.input, now)).resolves.toEqual({ status: "forbidden" });
    await expect(listSpeakerBoardAsAdmin(db, { ...auth.input, raceId: otherId }, now)).resolves.toEqual({ status: "forbidden" });
    await expect(listSpeakerBoardAsAdmin(db, auth.input, new Date(now.getTime() + 3600_000)))
      .resolves.toEqual({ status: "unauthorized" });
    await revokePairingAdminAccessCredential(db, { credentialId: auth.installation.credentialId, capability: "VIEW_SPEAKER_BOARD" }, now);
    await expect(listSpeakerBoardAsAdmin(db, auth.input, now)).resolves.toEqual({ status: "unauthorized" });
    await expect(issuePairingAdminAccessCredential(db, { raceId, capability: "VIEW_SPEAKER_BOARD", label: "För lång",
      expiresAt: new Date(now.getTime() + 8 * 3600_000 + 1) }, { now })).rejects.toThrow();
  });

  it("visar historisk resultatklass med aktuellt klassnamn, personnamn och klubb efter import", async () => {
    const raceId = await fixture(), auth = await access(raceId);
    await ingestDeviceBatch(db, raceId, batch());
    const before = await listSpeakerBoardAsAdmin(db, auth.input, now);
    if (before.status !== "ok") throw new Error("Ursprungligt speakerunderlag saknas");
    expect(before.response.rows).toHaveLength(1);
    expect(before.response.rows[0]).toMatchObject({ givenName: "Ada", familyName: "Löpare",
      organisationName: "Centrum OK", className: "H21" });
    const revisionsBefore = await db.select().from(schema.resultRevisions)
      .where(eq(schema.resultRevisions.raceId, raceId));
    const original = revisionsBefore[0];
    if (!original) throw new Error("Ursprunglig revision saknas");

    // Exercise the real import boundary: display fields are current, but
    // changing the roster/course does not recalculate an existing result.
    const courses = await readFile(new URL("../../../../fixtures/iof/course-data.xml", import.meta.url), "utf8");
    await importIofXml(db, raceId, courses.replace("<ClassName>H21</ClassName>", "<ClassName>H21 uppdaterad</ClassName>"));
    const entries = await readFile(new URL("../../../../fixtures/iof/entry-list.xml", import.meta.url), "utf8");
    await importIofXml(db, raceId, entries
      .replace("<Given>Ada</Given>", "<Given>Adina</Given>")
      .replace("<Family>Löpare</Family>", "<Family>Testlöpare</Family>")
      .replace("<Organisation><Name>Centrum OK</Name></Organisation>", "<Organisation><Name>Syntetisk ny klubb</Name></Organisation>")
      .replace("<Class><Id>class-h21</Id><Name>H21</Name></Class>", "<Class><Id>class-d21</Id><Name>D21</Name></Class>"));
    const [currentEntry] = await db.select().from(schema.entries).where(eq(schema.entries.id, original.entryId));
    const currentClasses = await db.select().from(schema.classes).where(eq(schema.classes.raceId, raceId));
    expect(currentEntry?.classId).toBe(currentClasses.find((item) => item.externalId === "class-d21")?.id);
    expect(currentEntry?.classId).not.toBe(currentClasses.find((item) => item.externalId === "class-h21")?.id);
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId)))
      .toEqual(revisionsBefore);

    const after = await listSpeakerBoardAsAdmin(db, auth.input, now);
    if (after.status !== "ok") throw new Error("Uppdaterat speakerunderlag saknas");
    expect(after.response.raceSnapshotVersion).toBeGreaterThan(before.response.raceSnapshotVersion);
    expect(after.response.rows).toEqual([{ ...before.response.rows[0],
      givenName: "Adina", familyName: "Testlöpare", organisationName: "Syntetisk ny klubb", className: "H21 uppdaterad" }]);

    // A subsequent real readout creates a new revision in the current class.
    // It must not keep the historic class merely because the entry is the same.
    await ingestDeviceBatch(db, raceId, batch());
    const next = await listSpeakerBoardAsAdmin(db, auth.input, now);
    if (next.status !== "ok") throw new Error("Nytt revisionsunderlag saknas");
    expect(next.response.rows).toHaveLength(1);
    expect(next.response.rows[0]).toMatchObject({ givenName: "Adina", familyName: "Testlöpare",
      organisationName: "Syntetisk ny klubb", className: "D21", selectedRevision: 2,
      state: "ACTIVE_RESULT", result: { revision: 2, status: "MP", reason: "MISSING_CONTROL" } });
    expect(await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.id, original.id)))
      .toEqual([original]);
  });

  it("väljer publicerat huvud före global tidsordning och limit, med stabil UUID-tie", async () => {
    const raceId = await fixture();
    const auth = await access(raceId);
    await ingestDeviceBatch(db, raceId, batch());
    const [source] = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
    const [entry] = await db.select().from(schema.entries).where(eq(schema.entries.id, source!.entryId));
    if (!source || !entry || !("entryId" in source.evaluation)) throw new Error("Syntetisk revisionsgrund saknas");
    const clones = await db.insert(schema.entries).values(Array.from({ length: 30 }, (_, index) => ({
      raceId, classId: entry.classId, givenName: `Syntetisk ${index}`, familyName: "Test"
    }))).returning();
    const timestamp = new Date("2026-09-06T15:00:00.000Z");
    const revisions = clones.map((clone, index) => ({ ...source,
      id: `${source.id.slice(0, 24)}${index.toString(16).padStart(12, "0")}`,
      entryId: clone.id, evaluation: { ...source.evaluation, entryId: clone.id }, createdAt: timestamp
    }));
    await db.insert(schema.resultRevisions).values(revisions);
    // Revision 2 is the published head even though its timestamp is older.
    await db.insert(schema.resultRevisions).values({ ...revisions[29]!, id: crypto.randomUUID(), revision: 2,
      createdAt: new Date("2020-01-01T00:00:00.000Z") });
    // An unpublished higher revision must not push another entry out of the list.
    await db.insert(schema.resultRevisions).values({ ...revisions[0]!, id: crypto.randomUUID(), revision: 2,
      published: false, createdAt: new Date("2030-01-01T00:00:00.000Z") });
    const result = await listSpeakerBoardAsAdmin(db, auth.input, now);
    if (result.status !== "ok") throw new Error("Speakerunderlag saknas");
    expect(result.response.rows).toHaveLength(25);
    // Actual ingest timestamp may be later than the fixed tie timestamp.
    const tied = result.response.rows.filter((item) => item.registeredAt === timestamp.toISOString());
    expect(tied.map((item) => item.givenName)).toEqual(Array.from({ length: tied.length }, (_, index) => `Syntetisk ${28 - index}`));
    expect(result.response.rows.some((item) => item.givenName === "Syntetisk 29")).toBe(false);
    expect(result.response.rows.some((item) => item.registeredAt.startsWith("2030"))).toBe(false);
    expect(result.response.rows.map((item) => item.slot)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
  });

  it.each(["credential", "session"] as const)("ser %s-spärr som committar medan läsningen väntar på låset", async (kind) => {
    const raceId = await fixture();
    const auth = await access(raceId);
    const blocker = await pool.connect();
    let pending: ReturnType<typeof listSpeakerBoardAsAdmin> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const sessionId = auth.input.sessionToken.split(".")[1]!;
      if (kind === "credential") {
        await blocker.query("SELECT id FROM pairing_admin_access_credential WHERE id = $1 FOR UPDATE", [auth.installation.credentialId]);
      } else {
        await blocker.query("SELECT id FROM pairing_admin_session WHERE id = $1 FOR UPDATE", [sessionId]);
      }
      pending = listSpeakerBoardAsAdmin(db, auth.input, now);
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await pool.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))) AS waiting", [pid]);
        if (result.rows[0]?.waiting) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      if (kind === "credential") {
        await blocker.query("INSERT INTO pairing_admin_access_credential_revocation (credential_id, revoked_at, reason) VALUES ($1, $2, $3)",
          [auth.installation.credentialId, now, "SYNTHETIC_CONCURRENT_REVOKE"]);
      } else {
        await blocker.query("INSERT INTO pairing_admin_session_revocation (session_id, revoked_at, reason) VALUES ($1, $2, $3)",
          [sessionId, now, "SYNTHETIC_CONCURRENT_LOGOUT"]);
      }
      await blocker.query("COMMIT");
      await expect(pending).resolves.toEqual({ status: "unauthorized" });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
    }
  });

  it("avvisar gammalt snapshot efter annan sessions logout men tillåter färsk läsning", async () => {
    const raceId = await fixture(), auth = await access(raceId);
    const other = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: auth.installation.accessCredential },
      { now, expectedRaceId: raceId, expectedCapability: "VIEW_SPEAKER_BOARD" });
    if (other.status !== "authenticated") throw new Error("Andra testsessionen saknas");
    await db.transaction(async (tx) => {
      await tx.execute(sql`select 1`); // Establish snapshot before an independently committed logout.
      await db.insert(schema.pairingAdminSessionRevocations).values({
        sessionId: other.sessionToken.split(".")[1]!, revokedAt: now, reason: "SYNTHETIC_OTHER_LOGOUT"
      });
      expect(await authenticatePairingAdminSessionForProtectedRead(tx, { ...auth.input, capability: "VIEW_SPEAKER_BOARD" }, now))
        .toEqual({ status: "unauthorized" });
    }, { isolationLevel: "repeatable read" });
    expect((await listSpeakerBoardAsAdmin(db, auth.input, now)).status).toBe("ok");
    expect(await listSpeakerBoardAsAdmin(db, { raceId, sessionToken: other.sessionToken }, now)).toEqual({ status: "unauthorized" });
    const [guard] = await db.select().from(schema.pairingAdminRevocationGuards)
      .where(eq(schema.pairingAdminRevocationGuards.credentialId, auth.installation.credentialId));
    expect(guard?.generation).toBe(1n);
  });

  it("behåller auktoriserad läsnings lås efter savepoint tills yttre commit", async () => {
    const raceId = await fixture(), auth = await access(raceId);
    let pending: ReturnType<typeof revokePairingAdminAccessCredential> | undefined;
    try {
      await db.transaction(async (tx) => {
        const authorization = await authenticatePairingAdminSessionForProtectedRead(tx,
          { ...auth.input, capability: "VIEW_SPEAKER_BOARD" }, now);
        expect(authorization.status).toBe("authenticated");
        const pid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]!.pid);
        pending = revokePairingAdminAccessCredential(db, { credentialId: auth.installation.credentialId, capability: "VIEW_SPEAKER_BOARD" }, now);
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await pool.query<{ waiting: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))) AS waiting", [pid]);
          if (result.rows[0]?.waiting) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        const revocations = await tx.select().from(schema.pairingAdminAccessCredentialRevocations)
          .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, auth.installation.credentialId));
        expect(revocations).toEqual([]);
      }, { isolationLevel: "repeatable read" });
      await expect(pending).resolves.toMatchObject({ status: "revoked" });
      await expect(listSpeakerBoardAsAdmin(db, auth.input, now)).resolves.toEqual({ status: "unauthorized" });
    } finally {
      if (pending) await pending;
    }
  });

  it("har guard för gamla/nya credentials och skyddar identitet/generation", async () => {
    const raceId = await fixture(), auth = await access(raceId);
    const missing = await db.execute(sql`select count(*)::integer as missing
      from pairing_admin_access_credential c left join pairing_admin_revocation_guard g
      on g.credential_id = c.id where g.credential_id is null`);
    expect(missing.rows[0]!.missing).toBe(0);
    const before = await db.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, auth.installation.credentialId));
    await expect(db.delete(schema.pairingAdminRevocationGuards)
      .where(eq(schema.pairingAdminRevocationGuards.credentialId, auth.installation.credentialId))).rejects.toThrow();
    await expect(db.update(schema.pairingAdminRevocationGuards).set({ generation: 0n })
      .where(eq(schema.pairingAdminRevocationGuards.credentialId, auth.installation.credentialId))).rejects.toThrow();
    await revokePairingAdminAccessCredential(db, { credentialId: auth.installation.credentialId, capability: "VIEW_SPEAKER_BOARD" }, now);
    expect(await db.select().from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.id, auth.installation.credentialId))).toEqual(before);
    const [guard] = await db.select().from(schema.pairingAdminRevocationGuards)
      .where(eq(schema.pairingAdminRevocationGuards.credentialId, auth.installation.credentialId));
    expect(guard?.generation).toBe(1n);
  });

  it("avvisar auth och spärrwrite om lagringsgrinden saknas", async () => {
    const raceId = await fixture(), auth = await access(raceId);
    // A transaction-local empty shadow simulates missing guard state without
    // disabling protection triggers or deleting any persistent security row.
    await db.transaction(async (tx) => {
      await tx.execute(sql`create temporary table pairing_admin_revocation_guard
        (like public.pairing_admin_revocation_guard) on commit drop`);
      expect(await authenticatePairingAdminSessionForProtectedRead(tx,
        { ...auth.input, capability: "VIEW_SPEAKER_BOARD" }, now)).toEqual({ status: "unauthorized" });
      await expect(tx.transaction(async (savepoint) => {
        await savepoint.insert(schema.pairingAdminAccessCredentialRevocations).values({
          credentialId: auth.installation.credentialId, revokedAt: now, reason: "SYNTHETIC_MISSING_GUARD"
        });
      })).rejects.toThrow();
    });
    expect((await listSpeakerBoardAsAdmin(db, auth.input, now)).status).toBe("ok");
    expect(await db.select().from(schema.pairingAdminAccessCredentialRevocations)
      .where(eq(schema.pairingAdminAccessCredentialRevocations.credentialId, auth.installation.credentialId))).toEqual([]);
  });

  it("avvisar hela underlaget vid motsägande lagrad revision utan PII i felet", async () => {
    const raceId = await fixture(), auth = await access(raceId);
    await ingestDeviceBatch(db, raceId, batch());
    const [source] = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
    if (!source) throw new Error("Syntetisk revision saknas");
    await db.insert(schema.resultRevisions).values({ ...source, id: crypto.randomUUID(), revision: 2,
      status: "MP", reason: "MISSING_START" }); // Evaluation still proves technical OK: deliberately corrupt fixture.
    await expect(listSpeakerBoardAsAdmin(db, auth.input, now))
      .rejects.toThrow("Resultatrevisionen motsäger sitt lagrade utfall");
    const revisions = await db.select().from(schema.resultRevisions).where(eq(schema.resultRevisions.raceId, raceId));
    expect(revisions).toHaveLength(2);
    expect(revisions.find((revision) => revision.id === source.id)).toEqual(source);
  });

  it("utfärdar och spärrar genom betrodd CLI utan hemlighet i argv/fel", async () => {
    const raceId = await fixture();
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const run = ([command, ...args]: string[]) => promisify(execFile)("pnpm", ["--silent", `speaker:access:${command}`, ...args], {
      cwd: root, env: { ...process.env, DATABASE_URL: url }, timeout: 15_000, maxBuffer: 64 * 1024
    });
    // execFile pipes stdout into memory; the generated secret is never an argument or log.
    const issued = await run(["issue", "--race-id", raceId, "--label", "Syntetisk CLI",
      "--expires-at", new Date(Date.now() + 3600_000).toISOString()]);
    expect(issued.stderr).toBe("");
    const installation = JSON.parse(issued.stdout) as { credentialId: string; accessCredential: string; capability: string };
    expect(installation.capability).toBe("VIEW_SPEAKER_BOARD");
    expect(installation.accessCredential.startsWith("otid_org_speaker_board_v1.")).toBe(true);
    const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: installation.accessCredential },
      { expectedRaceId: raceId, expectedCapability: "VIEW_SPEAKER_BOARD" });
    expect(login.status).toBe("authenticated");
    const revoked = await run(["revoke", "--credential-id", installation.credentialId, "--reason", "SYNTHETIC_CLI_REVOKE"]);
    expect(JSON.parse(revoked.stdout)).toMatchObject({ status: "revoked", credentialId: installation.credentialId });
    expect(JSON.parse((await run(["revoke", "--credential-id", installation.credentialId])).stdout)).toMatchObject({ status: "already-revoked" });
    const before = await db.select({ value: count() }).from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.raceId, raceId));
    await expect(run(["issue", "--race-id", raceId, "--race-id", raceId])).rejects.toMatchObject({ code: 1, stdout: "" });
    expect(await db.select({ value: count() }).from(schema.pairingAdminAccessCredentials)
      .where(eq(schema.pairingAdminAccessCredentials.raceId, raceId))).toEqual(before);
    // Four real CLI processes each have their own 15-second timeout.
  }, 65_000);
});
