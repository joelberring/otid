import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { and, eq } from "drizzle-orm";
import { createDatabase, schema } from "@o-tid/database";
import { commitClassStartDrawAsAdmin, issuePairingAdminAccessCredential, listFixedStartSlotPlansAsAdministrator,
  loginPairingAdmin, previewClassStartDrawAsAdmin } from "../../src";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL krävs");
const { db, pool } = createDatabase(url);
const now = new Date("2026-09-20T07:00:00.000Z");
beforeAll(async () => migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname }));
afterAll(async () => pool.end());

async function setup() {
  const [event] = await db.insert(schema.events).values({ name: `Slot ${randomUUID()}`, startsOn: "2026-09-20", timeZone: "Europe/Stockholm" }).returning();
  const [race] = await db.insert(schema.races).values({ eventId: event!.id, name: "Lång", raceDate: "2026-09-20" }).returning();
  const [course] = await db.insert(schema.courses).values({ raceId: race!.id, name: "Lång bana" }).returning();
  const [version] = await db.insert(schema.courseVersions).values({ courseId: course!.id, version: 1 }).returning();
  const [fixed] = await db.insert(schema.classes).values({ raceId: race!.id, name: "D21", courseVersionId: version!.id, startRule: "FIXED", maxEntries: 5 }).returning();
  const [punch] = await db.insert(schema.classes).values({ raceId: race!.id, name: "Öppen", courseVersionId: version!.id, startRule: "PUNCH" }).returning();
  const entries = await db.insert(schema.entries).values([
    { raceId: race!.id, classId: fixed!.id, givenName: "Ada", familyName: "Andersson" },
    { raceId: race!.id, classId: fixed!.id, givenName: "Bea", familyName: "Berg" },
    { raceId: race!.id, classId: punch!.id, givenName: "Cia", familyName: "Carlsson" }
  ]).returning();
  const credential = await issuePairingAdminAccessCredential(db, { raceId: race!.id, capability: "MANAGE_RACE", label: "Admin", expiresAt: new Date("2026-09-20T15:00:00.000Z") }, { now });
  const login = await loginPairingAdmin(db, { formatVersion: 1, accessCredential: credential.accessCredential }, { expectedRaceId: race!.id, expectedCapability: "MANAGE_RACE", now });
  if (login.status !== "authenticated") throw new Error("Administratörsinloggning saknas");
  return { race: race!, fixed: fixed!, entries, auth: { raceId: race!.id, sessionToken: login.sessionToken, csrfCookie: login.csrfToken, csrfHeader: login.csrfToken } };
}

describe("TASK108 PostgreSQL: planerade startluckor", () => {
  it("visar endast senaste lottade FIXED-planen, utan write och utan PUNCH-slots", async () => {
    const f = await setup();
    const beforeDraw = await listFixedStartSlotPlansAsAdministrator(db, f.auth, now);
    expect(beforeDraw).toMatchObject({ status: "ok", response: { classes: [{ classId: f.fixed.id, plan: { status: "UNAVAILABLE", reason: "NO_SAVED_DRAW" } }] } });
    const parameters = { algorithmVersion: "xorshift32-fisher-yates-v1" as const, seed: 23, firstStartTime: "2026-09-20T08:00:00.000Z", intervalSeconds: 60 };
    const preview = await previewClassStartDrawAsAdmin(db, { ...f.auth, request: { formatVersion: 1, classId: f.fixed.id, parameters } }, now);
    if (preview.status !== "ok") throw new Error("Lottning kunde inte granskas");
    expect(await commitClassStartDrawAsAdmin(db, { ...f.auth, idempotencyKey: `class-start-draw:${randomUUID()}`,
      request: { formatVersion: 1, classId: f.fixed.id, parameters, expectedSnapshotVersion: preview.response.snapshotVersion, sourceHash: preview.response.sourceHash } }, now)).toMatchObject({ status: "changed" });
    const [header] = await db.select().from(schema.classStartDrawRequests).where(eq(schema.classStartDrawRequests.classId, f.fixed.id));
    const items = await db.select().from(schema.classStartDrawItems).where(eq(schema.classStartDrawItems.drawRequestId, header!.id));
    const released = items[0]!;
    await db.update(schema.entries).set({ fixedStartTime: null }).where(eq(schema.entries.id, released.entryId));
    const beforeRead = { requests: await db.select().from(schema.classStartDrawRequests).where(eq(schema.classStartDrawRequests.raceId, f.race.id)),
      snapshot: (await db.select({ version: schema.races.snapshotVersion }).from(schema.races).where(eq(schema.races.id, f.race.id)))[0] };
    const report = await listFixedStartSlotPlansAsAdministrator(db, f.auth, now);
    if (report.status !== "ok") throw new Error("Startplansrapport kunde inte läsas");
    expect(report.response.classes).toHaveLength(1);
    const plan = report.response.classes[0]!.plan;
    expect(plan.status).toBe("AVAILABLE");
    if (plan.status !== "AVAILABLE") throw new Error();
    expect(plan.slots.find(slot => slot.fixedStartTime === released.fixedStartTime.toISOString())).toEqual({ state: "VACANT", fixedStartTime: released.fixedStartTime.toISOString() });
    expect(plan.unassignedEntries).toHaveLength(1);
    expect(plan.unassignedEntries[0]?.id).toBe(released.entryId);
    expect(await db.select().from(schema.classStartDrawRequests).where(eq(schema.classStartDrawRequests.raceId, f.race.id))).toEqual(beforeRead.requests);
    expect((await db.select({ version: schema.races.snapshotVersion }).from(schema.races).where(eq(schema.races.id, f.race.id)))[0]).toEqual(beforeRead.snapshot);
    const other = items.find(item => item.entryId !== released.entryId)!;
    await db.update(schema.entries).set({ fixedStartTime: released.fixedStartTime }).where(and(eq(schema.entries.id, released.entryId), eq(schema.entries.raceId, f.race.id)));
    await db.update(schema.entries).set({ fixedStartTime: released.fixedStartTime }).where(and(eq(schema.entries.id, other.entryId), eq(schema.entries.raceId, f.race.id)));
    const ambiguous = await listFixedStartSlotPlansAsAdministrator(db, f.auth, now);
    expect(ambiguous).toMatchObject({ status: "ok", response: { classes: [{ plan: { status: "UNAVAILABLE", reason: "PLAN_CHANGED" } }] } });
  });
});
