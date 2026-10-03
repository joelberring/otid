import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { authenticateUserAccountSession } from "@o-tid/application";
import { publicResultFollowIdempotencyKey } from "@o-tid/contracts";
import { participantPublicResultFollowListRoute, participantPublicResultFollowSetRoute } from "./participant-public-result-follow-route-handlers";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const publicResultId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const session = `otid_user_session_v1.10000000-0000-4000-8000-000000000004.${"b".repeat(43)}`;
const csrf = "c".repeat(43);
const environment = { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://localhost:3000" } as const;
const cookies = `otid_organizer_session=${session}; otid_organizer_csrf=${csrf}`;

describe("TASK153 public result follow routes", () => {
  it("requires same-origin before reading a mutation body", async () => {
    let reads = 0;
    const request = { method: "POST", headers: new Headers({ "content-type": "application/json" }), body: {
      getReader() { reads += 1; throw new Error("body was read"); }
    } } as unknown as Request;
    const set = vi.fn();
    const response = await participantPublicResultFollowSetRoute(db, request, set as never, undefined, environment);
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
    expect(set).not.toHaveBeenCalled();
  });

  it("authenticates, validates the retry key, and returns a private set response", async () => {
    const body = { formatVersion: 1, requestId, raceId, publicResultId, followed: true };
    const set = vi.fn().mockResolvedValue({ status: "ok", response: { ...body, replayed: false } });
    const authenticate = vi.fn().mockResolvedValue({ status: "authenticated", principal: { accountId: raceId } });
    const headers = { origin: environment.O_TID_PUBLIC_ORIGIN, cookie: cookies, "x-otid-csrf": csrf,
      "content-type": "application/json", "idempotency-key": publicResultFollowIdempotencyKey(requestId) };
    const response = await participantPublicResultFollowSetRoute(db, new Request("http://localhost:3000/api/participant/me/follows", {
      method: "POST", headers, body: JSON.stringify(body)
    }), set as never, authenticate as unknown as typeof authenticateUserAccountSession, environment);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ...body, replayed: false });
    expect(authenticate).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken: session, csrfCookie: csrf, csrfHeader: csrf, requireCsrf: true }));
    expect(set).toHaveBeenCalledWith(db, expect.objectContaining({ idempotencyKey: headers["idempotency-key"], request: body }));
  });

  it("validates and privately returns the account list including unavailable targets", async () => {
    const list = vi.fn().mockResolvedValue({ status: "ok", response: { formatVersion: 1, items: [{
      raceId, publicResultId, eventName: "Tävling", raceName: "Medeldistans", result: null
    }] } });
    const response = await participantPublicResultFollowListRoute(db, new Request("http://localhost:3000/api/participant/me/follows", {
      headers: { cookie: `otid_organizer_session=${session}` }
    }), list as never, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ items: [{ raceId, publicResultId, result: null }] });
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken: session }));
  });
});
