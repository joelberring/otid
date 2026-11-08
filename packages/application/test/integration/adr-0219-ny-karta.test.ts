import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { readMapFile, wgs84ToMapPoint } from "@o-tid/map-file";
import { newKey } from "@o-tid/map-revision";
import { readMapContent } from "../../src/map-content";
import { createMapProjectNew } from "../../src/map-project-new";
import { readMapProject, readMapProjectSource } from "../../src/map-projects";
import { readMapProjectOutput, writeMapProjectVersion } from "../../src/map-project-output";
import { syncMapProject } from "../../src/map-project-sync";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 (K1, nya kartor): ett projekt med en ny tom karta. Området (WGS 84 eller SWEREF 99 TM) blir kartans mm, kartan
 * får O-Tids symbolset och georeferens i områdets mitt, och den fungerar som vilken grundfil som helst: synk och ny version.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_nykarta_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-08T07:00:00Z");

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_nykarta_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** Ungefär Kungshatt: en fyrhörning runt ön (longitud, latitud). */
const ISLAND: [number, number][] = [[17.775, 59.302], [17.805, 59.302], [17.805, 59.313], [17.775, 59.313]];

describe("ADR-0219 K1: ny karta", () => {
  it("skapar projektet med området i kartans mm, en tom karta med symbolsetet och georeferensen, och tar emot ritning", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const other = await registerTestAccount(db, undefined, NOW);
    const request = { formatVersion: 1, requestId: randomUUID(), name: "Kungshatt", symbolSet: "ISOM2017-2", scale: 10000, declination: 6.5,
      area: { crs: "WGS84", rings: [ISLAND] } };
    const created = await createMapProjectNew(db, { ...owner.proof, request }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    expect(await createMapProjectNew(db, { ...owner.proof, request }, NOW)).toMatchObject({ status: "created", replayed: true, projectId: created.projectId });
    expect((await createMapProjectNew(db, { ...other.proof, request }, NOW)).status).toBe("conflict");
    const projectId = created.projectId;

    const view = await readMapProject(db, { ...owner.proof, projectId }, NOW);
    if (view.status !== "ok") throw new Error(view.status);
    expect(view.view).toMatchObject({ club: null, role: "OWNER", base: { source: "NEW", format: "OMAP", fileName: "Kungshatt.omap", mapName: "Kungshatt" } });
    const source = await readMapProjectSource(db, { ...owner.proof, projectId }, NOW);
    if (source.status !== "ok") throw new Error(source.status);
    const map = readMapFile(new Uint8Array((await readMapContent(db, source.sha256))!), "Kungshatt.omap", { sources: true });
    expect(map.scale).toBe(10000);
    expect(map.objects).toEqual([]);
    expect(map.georeference?.crs).toEqual({ kind: "EPSG", code: 3006 });
    // Området: hörnen i kartans mm stämmer med georeferensen, och mitten ligger nära 0,0.
    const area = view.view.area!;
    expect(area).toHaveLength(1);
    const corner = wgs84ToMapPoint(map.georeference!, { latitude: ISLAND[0]![1], longitude: ISLAND[0]![0] });
    expect(area[0]![0]!.x).toBeCloseTo(corner.x, 1);
    expect(area[0]![0]!.y).toBeCloseTo(corner.y, 1);
    const xs = area[0]!.map(point => point.x), ys = area[0]!.map(point => point.y);
    expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2)).toBeLessThan(5);
    expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2)).toBeLessThan(5);
    // 1,7 km × 1,2 km vid 1:10 000 ≈ 170 × 120 mm.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(190);

    // Rita en sten och skriv en ny version.
    const stone = [...map.symbols.values()].find(symbol => symbol.code.main === 204)!;
    const synced = await syncMapProject(db, { ...owner.proof, projectId, request: { formatVersion: 1, clientId: "dator", since: 0, edits: [{
      editId: randomUUID(), key: newKey(randomUUID()), ref: null, base: null, kind: "ADD", at: NOW.toISOString(),
      state: { kind: "OBJECT", object: { kind: "point", symbol: stone.id, at: { x: 1, y: 2 }, angle: 0 } } }] } }, NOW);
    expect(synced.status === "ok" && synced.response.results.map(row => (row as { status: string }).status)).toEqual(["APPLIED"]);
    const written = await writeMapProjectVersion(db, { ...owner.proof, projectId, request: { formatVersion: 1, requestId: randomUUID() } }, NOW);
    if (written.status !== "ok" || written.response.status !== "created") throw new Error("ingen version");
    const output = await readMapProjectOutput(db, { ...owner.proof, projectId, outputId: written.response.outputId }, NOW);
    if (output.status !== "ok") throw new Error(output.status);
    const reread = readMapFile(new Uint8Array((await readMapContent(db, output.sha256))!), output.fileName);
    expect(reread.objects).toMatchObject([{ kind: "point", at: { x: 1, y: 2 } }]);
  });

  it("SWEREF 99 TM, sprint 1:4 000; vägrar fel skala, för stort område, punkter utanför Sverige och en trasig polygon", async () => {
    const owner = await registerTestAccount(db, undefined, NOW);
    const square = (e: number, n: number, side: number): [number, number][] => [[e, n], [e + side, n], [e + side, n + side], [e, n + side]];
    const request = (overrides: Record<string, unknown>) => ({ formatVersion: 1, requestId: randomUUID(), name: "Solberga", symbolSet: "ISSPROM2019-2",
      scale: 4000, area: { crs: "SWEREF99TM", rings: [square(671000, 6573000, 800)] }, ...overrides });
    const created = await createMapProjectNew(db, { ...owner.proof, request: request({}) }, NOW);
    if (created.status !== "created") throw new Error(created.status);
    const view = await readMapProject(db, { ...owner.proof, projectId: created.projectId }, NOW);
    // 800 m vid 1:4 000 = 200 mm per sida (kartan är vriden mot nord, så sidan mäts längs kanten).
    const ring = view.status === "ok" ? view.view.area![0]! : [];
    expect(Math.hypot(ring[1]!.x - ring[0]!.x, ring[1]!.y - ring[0]!.y)).toBeCloseTo(200, 1);

    expect((await createMapProjectNew(db, { ...owner.proof, request: request({ scale: 10000 }) }, NOW)).status).toBe("invalid-request");
    expect((await createMapProjectNew(db, { ...owner.proof, request: request({ area: { crs: "SWEREF99TM", rings: [square(671000, 6573000, 16000)] } }) },
      NOW)).status).toBe("area-too-large");
    expect((await createMapProjectNew(db, { ...owner.proof, request: request({ area: { crs: "WGS84", rings: [[[2.3, 48.8], [2.31, 48.8], [2.31, 48.81]]] } }) },
      NOW)).status).toBe("invalid-request");
    expect((await createMapProjectNew(db, { ...owner.proof, request: request({ area: { crs: "SWEREF99TM", rings: [[[671000, 6573000], [671000, 6573000],
      [671000, 6573000]]] } }) }, NOW)).status).toBe("invalid-request");
  });
});
