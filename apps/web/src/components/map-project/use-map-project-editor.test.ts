import { describe, expect, it, vi } from "vitest";
import { addEdits, emptyClientState } from "@o-tid/map-revision";
import type { StoredClient } from "../../lib/map-project-client-store";
import { runMapProjectSync, sendBatch, type SyncState } from "./use-map-project-editor";

describe("kön till servern", () => {
  it("skickar högst 200 ändringar och inte mer än servern tar emot, men alltid minst en", () => {
    const small = Array.from({ length: 450 }, (_, index) => ({ id: index }));
    expect(sendBatch(small)).toHaveLength(200);
    const big = Array.from({ length: 10 }, (_, index) => ({ id: index, path: "x".repeat(1000) }));
    expect(sendBatch(big, 3500)).toHaveLength(3);
    expect(sendBatch(big, 10)).toHaveLength(1);
    expect(sendBatch([])).toEqual([]);
  });
});

describe("runMapProjectSync (Etapp P3: ingen 5 s idle-ombyggnad vid 0 ändringar)", () => {
  const emptySyncResponse = (seq = 0) => ({
    status: 200,
    json: { formatVersion: 1, seq, status: "OPEN", more: false, results: [], objects: [], openProposals: [] }
  });

  it("hoppar över store() och sync-blinkning på tomma 5 s-pollar efter första lyckade synken", async () => {
    let client: StoredClient = { clientId: "c1", state: emptyClientState() };
    let syncState: SyncState = { kind: "idle" };
    let syncMutations = 0;
    const store = vi.fn((next: StoredClient) => { client = next; });
    const setSync = vi.fn((updater: SyncState | ((previous: SyncState) => SyncState)) => {
      const next = typeof updater === "function" ? updater(syncState) : updater;
      if (next !== syncState) { syncState = next; syncMutations += 1; }
    });
    const syncedOnce = { current: false };
    const alive = { current: true };
    const runner = {
      canEdit: true, syncedOnce, alive,
      getClient: () => client, store, setSync, setNotice: vi.fn(),
      request: vi.fn(async () => emptySyncResponse(0))
    };

    // Första synken visar "syncing" → "idle" (med `at` satt för lagerladdning), men skriver inte till IndexedDB när inget ändrats.
    await runMapProjectSync(runner);
    expect(syncedOnce.current).toBe(true);
    expect(syncState.kind).toBe("idle");
    expect(syncState.at).toBeTypeOf("number");
    expect(syncMutations).toBe(2);
    expect(store).not.toHaveBeenCalled();

    // Efterföljande tom 5 s-poll: varken store(), syncing-blink eller ny SyncState-referens (0 React-omritningar).
    const idleBefore = syncState;
    syncMutations = 0;
    await runMapProjectSync(runner);
    expect(store).not.toHaveBeenCalled();
    expect(syncMutations).toBe(0);
    expect(syncState).toBe(idleBefore);
  });

  it("återhämtar från offline/error på en tom 200-poll och skriver vid nya ändringar", async () => {
    let client: StoredClient = {
      clientId: "c2",
      state: addEdits(emptyClientState(), [{
        editId: "e1", key: "new:1", ref: null,
        state: { kind: "OBJECT", object: { kind: "point", symbol: "101", at: { x: 1, y: 2 }, angle: 0 } },
        kind: "ADD", at: "2026-11-27T00:00:00Z"
      }]).state
    };
    let syncState: SyncState = { kind: "offline", at: 1 };
    const store = vi.fn((next: StoredClient) => { client = next; });
    const setSync = vi.fn((updater: SyncState | ((previous: SyncState) => SyncState)) => {
      syncState = typeof updater === "function" ? updater(syncState) : updater;
    });
    const syncedOnce = { current: true };
    const alive = { current: true };

    await runMapProjectSync({
      canEdit: true, syncedOnce, alive,
      getClient: () => client, store, setSync, setNotice: vi.fn(),
      request: async () => ({
        status: 200,
        json: {
          formatVersion: 1, seq: 1, status: "OPEN", more: false, openProposals: [], objects: [],
          results: [{
            editId: "e1", status: "APPLIED",
            object: { key: "new:1", ref: null, seq: 1, lastEditId: "e1", state: client.state.pending[0]!.state }
          }]
        }
      })
    });
    expect(store).toHaveBeenCalledTimes(1);
    expect(client.state.pending).toHaveLength(0);
    expect(syncState.kind).toBe("idle");

    // Efter ett tillfälligt fel utan nya ändringar ska tom 200-poll återställa till idle.
    syncState = { kind: "error", status: 503, at: 2 };
    await runMapProjectSync({
      canEdit: true, syncedOnce, alive,
      getClient: () => client, store, setSync, setNotice: vi.fn(),
      request: async () => emptySyncResponse(1)
    });
    expect(store).toHaveBeenCalledTimes(1);
    expect(syncState.kind).toBe("idle");
  });
});
