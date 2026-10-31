import { describe, expect, it, vi } from "vitest";
import type * as Application from "@o-tid/application";
import { routeChoicePublishRequestSchema, routeChoiceSettingsSchema } from "@o-tid/contracts";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { csrf, db, dependencies, environment, id, request, token } from "./race-administrator-route-test-helpers";

/** Steg 60: vägvalsanalysens routes (läge, inställningar, publicering, kalibreringens rutter) och kontraktet. */
const sha = "a".repeat(64);
const state = { formatVersion: 1 as const, raceId: id, settings: { version: 1 as const }, mapFile: null, controls: [], courses: [], published: [],
  publishedMapSha256: null };
const get = () => new Request("https://otid.example/api/admin", { headers: { cookie: `__Host-otid-organizer-session=${token}` } });

describe("vägvalens kontrakt", () => {
  it("tar emot giltiga inställningar och avvisar okända klasser, fel version och orimliga tal", () => {
    expect(routeChoiceSettingsSchema.safeParse({ version: 1, classBySymbol: { "406": "SLOW", "105.100": "IGNORE" }, speedByClass: { FAST: 1.3 },
      contourIntervalMeters: 2.5, climbFactor: 8, referencePaceSecondsPerKm: 330 }).success).toBe(true);
    for (const settings of [{ version: 2 }, { version: 1, classBySymbol: { "406": "TURBO" } }, { version: 1, classBySymbol: { abc: "SLOW" } },
      { version: 1, speedByClass: { IMPASSABLE: 0 } }, { version: 1, contourIntervalMeters: 0 }, { version: 1, extra: true }]) {
      expect(routeChoiceSettingsSchema.safeParse(settings).success, JSON.stringify(settings)).toBe(false);
    }
  });

  it("publicering kräver sträcknycklar som sträcktidstabellens och minst två punkter", () => {
    const base = { formatVersion: 1, kind: "PUBLISH", mapSha256: sha, courseId: id, variantCode: null };
    expect(routeChoicePublishRequestSchema.safeParse({ ...base, legs: [{ key: "S-31.1", points: [[0, 0], [1, 1]] }] }).success).toBe(true);
    expect(routeChoicePublishRequestSchema.safeParse({ ...base, legs: [{ key: "31-32", points: [[0, 0], [1, 1]] }] }).success).toBe(false);
    expect(routeChoicePublishRequestSchema.safeParse({ ...base, legs: [{ key: "S-31.1", points: [[0, 0]] }] }).success).toBe(false);
    expect(routeChoicePublishRequestSchema.safeParse({ ...base, legs: [] }).success).toBe(false);
    expect(routeChoicePublishRequestSchema.safeParse({ formatVersion: 1, kind: "WITHDRAW", courseId: id, variantCode: "AC" }).success).toBe(true);
  });
});

describe("administratörsroutes: vägvalen", () => {
  it("ger läget och sparar inställningarna", async () => {
    const routeChoice = vi.fn<typeof Application.readRouteChoiceAsAdmin>().mockResolvedValue({ status: "ok", response: state });
    const routeChoiceSettings = vi.fn<typeof Application.saveRouteChoiceSettingsAsAdmin>()
      .mockResolvedValue({ status: "ok", settings: { version: 1, climbFactor: 10 } });
    const services = { ...dependencies(), routeChoice, routeChoiceSettings };
    const read = await raceAdministratorRoute(db, get(), id, { kind: "route-choice" }, services, environment);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(await read.json()).toEqual(state);
    const body = JSON.stringify({ formatVersion: 1, settings: { version: 1, climbFactor: 10 } });
    const saved = await raceAdministratorRoute(db, request("POST", body), id, { kind: "route-choice-settings" }, services, environment);
    expect(saved.status).toBe(200);
    expect(routeChoiceSettings.mock.calls[0]![1]).toMatchObject({ raceId: id, csrfHeader: csrf, request: { settings: { climbFactor: 10 } } });
    const invalid = JSON.stringify({ formatVersion: 1, settings: { version: 1, climbFactor: "många" } });
    expect((await raceAdministratorRoute(db, request("POST", invalid), id, { kind: "route-choice-settings" }, services, environment)).status).toBe(400);
    expect(routeChoiceSettings).toHaveBeenCalledTimes(1);
    expect((await raceAdministratorRoute(db, request("POST", body, { origin: "https://annan.example" }), id, { kind: "route-choice-settings" },
      services, environment)).status).toBe(403);
  });

  it("publicerar med 204 och ger begripliga fel som 422", async () => {
    const routeChoicePublish = vi.fn<typeof Application.publishRouteChoiceAsAdmin>().mockResolvedValue({ status: "ok", published: 1 });
    const services = { ...dependencies(), routeChoicePublish };
    const body = JSON.stringify({ formatVersion: 1, kind: "PUBLISH", mapSha256: sha, courseId: id, variantCode: null,
      legs: [{ key: "31.1-32.1", points: [[15, 42], [42, 61]] }] });
    expect((await raceAdministratorRoute(db, request("POST", body), id, { kind: "route-choice-published" }, services, environment)).status).toBe(204);
    routeChoicePublish.mockResolvedValueOnce({ status: "problem", problem: "MAP_FILE_CHANGED" });
    const changed = await raceAdministratorRoute(db, request("POST", body), id, { kind: "route-choice-published" }, services, environment);
    expect(changed.status).toBe(422);
    expect(await changed.json()).toEqual({ formatVersion: 1, error: "MAP_FILE_CHANGED" });
  });

  it("ger kalibreringens rutter per bana och kräver administratör för allt", async () => {
    const routeChoiceCalibration = vi.fn<typeof Application.readRouteChoiceCalibrationAsAdmin>().mockResolvedValue({ status: "ok",
      response: { formatVersion: 1, raceId: id, courseId: id, runners: [] } });
    const services = { ...dependencies(), routeChoiceCalibration };
    expect((await raceAdministratorRoute(db, get(), id, { kind: "route-choice-calibration", courseId: id }, services, environment)).status).toBe(200);
    expect(routeChoiceCalibration.mock.calls[0]![1]).toMatchObject({ courseId: id });
    expect((await raceAdministratorRoute(db, get(), id, { kind: "route-choice-calibration", courseId: "inte-ett-id" }, services, environment)).status)
      .toBe(400);
    services.authenticate.mockResolvedValue({ status: "authenticated", principal: { accountId: id, sessionId: id, raceId: id, eventId: id,
      grantId: id, grantRole: "FUNCTIONARY", role: "FUNCTIONARY", expiresAt: "2026-09-12T13:00:00Z" } });
    for (const action of [{ kind: "route-choice" as const }, { kind: "route-choice-calibration" as const, courseId: id }]) {
      expect((await raceAdministratorRoute(db, get(), id, action, services, environment)).status).toBe(403);
    }
    expect(services.authenticate.mock.calls.at(-1)![1]).toMatchObject({ role: "ADMIN" });
  });
});
