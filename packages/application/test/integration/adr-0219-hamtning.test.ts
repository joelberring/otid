import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, schema } from "@o-tid/database";
import { eq } from "drizzle-orm";
import { deleteAccountWithOwnedEvents } from "../../src/account-self-service";
import { createMapProjectFromUpload, inviteMapProjectMember, readMapProject } from "../../src/map-projects";
import { fetchMapProjectOsm } from "../../src/map-project-sources";
import { allowedSourceUrl, readMapProjectOrthoAsset, searchMapProjectOrtho, type LantmaterietRuntime } from "../../src/map-project-lantmateriet";
import { deleteMapSourceCredential, openMapSourceCredential, readMapSourceCredential, saveMapSourceCredential } from "../../src/map-source-credentials";
import { registerTestAccount } from "./accounts";

/**
 * ADR-0219 tillägget om hämtningen (K4c, migration 0100): OpenStreetMap via servern; kontots egna uppgifter till Lantmäteriet
 * (sparas krypterade, visas aldrig igen, tas bort med kontot); sökningen och bildens delar med uppgifterna, bara till
 * Lantmäteriets adresser. Tjänsterna är falska (en egen fetch).
 */
const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Testet kräver TEST_DATABASE_URL till en PostgreSQL-roll med CREATEDB");
const admin = createDatabase(base);
const databaseName = `otid_adr0219h_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${databaseName}`;
const { db, pool } = createDatabase(url.href);
const NOW = new Date("2026-11-08T12:00:00Z");
const mapBytes = new Uint8Array(await readFile(new URL("../../../../fixtures/maps/kartfil.omap", import.meta.url)));
const environment = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64") };
const BOX = { south: 59.29, west: 18.0, north: 59.31, east: 18.04 };

beforeAll(async () => {
  await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: new URL("../../../database/migrations", import.meta.url).pathname });
}, 60_000);
afterAll(async () => {
  await pool.end();
  if (!/^otid_adr0219h_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Ogiltig testdatabas för rensning");
  await admin.pool.query(`DROP DATABASE "${databaseName}"`);
  await admin.pool.end();
});

async function project() {
  const owner = await registerTestAccount(db, undefined, NOW);
  const created = await createMapProjectFromUpload(db, { ...owner.proof, metadata: { formatVersion: 1, requestId: randomUUID(), name: "Hämtning",
    fileName: "Hämtning.omap" }, file: mapBytes }, NOW);
  if (created.status !== "created") throw new Error(created.status);
  const reader = await registerTestAccount(db, undefined, NOW);
  await inviteMapProjectMember(db, { ...owner.proof, projectId: created.projectId, request: { formatVersion: 1, requestId: randomUUID(), email: reader.email, role: "READ" } }, NOW);
  await readMapProject(db, { ...reader.proof, projectId: created.projectId }, NOW);
  return { owner, reader, projectId: created.projectId };
}

describe("ADR-0219 K4c: hämtning", () => {
  it("OpenStreetMap: lager som en vektorfil, för stort område och Läsa avvisas", async () => {
    const { owner, reader, projectId } = await project();
    const calls: string[] = [];
    const runtime = { overpassUrl: "http://overpass.test/api/interpreter", fetch: (async (_url: string, init: RequestInit) => {
      calls.push(typeof init.body === "string" ? init.body : "");
      return Response.json({ elements: [{ type: "way", tags: { building: "yes" }, geometry: [{ lat: 59.3, lon: 18.01 }, { lat: 59.3, lon: 18.011 },
        { lat: 59.301, lon: 18.011 }, { lat: 59.3, lon: 18.01 }] }] });
    }) as typeof fetch };
    const result = await fetchMapProjectOsm(db, { ...owner.proof, projectId, request: { formatVersion: 1, box: BOX } }, runtime, NOW);
    expect(result).toMatchObject({ status: "ok", data: { crs: 4326, features: [{ layer: "OSM byggnad" }] } });
    expect(decodeURIComponent(calls[0]!)).toContain("59.2900000,18.0000000,59.3100000,18.0400000");
    expect((await fetchMapProjectOsm(db, { ...owner.proof, projectId, request: { formatVersion: 1, box: { ...BOX, north: 60 } } }, runtime, NOW)).status)
      .toBe("too-large");
    expect((await fetchMapProjectOsm(db, { ...reader.proof, projectId, request: { formatVersion: 1, box: BOX } }, runtime, NOW)).status).toBe("forbidden");
    expect(calls).toHaveLength(1);
  });

  it("uppgifterna: sparas krypterade, visas aldrig, ersätts och tas bort med kontot", async () => {
    const { owner } = await project();
    expect(await readMapSourceCredential(db, owner.proof, environment, NOW)).toMatchObject({ status: "ok", view: { available: true, saved: null } });
    expect((await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "x", secret: "y" } }, {}, NOW)).status)
      .toBe("not-configured");
    const saved = await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "geotorget-anna", secret: "hemligt-1" } },
      environment, NOW);
    expect(saved).toMatchObject({ status: "ok", view: { saved: { method: "BASIC", hint: "anna", readable: true } } });
    expect(JSON.stringify(saved)).not.toContain("hemligt-1");
    const [row] = await db.select().from(schema.mapSourceCredentials).where(eq(schema.mapSourceCredentials.accountId, owner.accountId));
    expect(JSON.stringify(row)).not.toContain("hemligt-1");
    expect(await openMapSourceCredential(db, owner.accountId, environment)).toEqual({ method: "BASIC", id: "geotorget-anna", secret: "hemligt-1" });
    // En annan masternyckel kan inte läsa dem.
    const other = { OTID_EVENTOR_MASTER_KEY: randomBytes(32).toString("base64") };
    expect(await openMapSourceCredential(db, owner.accountId, other)).toBeUndefined();
    expect(await readMapSourceCredential(db, owner.proof, other, NOW)).toMatchObject({ view: { saved: { readable: false } } });
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "OAUTH2", id: "nyckel-1234", secret: "s" } }, environment, NOW);
    expect(await openMapSourceCredential(db, owner.accountId, environment)).toMatchObject({ method: "OAUTH2", id: "nyckel-1234" });
    expect(await deleteMapSourceCredential(db, owner.proof, environment, NOW)).toMatchObject({ status: "ok", view: { saved: null } });
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "a", secret: "b" } }, environment, NOW);
    await db.transaction(tx => deleteAccountWithOwnedEvents(tx, owner.accountId, NOW));
    expect(await db.select().from(schema.mapSourceCredentials).where(eq(schema.mapSourceCredentials.accountId, owner.accountId))).toEqual([]);
  });

  it("ortofoton: sökningen och bildens delar med kontots uppgifter, bara till Lantmäteriets adresser", async () => {
    const { owner, reader, projectId } = await project();
    const seen: { url: string; auth: string | null; range: string | null }[] = [];
    const runtime: LantmaterietRuntime = { stacUrl: "https://api.lantmateriet.se/stac-bild/v1", tokenUrl: "https://apimanager.lantmateriet.se/oauth2/token",
      environment, fetch: (async (input: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        seen.push({ url: input, auth: headers.get("authorization"), range: headers.get("range") });
        if (input.endsWith("/oauth2/token")) return Response.json({ access_token: "biljett", expires_in: 3600 });
        if (input.endsWith("/search")) return Response.json({ type: "FeatureCollection", features: [
          { id: "63_5_2021", collection: "orto-2021", bbox: [18, 59.2, 18.1, 59.3], properties: { datetime: "2021-06-01T00:00:00Z" },
            assets: { data: { href: "https://dl1.lantmateriet.se/orto/63_5_2021.tif", type: "image/tiff; application=geotiff; profile=cloud-optimized" } } },
          { id: "63_5_2024", collection: "orto-2024", properties: { datetime: "2024-06-01T00:00:00Z" },
            assets: { data: { href: "https://dl1.lantmateriet.se/orto/63_5_2024.tif", type: "image/tiff" } } },
          { id: "falsk", properties: {}, assets: { data: { href: "https://annan.example/x.tif", type: "image/tiff" } } }
        ] });
        if (input === "https://dl1.lantmateriet.se/orto/63_5_2024.tif") return new Response(null, { status: 302, headers: { location: "https://dl2.lantmateriet.se/b.tif" } });
        if (input === "https://dl2.lantmateriet.se/b.tif") return new Response(new Uint8Array(100), { status: 206, headers: { "content-range": "bytes 0-99/5000" } });
        return new Response(null, { status: 404 });
      }) as typeof fetch };
    const search = { ...owner.proof, projectId, request: { formatVersion: 1, box: BOX } };
    expect((await searchMapProjectOrtho(db, search, runtime, NOW)).status).toBe("no-credential");
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "BASIC", id: "anna", secret: "hemligt" } }, environment, NOW);
    const found = await searchMapProjectOrtho(db, search, runtime, NOW);
    expect(found).toMatchObject({ status: "ok", items: [{ id: "63_5_2024", collection: "orto-2024" }, { id: "63_5_2021", bbox: [18, 59.2, 18.1, 59.3] }] });
    if (found.status !== "ok") throw new Error(found.status);
    expect(found.items).toHaveLength(2);
    expect(seen.at(-1)).toMatchObject({ url: "https://api.lantmateriet.se/stac-bild/v1/search", auth: `Basic ${Buffer.from("anna:hemligt").toString("base64")}` });
    expect((await searchMapProjectOrtho(db, { ...reader.proof, projectId, request: { formatVersion: 1, box: BOX } }, runtime, NOW)).status).toBe("forbidden");

    const part = await readMapProjectOrthoAsset(db, { ...owner.proof, projectId, href: found.items[0]!.href, range: "bytes=0-99" }, runtime, NOW);
    expect(part.status).toBe("ok");
    if (part.status === "ok") expect(part.response.status).toBe(206);
    expect(seen.slice(-2).map(call => [call.url, call.range])).toEqual([["https://dl1.lantmateriet.se/orto/63_5_2024.tif", "bytes=0-99"],
      ["https://dl2.lantmateriet.se/b.tif", "bytes=0-99"]]);
    // Utan Range, för stor del, en annan värd: avvisas utan att något hämtas.
    const before = seen.length;
    for (const [href, range] of [[found.items[0]!.href, null], [found.items[0]!.href, "bytes=0-99999999"], ["https://annan.example/x.tif", "bytes=0-9"],
      ["http://dl1.lantmateriet.se/x.tif", "bytes=0-9"], ["https://dl1.lantmateriet.se.example/x.tif", "bytes=0-9"]] as const) {
      expect((await readMapProjectOrthoAsset(db, { ...owner.proof, projectId, href, range }, runtime, NOW)).status).toBe("invalid-request");
    }
    expect(seen.length).toBe(before);
    expect(allowedSourceUrl("https://lantmateriet.se/x", runtime)?.hostname).toBe("lantmateriet.se");

    // OAuth2: biljetten hämtas en gång och används som Bearer.
    await saveMapSourceCredential(db, { ...owner.proof, request: { formatVersion: 1, method: "OAUTH2", id: "nyckel", secret: "hemlighet" } }, environment, NOW);
    await searchMapProjectOrtho(db, search, runtime, NOW);
    await searchMapProjectOrtho(db, search, runtime, NOW);
    expect(seen.filter(call => call.url.endsWith("/oauth2/token"))).toHaveLength(1);
    expect(seen.at(-1)?.auth).toBe("Bearer biljett");
  });
});
