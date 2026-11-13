import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "@o-tid/database";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { fetchMapProjectWmsImage, readMapProjectWmsCapabilities, wmsTilePlan, type WmsRuntime } from "../../src/map-project-wms";
import { PublicFetchError, type PublicFetch } from "../../src/public-fetch";
import { registerTestAccount } from "./accounts";

/**
 * Ortofoto från valfri WMS-tjänst som underlag: behörighet (den som får föreslå), kvot (samma som markfuktigheten), lagren ur
 * GetCapabilities, GetMap i 1.1.1 med fallback till 1.3.0 (axelordning nord, öst) och tydliga fel. Tjänsten är falsk (en egen
 * hämtning); inget nätverk används.
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219w_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-13T12:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const BOX = { south: 59.29, west: 18.0, north: 59.30, east: 18.04 };
const SERVICE = "https://opengeodata.goteborg.se/services/ortofoto/wms/v1";

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219w_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

/** En JPEG med bara de delar som storleken läses ur. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}
const bytes = (text: string) => new TextEncoder().encode(text);
const capabilities = (version: string, crs = "EPSG:3006", formats = "<Format>image/png</Format><Format>image/jpeg</Format>") =>
  `<WMS_Capabilities version="${version}"><Service><Title>Göteborg ortofoto</Title></Service><Capability><Request><GetMap>${formats}</GetMap></Request>`
  + `<Layer><CRS>EPSG:4326</CRS><CRS>${crs}</CRS><Layer><Name>orto_2023</Name><Title>Ortofoto 2023</Title></Layer></Layer></Capability></WMS_Capabilities>`;

/** Tjänsten: svarar på GetCapabilities och GetMap; `only130` låter 1.1.1 svara med ett ServiceException (som en tjänst som bara kan 1.3.0). */
function fakeService(options: { only130?: boolean; crs?: string; formats?: string; size?: (width: number, height: number) => [number, number] } = {}) {
  const calls: URL[] = [];
  const fetcher: PublicFetch = async target => {
    const query = new URL(target);
    calls.push(query);
    const get = (key: string) => query.searchParams.get(key);
    if (get("REQUEST") === "GetCapabilities") return { status: 200, contentType: "text/xml", body: bytes(capabilities(get("VERSION")!, options.crs, options.formats)) };
    if (options.only130 && get("VERSION") === "1.1.1") return { status: 200, contentType: "application/vnd.ogc.se_xml", body: bytes("<ServiceExceptionReport/>") };
    const [width, height] = options.size ? options.size(Number(get("WIDTH")), Number(get("HEIGHT"))) : [Number(get("WIDTH")), Number(get("HEIGHT"))];
    return { status: 200, contentType: "image/jpeg", body: jpeg(width, height) };
  };
  const runtime: WmsRuntime = { fetch: fetcher, cache: new Map() };
  return { calls, runtime };
}

async function project() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Ortofoto", fileName: "Ortofoto.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const reader = await registerTestAccount(db, undefined, NOW);
  await inviteMapProjectMember(db, { ...owner.proof, projectId: created.projectId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READ" } }, NOW);
  await readMapProject(db, { ...reader.proof, projectId: created.projectId }, NOW);
  return { owner, reader, projectId: created.projectId };
}
const image = (overrides: Record<string, unknown> = {}) => ({ formatVersion: 1, url: SERVICE, layer: "orto_2023", metersPerPixel: 2, box: BOX, ...overrides });

describe("ortofoto från WMS", () => {
  it("lagren: titel, namn och koordinatsystem; bara den som får föreslå", async () => {
    const { owner, reader, projectId } = await project();
    const { runtime, calls } = fakeService();
    const result = await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request: { formatVersion: 1, url: SERVICE } }, runtime, NOW);
    expect(result).toEqual({ status: "ok", response: { formatVersion: 1, title: "Göteborg ortofoto", version: "1.3.0", formats: ["image/png", "image/jpeg"],
      layers: [{ name: "orto_2023", title: "Ortofoto 2023", epsg: 3006 }] } });
    expect(calls[0]!.searchParams.get("VERSION")).toBe("1.3.0");
    expect((await readMapProjectWmsCapabilities(db, { ...reader.proof, projectId, request: { formatVersion: 1, url: SERVICE } }, runtime, NOW)).status).toBe("forbidden");
    expect((await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request: { formatVersion: 1 } }, runtime, NOW)).status).toBe("invalid-request");
  });

  it("faller tillbaka på 1.1.1 när 1.3.0 inte ger en lagerlista", async () => {
    const { owner, projectId } = await project();
    const calls: string[] = [];
    const runtime: WmsRuntime = { cache: new Map(), fetch: async target => {
      const version = new URL(target).searchParams.get("VERSION")!;
      calls.push(version);
      return version === "1.3.0" ? { status: 400, contentType: "text/html", body: bytes("<html/>") } : { status: 200, contentType: "text/xml", body: bytes(capabilities("1.1.1").replace("WMS_Capabilities", "WMT_MS_Capabilities")) };
    } };
    const result = await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request: { formatVersion: 1, url: SERVICE } }, runtime, NOW);
    expect(result).toMatchObject({ status: "ok", response: { version: "1.1.1" } });
    expect(calls).toEqual(["1.3.0", "1.1.1"]);
  });

  it("en bildruta i SWEREF 99 TM i 1.1.1 (BBOX öst, nord, JPEG före PNG) med världsfil", async () => {
    const { owner, projectId } = await project();
    const { runtime, calls } = fakeService();
    const plan = wmsTilePlan(BOX, 3006, 2)![0]!;
    const result = await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, runtime, NOW);
    expect(result).toMatchObject({ status: "ok", mediaType: "image/jpeg", crs: 3006, tile: 0, tiles: 1, world: plan.world });
    const query = calls.at(-1)!.searchParams;
    expect(Object.fromEntries([...query.entries()])).toMatchObject({ SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetMap", LAYERS: "orto_2023", SRS: "EPSG:3006", FORMAT: "image/jpeg",
      BBOX: [plan.minE, plan.minN, plan.maxE, plan.maxN].join(","), WIDTH: String(plan.width), HEIGHT: String(plan.height) });
  });

  it("en tjänst som bara kan 1.3.0 får axelordningen nord, öst och CRS i stället för SRS; versionen kommer ihåg", async () => {
    const { owner, projectId } = await project();
    const { runtime, calls } = fakeService({ only130: true });
    const plan = wmsTilePlan(BOX, 3006, 2)![0]!;
    const result = await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, runtime, NOW);
    expect(result.status).toBe("ok");
    const last = calls.at(-1)!.searchParams;
    expect(last.get("VERSION")).toBe("1.3.0");
    expect(last.get("CRS")).toBe("EPSG:3006");
    expect(last.get("SRS")).toBeNull();
    expect(last.get("BBOX")).toBe([plan.minN, plan.minE, plan.maxN, plan.maxE].join(","));
    const before = calls.length;
    await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, runtime, NOW);
    // Andra gången: bara en GetMap, direkt med 1.3.0.
    expect(calls.slice(before).map(call => call.searchParams.get("VERSION"))).toEqual(["1.3.0"]);
  });

  it("PNG när JPEG saknas, och kartans eget system när tjänsten inte har SWEREF 99 TM", async () => {
    const { owner, projectId } = await project();
    const png = fakeService({ formats: "<Format>image/png</Format>", crs: "EPSG:3011" });
    const none = await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, png.runtime, NOW);
    expect(none).toEqual({ status: "wms", code: "NO_SWEREF" });
    const own = await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image({ mapEpsg: 3011 }) }, png.runtime, NOW);
    expect(own).toMatchObject({ status: "ok", crs: 3011 });
    expect(png.calls.at(-1)!.searchParams.get("FORMAT")).toBe("image/png");
    expect(png.calls.at(-1)!.searchParams.get("SRS")).toBe("EPSG:3011");
    const nothing = fakeService({ formats: "<Format>image/gif</Format>" });
    expect(await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, nothing.runtime, NOW)).toEqual({ status: "wms", code: "NO_FORMAT" });
    expect(await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request: { formatVersion: 1, url: SERVICE } }, fakeService({ crs: "EPSG:3857" }).runtime, NOW))
      .toEqual({ status: "wms", code: "NO_SWEREF" });
  });

  it("stora områden delas i rutor (tile) och för många rutor ger ett tydligt fel", async () => {
    const { owner, projectId } = await project();
    const { runtime } = fakeService();
    const planned = wmsTilePlan(BOX, 3006, 0.25)!;
    expect(planned.length).toBeGreaterThan(1);
    const second = await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image({ metersPerPixel: 0.25, tile: 1 }) }, runtime, NOW);
    expect(second).toMatchObject({ status: "ok", tile: 1, tiles: planned.length, world: planned[1]!.world });
    expect(await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image({ metersPerPixel: 0.25, tile: planned.length }) }, runtime, NOW)).toEqual({ status: "invalid-request" });
    // Inom gränserna för en ruta (40 km²) men 30 rutor i 0,25 m.
    const large = { south: 59.28, west: 17.95, north: 59.32, east: 18.05 };
    expect(wmsTilePlan(large, 3006, 0.25)).toBeUndefined();
    const tooMany = await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image({ metersPerPixel: 0.25, box: large }) }, runtime, NOW);
    expect(wmsTilePlan(large, 3006, 0.5)).toBeDefined();
    expect(tooMany).toMatchObject({ status: "wms", code: "TOO_MANY_TILES" });
  });

  it("adresser som inte är publika https avvisas innan något hämtas", async () => {
    const { owner, projectId } = await project();
    const { runtime, calls } = fakeService();
    for (const [address, code] of [["http://exempel.se/wms", "NOT_HTTPS"], ["https://10.0.0.1/wms", "PRIVATE_ADDRESS"], ["https://169.254.169.254/latest", "PRIVATE_ADDRESS"],
      ["https://[::ffff:10.0.0.1]/wms", "PRIVATE_ADDRESS"], ["https://exempel.se:8443/wms", "BAD_URL"], ["https://u:p@exempel.se/wms", "BAD_URL"], ["inte en adress", "BAD_URL"]] as const) {
      expect(await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request: { formatVersion: 1, url: address } }, runtime, NOW), address).toEqual({ status: "wms", code });
      expect(await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image({ url: address }) }, runtime, NOW), address).toEqual({ status: "wms", code });
    }
    expect(calls).toHaveLength(0);
  });

  it("fel från tjänsten blir rätt besked: svarar inte, inte WMS, okänt lager, fel bildstorlek, för stor bild", async () => {
    const { owner, projectId } = await project();
    const request = { formatVersion: 1, url: SERVICE };
    const failing = (error: Error): WmsRuntime => ({ cache: new Map(), fetch: async () => { throw error; } });
    expect(await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request }, failing(new PublicFetchError("timeout")), NOW)).toEqual({ status: "wms", code: "UNREACHABLE" });
    expect(await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request }, failing(new PublicFetchError("private-address")), NOW)).toEqual({ status: "wms", code: "PRIVATE_ADDRESS" });
    expect(await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request }, failing(new PublicFetchError("redirect")), NOW)).toEqual({ status: "wms", code: "UNREACHABLE" });
    const html: WmsRuntime = { cache: new Map(), fetch: async () => ({ status: 200, contentType: "text/html", body: bytes("<html>hej</html>") }) };
    expect(await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request }, html, NOW)).toEqual({ status: "wms", code: "NOT_WMS" });
    const good = fakeService();
    expect(await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image({ layer: "finns_inte" }) }, good.runtime, NOW)).toEqual({ status: "wms", code: "NO_LAYER" });
    const wrongSize = fakeService({ size: (width, height) => [width - 1, height] });
    expect(await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, wrongSize.runtime, NOW)).toEqual({ status: "wms", code: "NOT_IMAGE" });
    const big: WmsRuntime = { cache: good.runtime.cache, fetch: async target => { if (new URL(target).searchParams.get("REQUEST") === "GetMap") throw new PublicFetchError("too-large"); return good.runtime.fetch!(target, { timeoutMs: 1, maxBytes: 1 }); } };
    expect(await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, big, NOW)).toEqual({ status: "wms", code: "IMAGE_TOO_LARGE" });
  });

  it("kvoten: samma som markfuktigheten (20 i timmen per konto), bildruta två och framåt räknas för sig", async () => {
    const { owner, projectId } = await project();
    const { runtime } = fakeService();
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    for (let index = 0; index < 20; index += 1) {
      expect((await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request: { formatVersion: 1, url: SERVICE } }, runtime, later)).status, String(index)).toBe("ok");
    }
    expect(await readMapProjectWmsCapabilities(db, { ...owner.proof, projectId, request: { formatVersion: 1, url: SERVICE } }, runtime, later)).toEqual({ status: "throttled" });
    expect(await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image() }, runtime, later)).toEqual({ status: "throttled" });
    expect((await fetchMapProjectWmsImage(db, { ...owner.proof, projectId, request: image({ metersPerPixel: 0.25, tile: 1 }) }, runtime, later)).status).toBe("ok");
  });
});
