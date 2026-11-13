import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { baseKey, objectRefFor, type ObjectState } from "@o-tid/map-revision";
import { readCourseSettingAsAdmin } from "../../src/course-setting";
import { mapStorageUsage, readMapContent, storeMapContent } from "../../src/map-content";
import { deleteMapProject } from "../../src/map-project-delete";
import { createMapProjectFromUpload, inviteMapProjectMember, listMapProjects, readMapProject, updateMapProject } from "../../src/map-projects";
import { syncMapProject } from "../../src/map-project-sync";
import { createOrganizerEvent } from "../../src/organizer-events";
import { readMapProjectCurrentFile, readRaceMapProjectLink, saveMapProjectSnapshotToRace } from "../../src/race-map-project";
import { readRaceMapSourceFileAsAdmin } from "../../src/race-map-source";
import { registerTestAccount } from "./accounts";

/**
 * Ägaren 2026-11-13: radera ett kartprojekt. Ägaren raderar allt som hör till projektet i en transaktion och filerna frigörs;
 * banläggningen behåller sin kartfil men tappar kopplingen; en medlem som inte är ägare nekas; ett projekt med pågående
 * körning raderas inte (`busy`); listan har status och sorteras på senast använt.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_kartprojekt_radera_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-13T09:00:00Z");
const fixture = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const parsed = readMapFile(fixture, "Skogen.omap", { sources: true });

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_kartprojekt_radera_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** Kartfilen med ett unikt antal tomma rader sist, så att varje projekt får ett eget innehåll (och en egen sha256). */
const uniqueMap = (extra: number) => { const bytes = new Uint8Array(fixture.length + extra); bytes.set(fixture); bytes.fill(10, fixture.length); return bytes; };
let counter = 0;

const pointObject = parsed.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
const moved = (dx: number): ObjectState => ({ kind: "OBJECT", object: { ...pointObject, at: { x: pointObject.at.x + dx, y: pointObject.at.y } } });

type Account = Awaited<ReturnType<typeof registerTestAccount>>;

async function project(owner: Account, name = "Prov") {
  counter += 1;
  const bytes = uniqueMap(counter);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name, fileName: "Skogen.omap" },
    file: bytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { projectId: created.projectId, sha: sha256Hex(bytes) };
}

/** En klar laserkörning (eller annan status) med en resultatfil som bara den har. */
async function geoJob(projectId: string, accountId: string, status: "DONE" | "QUEUED" | "RUNNING" | "CANCELLED") {
  const jobId = randomUUID();
  await db.insert(schema.mapProjectGeoJobs).values({ id: jobId, projectId, accountId, kind: "PULLAUTIN", status, request: {}, createdAt: NOW, requestId: randomUUID() });
  const content = new TextEncoder().encode(`resultat ${randomUUID()}`);
  const sha = sha256Hex(content);
  await db.transaction(async tx => {
    const stored = await storeMapContent(tx, content, accountId, NOW);
    if (stored.status !== "stored") throw new Error("kvot");
    await tx.insert(schema.mapProjectGeoOutputs).values({ jobId, name: "karta.png", contentSha256: sha, mediaType: "image/png", byteSize: content.length, createdAt: NOW });
  });
  return { jobId, sha };
}

async function raceOf(account: Account): Promise<string> {
  const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Kartprojekt", raceName: "Träning", raceDate: "2026-11-20",
      timeZone: "Europe/Stockholm", raceType: "TRAINING" }) }, NOW);
  if (created.status !== "created") throw new Error(`Tävlingen kunde inte skapas: ${JSON.stringify(created)}`);
  return created.response.raceId;
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
const metadata: RaceMapSourceMetadata = { formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null, render: { pxPerMm: 8, originX: -2, originY: 102 },
  summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null };

const exists = async (projectId: string) => (await db.select({ id: schema.mapProjects.id }).from(schema.mapProjects).where(eq(schema.mapProjects.id, projectId))).length === 1;

describe("radera ett kartprojekt", () => {
  it("ägaren raderar allt som hör till projektet, filerna frigörs och banläggningen behåller sin karta", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const { projectId, sha } = await project(owner, "Provkarta");
    const raceId = await raceOf(owner);
    const ref = objectRefFor(sha256Hex(uniqueMap(counter)), pointObject)!;
    const synced = await syncMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, clientId: "dator-1", since: 0, edits: [
      { editId: randomUUID(), key: baseKey(ref), ref, base: null, state: moved(2), kind: "MOVE", at: NOW.toISOString() }] } }, NOW);
    expect(synced.status).toBe("ok");
    const job = await geoJob(projectId, owner.accountId, "DONE");
    // Banläggningen tar sin karta ur projektet.
    const file = await readMapProjectCurrentFile(db, { ...owner.proof, projectId }, NOW);
    if (file.status !== "ok") throw new Error(file.status);
    expect((await saveMapProjectSnapshotToRace(db, { ...owner.proof, projectId, raceId, sha256: file.sha256, image: png(992, 832), metadata }, NOW)).status).toBe("ok");
    const raceSha = (await readRaceMapSourceFileAsAdmin(db, { ...owner.proof, raceId }, NOW));
    if (raceSha.status !== "ok") throw new Error(raceSha.status);
    const before = (await db.transaction(tx => mapStorageUsage(tx, null))).totalBytes;
    expect(await readMapContent(db, sha)).toBeDefined();
    expect(await readMapContent(db, job.sha)).toBeDefined();

    expect(await deleteMapProject(db, { ...owner.proof, projectId }, NOW)).toMatchObject({ status: "deleted", name: "Provkarta" });

    expect(await exists(projectId)).toBe(false);
    for (const table of [schema.mapProjectMembers, schema.mapProjectEdits, schema.mapProjectObjects, schema.mapProjectGeoJobs]) {
      expect(await db.select().from(table).where(eq(table.projectId, projectId))).toEqual([]);
    }
    expect(await db.select().from(schema.mapProjectGeoOutputs).where(eq(schema.mapProjectGeoOutputs.jobId, job.jobId))).toEqual([]);
    // Filerna är borta direkt (inte först vid underhållet) och lagringen har minskat.
    expect(await readMapContent(db, job.sha)).toBeUndefined();
    expect(await readMapContent(db, sha)).toBeUndefined();
    expect((await db.transaction(tx => mapStorageUsage(tx, null))).totalBytes).toBeLessThan(before);
    // Banläggningen: kopplingen är borta, kartfilen kvar och banläggningen går att öppna.
    expect((await db.select().from(schema.raceMapProjectLinks).where(eq(schema.raceMapProjectLinks.raceId, raceId)))).toEqual([]);
    const link = await readRaceMapProjectLink(db, { ...owner.proof, raceId }, NOW);
    expect(link.status === "ok" && link.response.link).toBeNull();
    const after = await readRaceMapSourceFileAsAdmin(db, { ...owner.proof, raceId }, NOW);
    expect(after.status === "ok" && after.sha256).toBe(file.sha256);
    expect(await readMapContent(db, file.sha256)).toBeDefined();
    expect((await readCourseSettingAsAdmin(db, { ...owner.proof, raceId }, NOW)).status).toBe("ok");
    // Raderat är raderat: projektet finns inte längre för ägaren.
    expect((await readMapProject(db, { ...owner.proof, projectId }, NOW)).status).toBe("not-found");
    expect((await deleteMapProject(db, { ...owner.proof, projectId }, NOW)).status).toBe("not-found");
  });

  it("en medlem som inte är ägare nekas, och den som inte är med får inte veta att projektet finns", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const editor = await registerTestAccount(db, undefined, NOW);
    const outsider = await registerTestAccount(db, undefined, NOW);
    const { projectId } = await project(owner);
    expect((await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: editor.email, role: "EDIT" } }, NOW)).status).toBe("invited");
    expect((await readMapProject(db, { ...editor.proof, projectId }, NOW)).status).toBe("ok");
    expect((await deleteMapProject(db, { ...editor.proof, projectId }, NOW)).status).toBe("forbidden");
    expect((await deleteMapProject(db, { ...outsider.proof, projectId }, NOW)).status).toBe("not-found");
    expect(await exists(projectId)).toBe(true);
    expect((await deleteMapProject(db, { ...owner.proof, projectId }, NOW)).status).toBe("deleted");
  });

  it("ett projekt med pågående körning raderas inte förrän körningen är avbruten", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const { projectId } = await project(owner);
    const running = await geoJob(projectId, owner.accountId, "RUNNING");
    expect(await deleteMapProject(db, { ...owner.proof, projectId }, NOW)).toEqual({ status: "busy", runs: 1 });
    expect(await exists(projectId)).toBe(true);
    expect(await readMapContent(db, running.sha)).toBeDefined();
    await db.update(schema.mapProjectGeoJobs).set({ status: "CANCELLED", finishedAt: NOW }).where(eq(schema.mapProjectGeoJobs.id, running.jobId));
    expect((await deleteMapProject(db, { ...owner.proof, projectId }, NOW)).status).toBe("deleted");
    expect(await readMapContent(db, running.sha)).toBeUndefined();
  });

  it("listan har status och sorteras på senast använt; avslutade syns men filtreras av sidan", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const older = await project(owner, "Äldre");
    const closed = await project(owner, "Avslutat");
    const newer = await project(owner, "Nyare");
    const later = (hours: number) => new Date(NOW.getTime() + hours * 3600_000);
    await db.update(schema.mapProjects).set({ lastOpenedAt: later(1) }).where(eq(schema.mapProjects.id, older.projectId));
    await db.update(schema.mapProjects).set({ lastOpenedAt: later(5) }).where(eq(schema.mapProjects.id, newer.projectId));
    expect((await updateMapProject(db, { ...owner.proof, projectId: closed.projectId, request: { formatVersion: 1, status: "CLOSED" } }, later(3))).status).toBe("ok");
    const list = await listMapProjects(db, owner.proof, later(6));
    if (list.status !== "ok") throw new Error(list.status);
    expect(list.list.projects.map(row => [row.name, row.status])).toEqual([["Nyare", "OPEN"], ["Avslutat", "CLOSED"], ["Äldre", "OPEN"]]);
    expect(list.list.projects.every(row => typeof row.lastActiveAt === "string")).toBe(true);
    // Ett avslutat projekt går att radera.
    expect((await deleteMapProject(db, { ...owner.proof, projectId: closed.projectId }, NOW)).status).toBe("deleted");
  });
});
