import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "./workspace-state";
import { saveClassMassStart } from "./class-mass-start";

const RACE_ID = "10000000-0000-4000-8000-000000000000";
const CLASS_ID = "10000000-0000-4000-8000-000000000001";
const T1910 = "2026-11-28T18:10:00.000Z";
const T1911 = "2026-11-28T18:11:00.000Z";

function mockWorkspace(options: { previewFirstStart?: string; requiresConfirmation?: boolean; readOutCount?: number; recalculatedCount?: number } = {}) {
  const previewFirstStart = options.previewFirstStart ?? T1910;
  const requiresConfirmation = options.requiresConfirmation ?? false;
  const readOutCount = options.readOutCount ?? 0;
  const recalculatedCount = options.recalculatedCount ?? 0;
  const requests: { path: string; body?: unknown }[] = [];
  const changeClassEdit = vi.fn();
  const readCourses = vi.fn(async () => undefined);
  const load = vi.fn(async () => undefined);
  const finish = vi.fn();

  const ws = {
    writingRef: { current: false },
    pending: { current: undefined },
    requireSession: () => true,
    begin: () => ({ id: 1 }),
    current: () => true,
    finish,
    csrf: () => "csrf-token",
    changeClassEdit,
    readCourses,
    load,
    request: vi.fn(async (path: string, _op: unknown, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      requests.push({ path, body });
      if (path === "/draw" && !init?.method) {
        return {
          ok: true,
          _payload: {
            formatVersion: 1, raceId: RACE_ID, snapshotVersion: 2, raceDate: "2026-11-28", timeZone: "Europe/Stockholm",
            firstStartTime: null,
            classes: [{ id: CLASS_ID, name: "Hyperion herr", courseName: "Bana B", firstControlCode: 31, entryCount: 4,
              method: "FREE", intervalMinutes: 2, vacancies: { kind: "COUNT", value: 0 }, hasStartTimes: false, firstStartTime: null }],
            settings: null, entries: []
          }
        };
      }
      if (path === "/draw-preview") {
        return {
          ok: true,
          _payload: {
            formatVersion: 1, raceId: RACE_ID, snapshotVersion: 2, timeZone: "Europe/Stockholm", seed: 123,
            classes: [{ classId: CLASS_ID, className: "Hyperion herr", method: "MASS", firstStartTime: previewFirstStart,
              intervalMinutes: 1, vacancyCount: 0, replacesStartTimes: requiresConfirmation, slots: [] }],
            startGroups: [], warnings: [], existingClasses: [], timeline: [],
            replacesStartTimes: requiresConfirmation, readOutCount, becomesOkCount: 0, becomesMispunchedCount: 0,
            unchangedCount: readOutCount, notRecalculatedCount: 0, changes: [], requiresConfirmation
          }
        };
      }
      return {
        ok: true,
        _payload: {
          formatVersion: 1, replayed: false, requestId: typeof body?.requestId === "string" ? body.requestId : RACE_ID,
          raceId: RACE_ID, request: body,
          classCount: 1, entryCount: 4, vacancyCount: 0, recalculatedCount,
          snapshotVersionBefore: 2, snapshotVersionAfter: 3, drawnAt: "2026-11-28T17:00:00.000Z"
        }
      };
    }),
    json: vi.fn(async (response: { _payload: unknown }) => response._payload)
  };
  return { ws: ws as unknown as Workspace, requests, changeClassEdit, readCourses, load, finish };
}

describe("saveClassMassStart i Klasser → Redigera", () => {
  it("godtar 19.10 och 1910, skickar explicit laterStart och rapporterar faktiskt sparad tid", async () => {
    for (const raw of ["19:10", "19.10", "1910"]) {
      const { ws, requests, changeClassEdit, readCourses, load } = mockWorkspace();
      const outcome = await saveClassMassStart(ws, CLASS_ID, raw, async () => true);
      expect(outcome).toEqual({ kind: "SAVED", clock: "19:10", recalculatedCount: 0 });
      expect(requests[1]).toEqual({
        path: "/draw-preview",
        body: {
          formatVersion: 1, firstStartTime: T1910, clubSeparation: false,
          classes: [{ classId: CLASS_ID, method: "MASS", intervalMinutes: 1, vacancies: { kind: "COUNT", value: 0 },
            laterStart: { kind: "CLOCK", startTime: T1910 } }]
        }
      });
      expect(changeClassEdit).toHaveBeenCalledWith({ startRule: "FIXED" });
      expect(readCourses).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledTimes(1);
    }
  });

  it("ljuger aldrig om sparad tid: visar faktiskt returnerad tid från förhandsvisningen och omräknade resultat", async () => {
    const { ws } = mockWorkspace({ previewFirstStart: T1911, requiresConfirmation: true, readOutCount: 3, recalculatedCount: 3 });
    const confirm = vi.fn(async () => true);
    const outcome = await saveClassMassStart(ws, CLASS_ID, "19:10", confirm);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ readOutCount: 3 }), "19:11");
    expect(outcome).toEqual({ kind: "SAVED", clock: "19:11", recalculatedCount: 3 });
  });

  it("avvisar ogiltiga klockslag och sekunder samt avbryter vid nekad bekräftelse", async () => {
    const invalid = mockWorkspace();
    expect(await saveClassMassStart(invalid.ws, CLASS_ID, "19:10:30", async () => true)).toEqual({ kind: "INVALID" });
    expect(await saveClassMassStart(invalid.ws, CLASS_ID, "abc", async () => true)).toEqual({ kind: "INVALID" });
    expect(invalid.requests).toEqual([]);

    const cancelled = mockWorkspace({ requiresConfirmation: true });
    expect(await saveClassMassStart(cancelled.ws, CLASS_ID, "19:10", async () => false)).toEqual({ kind: "CANCELLED" });
    expect(cancelled.requests).toHaveLength(2); // Bara /draw (GET) och /draw-preview, aldrig sparat!
  });
});
