import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  changeEntryClass, changeEntryClassAsAdmin, getRaceOverviewAsAdmin, importIofXml, ingestDeviceBatch,
  listEntryClassesAsAdmin, logoutUserAccountSession, publicRaceSummary, requireRaceRole
} from "../../src";
import { db, courseXml, importedRace, batch, okPayload, useRaceDatabase } from "./race-fixtures";
import { raceAuth } from "./accounts";

useRaceDatabase();

/** Steg 23 (ADR-0173 beslut 4): en sessionsnivå. Kontots session och dess roll på eventet gäller tävlingen. */
describe("en sessionsnivå: kontosession och roll per tävling", () => {
  const now = new Date("2026-09-12T12:00:00.000Z");

  it("använder kontots session för översikt, lista och spårbart klassbyte med exakt retry", async () => {
    const { raceId, overview } = await importedRace();
    const actor = await raceAuth(db, raceId, "ADMIN", now);
    expect(await requireRaceRole(db, { ...actor, role: "ADMIN" }, now)).toMatchObject({ status: "authenticated",
      principal: { accountId: actor.actorId, raceId, role: "ADMIN", grantRole: "ADMIN", expiresAt: "2026-10-12T12:00:00.000Z" } });
    expect((await getRaceOverviewAsAdmin(db, actor, now)).status).toBe("ok");
    expect((await listEntryClassesAsAdmin(db, actor, now)).status).toBe("ok");
    const entry = overview.entries[0];
    const target = overview.classes.find((value) => value.id !== entry?.classId);
    if (!entry || !target) throw new Error("Deltagare eller klass saknas");
    const [storedEntry] = await db.select({ version: schema.entries.version }).from(schema.entries)
      .where(eq(schema.entries.id, entry.id));
    if (!storedEntry) throw new Error("Version saknas");
    const requestId = crypto.randomUUID();
    const input = { ...actor, entryId: entry.id, idempotencyKey: `entry-class-change:${requestId}`,
      request: { formatVersion: 1, classId: target.id, expectedEntryVersion: storedEntry.version } };
    expect(await changeEntryClassAsAdmin(db, { ...input, csrfHeader: "invalid" }, now)).toEqual({ status: "forbidden" });
    const changed = await changeEntryClassAsAdmin(db, input, now);
    expect(changed.status).toBe("changed");
    if (changed.status !== "changed") throw new Error("Klassbytet misslyckades");
    expect(await changeEntryClassAsAdmin(db, input, now)).toEqual({ status: "changed",
      response: { ...changed.response, replayed: true } });
    const other = await raceAuth(db, raceId, "ADMIN", now);
    expect(await changeEntryClassAsAdmin(db, { ...input, ...other, entryId: entry.id }, now)).toEqual({ status: "conflict" });
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.requestId, requestId));
    expect(audit).toEqual([expect.objectContaining({ actorKind: "USER_ACCOUNT", actorId: actor.actorId })]);
    const journal = await db.select().from(schema.entryClassChangeRequests)
      .where(eq(schema.entryClassChangeRequests.requestId, requestId));
    expect(journal).toHaveLength(1);
    expect(journal[0]?.actorAccountId).toBe(actor.actorId);
  });

  it("nekar utan behörighet på eventet, för låg roll, utgången och utloggad session och borttagen behörighet", async () => {
    const { raceId } = await importedRace();
    const other = await importedRace();
    const admin = await raceAuth(db, raceId, "ADMIN", now);
    const functionary = await raceAuth(db, raceId, "FUNCTIONARY", now);
    const check = (proof: typeof admin, role: "ADMIN" | "FUNCTIONARY", at = now, id = raceId) =>
      requireRaceRole(db, { ...proof, raceId: id, role }, at).then((result) => result.status);
    expect(await check(admin, "ADMIN")).toBe("authenticated");
    expect(await check(functionary, "FUNCTIONARY")).toBe("authenticated");
    expect(await check(functionary, "ADMIN")).toBe("forbidden");
    expect((await listEntryClassesAsAdmin(db, functionary, now)).status).toBe("forbidden");
    // En annan tävling (ett annat event) och en okänd session.
    expect(await check(admin, "FUNCTIONARY", now, other.raceId)).toBe("unauthorized");
    expect(await check({ ...admin, sessionToken: `otid_user_session_v1.${crypto.randomUUID()}.${"A".repeat(43)}` }, "ADMIN"))
      .toBe("unauthorized");
    // CSRF gäller bara skrivningar och måste vara kontosessionens.
    expect((await requireRaceRole(db, { ...admin, csrfHeader: "A".repeat(43), role: "ADMIN", requireCsrf: true }, now)).status)
      .toBe("forbidden");
    expect((await requireRaceRole(db, { ...admin, role: "ADMIN", requireCsrf: true }, now)).status).toBe("authenticated");
    // Kontots session gäller 30 dagar.
    expect(await check(admin, "ADMIN", new Date("2026-10-12T12:00:00.000Z"))).toBe("unauthorized");

    // Utloggning och borttagen behörighet slår igenom direkt.
    expect(await logoutUserAccountSession(db, admin, now)).toEqual({ status: "logged-out" });
    expect(await check(admin, "ADMIN")).toBe("unauthorized");
    const [grant] = await db.select({ id: schema.eventAdministrationGrants.id }).from(schema.eventAdministrationGrants)
      .where(eq(schema.eventAdministrationGrants.accountId, functionary.actorId));
    if (!grant) throw new Error("Behörigheten saknas");
    await db.insert(schema.eventAdministrationGrantRevocations).values({ grantId: grant.id, revokedAt: now, reason: "Test" });
    expect(await check(functionary, "FUNCTIONARY")).toBe("unauthorized");
  });
});

describe("skyddad raceöversikt", () => {
  const usedAt = new Date("2026-08-31T20:02:00.000Z");

  async function overviewAdmin(raceId: string) {
    const auth = await raceAuth(db, raceId, "ADMIN", new Date("2026-08-31T20:01:00.000Z"));
    return { auth, login: { sessionToken: auth.sessionToken, csrfToken: auth.csrfCookie } };
  }

  async function writeFootprint() {
    const [audits, sessions, revisions, imports] = await Promise.all([
      db.select({ value: count() }).from(schema.auditEvents),
      db.select({ value: count() }).from(schema.userAccountSessions),
      db.select({ value: count() }).from(schema.resultRevisions),
      db.select({ value: count() }).from(schema.importFiles)
    ]);
    return { audits: audits[0]?.value, sessions: sessions[0]?.value, revisions: revisions[0]?.value, imports: imports[0]?.value };
  }

  it("returnerar strikt PII-fri projektion och en separat minimal publik sammanfattning", async () => {
    const fixture = await importedRace();
    await ingestDeviceBatch(db, fixture.raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await overviewAdmin(fixture.raceId);
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
    expect(encoded).not.toContain(admin.login.sessionToken);
    expect(encoded).not.toContain(admin.login.csrfToken);

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

  it("isolerar tävlingen och gör 100 samtidiga läsningar utan skrivningar", async () => {
    const fixture = await importedRace();
    const other = await importedRace();
    await ingestDeviceBatch(db, other.raceId, batch(crypto.randomUUID(), okPayload));
    const admin = await overviewAdmin(fixture.raceId);
    await expect(getRaceOverviewAsAdmin(db, { sessionToken: admin.login.sessionToken, raceId: other.raceId }, usedAt))
      .resolves.toEqual({ status: "unauthorized" });
    const functionary = await raceAuth(db, fixture.raceId, "FUNCTIONARY", new Date("2026-08-31T20:01:00.000Z"));
    await expect(getRaceOverviewAsAdmin(db, functionary, usedAt)).resolves.toEqual({ status: "forbidden" });

    const before = await writeFootprint();
    const responses = await Promise.all(Array.from({ length: 100 }, () => getRaceOverviewAsAdmin(db, {
      sessionToken: admin.login.sessionToken, raceId: fixture.raceId }, usedAt)));
    expect(responses.every((response) => response.status === "ok")).toBe(true);
    expect(responses.every((response) => response.status !== "ok" ||
      response.response.race.id === fixture.raceId && response.response.counts.readouts === 0)).toBe(true);
    expect(await writeFootprint()).toEqual(before);
  });

  it.each(["class", "import"] as const)(
    "serialiserar samtidig %s-mutation till en sammanhängande snapshotprojektion",
    async (mutation) => {
      const fixture = await importedRace();
      const admin = await overviewAdmin(fixture.raceId);
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
