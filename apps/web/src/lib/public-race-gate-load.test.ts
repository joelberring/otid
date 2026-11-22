import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Granskningen 3.3: lastskyddet för publiken kringgås inte med en påhittad sessionskaka. Bara en session som databasen känner
 * igen går förbi kön; en giltig session minns en kort stund.
 */
const state = vi.hoisted(() => ({ cookie: "", valid: false, authCalls: 0, admits: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: {}, pool: {}, database: {}, publicDb: {}, publicDatabase: {} }));
vi.mock("./public-load", () => ({
  publicBusyResponse: () => new Response(null, { status: 503 }),
  publicLoad: () => ({ admit: async () => { state.admits += 1; return { kind: "admitted", release: () => undefined }; } })
}));
vi.mock("@o-tid/application", () => ({
  authenticateUserAccountSession: async () => { state.authCalls += 1; return { status: state.valid ? "authenticated" : "unauthorized" }; },
  publicRaceGate: async () => ({ access: "PUBLIC", privateCache: false }),
  isRaceStaff: async () => false
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) =>
  state.cookie && name === "otid_organizer_session" ? { name, value: state.cookie } : undefined }) }));

const raceId = "10000000-0000-4000-8000-000000000001";

describe("publikt lastskydd och sessionskakan", () => {
  beforeEach(() => { state.cookie = ""; state.valid = false; state.authCalls = 0; state.admits = 0; });

  it("en påhittad kaka får en plats i kön som alla andra", async () => {
    const { publicRaceResponse } = await import("./public-race-gate");
    state.cookie = "påhittad-kaka-x".replaceAll("å", "a").replaceAll("ä", "a");
    await publicRaceResponse(raceId, () => Response.json({}));
    expect(state.admits).toBe(1);
  });

  it("en giltig session går förbi kön och minns i 30 sekunder", async () => {
    const { publicRaceResponse } = await import("./public-race-gate");
    state.cookie = "giltig-session-1"; state.valid = true;
    await publicRaceResponse(raceId, () => Response.json({}));
    await publicRaceResponse(raceId, () => Response.json({}));
    expect(state.admits).toBe(0);
    expect(state.authCalls).toBe(1);
  });

  it("utan kaka ställs anropet i kön utan att databasen frågas", async () => {
    const { publicRaceResponse } = await import("./public-race-gate");
    await publicRaceResponse(raceId, () => Response.json({}));
    expect(state.admits).toBe(1);
    expect(state.authCalls).toBe(0);
  });
});
