import { describe, expect, it, vi } from "vitest";
import type { loadRaceNavigationFacts } from "@o-tid/application";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, dependencies, environment, id, token } from "./race-administrator-route-test-helpers";

/** Tävlingsraden (ADR-0227 tillägg 2026-11-18): avläsningens Byt funktion läser rollen, typen och datumet. */
const get = () => new Request("https://otid.example/api/admin", { headers: { cookie: `__Host-otid-organizer-session=${token}` } });
const facts = { eventName: "Natt-KM", raceName: "", raceDate: "2026-12-09", timeZone: "Europe/Stockholm", raceType: "STANDARD" as const };

describe("administratörsroutes: tävlingsradens uppgifter", () => {
  it("ger rollen och banläggningens nivå med arrangemangets uppgifter; utan roll 401", async () => {
    const services = { ...dependencies(), raceNavigationFacts: vi.fn<typeof loadRaceNavigationFacts>().mockResolvedValue(facts) };
    const navigation = () => raceAdministratorRoute(db, get(), id, { kind: "navigation" }, services, environment);
    expect(await (await navigation()).json()).toEqual({ raceId: id, ...facts, role: "ADMIN", courseSetting: "EDIT" });
    services.authenticate.mockResolvedValueOnce({ status: "authenticated", principal: { accountId: id, raceId: id, eventId: id, grantId: id,
      grantRole: "FUNCTIONARY", role: "FUNCTIONARY", sessionId: id, expiresAt: "2099-01-01T00:00:00.000Z" } });
    services.authenticateCourseSetting.mockResolvedValueOnce({ status: "unauthorized" });
    expect(await (await navigation()).json()).toEqual({ raceId: id, ...facts, role: "FUNCTIONARY" });
    expect(services.authenticate).toHaveBeenLastCalledWith(db, expect.objectContaining({ role: "FUNCTIONARY" }));
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await navigation()).status).toBe(401);
  });
});
