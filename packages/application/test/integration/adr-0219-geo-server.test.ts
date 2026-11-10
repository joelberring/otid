import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { createMapProjectFromUpload } from "../../src/map-projects";
import { lantmaterietRuntimeFromEnvironment } from "../../src/map-project-lantmateriet";
import { laserRuntimeFromEnvironment } from "../../src/map-project-laser";
import { authenticateGeoWorker, claimGeoJob, createGeoJob, finishGeoJob, geoServerView } from "../../src/map-project-geo-jobs";
import { geoCloudInit, geoServerMonthCost, geoServerSettings, manageGeoServer, retireGeoServer, type Hetzner, type HetznerType } from "../../src/geo-server";
import type { ServerMessage } from "../../src/server-status";
import { saveMapSourceCredential } from "../../src/map-source-credentials";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 K5b (migration 0104): geo-servern startas hos Hetzner när ett geo-jobb väntar (typerna och platserna i tur och
 * ordning), hörs av med sin egen nyckel, raderas efter tomgång, när den inte startar och när den gått för länge. Ägaren mejlas
 * vid reservtyp, när ingen typ går att skapa och när budgeten är slut, högst en gång per dygn. Hetzner är falsk.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219s_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-09T08:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const environment = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64"), OTID_HETZNER_TOKEN: "hetzner-nyckel", O_TID_PUBLIC_ORIGIN: "https://otid.example.se",
  OTID_GEO_SERVER_TYPES: "cx23, cax11", OTID_GEO_SERVER_LOCATIONS: "fsn1,hel1", OTID_GEO_IDLE_MINUTES: "20", OTID_GEO_BUDGET_EUR_PER_MONTH: "10", OTID_TAG: "abc1234" };
const runtime = laserRuntimeFromEnvironment(lantmaterietRuntimeFromEnvironment(environment));
const LAZ = "https://dl1.lantmateriet.se/hojd/laser/skog/ruta.laz";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219s_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

function fakeHetzner(available: (type: string, location: string) => boolean) {
  const created: { id: number; name: string; type: string; location: string; userData: string; labels: Record<string, string> }[] = [];
  const removed: number[] = [];
  const extra: { id: number; name: string; created: string }[] = [];
  let next = 100;
  const types: HetznerType[] = [
    { name: "cx23", memoryGb: 4, architecture: "x86", deprecated: false, hourly: new Map([["fsn1", 0.0088], ["hel1", 0.0088]]) },
    { name: "cax11", memoryGb: 4, architecture: "arm", deprecated: false, hourly: new Map([["fsn1", 0.0096], ["hel1", 0.0096]]) },
    { name: "cpx22", memoryGb: 4, architecture: "x86", deprecated: false, hourly: new Map([["fsn1", 0.02]]) }
  ];
  const hetzner: Hetzner = {
    create: async input => {
      if (!available(input.type, input.location)) return { ok: false, code: "resource_unavailable", message: "slut" };
      next += 1;
      created.push({ id: next, ...input });
      return { ok: true, id: next };
    },
    remove: async id => { removed.push(id); return true; },
    list: async () => [...created.filter(row => !removed.includes(row.id)).map(row => ({ id: row.id, name: row.name, created: NOW.toISOString() })),
      ...extra.filter(row => !removed.includes(row.id))],
    types: async () => types
  };
  return { hetzner, created, removed, extra };
}

async function waitingJob() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const project = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Geo",
    fileName: "Geo.omap" }, file: mapBytes }, NOW);
  if (project.status !== "created") throw new Error(project.status);
  await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "a", secret: "b" } }, environment, NOW);
  const job = await createGeoJob(db, { ...owner.proof, projectId: project.projectId, request: { formatVersion: 1, requestId: randomUUID(), kind: "PULLAUTIN",
    name: "Natt", tiles: [{ id: "r", href: LAZ, bbox: null, epsg: 3006 }], settings: {} } }, runtime, NOW);
  if (job.status !== "created") throw new Error(job.status);
  return job.job.jobId;
}
const clear = async () => {
  await db.delete(schema.mapProjectGeoJobs);
  await db.delete(schema.geoServers);
  await db.delete(schema.geoServerStates);
};

describe("ADR-0219 K5b: geo-servern hos Hetzner", () => {
  const settings = geoServerSettings(environment)!;

  it("inställningarna och uppstarten", () => {
    expect(settings).toMatchObject({ types: ["cx23", "cax11"], locations: ["fsn1", "hel1"], idleMinutes: 20, budgetEur: 10, label: "otid.example.se",
      image: "ghcr.io/joelberring/otid-geo:abc1234", origin: "https://otid.example.se" });
    expect(geoServerSettings({ O_TID_PUBLIC_ORIGIN: "https://x.se" })).toBeUndefined();
    expect(geoServerSettings({ OTID_HETZNER_TOKEN: "x", O_TID_PUBLIC_ORIGIN: "https://x.se", OTID_GEO_SERVER_TYPES: " ;rm -rf" })?.types).toEqual(["cx23", "cax11"]);
    const init = geoCloudInit({ image: "ghcr.io/joelberring/otid-geo:main", origin: "https://otid.example.se", token: "t'x", name: "otid-geo-1" });
    expect(init.startsWith("#cloud-config\n")).toBe(true);
    expect(init).toContain("-e OTID_GEO_WORKER_TOKEN='t'\\''x'");
    expect(init).toContain("'ghcr.io/joelberring/otid-geo:main'");
  });

  it("startar med reservtypen, hörs av, raderas efter tomgång; mejl en gång per dygn", async () => {
    await clear();
    const { hetzner, created, removed } = fakeHetzner(type => type === "cax11");
    const mails: ServerMessage[] = [];
    const mail = async (message: ServerMessage) => { mails.push(message); };
    expect(await manageGeoServer(db, hetzner, settings, mail, NOW)).toEqual({ action: "none", detail: null });
    expect(await geoServerView(db, environment, NOW)).toEqual({ state: "OFF", detail: null });

    const jobId = await waitingJob();
    expect(await manageGeoServer(db, hetzner, settings, mail, at(1))).toEqual({ action: "created", detail: "cax11 i fsn1" });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: "cax11", location: "fsn1", labels: { "otid-geo": "otid.example.se" } });
    expect(mails.map(message => message.subject)).toEqual(["O-Tid: geo-servern startade med en reservtyp"]);
    expect(mails[0]!.text).toContain("cx23 i fsn1: resource_unavailable");
    expect(await geoServerView(db, environment, at(1))).toEqual({ state: "STARTING", detail: null });

    // Servern hörs av med nyckeln ur uppstarten och tar jobbet.
    const token = /OTID_GEO_WORKER_TOKEN='([0-9a-f]{64})'/.exec(created[0]!.userData)![1]!;
    const name = await authenticateGeoWorker(db, `Bearer ${token}`, "vad-som-helst", {}, at(4));
    expect(name).toBe(created[0]!.name);
    expect(await authenticateGeoWorker(db, `Bearer ${"f".repeat(64)}`, null, {}, at(4))).toBeUndefined();
    expect((await claimGeoJob(db, name!, at(4)))?.jobId).toBe(jobId);
    expect(await manageGeoServer(db, hetzner, settings, mail, at(5))).toEqual({ action: "none", detail: null });
    expect(await geoServerView(db, environment, at(5))).toEqual({ state: "READY", detail: null });
    await finishGeoJob(db, jobId, name!, { status: "FAILED", error: "prov" }, at(10));
    // Under tomgångens 20 minuter står den kvar (arbetaren frågar efter jobb hela tiden); sedan raderas den.
    for (const minute of [14, 24, 30]) await authenticateGeoWorker(db, `Bearer ${token}`, null, {}, at(minute));
    expect((await manageGeoServer(db, hetzner, settings, mail, at(25))).action).toBe("none");
    expect(await manageGeoServer(db, hetzner, settings, mail, at(31))).toEqual({ action: "deleted", detail: `${name!} utan jobb i 20 minuter` });
    expect(removed).toEqual([created[0]!.id]);
    expect(await geoServerView(db, environment, at(31))).toEqual({ state: "OFF", detail: null });
    // Nyckeln gäller inte längre.
    expect(await authenticateGeoWorker(db, `Bearer ${token}`, null, {}, at(32))).toBeUndefined();
    // En påbörjad timme med cax11.
    expect(await geoServerMonthCost(db, at(32))).toBeCloseTo(0.0096);

    // Ett nytt jobb samma dygn: reservtypen igen men inget nytt mejl.
    await waitingJob();
    expect((await manageGeoServer(db, hetzner, settings, mail, at(40))).action).toBe("created");
    expect(mails).toHaveLength(1);

    // Ägaren 2026-11-11: en server med en äldre geo-arbetare (avbildningen byggdes om medan den gick) raderas i nästa omgång,
    // och en ny startas för jobbet som väntar.
    const second = created[1]!;
    const secondName = await authenticateGeoWorker(db, `Bearer ${/OTID_GEO_WORKER_TOKEN='([0-9a-f]{64})'/.exec(second.userData)![1]!}`, null, {}, at(43));
    await retireGeoServer(db, secondName!, at(43));
    await retireGeoServer(db, secondName!, at(43));
    // Samma omgång raderar den gamla och startar en ny för jobbet som väntar.
    expect((await manageGeoServer(db, hetzner, settings, mail, at(44))).action).toBe("created");
    expect(removed).toContain(second.id);
    expect(created).toHaveLength(3);
    await retireGeoServer(db, "finns-inte", at(46));
  });

  it("ingen typ går att skapa: jobben väntar, ägaren får ett mejl per dygn med andra typer", async () => {
    await clear();
    const { hetzner, created } = fakeHetzner(() => false);
    const mails: ServerMessage[] = [];
    await waitingJob();
    expect((await manageGeoServer(db, hetzner, settings, async message => { mails.push(message); }, NOW)).action).toBe("unavailable");
    expect(created).toEqual([]);
    expect(await geoServerView(db, environment, NOW)).toEqual({ state: "UNAVAILABLE", detail: null });
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe("O-Tid: ingen geo-server går att skapa");
    expect(mails[0]!.text).toContain("cpx22 (från 0.0200 €/h)");
    expect(mails[0]!.text).toContain("cx23 i fsn1: resource_unavailable; cx23 i hel1: resource_unavailable; cax11 i fsn1");
    await manageGeoServer(db, hetzner, settings, async message => { mails.push(message); }, at(60));
    expect(mails).toHaveLength(1);
    await manageGeoServer(db, hetzner, settings, async message => { mails.push(message); }, at(24 * 60 + 1));
    expect(mails).toHaveLength(2);
  });

  it("budgeten, en server som inte startar, en som gått för länge och en okänd med O-Tids etikett", async () => {
    await clear();
    const { hetzner, created, removed, extra } = fakeHetzner(() => true);
    const mails: ServerMessage[] = [];
    const mail = async (message: ServerMessage) => { mails.push(message); };
    await waitingJob();
    // Budget 0,005 €: inte ens en timme ryms.
    expect((await manageGeoServer(db, hetzner, { ...settings, budgetEur: 0.005 }, mail, NOW)).action).toBe("budget");
    expect(await geoServerView(db, environment, NOW)).toEqual({ state: "BUDGET", detail: null });
    expect(mails.map(message => message.subject)).toEqual(["O-Tid: geo-serverns budget är slut"]);

    // Startar men hör aldrig av sig: raderas efter 15 minuter, och en ny startas.
    expect((await manageGeoServer(db, hetzner, settings, mail, NOW)).action).toBe("created");
    expect((await manageGeoServer(db, hetzner, settings, mail, at(16))).action).toBe("created");
    expect(removed).toEqual([created[0]!.id]);
    expect(mails.map(message => message.subject)).toContain("O-Tid: geo-servern startade inte");
    // Högst tre starter i timmen.
    await manageGeoServer(db, hetzner, settings, mail, at(32));
    expect(created).toHaveLength(3);
    expect((await manageGeoServer(db, hetzner, settings, mail, at(48))).action).toBe("unavailable");
    expect(created).toHaveLength(3);

    // Hörs av men går längre än maxtiden: raderas.
    await db.delete(schema.geoServers);
    removed.length = 0;
    const started = await manageGeoServer(db, hetzner, settings, mail, at(120));
    expect(started.action).toBe("created");
    const token = /OTID_GEO_WORKER_TOKEN='([0-9a-f]{64})'/.exec(created.at(-1)!.userData)![1]!;
    await authenticateGeoWorker(db, `Bearer ${token}`, null, {}, at(122));
    const long = created.at(-1)!.id;
    await manageGeoServer(db, hetzner, { ...settings, maxHours: 1 }, mail, at(181));
    expect(removed).toContain(long);
    expect((await db.select().from(schema.geoServers)).find(row => row.providerId === long)).toMatchObject({ status: "DELETED",
      deleteReason: "längre än 1 timmar" });

    // Översynen C1: en server som tystnat mitt i ett jobb raderas, jobbet går tillbaka i kön och en ny server startas.
    await clear();
    removed.length = 0;
    const jobId = await waitingJob();
    expect((await manageGeoServer(db, hetzner, settings, mail, at(300))).action).toBe("created");
    const silentToken = /OTID_GEO_WORKER_TOKEN='([0-9a-f]{64})'/.exec(created.at(-1)!.userData)![1]!;
    const silent = created.at(-1)!.id;
    const worker = await authenticateGeoWorker(db, `Bearer ${silentToken}`, null, {}, at(302));
    expect((await claimGeoJob(db, worker!, at(302)))?.jobId).toBe(jobId);
    expect((await manageGeoServer(db, hetzner, settings, mail, at(310))).action).toBe("none");
    expect(await manageGeoServer(db, hetzner, settings, mail, at(313))).toEqual({ action: "created", detail: "cx23 i fsn1" });
    expect(removed).toContain(silent);
    expect((await db.select().from(schema.geoServers)).find(row => row.providerId === silent)).toMatchObject({ deleteReason: "hördes inte av" });
    expect((await db.select().from(schema.mapProjectGeoJobs).where(eq(schema.mapProjectGeoJobs.id, jobId)))[0]).toMatchObject({ status: "QUEUED" });

    // Översynen A3: ett varv i taget; ett pågående lås gör att nästa varv inte gör något.
    await db.update(schema.geoServerStates).set({ updatedAt: at(320) }).where(eq(schema.geoServerStates.key, "lease"));
    expect(await manageGeoServer(db, hetzner, settings, mail, at(321))).toEqual({ action: "none", detail: "ett annat varv pågår" });
    expect((await manageGeoServer(db, hetzner, settings, mail, at(326))).detail).not.toBe("ett annat varv pågår");

    // En server med etiketten som tabellen inte känner till raderas.
    extra.push({ id: 999, name: "otid-geo-borta", created: NOW.toISOString() });
    await manageGeoServer(db, hetzner, settings, mail, at(200));
    expect(removed).toContain(999);
  });
});
