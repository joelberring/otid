import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  changeEntryClass, changeEntryClassAsAdmin, importIofXml, ingestDeviceBatch,
  getRaceOverviewAsAdmin, listEntryClassesAsAdmin, publicRaceSummary
} from "../../src";
import {
  authenticatePairingAdminSession, issuePairingAdminAccessCredential, loginPairingAdmin,
  logoutPairingAdminSession, revokePairingAdminAccessCredential
} from "../../src/pairing-admin";
import { db, courseXml, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";

useRaceDatabase();

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
    expect((await getRaceOverviewAsAdmin(db, actor.proof, new Date("2026-09-12T13:00:00Z"))).status).toBe("unauthorized");
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
      raceId, capability: "IMPORT_IOF", label: `Målvagn ${marker}`,
      expiresAt: new Date("2026-08-31T21:00:00.000Z")
    }, { now: accessIssuedAt, secretBytes: Buffer.alloc(32, marker) });
    const login = await loginPairingAdmin(db, {
      formatVersion: 1, accessCredential: installation.accessCredential
    }, {
      expectedRaceId: raceId,
      expectedCapability: "IMPORT_IOF",
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
      formatVersion: 1, raceId, capability: "IMPORT_IOF", expiresAt: "2026-08-31T15:01:00.000Z"
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
      sessionToken: login.sessionToken, raceId, capability: "IMPORT_IOF",
      requireCsrf: true, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toMatchObject({ status: "authenticated" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: login.sessionToken, raceId, capability: "IMPORT_IOF",
      requireCsrf: true, csrfCookie: login.csrfToken, csrfHeader: "A".repeat(43)
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toEqual({ status: "forbidden" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: login.sessionToken, raceId: other.raceId, capability: "IMPORT_IOF"
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toEqual({ status: "forbidden" });
    await expect(loginPairingAdmin(db, {
      formatVersion: 1, accessCredential: installation.accessCredential.replace(/.$/, "A")
    }, {
      expectedRaceId: raceId, expectedCapability: "IMPORT_IOF",
      now: new Date("2026-08-31T14:02:00.000Z")
    })).resolves.toEqual({ status: "unauthorized" });
    const [beforeUnknown] = await db.select({ value: count() }).from(schema.pairingAdminSessions);
    await expect(loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: `otid_org_import_v1.${crypto.randomUUID()}.${Buffer.alloc(32, 63).toString("base64url")}`
    }, {
      expectedRaceId: raceId, expectedCapability: "IMPORT_IOF",
      now: new Date("2026-08-31T14:02:00.000Z")
    })).resolves.toEqual({ status: "unauthorized" });
    const [afterUnknown] = await db.select({ value: count() }).from(schema.pairingAdminSessions);
    expect(afterUnknown?.value).toBe(beforeUnknown?.value);
  });

  it("spärr och logout slår igenom direkt och auth-tabellerna är append-only", async () => {
    const { raceId } = await importedRace();
    const first = await adminSession(raceId, 101);
    await expect(logoutPairingAdminSession(db, {
      sessionToken: first.login.sessionToken, csrfCookie: first.login.csrfToken, csrfHeader: first.login.csrfToken,
      raceId, capability: "IMPORT_IOF",
      readBodyIsEmpty: async () => false
    }, new Date("2026-08-31T14:02:00.000Z"))).resolves.toEqual({ status: "invalid-request" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "IMPORT_IOF"
    }, new Date("2026-08-31T14:02:30.000Z"))).resolves.toMatchObject({ status: "authenticated" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "IMPORT_IOF",
      csrfCookie: first.login.csrfToken, csrfHeader: first.login.csrfToken
    }, new Date("2026-08-31T14:03:00.000Z"))).resolves.toEqual({ status: "logged-out" });
    await expect(logoutPairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "IMPORT_IOF",
      csrfCookie: first.login.csrfToken, csrfHeader: first.login.csrfToken
    }, new Date("2026-08-31T14:04:00.000Z"))).resolves.toEqual({ status: "already-logged-out" });
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: first.login.sessionToken, raceId, capability: "IMPORT_IOF"
    }, new Date("2026-08-31T14:04:00.000Z"))).resolves.toEqual({ status: "unauthorized" });

    const second = await adminSession(raceId, 111);
    await revokePairingAdminAccessCredential(db, {
      credentialId: second.installation.credentialId,
      capability: "IMPORT_IOF"
    },
      new Date("2026-08-31T14:03:00.000Z"));
    await expect(authenticatePairingAdminSession(db, {
      sessionToken: second.login.sessionToken, raceId, capability: "IMPORT_IOF"
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
      raceDate: fixture.overview.race.raceDate,
      shortCode: summary.shortCode
    });
    expect(summary.shortCode).toMatch(/^[2-9a-hjkmnp-z]{6}$/);
    expect(Object.keys(summary).sort()).toEqual(["eventName", "id", "name", "raceDate", "shortCode"]);
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
      capability: "VIEW_SPEAKER_BOARD",
      label: "Fel capability",
      expiresAt: new Date("2026-09-01T04:00:00.000Z")
    }, { now: issuedAt, secretBytes: Buffer.alloc(32, 124) });
    const pairingLogin = await loginPairingAdmin(db, {
      formatVersion: 1,
      accessCredential: pairingCredential.accessCredential
    }, {
      expectedRaceId: fixture.raceId,
      expectedCapability: "VIEW_SPEAKER_BOARD",
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
      capability: "VIEW_SPEAKER_BOARD",
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
      capability: "VIEW_SPEAKER_BOARD"
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
