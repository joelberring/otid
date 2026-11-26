import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";

const mocks = vi.hoisted(() => ({
  readMapProjectSource: vi.fn(),
  readMapProjectOutput: vi.fn(),
  exportMapProjectChanges: vi.fn(),
  updateMapProject: vi.fn(),
  createMapProjectNew: vi.fn(),
  streamMapContentParts: vi.fn()
}));

vi.mock("@o-tid/application", async (importOriginal) => ({
  ...await importOriginal<typeof import("@o-tid/application")>(),
  readMapProjectSource: mocks.readMapProjectSource,
  readMapProjectOutput: mocks.readMapProjectOutput,
  exportMapProjectChanges: mocks.exportMapProjectChanges,
  updateMapProject: mocks.updateMapProject,
  createMapProjectNew: mocks.createMapProjectNew,
  streamMapContentParts: mocks.streamMapContentParts
}));

import {
  mapProjectExportRoute, mapProjectNewRoute, mapProjectOutputRoute, mapProjectRoute, mapProjectSourceRoute
} from "./map-project-route-handlers";

const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se" } as const;
const projectId = "10000000-0000-4000-8000-000000000001";
const outputId = "10000000-0000-4000-8000-000000000002";
const contentId = "10000000-0000-4000-8000-000000000003";
const csrf = "c".repeat(43);
const session = `otid_user_session_v1.${projectId}.${"s".repeat(43)}`;
const base = `https://tid.klubb.se/api/organizer/map-projects/${projectId}`;

const getReq = (path: string) => new Request(`${base}${path}`, {
  headers: { cookie: `__Host-otid-organizer-session=${session}` }
});

const putReq = (body: Record<string, unknown>) => new Request(base, {
  method: "PUT",
  body: JSON.stringify(body),
  headers: {
    origin: env.O_TID_PUBLIC_ORIGIN,
    "content-type": "application/json",
    "x-otid-csrf": csrf,
    cookie: `__Host-otid-organizer-session=${session}; __Host-otid-organizer-csrf=${csrf}`
  }
});

async function* singleChunk(bytes: Uint8Array) { yield bytes; }

describe("Etapp 2: kartprojektens API-rutter för nedladdningsspärr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("/source returnerar 403 vid spärr för icke-ägare och 200 för ägare", async () => {
    mocks.readMapProjectSource.mockResolvedValueOnce({ status: "forbidden" });
    const blocked = await mapProjectSourceRoute(db, getReq("/source"), projectId, env);
    expect(blocked.status).toBe(403);

    const bytes = new Uint8Array([0xad, 0x0c, 1, 2]);
    mocks.readMapProjectSource.mockResolvedValueOnce({
      status: "ok", fileName: "Skogen.ocd", format: "OCD", byteLength: bytes.byteLength, contentId, sha256: "a".repeat(64)
    });
    mocks.streamMapContentParts.mockReturnValueOnce(singleChunk(bytes));
    const allowed = await mapProjectSourceRoute(db, getReq("/source"), projectId, env);
    expect(allowed.status).toBe(200);
    expect([...new Uint8Array(await allowed.arrayBuffer())]).toEqual([0xad, 0x0c, 1, 2]);
  });

  it("/outputs/:outputId returnerar 403 vid spärr för icke-ägare och 200 för ägare", async () => {
    mocks.readMapProjectOutput.mockResolvedValueOnce({ status: "forbidden" });
    const blocked = await mapProjectOutputRoute(db, getReq(`/outputs/${outputId}`), projectId, outputId, env);
    expect(blocked.status).toBe(403);

    const bytes = new Uint8Array([1, 2, 3]);
    mocks.readMapProjectOutput.mockResolvedValueOnce({
      status: "ok", fileName: "Skogen reviderad.omap", byteLength: bytes.byteLength, contentId, sha256: "b".repeat(64)
    });
    mocks.streamMapContentParts.mockReturnValueOnce(singleChunk(bytes));
    const allowed = await mapProjectOutputRoute(db, getReq(`/outputs/${outputId}`), projectId, outputId, env);
    expect(allowed.status).toBe(200);
    expect([...new Uint8Array(await allowed.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("/export?format=omap ger 403 vid spärr för icke-ägare och 200 för ägare samt för geojson", async () => {
    mocks.exportMapProjectChanges.mockResolvedValueOnce({ status: "forbidden" });
    const blocked = await mapProjectExportRoute(db, getReq("/export?format=omap"), projectId, env);
    expect(blocked.status).toBe(403);

    mocks.exportMapProjectChanges.mockResolvedValueOnce({
      status: "ok", fileName: "Skogen ändringar.xmap", contentType: "application/xml", body: "<map/>"
    });
    const allowedOmap = await mapProjectExportRoute(db, getReq("/export?format=omap"), projectId, env);
    expect(allowedOmap.status).toBe(200);
    expect(await allowedOmap.text()).toBe("<map/>");

    mocks.exportMapProjectChanges.mockResolvedValueOnce({
      status: "ok", fileName: "Skogen ändringar.geojson", contentType: "application/geo+json", body: "{\"type\":\"FeatureCollection\",\"features\":[]}"
    });
    const allowedGeo = await mapProjectExportRoute(db, getReq("/export?format=geojson"), projectId, env);
    expect(allowedGeo.status).toBe(200);
  });

  it("PUT på kartprojektet vidarebefordrar sourceDownloadPolicy och ger 403/200 efter roll", async () => {
    mocks.updateMapProject.mockResolvedValueOnce({ status: "forbidden" });
    const forbidden = await mapProjectRoute(db, putReq({ formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }), projectId, env);
    expect(forbidden.status).toBe(403);

    mocks.updateMapProject.mockResolvedValueOnce({ status: "ok" });
    const ok = await mapProjectRoute(db, putReq({ formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }), projectId, env);
    expect(ok.status).toBe(200);
    expect(mocks.updateMapProject.mock.calls[1]![1]).toMatchObject({
      projectId, request: { formatVersion: 1, sourceDownloadPolicy: "CUSTODIANS_ONLY" }
    });
  });

  it("/export?format=ocd returnerar 403 vid spärr och 200 binär OCAD-fil när tillåtet samt 400 vid okänt format", async () => {
    mocks.exportMapProjectChanges.mockResolvedValueOnce({ status: "forbidden" });
    const blocked = await mapProjectExportRoute(db, getReq("/export?format=ocd"), projectId, env);
    expect(blocked.status).toBe(403);

    const ocdBytes = new Uint8Array([0xad, 0x0c, 0x00, 0x00, 0x0c, 0x00]);
    mocks.exportMapProjectChanges.mockResolvedValueOnce({
      status: "ok", fileName: "Skogen ändringar.ocd", contentType: "application/octet-stream", body: ocdBytes
    });
    const allowed = await mapProjectExportRoute(db, getReq("/export?format=ocd"), projectId, env);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toBe("application/octet-stream");
    expect(allowed.headers.get("content-disposition")).toContain(".ocd");
    expect([...new Uint8Array(await allowed.arrayBuffer())]).toEqual([...ocdBytes]);

    const invalid = await mapProjectExportRoute(db, getReq("/export?format=svg"), projectId, env);
    expect(invalid.status).toBe(400);
  });

  it("PUT på kartprojektet vidarebefordrar colors på OCAD-projekt och returnerar 200", async () => {
    mocks.updateMapProject.mockResolvedValueOnce({ status: "ok" });
    const response = await mapProjectRoute(db, putReq({ formatVersion: 1, colors: [{ id: 1, cmyk: { c: 0.1, m: 0.2, y: 0.3, k: 0 } }] }), projectId, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ formatVersion: 1, status: "ok" });
  });

  it("Etapp 5B: /export?format=ocd-full och omap-full ger 403 vid spärr, headers vid nedladdning samt JSON vid report=1", async () => {
    // 403 CUSTODIANS_ONLY på både filnedladdning och ?report=1!
    mocks.exportMapProjectChanges.mockResolvedValueOnce({ status: "forbidden" });
    expect((await mapProjectExportRoute(db, getReq("/export?format=ocd-full"), projectId, env)).status).toBe(403);
    mocks.exportMapProjectChanges.mockResolvedValueOnce({ status: "forbidden" });
    expect((await mapProjectExportRoute(db, getReq("/export?format=omap-full&report=1"), projectId, env)).status).toBe(403);

    const sampleReport = {
      sourceFormat: "OMAP" as const, targetFormat: "OCD" as const, colors: 19, symbols: 110, objects: 42, skippedObjects: 0,
      warnings: [{ code: "PRECISION_ROUNDED", count: 12, message: "12 objekt avrundades." }]
    };
    const ocdBytes = new Uint8Array([0xad, 0x0c, 0, 0, 12, 0]);
    mocks.exportMapProjectChanges.mockResolvedValueOnce({
      status: "ok", fileName: "Skogen.ocd", contentType: "application/octet-stream", body: ocdBytes, report: sampleReport
    });
    const fullOcd = await mapProjectExportRoute(db, getReq("/export?format=ocd-full"), projectId, env);
    expect(fullOcd.status).toBe(200);
    expect(fullOcd.headers.get("content-type")).toBe("application/octet-stream");
    expect(fullOcd.headers.get("x-otid-conversion-warnings")).toBe("1");
    const decoded = JSON.parse(Buffer.from(fullOcd.headers.get("x-otid-conversion-report")!, "base64").toString("utf8")) as Record<string, unknown>;
    expect(decoded).toMatchObject({ formatVersion: 1, fileName: "Skogen.ocd", objects: 42, warnings: sampleReport.warnings });

    // ?report=1 returnerar JSON-rapport utan filnedladdning.
    mocks.exportMapProjectChanges.mockResolvedValueOnce({
      status: "ok", fileName: "Skogen.ocd", contentType: "application/octet-stream", body: ocdBytes, report: sampleReport
    });
    const reportJson = await mapProjectExportRoute(db, getReq("/export?format=ocd-full&report=1"), projectId, env);
    expect(reportJson.status).toBe(200);
    expect(await reportJson.json()).toMatchObject({ formatVersion: 1, fileName: "Skogen.ocd", warnings: sampleReport.warnings });

    // ?report=1 på geojson ger 400.
    expect((await mapProjectExportRoute(db, getReq("/export?format=geojson&report=1"), projectId, env)).status).toBe(400);

    // POST /new vidarebefordrar format=OCD.
    mocks.createMapProjectNew.mockResolvedValueOnce({ status: "created", replayed: false, projectId });
    const postNew = new Request("https://tid.klubb.se/api/organizer/map-projects/new", {
      method: "POST",
      body: JSON.stringify({ formatVersion: 1, requestId: outputId, name: "Ny OCAD", symbolSet: "ISOM2017-2", scale: 15000, format: "OCD", area: { crs: "SWEREF99TM", rings: [[[671000, 6573000], [672000, 6573000], [672000, 6574000]]] } }),
      headers: {
        origin: env.O_TID_PUBLIC_ORIGIN, "content-type": "application/json", "x-otid-csrf": csrf,
        cookie: `__Host-otid-organizer-session=${session}; __Host-otid-organizer-csrf=${csrf}`
      }
    });
    const created = await mapProjectNewRoute(db, postNew, env);
    expect(created.status).toBe(201);
    expect((mocks.createMapProjectNew.mock.calls[0]![1] as { request?: unknown }).request).toMatchObject({ format: "OCD" });
  });
});
