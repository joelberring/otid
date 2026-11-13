import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import type { RaceMapSourceMetadata } from "@o-tid/contracts";
import { readMapFile, sha256Hex, type MapObject } from "@o-tid/map-file";
import { baseKey, newKey, objectRefFor, type ObjectState } from "@o-tid/map-revision";
import { readCourseSettingAsAdmin } from "../../src/course-setting";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject, updateMapProject } from "../../src/map-projects";
import { syncMapProject } from "../../src/map-project-sync";
import { createOrganizerEvent } from "../../src/organizer-events";
import { purgeRows } from "../../src/purge";
import { readRaceMapSourceFileAsAdmin, saveRaceMapSourceAsAdmin } from "../../src/race-map-source";
import { readMapProjectCurrentFile, readRaceMapProjectLink, saveMapProjectSnapshotToRace } from "../../src/race-map-project";
import { raceAuth, registerTestAccount } from "./accounts";

/**
 * Ägarens plan 2026-11-13, etapp 1: banläggningens karta ur ett kartprojekt. Ögonblicksbilden (grundfilen med införda
 * ändringar) blir tävlingens kartfil, kartan är låst vid projektets löpnummer tills någon tar in ändringarna, och bara den som
 * är med i projektet och administratör i tävlingen får koppla. Kartan är den syntetiska Mapper-fixturen.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_kartprojekt_bana_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-13T09:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const SHA = sha256Hex(mapBytes);
const parsed = readMapFile(mapBytes, "Skogen.omap", { sources: true });

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_kartprojekt_bana_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

const pointObject = parsed.objects.find(object => object.kind === "point") as Extract<MapObject, { kind: "point" }>;
const POINT_REF = objectRefFor(SHA, pointObject)!;
const moved = (dx: number): ObjectState => ({ kind: "OBJECT", object: { ...pointObject, at: { x: pointObject.at.x + dx, y: pointObject.at.y } } });
const added = (x: number): ObjectState => ({ kind: "OBJECT", object: { kind: "point", symbol: pointObject.symbol, at: { x, y: 10 }, angle: 0 } });
const edit = (key: string, state: ObjectState, kind: string) => ({ editId: randomUUID(), key, ref: key === baseKey(POINT_REF) ? POINT_REF : null,
  base: null, state, kind, at: NOW.toISOString() });

type Account = Awaited<ReturnType<typeof registerTestAccount>>;
type Proof = Account["proof"];

/** En minimal PNG (bara signatur och IHDR) med bildens storlek: kartans yta 0–120 × 0–100 mm med 8 px/mm och 2 mm kant. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
const image = png(992, 832);
const metadata: RaceMapSourceMetadata = { formatVersion: 1, format: "OMAP", version: "Mapper v9", scale: 10_000,
  bounds: { minX: 0, minY: 0, maxX: 120, maxY: 100 }, georeference: null, render: { pxPerMm: 8, originX: -2, originY: 102 },
  summary: { objectCount: 11, warnings: [], simplifications: [] }, tiePoints: null };

async function raceOf(account: Account): Promise<string> {
  const created = await createOrganizerEvent(db, { ...account.proof, idempotencyKey: `organizer-event-create:${randomUUID()}`,
    readBody: async () => ({ formatVersion: 1, eventName: "Kartprojekt", raceName: "Träning", raceDate: "2026-11-20",
      timeZone: "Europe/Stockholm", raceType: "TRAINING" }) }, NOW);
  if (created.status !== "created") throw new Error(`Tävlingen kunde inte skapas: ${JSON.stringify(created)}`);
  return created.response.raceId;
}

async function setup() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Älvsjöskogen",
    fileName: "Skogen.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  return { owner, projectId: created.projectId, raceId: await raceOf(owner) };
}

async function sync(proof: Proof, projectId: string, edits: unknown[]) {
  const result = await syncMapProject(db, { ...proof, projectId, request: { formatVersion: 1, clientId: "dator-1", since: 0, edits } }, NOW);
  if (result.status !== "ok") throw new Error(`Synken: ${result.status}`);
  return result.response;
}

async function current(proof: Proof, projectId: string) {
  const file = await readMapProjectCurrentFile(db, { ...proof, projectId }, NOW);
  if (file.status !== "ok") throw new Error(`Kartan: ${file.status}`);
  return file;
}

const link = async (proof: Proof, raceId: string) => {
  const result = await readRaceMapProjectLink(db, { ...proof, raceId }, NOW);
  if (result.status !== "ok") throw new Error(`Kopplingen: ${result.status}`);
  return result.response.link;
};
const raceFileSha = async (proof: Proof, raceId: string) => {
  const file = await readRaceMapSourceFileAsAdmin(db, { ...proof, raceId }, NOW);
  return file.status === "ok" ? file.sha256 : file.status;
};

describe("banläggningens karta ur ett kartprojekt", () => {
  it("kopplar, låser kartversionen och tar in kartans ändringar", async () => {
    const { owner, projectId, raceId } = await setup();
    expect(await link(owner.proof, raceId)).toBeNull();

    // Utan ändringar är projektets aktuella karta grundfilen orörd.
    const first = await current(owner.proof, projectId);
    expect(first).toMatchObject({ fileName: "Skogen.omap", format: "OMAP", seq: 0, sha256: SHA });
    expect(await saveMapProjectSnapshotToRace(db, { ...owner.proof, projectId, raceId, sha256: first.sha256, image, metadata }, NOW))
      .toEqual({ status: "ok", georeferenced: false, seq: 0 });
    expect(await raceFileSha(owner.proof, raceId)).toBe(SHA);
    expect(await link(owner.proof, raceId)).toMatchObject({ projectId, projectName: "Älvsjöskogen", seq: 0, newerChanges: 0, member: true,
      canUpdate: true, linkedAt: NOW.toISOString() });
    // Banläggningen läser kartan som vilken kartfil som helst.
    const state = await readCourseSettingAsAdmin(db, { ...owner.proof, raceId }, NOW);
    expect(state.status === "ok" && state.response.mapFile).toMatchObject({ sha256: SHA, fileName: "Skogen.omap", scale: 10_000 });

    // Kartan ritas om i projektet: banläggningens karta står kvar, kopplingen säger hur många ändringar som väntar.
    await sync(owner.proof, projectId, [edit(baseKey(POINT_REF), moved(4), "MOVE"), edit(newKey(randomUUID()), added(30), "ADD")]);
    expect(await raceFileSha(owner.proof, raceId)).toBe(SHA);
    expect(await link(owner.proof, raceId)).toMatchObject({ seq: 0, newerChanges: 2 });

    // Samma sparade läge ger samma fil; den har ändringarna.
    const second = await current(owner.proof, projectId);
    expect(second.seq).toBe(2);
    expect(second.sha256).not.toBe(SHA);
    expect((await current(owner.proof, projectId)).sha256).toBe(second.sha256);
    const redrawn = readMapFile(second.bytes, "Skogen.omap");
    expect(redrawn.objects.length).toBe(parsed.objects.length + 1);

    // En bild ritad ur en äldre karta sparas inte (någon hann ändra): webbläsaren hämtar på nytt.
    expect(await saveMapProjectSnapshotToRace(db, { ...owner.proof, projectId, raceId, sha256: first.sha256, image, metadata }, NOW))
      .toEqual({ status: "conflict" });
    expect(await raceFileSha(owner.proof, raceId)).toBe(SHA);

    // «Ta in kartans ändringar»: en ny ögonblicksbild ersätter kartfilen.
    const later = new Date(NOW.getTime() + 60_000);
    expect(await saveMapProjectSnapshotToRace(db, { ...owner.proof, projectId, raceId, sha256: second.sha256, image, metadata }, later))
      .toEqual({ status: "ok", georeferenced: false, seq: 2 });
    expect(await raceFileSha(owner.proof, raceId)).toBe(second.sha256);
    expect(await link(owner.proof, raceId)).toMatchObject({ seq: 2, newerChanges: 0, linkedAt: later.toISOString() });
    const audit = await pool.query<{ after: { seq: number } }>(`select after from audit_event where race_id = $1 and action = 'RACE_MAP_PROJECT_LINKED'
      order by after->>'seq'`, [raceId]);
    expect(audit.rows.map(row => row.after.seq)).toEqual([0, 2]);

    // En ändrad färg räknas som en ändring som väntar.
    const cmyk = { c: 0.1, m: 0.9, y: 0.2, k: 0.05 };
    const recolored = await updateMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, colors: [{ id: parsed.colors[0]!.id, cmyk }] } },
      new Date(later.getTime() + 60_000));
    expect(recolored.status).toBe("ok");
    expect(await link(owner.proof, raceId)).toMatchObject({ seq: 2, newerChanges: 1 });
    const third = await current(owner.proof, projectId);
    expect(third.sha256).not.toBe(second.sha256);
    expect((await saveMapProjectSnapshotToRace(db, { ...owner.proof, projectId, raceId, sha256: third.sha256, image, metadata }, later)).status).toBe("ok");
    expect(await link(owner.proof, raceId)).toMatchObject({ seq: 2, newerChanges: 0 });

    // En vanlig uppladdad kartfil ersätter kartan: kopplingen gäller inte längre.
    expect((await saveRaceMapSourceAsAdmin(db, { ...owner.proof, raceId, file: mapBytes, fileName: "egen.omap", image, metadata }, later)).status).toBe("ok");
    expect(await link(owner.proof, raceId)).toBeNull();
  });

  it("behörighet: med i projektet och administratör i tävlingen; utloggad och fel roll får inget", async () => {
    const { owner, projectId, raceId } = await setup();
    const outsider = await registerTestAccount(db, undefined, NOW);
    const outsiderRace = await raceOf(outsider);
    const reader = await registerTestAccount(db, undefined, NOW);
    expect((await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email,
      role: "READ" } }, NOW)).status).toBe("invited");
    expect((await readMapProject(db, { ...reader.proof, projectId }, NOW)).status).toBe("ok");
    const readerRace = await raceOf(reader);
    const loggedOut = { sessionToken: null, csrfCookie: null, csrfHeader: null };
    const save = (proof: { sessionToken: string | null; csrfCookie?: string | null; csrfHeader?: string | null }, race: string, body: unknown = metadata) =>
      saveMapProjectSnapshotToRace(db, { ...proof, projectId, raceId: race, sha256: SHA, image, metadata: body }, NOW);

    // Utloggad: 401 före allt annat, också med en trasig kropp.
    expect(await readMapProjectCurrentFile(db, { ...loggedOut, projectId }, NOW)).toEqual({ status: "unauthorized" });
    expect(await save(loggedOut, raceId)).toEqual({ status: "unauthorized" });
    expect(await save(loggedOut, raceId, { fel: true })).toEqual({ status: "unauthorized" });
    expect(await readRaceMapProjectLink(db, { ...loggedOut, raceId }, NOW)).toEqual({ status: "unauthorized" });

    // Inte med i projektet: projektet röjs inte, inte ens för den som är administratör i sin egen tävling.
    expect(await readMapProjectCurrentFile(db, { ...outsider.proof, projectId }, NOW)).toEqual({ status: "not-found" });
    expect(await save(outsider.proof, outsiderRace)).toEqual({ status: "not-found" });
    expect(await save(outsider.proof, outsiderRace, { fel: true })).toEqual({ status: "not-found" });
    // Administratör i tävlingen men inte med i projektet.
    const raceAdmin = await raceAuth(db, raceId, "ADMIN", NOW);
    expect(await save(raceAdmin, raceId)).toEqual({ status: "not-found" });

    // Läsa i projektet räcker för att hämta kartan och koppla den till en egen tävling, men inte till någon annans.
    expect((await readMapProjectCurrentFile(db, { ...reader.proof, projectId }, NOW)).status).toBe("ok");
    expect(["forbidden", "unauthorized"]).toContain((await save(reader.proof, raceId)).status);
    expect(await raceFileSha(owner.proof, raceId)).toBe("not-found");
    expect(await save(reader.proof, readerRace)).toMatchObject({ status: "ok", seq: 0 });
    // Fel CSRF sparar inget.
    expect(["forbidden", "unauthorized"]).toContain((await save({ ...owner.proof, csrfHeader: "fel" }, raceId)).status);
    // En funktionär i tävlingen får varken koppla eller läsa kopplingen (banläggningen är inte funktionärens).
    const functionary = await raceAuth(db, readerRace, "FUNCTIONARY", NOW);
    expect(await readRaceMapProjectLink(db, { ...functionary, raceId: readerRace }, NOW)).toEqual({ status: "forbidden" });

    // Den som läser banläggningen men inte är med i projektet ser kopplingen utan att kunna öppna projektet eller ta in ändringar.
    const coAdmin = await raceAuth(db, readerRace, "ADMIN", NOW);
    expect(await link(coAdmin, readerRace)).toMatchObject({ projectId, projectName: "Älvsjöskogen", member: false, canUpdate: false });
    expect(await link(reader.proof, readerRace)).toMatchObject({ member: true, canUpdate: true });
  });

  it("projektet tas bort: kopplingen försvinner och tävlingen behåller sin karta", async () => {
    const { owner, projectId, raceId } = await setup();
    await sync(owner.proof, projectId, [edit(baseKey(POINT_REF), moved(2), "MOVE")]);
    const file = await current(owner.proof, projectId);
    expect((await saveMapProjectSnapshotToRace(db, { ...owner.proof, projectId, raceId, sha256: file.sha256, image, metadata }, NOW)).status).toBe("ok");
    await db.transaction(tx => purgeRows(tx, "map_project", [projectId]));
    expect((await pool.query("select 1 from race_map_project_link where race_id = $1", [raceId])).rowCount).toBe(0);
    expect(await link(owner.proof, raceId)).toBeNull();
    expect(await raceFileSha(owner.proof, raceId)).toBe(file.sha256);
  });
});
