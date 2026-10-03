import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ database: vi.fn<() => unknown>(), data: vi.fn(), login: vi.fn(), status: vi.fn(), logout: vi.fn() }));
vi.mock("./db", () => ({ get db() { return mocks.database(); } }));
vi.mock("./speaker-board-route-handlers", async (original) => ({
  ...await original<typeof import("./speaker-board-route-handlers")>(),
  speakerBoardDataRoute: mocks.data, speakerBoardLoginRoute: mocks.login,
  speakerBoardSessionStatusRoute: mocks.status, speakerBoardLogoutRoute: mocks.logout
}));
import { GET as data } from "../app/api/admin/races/[raceId]/speaker-board/route";
import { GET as status, POST as login, DELETE as logout } from "../app/api/admin/races/[raceId]/speaker-board-session/route";
const raceId = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks(); mocks.database.mockReturnValue({});
  for (const handler of [mocks.data, mocks.login, mocks.status, mocks.logout]) handler.mockResolvedValue(new Response(null, { status: 204 }));
});
describe("speaker Next route wiring", () => {
  it("rejects noncanonical race IDs before database acquisition or handler calls", async () => {
    for (const handler of [data, status, login, logout]) {
      const response = await handler(new Request("https://otid.example"), { params: Promise.resolve({ raceId: "invalid" }) });
      expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.database).not.toHaveBeenCalled();
    for (const handler of [mocks.data, mocks.login, mocks.status, mocks.logout]) expect(handler).not.toHaveBeenCalled();
  });
  it("binds every Next method to its scoped handler", async () => {
    for (const [handler, target] of [[data, mocks.data], [status, mocks.status], [login, mocks.login], [logout, mocks.logout]] as const) {
      const request = new Request("https://otid.example");
      const response = await handler(request, { params: Promise.resolve({ raceId }) });
      expect(response.status).toBe(204); expect(target).toHaveBeenCalledWith({}, request, raceId);
    }
  });
  it("contains database configuration failures in private generic responses", async () => {
    mocks.database.mockImplementation(() => { throw new Error("PRIVATE_DATABASE_CANARY"); });
    for (const handler of [data, status, login, logout]) {
      const response = await handler(new Request("https://otid.example"), { params: Promise.resolve({ raceId }) });
      expect(response.status).toBe(500); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.text()).toBe('{"formatVersion":1,"error":"INTERNAL_ERROR"}');
    }
  });
});
