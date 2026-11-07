import { describe, expect, it, vi } from "vitest";
import type * as Application from "@o-tid/application";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { forEachMultipartPart, MultipartError, multipartBoundary, partBytes } from "./multipart";
import { csrf, db, dependencies, environment, id, token } from "./race-administrator-route-test-helpers";

/** Steg 59: kartfilens uppladdning (multipart), originalfilen och borttagningen. */
async function multipart(parts: Record<string, Blob | string>, fileNames: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    if (typeof value === "string") form.append(name, value);
    else form.append(name, value, fileNames[name] ?? `${name}.bin`);
  }
  const encoded = new Response(form);
  return { body: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get("content-type")! };
}

function upload(body: Uint8Array<ArrayBuffer>, contentType: string, headers: Record<string, string> = {}) {
  return new Request("https://otid.example/api/admin", { method: "POST", body, headers: { origin: environment.O_TID_PUBLIC_ORIGIN,
    "x-otid-csrf": csrf, "content-type": contentType, cookie: `__Host-otid-organizer-session=${token}; __Host-otid-organizer-csrf=${csrf}`,
    ...headers } });
}

/** En ström som lämnar bodyn i bitar av given storlek (som nätet gör). */
function streamOf(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset >= bytes.byteLength) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + size)); offset += size;
  } });
}

async function readParts(bytes: Uint8Array, boundary: string, size: number, maxBytes = 1_000_000, maxParts = 8) {
  const parts: { name: string; fileName: string | undefined; bytes: number[] }[] = [];
  await forEachMultipartPart(streamOf(bytes, size), boundary, { maxBytes, maxParts }, async part => {
    parts.push({ name: part.name, fileName: part.fileName, bytes: [...await partBytes(part.chunks, maxBytes)] });
  });
  return parts;
}

/**
 * ADR-0189 beslut 2: strömmen skrivs till databasen i tjänsten; här samlas den i minnet. Det som strömmats och sedan tagits
 * bort räknas, så att testet ser att inget blir kvar.
 */
function memoryStaging() {
  const staged = new Map<string, Uint8Array>();
  const mapContentStage = vi.fn<typeof Application.stageMapContent>(async (_db, chunks, options) => {
    const bytes: number[] = [];
    for await (const chunk of chunks) {
      bytes.push(...chunk);
      if (bytes.length > options.maxBytes) return { kind: "too-large" };
    }
    if (bytes.length === 0) return { kind: "empty" };
    const contentId = crypto.randomUUID();
    staged.set(contentId, new Uint8Array(bytes));
    return { kind: "staged", contentId, sha256: "0".repeat(64), byteLength: bytes.length, head: new Uint8Array(bytes) };
  });
  const mapContentDiscard = vi.fn<typeof Application.discardStagedMapContent>(async (_db, contentId) => { staged.delete(contentId); });
  return { staged, services: { mapContentStage, mapContentDiscard } };
}

const action = { kind: "race-map-source" as const };
const metadata = JSON.stringify({ formatVersion: 1 });

describe("multipart som ström", () => {
  it("läser webbläsarens FormData med filnamn och typ, oavsett var bitarna delas", async () => {
    const { body, contentType } = await multipart({ metadata: new Blob([metadata], { type: "application/json" }),
      file: new Blob([new Uint8Array([0xad, 0x0c, 1, 2, 13, 10, 45, 45])]) }, { file: "Djurgården 2025.ocd" });
    const boundary = multipartBoundary(contentType)!;
    for (const size of [1, 2, 3, 7, 64, 100_000]) {
      const parts = await readParts(body, boundary, size);
      expect(parts.map(part => part.name)).toEqual(["metadata", "file"]);
      expect(new TextDecoder().decode(new Uint8Array(parts[0]!.bytes))).toBe(metadata);
      expect(parts[1]!.fileName).toBe("Djurgården 2025.ocd");
      expect(parts[1]!.bytes).toEqual([0xad, 0x0c, 1, 2, 13, 10, 45, 45]);
    }
  });

  it("hoppar över det som anroparen inte läste", async () => {
    const { body, contentType } = await multipart({ a: new Blob(["första delen"]), b: new Blob(["andra"]) });
    const names: string[] = [];
    await forEachMultipartPart(streamOf(body, 3), multipartBoundary(contentType)!, { maxBytes: 10_000, maxParts: 3 }, async part => {
      names.push(part.name);
      if (part.name === "b") expect(new TextDecoder().decode(await partBytes(part.chunks, 100))).toBe("andra");
    });
    expect(names).toEqual(["a", "b"]);
  });

  it("avvisar fel typ, trasig body, för många delar och för stor body", async () => {
    expect(multipartBoundary("application/json")).toBeUndefined();
    expect(multipartBoundary("multipart/form-data")).toBeUndefined();
    const outcome = (text: string, options: { maxBytes?: number; maxParts?: number } = {}) =>
      readParts(new TextEncoder().encode(text), "x", 5, options.maxBytes, options.maxParts).then(() => "ok", (error: unknown) =>
        error instanceof MultipartError ? error.kind : "annat");
    expect(await outcome("--x\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\nutan slut")).toBe("invalid");
    expect(await outcome("annat")).toBe("invalid");
    const many = Array.from({ length: 10 }, (_, index) => `--x\r\nContent-Disposition: form-data; name="p${index}"\r\n\r\nv\r\n`).join("") + "--x--";
    expect(await outcome(many)).toBe("invalid");
    expect(await outcome(many, { maxParts: 10 })).toBe("ok");
    expect(await outcome(many, { maxParts: 10, maxBytes: 100 })).toBe("too-large");
  });
});

describe("administratörsroutes: kartfilen", () => {
  it("strömmar kartfilen och bilden, skickar dem och metadata till tjänsten och svarar 204; inget strömmat blir kvar", async () => {
    const raceMapSourceSave = vi.fn<typeof Application.saveRaceMapSourceAsAdmin>().mockResolvedValue({ status: "ok", georeferenced: true });
    const staging = memoryStaging();
    const { body, contentType } = await multipart({ metadata: new Blob([metadata]), file: new Blob([new Uint8Array([0xad, 0x0c])]),
      image: new Blob([new Uint8Array([0x89, 0x50])]) }, { file: "karta.ocd" });
    const response = await raceAdministratorRoute(db, upload(body, contentType), id, action,
      { ...dependencies(), ...staging.services, raceMapSourceSave }, environment);
    expect(response.status).toBe(204);
    const input = raceMapSourceSave.mock.calls[0]![1];
    expect(input).toMatchObject({ raceId: id, fileName: "karta.ocd", metadata: { formatVersion: 1 } });
    expect(input.file).toMatchObject({ kind: "staged", byteLength: 2 });
    expect([...(input.file as Application.StagedMapContent).head]).toEqual([0xad, 0x0c]);
    expect([...(input.image as Application.StagedMapContent).head]).toEqual([0x89, 0x50]);
    expect(staging.staged.size).toBe(0);
    expect(staging.services.mapContentDiscard).toHaveBeenCalledTimes(2);
  });

  it("avbryter en för stor kartfil medan den strömmas, utan att spara något", async () => {
    const raceMapSourceSave = vi.fn<typeof Application.saveRaceMapSourceAsAdmin>();
    const staging = memoryStaging();
    staging.services.mapContentStage.mockImplementationOnce(async () => ({ kind: "too-large" }));
    const { body, contentType } = await multipart({ metadata: new Blob([metadata]), file: new Blob(["x"]), image: new Blob(["y"]) });
    const response = await raceAdministratorRoute(db, upload(body, contentType), id, action,
      { ...dependencies(), ...staging.services, raceMapSourceSave }, environment);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "MAP_FILE_TOO_LARGE" });
    expect(raceMapSourceSave).not.toHaveBeenCalled();
    expect(staging.staged.size).toBe(0);
  });

  it("full kvot ger 422 med gränsen i MB", async () => {
    const MB = 1024 * 1024;
    const raceMapSourceSave = vi.fn<typeof Application.saveRaceMapSourceAsAdmin>().mockResolvedValue({ status: "problem",
      problem: "STORAGE_QUOTA_EXCEEDED", quota: { scope: "ACCOUNT", usedBytes: 1900 * MB, limitBytes: 2048 * MB, neededBytes: 200 * MB } });
    const staging = memoryStaging();
    const { body, contentType } = await multipart({ metadata: new Blob([metadata]), file: new Blob(["x"]), image: new Blob(["y"]) });
    const response = await raceAdministratorRoute(db, upload(body, contentType), id, action,
      { ...dependencies(), ...staging.services, raceMapSourceSave }, environment);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "STORAGE_QUOTA_EXCEEDED",
      quota: { scope: "ACCOUNT", usedMb: 1900, limitMb: 2048, neededMb: 200 } });
    expect(staging.staged.size).toBe(0);
  });

  it("kräver tre delar, multipart, rätt Origin och svarar 422 med begripligt fel", async () => {
    const raceMapSourceSave = vi.fn<typeof Application.saveRaceMapSourceAsAdmin>().mockResolvedValue({ status: "problem", problem: "INVALID_MAP_FILE" });
    const staging = memoryStaging();
    const services = { ...dependencies(), ...staging.services, raceMapSourceSave };
    const partial = await multipart({ metadata: new Blob([metadata]), file: new Blob(["x"]) });
    expect((await raceAdministratorRoute(db, upload(partial.body, partial.contentType), id, action, services, environment)).status).toBe(400);
    const doubled = await multipart({ metadata: new Blob([metadata]), file: new Blob(["x"]), image: new Blob(["y"]) });
    expect((await raceAdministratorRoute(db, upload(doubled.body, "application/octet-stream"), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, upload(doubled.body, doubled.contentType, { origin: "https://annan.example" }), id, action,
      services, environment)).status).toBe(403);
    const rejected = await raceAdministratorRoute(db, upload(doubled.body, doubled.contentType), id, action, services, environment);
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({ formatVersion: 1, error: "INVALID_MAP_FILE" });
    const broken = await multipart({ metadata: new Blob(["{inte json"]), file: new Blob(["x"]), image: new Blob(["y"]) });
    expect((await raceAdministratorRoute(db, upload(broken.body, broken.contentType), id, action, services, environment)).status).toBe(400);
    expect(raceMapSourceSave).toHaveBeenCalledTimes(1);
    expect(staging.staged.size).toBe(0);
  });

  it("avvisar en för stor uppladdning innan den läses", async () => {
    const raceMapSourceSave = vi.fn<typeof Application.saveRaceMapSourceAsAdmin>();
    const { body, contentType } = await multipart({ metadata: new Blob([metadata]), file: new Blob(["x"]), image: new Blob(["y"]) });
    const response = await raceAdministratorRoute(db, upload(body, contentType, { "content-length": String(200 * 1024 * 1024) }), id, action,
      { ...dependencies(), raceMapSourceSave }, environment);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "MAP_FILE_TOO_LARGE" });
    expect(raceMapSourceSave).not.toHaveBeenCalled();
  });

  it("ger originalfilen som nedladdning och tar bort kartfilen", async () => {
    const raceMapSourceFile = vi.fn<typeof Application.readRaceMapSourceFileAsAdmin>()
      .mockResolvedValue({ status: "ok", fileName: "Djurgården 2025.ocd", format: "OCD", sha256: "a".repeat(64), file: Buffer.from([0xad, 0x0c, 7]) });
    const raceMapSourceRemove = vi.fn<typeof Application.removeRaceMapSourceAsAdmin>().mockResolvedValue({ status: "ok" });
    const services = { ...dependencies(), raceMapSourceFile, raceMapSourceRemove };
    const get = new Request("https://otid.example/api/admin", { headers: { cookie: `__Host-otid-organizer-session=${token}` } });
    const file = await raceAdministratorRoute(db, get, id, action, services, environment);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toBe(`attachment; filename="karta.ocd"; filename*=UTF-8''${encodeURIComponent("Djurgården 2025.ocd")}`);
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0xad, 0x0c, 7]);
    const remove = new Request("https://otid.example/api/admin", { method: "DELETE", headers: { origin: environment.O_TID_PUBLIC_ORIGIN,
      "x-otid-csrf": csrf, cookie: `__Host-otid-organizer-session=${token}; __Host-otid-organizer-csrf=${csrf}` } });
    expect((await raceAdministratorRoute(db, remove, id, action, services, environment)).status).toBe(204);
    raceMapSourceFile.mockResolvedValueOnce({ status: "not-found" });
    expect((await raceAdministratorRoute(db, get, id, action, services, environment)).status).toBe(404);
  });

  it("ADR-0218: med filens sha256 i adressen får webbläsaren behålla filen privat med ETag; If-None-Match ger 304 efter behörigheten", async () => {
    const sha = "b".repeat(64);
    const raceMapSourceFile = vi.fn<typeof Application.readRaceMapSourceFileAsAdmin>()
      .mockResolvedValue({ status: "ok", fileName: "skog.ocd", format: "OCD", sha256: sha, file: Buffer.from([0xad, 0x0c, 7]) });
    const services = { ...dependencies(), raceMapSourceFile };
    const get = (headers: Record<string, string> = {}) => new Request("https://otid.example/api/admin",
      { headers: { cookie: `__Host-otid-organizer-session=${token}`, ...headers } });
    const addressed = await raceAdministratorRoute(db, get(), id, { kind: "race-map-source", sha256: sha }, services, environment);
    expect(addressed.status).toBe(200);
    expect(addressed.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    expect(addressed.headers.get("etag")).toBe(`"${sha}"`);
    expect(addressed.headers.get("vary")).toBe("Cookie");
    expect(raceMapSourceFile.mock.calls[0]![3]).toEqual({ ifNoneMatch: undefined });
    // Filen har bytts sedan adressen skrevs: den nya filen, men inte i webbläsarens cache.
    const other = await raceAdministratorRoute(db, get(), id, { kind: "race-map-source", sha256: "c".repeat(64) }, services, environment);
    expect(other.status).toBe(200);
    expect(other.headers.get("cache-control")).toBe("private, no-store");
    expect(other.headers.get("etag")).toBeNull();
    // Webbläsaren frågar med sin ETag: tjänsten (som prövar behörigheten först) säger att filen är densamma.
    raceMapSourceFile.mockResolvedValueOnce({ status: "not-modified", sha256: sha });
    const again = await raceAdministratorRoute(db, get({ "if-none-match": `W/"${sha}"` }), id, { kind: "race-map-source", sha256: sha }, services, environment);
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(`"${sha}"`);
    expect(raceMapSourceFile.mock.calls[2]![3]).toEqual({ ifNoneMatch: sha });
    // Utan behörighet hjälper ingen ETag.
    raceMapSourceFile.mockResolvedValueOnce({ status: "forbidden" });
    expect((await raceAdministratorRoute(db, get({ "if-none-match": `"${sha}"` }), id, { kind: "race-map-source", sha256: sha }, services, environment)).status)
      .toBe(403);
    // Adressen med sha256 tar bara emot GET.
    const remove = new Request("https://otid.example/api/admin", { method: "DELETE", headers: { origin: environment.O_TID_PUBLIC_ORIGIN,
      "x-otid-csrf": csrf, cookie: `__Host-otid-organizer-session=${token}; __Host-otid-organizer-csrf=${csrf}` } });
    expect((await raceAdministratorRoute(db, remove, id, { kind: "race-map-source", sha256: sha }, services, environment)).status).toBe(405);
    expect((await raceAdministratorRoute(db, get(), id, { kind: "race-map-source", sha256: "XYZ" }, services, environment)).status).toBe(400);
  });

  it("kräver administratör för att ladda upp; originalfilen kräver banläggningens behörighet (steg 66, kartritaren räcker)", async () => {
    const services = dependencies();
    services.authenticate.mockResolvedValue({ status: "authenticated", principal: { accountId: id, sessionId: id, raceId: id, eventId: id,
      grantId: id, grantRole: "FUNCTIONARY", role: "FUNCTIONARY", expiresAt: "2026-09-12T13:00:00Z" } });
    services.authenticateCourseSetting.mockResolvedValue({ status: "forbidden" });
    const get = new Request("https://otid.example/api/admin", { headers: { cookie: `__Host-otid-organizer-session=${token}` } });
    expect((await raceAdministratorRoute(db, get, id, action, services, environment)).status).toBe(403);
    expect(services.authenticateCourseSetting.mock.calls[0]![1]).toMatchObject({ required: "MAP" }); // ADR-0181 beslut 8: också kartritaren.
    expect(services.authenticate).not.toHaveBeenCalled();
    const remove = new Request("https://otid.example/api/admin", { method: "DELETE", headers: { origin: environment.O_TID_PUBLIC_ORIGIN,
      "x-otid-csrf": csrf, cookie: `__Host-otid-organizer-session=${token}; __Host-otid-organizer-csrf=${csrf}` } });
    expect((await raceAdministratorRoute(db, remove, id, action, services, environment)).status).toBe(403);
    expect(services.authenticate.mock.calls[0]![1]).toMatchObject({ role: "ADMIN" });
  });
});
