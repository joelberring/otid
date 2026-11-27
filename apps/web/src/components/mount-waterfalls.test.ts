import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { CourseSettingState } from "@o-tid/contracts";
import { organizerSv } from "../i18n/organizer-sv";
import { HttpError } from "../lib/course-setting-api";
import type { FieldRecord } from "../lib/course-setting-offline";

// Modulkonstanter med JSX i importerade komponenter (t.ex. app-icons.tsx) körs vid import och kräver React globalt i Vitest.
(globalThis as { React?: typeof React }).React = React;

const [{ loadCourseSettingMount }, { loadInvitationMount }, { loadMapProjectJoinMount }, { loadOrganizerSessionWithEvents }] = await Promise.all([
  import("./course-setting/course-setting-page"),
  import("./invitation-page"),
  import("./map-project/map-project-join-page"),
  import("./organizer-workspace")
]);

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const RACE_ID = "20000000-0000-4000-8000-000000000002";
const TOKEN = "a".repeat(43);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const VALID_SESSION = {
  formatVersion: 1 as const,
  accountId: ACCOUNT_ID,
  email: "anna@exempel.se",
  displayName: "Anna",
  superadmin: false,
  expiresAt: "2099-01-01T12:00:00Z",
  emailVerified: true
};

describe("parallella mount-vattenfall (Etapp P4B)", () => {
  describe("organizer-workspace: loadOrganizerSessionWithEvents", () => {
    it("startar /session och /events parallellt och returnerar förhämtat /events-svar när inloggad", async () => {
      const sessionDef = deferred<Response>();
      const eventsDef = deferred<Response>();
      const started: string[] = [];
      const fetchImpl = vi.fn((input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        started.push(url);
        return url.endsWith("/session") ? sessionDef.promise : eventsDef.promise;
      }) as unknown as typeof fetch;

      const run = loadOrganizerSessionWithEvents(organizerSv, { fetchImpl, takeNext: () => undefined });
      // Båda anropen ska ha startat innan något svar kommit.
      expect(started).toEqual(["/api/organizer/session", "/api/organizer/events"]);

      const eventsResponse = new Response(JSON.stringify({ formatVersion: 1, events: [] }), { status: 200 });
      sessionDef.resolve(new Response(JSON.stringify(VALID_SESSION), { status: 200 }));
      eventsDef.resolve(eventsResponse);

      const result = await run;
      expect(result.kind).toBe("signed-in");
      if (result.kind === "signed-in") {
        expect(result.session.email).toBe("anna@exempel.se");
        expect(result.events).toEqual({ status: "fulfilled", value: eventsResponse });
      }
    });

    it("ignorerar 401/403 och nätfel på /events när sessionen inte är inloggad", async () => {
      const fetch401 = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/session")) return new Response(JSON.stringify({ formatVersion: 1, authenticated: false }), { status: 200 });
        return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 });
      }) as unknown as typeof fetch;
      expect(await loadOrganizerSessionWithEvents(organizerSv, { fetchImpl: fetch401, takeNext: () => undefined })).toEqual({ kind: "signed-out" });

      const fetchNetworkFail = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/session")) return new Response(null, { status: 401 });
        throw new TypeError("offline");
      }) as unknown as typeof fetch;
      expect(await loadOrganizerSessionWithEvents(organizerSv, { fetchImpl: fetchNetworkFail, takeNext: () => undefined })).toEqual({ kind: "signed-out" });
    });

    it("returnerar redirect direkt utan att falla på /events när takeNext finns", async () => {
      const fetchImpl = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.endsWith("/session")) return new Response(JSON.stringify(VALID_SESSION), { status: 200 });
        return new Response(null, { status: 500 });
      }) as unknown as typeof fetch;
      const result = await loadOrganizerSessionWithEvents(organizerSv, { fetchImpl, takeNext: () => "/admin/next" });
      expect(result).toEqual({ kind: "redirect", session: VALID_SESSION, next: "/admin/next" });
    });
  });

  describe("course-setting-page: loadCourseSettingMount", () => {
    const serverState = {
      formatVersion: 1,
      raceId: RACE_ID,
      raceType: "STANDARD",
      setting: { version: 3 },
      mapFile: null,
      access: { admin: true, level: "EDIT" }
    } as unknown as CourseSettingState;
    const phoneCopy = {
      raceId: RACE_ID,
      savedAt: "2026-11-27T01:00:00Z",
      state: serverState,
      log: [{ kind: "note" }],
      inFlight: undefined
    } as unknown as FieldRecord;

    it("kör phoneRecord och fetchCourseSetting parallellt med Promise.allSettled och behåller väntande telefonlogg", async () => {
      const phoneDef = deferred<FieldRecord | undefined>();
      const fetchDef = deferred<CourseSettingState>();
      const started: string[] = [];
      const run = loadCourseSettingMount(
        RACE_ID,
        () => { started.push("phone"); return phoneDef.promise; },
        () => { started.push("server"); return fetchDef.promise; }
      );
      expect(started).toEqual(["phone", "server"]);
      phoneDef.resolve(phoneCopy);
      fetchDef.resolve(serverState);
      expect(await run).toEqual({ kind: "server", state: serverState, pending: phoneCopy });
    });

    it("öppnar ur telefonen vid nätfel/401/500, men raderar telefonkopian och ger role-fel vid 403", async () => {
      const offline = await loadCourseSettingMount(RACE_ID, async () => phoneCopy, async () => { throw new TypeError("offline"); });
      expect(offline).toEqual({ kind: "phone", record: phoneCopy });

      const unauthWithPhone = await loadCourseSettingMount(RACE_ID, async () => phoneCopy, async () => { throw new HttpError(401); });
      expect(unauthWithPhone).toEqual({ kind: "phone", record: phoneCopy });

      const forbidden = await loadCourseSettingMount(RACE_ID, async () => phoneCopy, async () => { throw new HttpError(403); });
      expect(forbidden).toEqual({ kind: "failed", reason: "role", forgetPhone: true });

      const unauthWithoutPhone = await loadCourseSettingMount(RACE_ID, async () => undefined, async () => { throw new HttpError(401); });
      expect(unauthWithoutPhone).toEqual({ kind: "failed", reason: "login", forgetPhone: false });
    });
  });

  describe("invitation-page: loadInvitationMount", () => {
    const validView = {
      formatVersion: 1 as const,
      status: "valid" as const,
      kind: "RACE" as const,
      targetName: "Höstträning",
      raceDate: "2026-11-27",
      role: "ADMIN" as const,
      inviterName: "Kim",
      email: "anna@exempel.se",
      next: `/admin/${RACE_ID}/manage`,
      expiresAt: "2099-01-01T12:00:00Z"
    };

    it("kör POST /api/invitation och GET /api/organizer/session parallellt i Promise.all", async () => {
      const inviteDef = deferred<{ status: number; json: unknown }>();
      const sessionDef = deferred<Response>();
      const started: string[] = [];
      const request = vi.fn((path: string) => { started.push(path); return inviteDef.promise; });
      const fetchImpl = vi.fn((input: string | URL | Request) => {
        started.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        return sessionDef.promise;
      }) as unknown as typeof fetch;

      const run = loadInvitationMount(TOKEN, { request, fetchImpl });
      expect(started).toEqual(["/api/invitation", "/api/organizer/session"]);

      inviteDef.resolve({ status: 200, json: validView });
      sessionDef.resolve(new Response(JSON.stringify({ ...VALID_SESSION, emailVerified: false }), { status: 200 }));

      expect(await run).toEqual({
        state: { kind: "valid", view: validView },
        sessionEmail: "anna@exempel.se",
        sessionVerified: false
      });
    });

    it("visar inbjudan även när sessionskollen misslyckas", async () => {
      const result = await loadInvitationMount(TOKEN, {
        request: async () => ({ status: 200, json: validView }),
        fetchImpl: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch
      });
      expect(result).toEqual({ state: { kind: "valid", view: validView }, sessionEmail: undefined, sessionVerified: true });
    });
  });

  describe("map-project-join-page: loadMapProjectJoinMount", () => {
    const validLink = {
      formatVersion: 1 as const,
      status: "valid" as const,
      projectName: "Högdalen",
      role: "EDIT" as const,
      inviterName: "Kim",
      expiresAt: "2099-01-01T12:00:00Z"
    };

    it("kör POST /api/map-project-link och GET /api/organizer/session parallellt i Promise.all", async () => {
      const linkDef = deferred<{ status: number; json: unknown }>();
      const sessionDef = deferred<Response>();
      const started: string[] = [];
      const request = vi.fn((path: string) => { started.push(path); return linkDef.promise; });
      const fetchImpl = vi.fn((input: string | URL | Request) => {
        started.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        return sessionDef.promise;
      }) as unknown as typeof fetch;

      const run = loadMapProjectJoinMount(TOKEN, { request, fetchImpl });
      expect(started).toEqual(["/api/map-project-link", "/api/organizer/session"]);

      linkDef.resolve({ status: 200, json: validLink });
      sessionDef.resolve(new Response(JSON.stringify(VALID_SESSION), { status: 200 }));

      expect(await run).toEqual({
        state: { kind: "valid", view: validLink },
        signedIn: true,
        verified: true
      });
    });

    it("returnerar failed när kartlänksuppslaget misslyckas (så adressens hash inte rensas)", async () => {
      const result = await loadMapProjectJoinMount(TOKEN, {
        request: async () => { throw new TypeError("offline"); },
        fetchImpl: (async () => new Response(JSON.stringify(VALID_SESSION), { status: 200 })) as unknown as typeof fetch
      });
      expect(result).toEqual({ state: { kind: "failed" } });
    });
  });
});
