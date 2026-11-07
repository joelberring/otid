import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./course-setting-offline-forget", () => ({ forgetAllCourseSettingCopies: async () => undefined, fieldStore: () => ({ pendingCount: async () => 0 }) }));

const { LOGGED_OUT_PATH, logOut } = await import("./account-logout");

/** Städrundan 2026-11-07: "Du är utloggad" först när servern har spärrat sessionen, också utan CSRF-kakan. */
describe("utloggningen", () => {
  const assign = vi.fn();
  const fetchMock = vi.fn();
  beforeEach(() => {
    assign.mockReset(); fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal("window", { location: { href: "https://otid.example/organizer", assign } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("utan CSRF-kakan frågar den ändå servern och går till Du är utloggad först när servern kvitterat", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await logOut()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/organizer/logout", expect.objectContaining({ method: "POST", headers: {} }));
    expect(assign).toHaveBeenCalledWith(LOGGED_OUT_PATH);
  });

  it("med kakan skickas nyckeln; 401 (sessionen redan slut) räknas som utloggad", async () => {
    vi.stubGlobal("document", { cookie: `__Host-otid-organizer-csrf=${"c".repeat(43)}` });
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect(await logOut()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/organizer/logout", expect.objectContaining({ headers: { "x-otid-csrf": "c".repeat(43) } }));
    expect(assign).toHaveBeenCalledWith(LOGGED_OUT_PATH);
  });

  it("svarar servern med fel visas felet och ingen utloggning; ett nätverksfel kastas", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    expect(await logOut()).toEqual({ ok: false, status: 500 });
    fetchMock.mockRejectedValue(new TypeError("nätet"));
    await expect(logOut()).rejects.toThrow("nätet");
    expect(assign).not.toHaveBeenCalled();
  });

  it("från alla enheter utan kakan: ett fel, inget påstås", async () => {
    expect(await logOut({ everywhere: true })).toEqual({ ok: false, status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
