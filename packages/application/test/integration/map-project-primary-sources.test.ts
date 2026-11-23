import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { newKey } from "@o-tid/map-revision";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { recordMapProjectDecision } from "../../src/map-project-decisions";
import { createMapProjectPrimarySource, listMapProjectPrimarySources, mapProjectOsmOrigin, removeMapProjectPrimarySource } from "../../src/map-project-primary-sources";
import { syncMapProject } from "../../src/map-project-sync";
import { registerTestAccount } from "./accounts";

/** PLAN K4c Huvudkälla (0143): markeringen sparas per projekt, och ursprunget för orörda objekt ur inlagda utkast läses. */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_huvudkalla_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-23T10:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_huvudkalla_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function setup() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Liljeholmen och Gröndal",
    fileName: "Liljeholmen.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const projectId = created.projectId;
  const people = { editor: await registerTestAccount(db, undefined, NOW), reader: await registerTestAccount(db, undefined, NOW),
    outsider: await registerTestAccount(db, undefined, NOW) };
  for (const [person, role] of [[people.editor, "EDIT"], [people.reader, "READ"]] as const) {
    expect((await inviteMapProjectMember(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID(), email: person.email,
      role } }, NOW)).status).toBe("invited");
    expect((await readMapProject(db, { ...person.proof, projectId }, NOW)).status).toBe("ok");
  }
  return { owner, ...people, projectId };
}

const AREA = [[[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }]]];

describe("huvudkällor (0143)", () => {
  it("sparas en gång per id, läses av medlemmarna, markeras och tas bort av den som får föreslå", async () => {
    const { editor, reader, outsider, projectId } = await setup();
    const request = (sourceId: string) => ({ formatVersion: 1, sourceId, name: "liljeholmen.dxf", area: AREA, kinds: ["buildings", "roads", "railway"] });
    const id = randomUUID();
    const created = await createMapProjectPrimarySource(db, { ...editor.proof, projectId, request: request(id) }, NOW);
    expect(created).toMatchObject({ status: "created", replayed: false, source: { sourceId: id, name: "liljeholmen.dxf", kinds: ["buildings", "roads", "railway"] } });
    expect((await createMapProjectPrimarySource(db, { ...editor.proof, projectId, request: request(id) }, NOW)).status).toBe("created");
    expect((await createMapProjectPrimarySource(db, { ...reader.proof, projectId, request: request(randomUUID()) }, NOW)).status).toBe("forbidden");
    expect((await createMapProjectPrimarySource(db, { ...outsider.proof, projectId, request: request(randomUUID()) }, NOW)).status).toBe("not-found");
    expect((await createMapProjectPrimarySource(db, { ...editor.proof, projectId, request: { ...request(randomUUID()), kinds: ["trees"] } }, NOW)).status).toBe("invalid-request");
    expect((await createMapProjectPrimarySource(db, { ...editor.proof, projectId, request: { ...request(randomUUID()), area: [[[{ x: 0, y: 0 }]]] } }, NOW)).status).toBe("invalid-request");
    const listed = await listMapProjectPrimarySources(db, { ...reader.proof, projectId }, NOW);
    expect(listed.status === "ok" && listed.sources).toEqual([{ sourceId: id, name: "liljeholmen.dxf", kinds: ["buildings", "roads", "railway"], area: AREA,
      createdAt: NOW.toISOString() }]);
    expect((await listMapProjectPrimarySources(db, { ...outsider.proof, projectId }, NOW)).status).toBe("not-found");
    expect((await removeMapProjectPrimarySource(db, { ...reader.proof, projectId, sourceId: id }, NOW)).status).toBe("forbidden");
    expect((await removeMapProjectPrimarySource(db, { ...editor.proof, projectId, sourceId: id }, NOW)).status).toBe("removed");
    const after = await listMapProjectPrimarySources(db, { ...reader.proof, projectId }, NOW);
    expect(after.status === "ok" && after.sources).toEqual([]);
  });

  it("ursprunget: bara orörda objekt ur utkast vars symbol bara kom från OpenStreetMap", async () => {
    const { editor, reader, projectId } = await setup();
    const object = (x: number) => ({ kind: "OBJECT", object: { kind: "point", symbol: "0", at: { x, y: 10 }, angle: 0 } });
    const keys = [newKey(randomUUID()), newKey(randomUUID()), newKey(randomUUID())];
    const adds = keys.map((key, index) => ({ editId: randomUUID(), key, ref: null, base: null, state: object(index * 10), kind: "ADD", at: NOW.toISOString() }));
    const synced = await syncMapProject(db, { ...editor.proof, projectId, request: { formatVersion: 1, clientId: "dator", since: 0, edits: adds } }, NOW);
    expect(synced.status).toBe("ok");
    // Det andra objektet flyttas efteråt (inte längre orört), det tredje tas bort.
    const later = [
      { editId: randomUUID(), key: keys[1], ref: null, base: adds[1]!.editId, state: object(55), kind: "MOVE", at: NOW.toISOString() },
      { editId: randomUUID(), key: keys[2], ref: null, base: adds[2]!.editId, state: { kind: "DELETED" }, kind: "DELETE", at: NOW.toISOString() }
    ];
    expect((await syncMapProject(db, { ...editor.proof, projectId, request: { formatVersion: 1, clientId: "dator", since: 0, edits: later } }, NOW)).status).toBe("ok");
    const decision = (layers: { layer: string; symbol: string | null; offered: number; accepted: boolean }[]) => ({ formatVersion: 1, decisionId: randomUUID(),
      source: "Grundkartan", geoJobId: null, settings: {}, mode: "ADD", layers, addedKeys: keys });
    expect((await recordMapProjectDecision(db, { ...editor.proof, projectId, request: decision([{ layer: "OSM byggnad", symbol: "521", offered: 3, accepted: true },
      { layer: "belagt", symbol: "501", offered: 1, accepted: true }, { layer: "OSM gångyta (highway=pedestrian)", symbol: "501", offered: 1, accepted: true }]) }, NOW)).status).toBe("recorded");
    // Ett utkast utan OpenStreetMap (Stockholms baskarta) ger inget ursprung.
    expect((await recordMapProjectDecision(db, { ...editor.proof, projectId, request: decision([{ layer: "ByggnadByggnadgyBOdefin", symbol: "521", offered: 3, accepted: true }]) }, NOW)).status).toBe("recorded");
    const origin = await mapProjectOsmOrigin(db, { ...reader.proof, projectId }, NOW);
    expect(origin.status === "ok" && origin.decisions).toEqual([{ codes: ["521"], keys: [keys[0]] }]);
  });
});
