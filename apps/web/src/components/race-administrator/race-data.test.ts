import { afterEach, describe, expect, it, vi } from "vitest";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import type { MobileNavigation } from "./navigation";
import { createRaceDataActions } from "./race-data";
import type { Operation } from "./types";
import type { Base } from "./workspace-state";

const RACE_ID = "10000000-0000-4000-8000-000000000001";
const BASE = `/api/admin/races/${RACE_ID}/administrator`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const VALID_CANDIDATES = {
  formatVersion: 2 as const,
  raceId: RACE_ID,
  eventName: "Höstträning",
  raceName: "",
  snapshotVersion: 1,
  raceDate: "2026-11-27",
  raceType: "TRAINING" as const,
  publication: { shortCode: "abc234", publishedAt: null, hiddenBySuperadmin: false },
  generatedAt: "2026-11-27T10:00:00Z",
  timeZone: "Europe/Stockholm",
  classes: [],
  entries: []
};

function makeHarness(sessionRequest: (path: string, op: Operation) => Promise<Response>) {
  const op: Operation = { generation: 1, controller: new AbortController(), timer: setTimeout(() => undefined, 60_000) };
  const setData = vi.fn();
  const setRole = vi.fn();
  const setCourseSetting = vi.fn();
  const setExpiresAt = vi.fn();
  const setAuthenticated = vi.fn();
  const setMessage = vi.fn();
  const lock = vi.fn(() => { op.controller.abort(); });
  const ws = {
    base: BASE,
    raceId: RACE_ID,
    entryId: "",
    adminText: raceAdministratorSv,
    pending: { current: undefined },
    writingRef: { current: false },
    deadline: { current: 0 },
    setEffectiveResult: vi.fn(),
    setEffectiveResultError: vi.fn(),
    setData,
    setEntryChanges: vi.fn(),
    setIdentityCandidates: vi.fn(),
    setSelectedClassId: vi.fn(),
    setExpiresAt,
    setAuthenticated,
    setMobilePanel: vi.fn(),
    setMessage,
    setEntryId: vi.fn(),
    setClassId: vi.fn(),
    setPage: vi.fn(),
    setNewCard: vi.fn(),
    setRole,
    setCourseSetting,
    lock,
    request: vi.fn(sessionRequest),
    json: vi.fn(async (response: Response) => response.json() as Promise<unknown>),
    assertCurrent: vi.fn((currentOp: Operation) => {
      if (currentOp.controller.signal.aborted) throw new Error("Superseded request");
    }),
    current: vi.fn(() => true),
    begin: vi.fn(() => op),
    finish: vi.fn(),
    requireSession: vi.fn(() => true),
    showMobilePanel: vi.fn()
  } as unknown as Base & MobileNavigation;
  return { ws, op, setData, setRole, setCourseSetting, setExpiresAt, setAuthenticated, setMessage, lock };
}

describe("race-data: parallell /session + /transfer-candidates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("startar /session och /transfer-candidates parallellt och autentiserar i en RTT", async () => {
    const sessionDef = deferred<Response>();
    const candidatesDef = deferred<Response>();
    const started: string[] = [];

    vi.stubGlobal("fetch", vi.fn((input: string) => {
      started.push(input);
      return candidatesDef.promise;
    }));
    const h = makeHarness((path) => {
      started.push(`${BASE}${path}`);
      return sessionDef.promise;
    });
    const actions = createRaceDataActions(h.ws);

    const run = actions.session(h.op);
    expect(started).toEqual([`${BASE}/session`, `${BASE}/transfer-candidates`]);

    sessionDef.resolve(new Response(JSON.stringify({
      formatVersion: 1, raceId: RACE_ID, role: "ADMIN", expiresAt: "2099-01-01T12:00:00Z", courseSetting: "EDIT"
    }), { status: 200 }));
    candidatesDef.resolve(new Response(JSON.stringify(VALID_CANDIDATES), { status: 200 }));

    await run;
    clearTimeout(h.op.timer);
    expect(h.setRole).toHaveBeenCalledWith("ADMIN");
    expect(h.setCourseSetting).toHaveBeenCalledWith("EDIT");
    expect(h.setData).toHaveBeenCalledWith(VALID_CANDIDATES);
    expect(h.setAuthenticated).toHaveBeenCalledWith(true);
    expect(h.lock).not.toHaveBeenCalled();
  });

  it("ignorerar 403 på /transfer-candidates när banläggare skickas vidare till /course-setting", async () => {
    const sessionDef = deferred<Response>();
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    // /transfer-candidates svarar 403 direkt (före /session) — får inte anropa lock() eller avbryta /session!
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 })));

    const h = makeHarness(() => sessionDef.promise);
    const actions = createRaceDataActions(h.ws);
    const run = actions.session(h.op);

    // Låt 403-svaret på /transfer-candidates avgöras före /session.
    await Promise.resolve();
    expect(h.lock).not.toHaveBeenCalled();
    expect(h.op.controller.signal.aborted).toBe(false);

    sessionDef.resolve(new Response(JSON.stringify({
      formatVersion: 1, raceId: RACE_ID, authenticated: false, courseSetting: "EDIT"
    }), { status: 200 }));

    await expect(run).rejects.toThrow("No race session");
    clearTimeout(h.op.timer);
    expect(replace).toHaveBeenCalledWith(`/admin/${encodeURIComponent(RACE_ID)}/course-setting`);
    expect(h.lock).not.toHaveBeenCalled();
    expect(h.setAuthenticated).not.toHaveBeenCalled();
  });

  it("ignorerar 401 på /transfer-candidates när användaren är utloggad", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const h = makeHarness(async () => new Response(JSON.stringify({
      formatVersion: 1, raceId: RACE_ID, authenticated: false
    }), { status: 200 }));
    const actions = createRaceDataActions(h.ws);

    await expect(actions.session(h.op)).rejects.toThrow("No race session");
    clearTimeout(h.op.timer);
    expect(h.lock).not.toHaveBeenCalled();
  });

  it("låser arbetsytan om /session godkänns men /transfer-candidates ändå svarar 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    const h = makeHarness(async () => new Response(JSON.stringify({
      formatVersion: 1, raceId: RACE_ID, role: "ADMIN", expiresAt: "2099-01-01T12:00:00Z"
    }), { status: 200 }));
    const actions = createRaceDataActions(h.ws);

    await expect(actions.session(h.op)).rejects.toThrow("Unauthorized");
    clearTimeout(h.op.timer);
    expect(h.lock).toHaveBeenCalledTimes(1);
    expect(h.setAuthenticated).not.toHaveBeenCalled();
  });
});
