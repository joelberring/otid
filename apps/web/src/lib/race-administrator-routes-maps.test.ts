import { describe, expect, it, vi } from "vitest";
import type * as Application from "@o-tid/application";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { multipartBoundary, parseMultipart } from "./multipart";
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

const action = { kind: "race-map-source" as const };
const metadata = JSON.stringify({ formatVersion: 1 });

describe("multipart", () => {
  it("läser webbläsarens FormData med filnamn och typ", async () => {
    const { body, contentType } = await multipart({ metadata: new Blob([metadata], { type: "application/json" }),
      file: new Blob([new Uint8Array([0xad, 0x0c, 1, 2])]) }, { file: "Djurgården 2025.ocd" });
    const boundary = multipartBoundary(contentType)!;
    const parts = parseMultipart(body, boundary)!;
    expect(parts.map(part => part.name)).toEqual(["metadata", "file"]);
    expect(new TextDecoder().decode(parts[0]!.bytes)).toBe(metadata);
    expect(parts[1]!.fileName).toBe("Djurgården 2025.ocd");
    expect([...parts[1]!.bytes]).toEqual([0xad, 0x0c, 1, 2]);
  });

  it("avvisar fel typ, trasig body och för många delar", () => {
    expect(multipartBoundary("application/json")).toBeUndefined();
    expect(multipartBoundary("multipart/form-data")).toBeUndefined();
    expect(parseMultipart(new TextEncoder().encode("--x\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\nutan slut"), "x")).toBeUndefined();
    expect(parseMultipart(new TextEncoder().encode("annat"), "x")).toBeUndefined();
    const many = Array.from({ length: 10 }, (_, index) => `--x\r\nContent-Disposition: form-data; name="p${index}"\r\n\r\nv\r\n`).join("") + "--x--";
    expect(parseMultipart(new TextEncoder().encode(many), "x")).toBeUndefined();
    expect(parseMultipart(new TextEncoder().encode(many), "x", 20)).toHaveLength(10);
  });
});

describe("administratörsroutes: kartfilen", () => {
  it("skickar kartfilen, bilden och metadata till tjänsten och svarar 204", async () => {
    const raceMapSourceSave = vi.fn<typeof Application.saveRaceMapSourceAsAdmin>().mockResolvedValue({ status: "ok", georeferenced: true });
    const { body, contentType } = await multipart({ metadata: new Blob([metadata]), file: new Blob([new Uint8Array([0xad, 0x0c])]),
      image: new Blob([new Uint8Array([0x89, 0x50])]) }, { file: "karta.ocd" });
    const response = await raceAdministratorRoute(db, upload(body, contentType), id, action, { ...dependencies(), raceMapSourceSave }, environment);
    expect(response.status).toBe(204);
    const input = raceMapSourceSave.mock.calls[0]![1];
    expect(input).toMatchObject({ raceId: id, fileName: "karta.ocd", metadata: { formatVersion: 1 } });
    expect([...input.file]).toEqual([0xad, 0x0c]);
    expect([...input.image]).toEqual([0x89, 0x50]);
  });

  it("kräver tre delar, multipart, rätt Origin och svarar 422 med begripligt fel", async () => {
    const raceMapSourceSave = vi.fn<typeof Application.saveRaceMapSourceAsAdmin>().mockResolvedValue({ status: "problem", problem: "INVALID_MAP_FILE" });
    const services = { ...dependencies(), raceMapSourceSave };
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
      .mockResolvedValue({ status: "ok", fileName: "Djurgården 2025.ocd", format: "OCD", file: Buffer.from([0xad, 0x0c, 7]) });
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

  it("kräver administratör, även för att hämta originalfilen", async () => {
    const services = dependencies();
    services.authenticate.mockResolvedValue({ status: "authenticated", principal: { accountId: id, sessionId: id, raceId: id, eventId: id,
      grantId: id, grantRole: "FUNCTIONARY", role: "FUNCTIONARY", expiresAt: "2026-09-12T13:00:00Z" } });
    const get = new Request("https://otid.example/api/admin", { headers: { cookie: `__Host-otid-organizer-session=${token}` } });
    expect((await raceAdministratorRoute(db, get, id, action, services, environment)).status).toBe(403);
    expect(services.authenticate.mock.calls[0]![1]).toMatchObject({ role: "ADMIN" });
  });
});
