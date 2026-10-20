import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { decideStartListPublicationAsAdmin, getPublicStartList, getPublishedStartListXml, getStartListPublicationPreviewAsAdmin,
  listEntryTransfersAsAdmin } from "../../src";
import { saveRaceSettingsAsAdmin } from "../../src/race-settings";
import { readPublicRaceHub } from "../../src/public-races";
import { raceLogin } from "./accounts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-10-20T12:00:00.000Z");
beforeAll(async () => {
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
});
afterAll(async () => pool.end());

/** Påhittad tävling: en klass med fri start, två löpare, den ena med bricka. */
async function setup() {
  const [event] = await db.insert(schema.events).values({ name: "Steg 33 Kvällsträning", startsOn: "2026-10-20", timeZone: "Europe/Stockholm" }).returning();
  if (!event) throw Error();
  const [race] = await db.insert(schema.races).values({ eventId: event.id, name: "Kvällsträning", raceDate: "2026-10-20", raceType: "TRAINING" }).returning();
  if (!race) throw Error();
  const [course] = await db.insert(schema.courses).values({ raceId: race.id, name: "Mellan" }).returning();
  const [version] = await db.insert(schema.courseVersions).values({ courseId: course!.id, version: 1 }).returning();
  const [raceClass] = await db.insert(schema.classes).values({ raceId: race.id, name: "Öppen", courseVersionId: version!.id, startRule: "PUNCH" }).returning();
  const entries = await db.insert(schema.entries).values([
    { raceId: race.id, classId: raceClass!.id, givenName: "Testa", familyName: "Påhittad", organisationName: "OK Exempel" },
    { raceId: race.id, classId: raceClass!.id, givenName: "Prova", familyName: "Bricklös", organisationName: null }
  ]).returning();
  await db.insert(schema.cardAssignments).values({ raceId: race.id, entryId: entries[0]!.id, cardNumber: "8123456" });
  const login = await raceLogin(db, race.id, "ADMIN", now);
  const auth = { raceId: race.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken };
  return { race, entries, auth };
}

async function settings(auth: Awaited<ReturnType<typeof setup>>["auth"], change: Record<string, unknown>) {
  const requestId = randomUUID();
  return saveRaceSettingsAsAdmin(db, { ...auth, idempotencyKey: `race-settings:${requestId}`, request: { formatVersion: 1, requestId,
    eventName: "Steg 33 Kvällsträning", raceName: "Kvällsträning", raceDate: "2026-10-20", raceType: "TRAINING", ...change } }, now);
}

async function publish(auth: Awaited<ReturnType<typeof setup>>["auth"], expectedRevision: number) {
  const preview = await getStartListPublicationPreviewAsAdmin(db, auth, now);
  if (preview.status !== "ok" || !preview.response.sourceHash) throw Error("Ingen förhandsvisning");
  return decideStartListPublicationAsAdmin(db, { ...auth, idempotencyKey: `start-list-publication:${randomUUID()}`,
    request: { formatVersion: 1, action: "PUBLISH", expectedRevision, expectedSourceHash: preview.response.sourceHash } }, now);
}

describe("Steg 33: tävlingsinfo och bricka i startlistan", () => {
  it("sparar info och första start med auditpost och visar dem på tävlingssidan och i arbetsytan", async () => {
    const f = await setup();
    expect(await readPublicRaceHub(db, f.race.id)).toMatchObject({ info: null, firstStartTime: null });
    const info = "Samling vid klubbstugan.\nKarta i skala 1:10 000.\n\nVälkomna!";
    expect(await settings(f.auth, { info, firstStartTime: "18:30" })).toMatchObject({ status: "saved" });
    expect(await readPublicRaceHub(db, f.race.id)).toMatchObject({ info, firstStartTime: "18:30" });
    const workspace = await listEntryTransfersAsAdmin(db, f.auth, now);
    expect(workspace).toMatchObject({ status: "ok", response: { info, firstStartTime: "18:30", publicStartListCardNumbers: true } });
    const [audit] = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.raceId, f.race.id),
      eq(schema.auditEvents.action, "RACE_SETTINGS_SAVED_BY_ADMIN")));
    expect(audit).toMatchObject({ before: { info: null, firstStartTime: null }, after: { info, firstStartTime: "18:30" } });

    // En äldre klient utan fälten ändrar dem inte; null tömmer.
    expect(await settings(f.auth, {})).toMatchObject({ status: "saved" });
    expect(await readPublicRaceHub(db, f.race.id)).toMatchObject({ info, firstStartTime: "18:30" });
    expect(await settings(f.auth, { info: null, firstStartTime: null })).toMatchObject({ status: "saved" });
    expect(await readPublicRaceHub(db, f.race.id)).toMatchObject({ info: null, firstStartTime: null });

    // Ogiltigt: för lång text, HTML-tecken är bara text (godtas), fel klockslag, inledande blanksteg.
    expect(await settings(f.auth, { info: "x".repeat(1001) })).toEqual({ status: "invalid-request" });
    expect(await settings(f.auth, { firstStartTime: "25:00" })).toEqual({ status: "invalid-request" });
    expect(await settings(f.auth, { firstStartTime: "1830" })).toEqual({ status: "invalid-request" });
    expect(await settings(f.auth, { info: " info" })).toEqual({ status: "invalid-request" });
    expect(await settings(f.auth, { info: "<b>fet</b>" })).toMatchObject({ status: "saved" });
    expect(await readPublicRaceHub(db, f.race.id)).toMatchObject({ info: "<b>fet</b>" });
  });

  it("bricka följer med i ögonblicksbilden och visas bara när inställningen är på", async () => {
    const f = await setup();
    expect(await publish(f.auth, 0)).toMatchObject({ status: "decided" });
    const shown = await getPublicStartList(db, f.race.id);
    if (shown.status !== "published") throw Error();
    expect(shown.response.showCardNumbers).toBe(true);
    expect(shown.response.content.classes[0]!.entries.map(entry => [entry.displayName, entry.cardNumber]))
      .toEqual([["Prova Bricklös", undefined], ["Testa Påhittad", "8123456"]]);
    // IOF-exporten av den publicerade listan är oförändrad (ingen bricka).
    const xml = await getPublishedStartListXml(db, f.race.id);
    expect(xml.status === "exported" && xml.xml).not.toContain("8123456");

    // Avstängd: döljs direkt i den redan publicerade listan.
    expect(await settings(f.auth, { publicStartListCardNumbers: false })).toMatchObject({ status: "saved" });
    const hidden = await getPublicStartList(db, f.race.id);
    if (hidden.status !== "published") throw Error();
    expect(hidden.response.revision).toBe(shown.response.revision);
    expect(hidden.response.showCardNumbers).toBe(false);
    expect(JSON.stringify(hidden.response)).not.toContain("8123456");

    // Påslagen igen; en ändrad bricka syns först efter ny publicering.
    expect(await settings(f.auth, { publicStartListCardNumbers: true })).toMatchObject({ status: "saved" });
    await db.update(schema.cardAssignments).set({ active: false }).where(eq(schema.cardAssignments.entryId, f.entries[0]!.id));
    await db.insert(schema.cardAssignments).values({ raceId: f.race.id, entryId: f.entries[0]!.id, cardNumber: "8654321" });
    expect(JSON.stringify(await getPublicStartList(db, f.race.id))).toContain("8123456");
    expect(await publish(f.auth, 1)).toMatchObject({ status: "decided" });
    const republished = JSON.stringify(await getPublicStartList(db, f.race.id));
    expect(republished).toContain("8654321");
    expect(republished).not.toContain("8123456");
  });
});
