import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clubBase, clubFailure, clubRequest, csrf } from "./club-request";
import { HttpStatusError } from "./http-status-error";
import { HttpStatusError as SyncHttpStatusError } from "./course-setting-sync";

describe("club-request och http-status-error", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "" });
    vi.stubGlobal("window", { location: { href: "https://otid.example/kartbank" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("kodar clubBase och läser CSRF-kakan utan tunga beroenden", () => {
    expect(clubBase("club/1")).toBe("/api/organizer/clubs/club%2F1");
    expect(csrf()).toBeUndefined();
    const token = "a".repeat(43);
    vi.stubGlobal("document", { cookie: `__Host-otid-organizer-csrf=${token}` });
    expect(csrf()).toBe(token);
  });

  it("vägrar muterande anrop utan CSRF-kaka med 401 och skickar x-otid-csrf när kakan finns", async () => {
    expect(await clubRequest("/api/organizer/clubs", "POST", { name: "Test" })).toEqual({ status: 401, json: undefined });
    expect(fetchMock).not.toHaveBeenCalled();

    const token = "b".repeat(43);
    vi.stubGlobal("document", { cookie: `__Host-otid-organizer-csrf=${token}` });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    expect(await clubRequest("/api/organizer/clubs", "POST", { name: "Test" })).toEqual({ status: 201, json: { ok: true } });
    expect(fetchMock).toHaveBeenCalledWith("/api/organizer/clubs", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-otid-csrf": token }
    }));
  });

  it("hanterar GET utan CSRF och tomma eller icke-JSON-svar", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await clubRequest("/api/organizer/clubs")).toEqual({ status: 204, json: undefined });
    fetchMock.mockResolvedValueOnce(new Response("inte-json", { status: 502 }));
    expect(await clubRequest("/api/organizer/clubs")).toEqual({ status: 502, json: undefined });
    expect(clubFailure(401)).toBeTruthy();
    expect(clubFailure(500)).toContain("500");
  });

  it("delar exakt samma HttpStatusError-klass mellan http-status-error och course-setting-sync", () => {
    const error = new HttpStatusError(409);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SyncHttpStatusError);
    expect(error.status).toBe(409);
    expect(HttpStatusError).toBe(SyncHttpStatusError);
  });
});
