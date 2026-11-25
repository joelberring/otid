import { describe, expect, it } from "vitest";
import type { LocalTrack } from "../../lib/map-project-track-store";
import { flushReconTracks, type ReconFlushDeps } from "./use-map-project-recon";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const BASE = `/api/map-projects/${PROJECT_ID}`;

function makeTrack(overrides: Partial<LocalTrack> = {}): LocalTrack {
  return {
    trackId: "00000000-0000-4000-8000-000000000010",
    projectId: PROJECT_ID,
    accountId: ACCOUNT_ID,
    name: "Rekning",
    source: "FIELD",
    startedAt: "2026-11-25T10:00:00.000Z",
    parts: [[[59.3, 18.0, 0, 5]]],
    open: [],
    sent: 0,
    created: true,
    ...overrides
  };
}

describe("use-map-project-recon: flushReconTracks", () => {
  it("skickar alltid endedAt även när alla delar redan var skickade (sent === parts.length)", async () => {
    const store = new Map<string, LocalTrack>();
    const track = makeTrack({ sent: 1, endedAt: "2026-11-25T10:05:00.000Z" });
    store.set(track.trackId, track);
    const calls: { url: string; method: string; body: unknown }[] = [];
    const deps: ReconFlushDeps = {
      base: BASE, projectId: PROJECT_ID, accountId: ACCOUNT_ID,
      request: async (url, method = "GET", body?: unknown) => {
        calls.push({ url, method, body });
        return { status: 200, json: {} };
      },
      listLocal: async () => [...store.values()],
      putLocal: async (t) => { store.set(t.trackId, t); },
      deleteLocal: async (id) => { store.delete(id); },
      getRecording: () => undefined,
      setRecordingLive: () => undefined,
      ended: new Map([[track.trackId, track]]),
      discarded: new Set(),
      endedSent: new Set()
    };

    await flushReconTracks(deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: `${BASE}/tracks/${track.trackId}/parts`,
      method: "POST",
      body: { seq: 1, points: [[59.3, 18.0, 0, 5]], endedAt: "2026-11-25T10:05:00.000Z" }
    });
    expect(store.size).toBe(0);
  });

  it("skickar endedAt när stopRecording sker medan sista POST /parts pågår", async () => {
    const store = new Map<string, LocalTrack>();
    let recording: LocalTrack | undefined = makeTrack({ sent: 0, endedAt: undefined });
    store.set(recording.trackId, recording);
    const ended = new Map<string, LocalTrack>();
    const calls: { method: string; body: unknown }[] = [];
    const deps: ReconFlushDeps = {
      base: BASE, projectId: PROJECT_ID, accountId: ACCOUNT_ID,
      request: async (_url, method = "GET", body?: unknown) => {
        calls.push({ method, body });
        // Under första POST /parts (utan endedAt) trycker användaren Stopp.
        if (calls.length === 1 && recording) {
          const stopped: LocalTrack = { ...recording, endedAt: "2026-11-25T10:06:00.000Z" };
          recording = undefined;
          ended.set(stopped.trackId, stopped);
        }
        return { status: 200, json: {} };
      },
      listLocal: async () => [...store.values()],
      putLocal: async (t) => { store.set(t.trackId, t); },
      deleteLocal: async (id) => { store.delete(id); },
      getRecording: () => recording,
      setRecordingLive: (t) => { recording = t; },
      ended,
      discarded: new Set(),
      endedSent: new Set()
    };

    await flushReconTracks(deps);
    expect(calls).toHaveLength(2);
    expect((calls[0]!.body as { endedAt?: string }).endedAt).toBeUndefined();
    expect(calls[1]!.body).toMatchObject({ seq: 1, endedAt: "2026-11-25T10:06:00.000Z" });
    expect(store.size).toBe(0);
  });

  it("raderar ett tomt avslutat spår på servern när POST /tracks redan skapat det", async () => {
    const store = new Map<string, LocalTrack>();
    const empty = makeTrack({ parts: [], sent: 0, created: true, endedAt: "2026-11-25T10:01:00.000Z" });
    store.set(empty.trackId, empty);
    const calls: { url: string; method: string }[] = [];
    const deps: ReconFlushDeps = {
      base: BASE, projectId: PROJECT_ID, accountId: ACCOUNT_ID,
      request: async (url, method = "GET") => {
        calls.push({ url, method });
        return { status: 200, json: {} };
      },
      listLocal: async () => [...store.values()],
      putLocal: async (t) => { store.set(t.trackId, t); },
      deleteLocal: async (id) => { store.delete(id); },
      getRecording: () => undefined,
      setRecordingLive: () => undefined,
      ended: new Map(),
      discarded: new Set([empty.trackId]),
      endedSent: new Set()
    };

    await flushReconTracks(deps);
    expect(calls).toEqual([{ url: `${BASE}/tracks/${empty.trackId}`, method: "DELETE" }]);
    expect(store.size).toBe(0);
  });
});
