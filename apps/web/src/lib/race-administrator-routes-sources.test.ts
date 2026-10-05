import { describe, expect, it, vi } from "vitest";
import type * as Application from "@o-tid/application";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { csrf, db, dependencies, environment, id, other, request, token } from "./race-administrator-route-test-helpers";

const settings = { formatVersion: 1 as const, raceId: id, server: "OK" as const, key: "SAVED" as const,
  organisation: { id: "9321", name: "OK Skogsfalken" }, event: null, lastAppliedAt: null };
const KEY = "0123456789abcdef0123456789abcdef";

function bare(method: string, body?: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://otid.example/api/admin", { method, ...(body === undefined ? {} : { body }), headers: {
    origin: environment.O_TID_PUBLIC_ORIGIN, "x-otid-csrf": csrf,
    cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}`, ...headers } });
}

describe("administratörsroutes: Eventor och banfil", () => {
  it("sparar nyckeln med PUT men skickar den aldrig tillbaka; utan masternyckel blir det 409", async () => {
    const eventorKey = vi.fn<typeof Application.saveEventorKeyAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: { formatVersion: 1, raceId: id, outcome: "CONNECTED", settings } });
    const services = { ...dependencies(), eventorKey };
    const saved = await raceAdministratorRoute(db, request("PUT", JSON.stringify({ formatVersion: 1, apiKey: KEY })), id,
      { kind: "eventor" }, services, environment);
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(KEY);
    expect(eventorKey.mock.calls[0]![1]).toMatchObject({ raceId: id, request: { apiKey: KEY } });
    eventorKey.mockResolvedValueOnce({ status: "not-configured" });
    expect((await raceAdministratorRoute(db, request("PUT", JSON.stringify({ formatVersion: 1, apiKey: KEY })), id,
      { kind: "eventor" }, services, environment)).status).toBe(409);
    expect((await raceAdministratorRoute(db, request("POST", "{}"), id, { kind: "eventor" }, services, environment)).status).toBe(405);
    // Skrivningar kräver rätt Origin.
    expect((await raceAdministratorRoute(db, request("PUT", "{}", { origin: "https://annan.example" }), id, { kind: "eventor" },
      services, environment)).status).toBe(403);
  });

  it("visar Eventors läge i stället för skillnader när källan inte kan läsas", async () => {
    const eventorSyncPreview = vi.fn<typeof Application.previewEventorSyncAsAdministrator>()
      .mockResolvedValue({ status: "eventor", outcome: "NO_EVENT" });
    const response = await raceAdministratorRoute(db, bare("POST"), id, { kind: "eventor-sync-preview" },
      { ...dependencies(), eventorSyncPreview }, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ formatVersion: 1, raceId: id, problem: "NO_EVENT" });
  });

  it("läser banfilen som XML med filnamn och svarar 422 för fel filtyp", async () => {
    const courseFilePreview = vi.fn<typeof Application.previewCourseFileAsAdministrator>().mockResolvedValue({ status: "invalid-iof-xml" });
    const services = { ...dependencies(), courseFilePreview };
    const response = await raceAdministratorRoute(db, bare("POST", "<CourseData/>", { "content-type": "application/xml",
      "x-otid-file-name": encodeURIComponent("Höstsprinten bana.xml") }), id, { kind: "course-file-preview" }, services, environment);
    expect(response.status).toBe(422);
    expect(courseFilePreview.mock.calls[0]![1]).toMatchObject({ xml: "<CourseData/>", fileName: "Höstsprinten bana.xml" });
    expect((await raceAdministratorRoute(db, bare("POST", "{}", { "content-type": "application/json" }), id,
      { kind: "course-file-preview" }, services, environment)).status).toBe(400);
  });

  it("godkännande kräver idempotensnyckel som binder begäran; ändrat besked ger 409", async () => {
    const body = { formatVersion: 1 as const, requestId: id, snapshotId: other, expectedSnapshotVersion: 3, excludedRowIds: ["r0123456789ab"],
      confirmResultChanges: true };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, source: "EVENTOR" as const, snapshotId: other,
      request: body, appliedRows: 4, recalculatedCount: 1, snapshotVersionAfter: 4, appliedAt: "2026-10-18T09:41:00.000Z" };
    const syncApply = vi.fn<typeof Application.applySyncAsAdministrator>().mockResolvedValue({ status: "saved", response: receipt });
    const services = { ...dependencies(), syncApply };
    const action = { kind: "source-sync" as const };
    const saved = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `source-sync:${id}` }),
      id, action, services, environment);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(receipt);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `source-sync:${other}` }),
      id, action, services, environment)).status).toBe(400);
    syncApply.mockResolvedValueOnce({ status: "confirmation-required", consequence: { readOutCount: 1, becomesOkCount: 1,
      becomesMispunchedCount: 0, unchangedCount: 0, notRecalculatedCount: 0, changes: [], cardsAfterReadout: [], requiresConfirmation: true } });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `source-sync:${id}` }),
      id, action, services, environment)).status).toBe(409);
  });
});
