import { describe, expect, it, vi } from "vitest";
import type { StartCheckinReceipt } from "@o-tid/contracts";
import type { CheckinVaultSnapshot } from "./checkin-vault";
import { syncNextCheckinOperation, syncNextCheckinRecoveryOperation } from "./checkin-vault-sync";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const csrf = "c".repeat(43);
const recoveryToken = `otid_checkin_recovery_v1.${id(8)}.${"t".repeat(43)}`;
const now = "2026-09-05T10:00:00.000Z";
function fixture(capability: "START_CHECKIN" | "FINISH_FOREST_WATCH" = "START_CHECKIN") {
  const snapshot: CheckinVaultSnapshot = {
    vaultId: id(1), version: 2, preparedAt: now, nextSequence: 2, lastReceiptSequence: 0,
    registration: { formatVersion: 1, deviceId: id(2), raceId: id(3), actorCredentialId: id(4), capability, label: "Prov", registeredAt: now },
    roster: { formatVersion: 1, raceId: id(3), snapshotVersion: 1, timeZone: "Europe/Stockholm", generatedAt: now,
      knowledge: "LAST_SYNCED_ONLY", entries: [], devices: [] },
    operations: [{ operation: { formatVersion: 1, requestId: id(5), dependsOnRequestId: null, deviceId: id(2),
      actorCredentialId: id(4), raceId: id(3), entryId: id(6), localSequence: 1, packageVersion: 1,
      expectedEntryVersion: 1, expectedRevision: 0, observedAt: now,
      action: capability === "START_CHECKIN" ? { kind: "MARK_START", state: "STARTED" } :
        { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true } }, contentHash: "a".repeat(64), receipt: null }]
  };
  const receipt: StartCheckinReceipt = { formatVersion: 1, storage: "STORED", requestId: id(5), deviceId: id(2),
    raceId: id(3), entryId: id(6), localSequence: 1, contentHash: "a".repeat(64), receivedAt: now,
    effect: { kind: "APPLIED", revision: 1, revisionId: id(7) } };
  const vault = { read: vi.fn(async () => snapshot), applyReceipt: vi.fn<(version: number, receipt: unknown) => Promise<CheckinVaultSnapshot>>().mockResolvedValue(snapshot) };
  return { snapshot, receipt, vault };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("one-step checkin outbox transport (injected storage only in these unit tests)", () => {
  it.each(["START_CHECKIN", "FINISH_FOREST_WATCH"] as const)("binds %s to its private route and commits the exact receipt", async (capability) => {
    const { vault, receipt, snapshot } = fixture(capability);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(receipt));
    expect(await syncNextCheckinOperation(vault, () => csrf, undefined, fetcher)).toEqual({ kind: "STORED", receipt, snapshot });
    const route = capability === "START_CHECKIN" ? "start-checkin" : "finish-forest-watch";
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/admin/races/${id(3)}/${route}/sync`, expect.objectContaining({
      method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
      headers: { "content-type": "application/json", "x-otid-csrf": csrf },
      body: JSON.stringify({ operation: snapshot.operations[0]!.operation, contentHash: snapshot.operations[0]!.contentHash })
    }));
    expect(vault.applyReceipt).toHaveBeenCalledExactlyOnceWith(2, receipt);
  });

  it("does nothing for an empty queue and refuses absent CSRF, wrong scope and role before network", async () => {
    const { vault, snapshot } = fixture();
    const fetcher = vi.fn<typeof fetch>();
    await expect(syncNextCheckinOperation(vault, () => undefined, undefined, fetcher)).rejects.toMatchObject({ code: "FORBIDDEN" });
    snapshot.operations[0]!.operation.actorCredentialId = id(9);
    await expect(syncNextCheckinOperation(vault, () => csrf, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    snapshot.operations[0]!.operation.actorCredentialId = id(4);
    snapshot.operations[0]!.operation.action = { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true };
    await expect(syncNextCheckinOperation(vault, () => csrf, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    snapshot.operations = [];
    expect(await syncNextCheckinOperation(vault, () => undefined, undefined, fetcher)).toEqual({ kind: "IDLE", snapshot });
    expect(fetcher).not.toHaveBeenCalled();
    expect(vault.applyReceipt).not.toHaveBeenCalled();
  });

  it.each([[401, "UNAUTHORIZED"], [403, "FORBIDDEN"], [409, "TRANSPORT_CONFLICT"], [400, "INVALID_REQUEST"], [500, "NETWORK"], [201, "NETWORK"]] as const)("does not acknowledge HTTP %s", async (status, code) => {
    const { vault, receipt } = fixture();
    await expect(syncNextCheckinOperation(vault, () => csrf, undefined, vi.fn<typeof fetch>().mockResolvedValue(response(receipt, status)))).rejects.toMatchObject({ code });
    expect(vault.applyReceipt).not.toHaveBeenCalled();
  });

  it("refuses mismatched identity/hash/revision and malformed response without local writes", async () => {
    const { vault, receipt } = fixture();
    for (const change of [{ requestId: id(9) }, { deviceId: id(9) }, { raceId: id(9) }, { entryId: id(9) },
      { localSequence: 2 }, { contentHash: "b".repeat(64) }, { effect: { ...receipt.effect, revision: 2 } },
      { effect: { kind: "UNCHANGED", revision: 1 } }, { unexpected: true }]) {
      await expect(syncNextCheckinOperation(vault, () => csrf, undefined, vi.fn<typeof fetch>().mockResolvedValue(response({ ...receipt, ...change })))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    expect(vault.applyReceipt).not.toHaveBeenCalled();
  });

  it("stores a durable conflict but never substitutes a successful business effect", async () => {
    const { vault, receipt } = fixture();
    receipt.effect = { kind: "CONFLICT", revision: 3, reason: "STALE_REVISION" };
    const result = await syncNextCheckinOperation(vault, () => csrf, undefined, vi.fn<typeof fetch>().mockResolvedValue(response(receipt)));
    expect(result).toMatchObject({ kind: "STORED", receipt: { effect: { kind: "CONFLICT" } } });
    expect(vault.applyReceipt).toHaveBeenCalledExactlyOnceWith(2, receipt);
  });

  it("retries unchanged bytes after lost response or local receipt commit failure, with fresh CSRF", async () => {
    const { vault, receipt, snapshot } = fixture();
    const before = JSON.stringify(snapshot);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("private server detail"))
      .mockResolvedValueOnce(response(receipt)).mockResolvedValueOnce(response(receipt));
    await expect(syncNextCheckinOperation(vault, () => csrf, undefined, fetcher)).rejects.toMatchObject({ code: "NETWORK", message: "Checkin synchronization failed" });
    expect(vault.applyReceipt).not.toHaveBeenCalled();
    vault.applyReceipt.mockRejectedValueOnce(new Error("Local CAS failure"));
    await expect(syncNextCheckinOperation(vault, () => csrf, undefined, fetcher)).rejects.toThrow("Local CAS failure");
    await syncNextCheckinOperation(vault, () => "d".repeat(43), undefined, fetcher);
    expect(new Set(fetcher.mock.calls.map((call) => call[1]?.body)).size).toBe(1);
    expect(fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({ "x-otid-csrf": "d".repeat(43) });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("keeps one operation in flight until local commit finishes", async () => {
    const { vault, receipt, snapshot } = fixture();
    let finish!: (value: CheckinVaultSnapshot) => void;
    vault.applyReceipt.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(receipt));
    let done = false;
    const step = syncNextCheckinOperation(vault, () => csrf, undefined, fetcher).then(() => { done = true; });
    await vi.waitFor(() => expect(vault.applyReceipt).toHaveBeenCalledOnce());
    expect(done).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    finish(snapshot);
    await step;
    expect(done).toBe(true);
  });

  it("aborts before reads or during delayed body and does not commit a late response", async () => {
    const { vault, receipt } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(syncNextCheckinOperation(vault, () => csrf, controller.signal)).rejects.toMatchObject({ code: "ABORTED" });
    expect(vault.read).not.toHaveBeenCalled();
    const active = new AbortController();
    let resolveBody!: (value: unknown) => void;
    const json = vi.fn(() => new Promise<unknown>((resolve) => { resolveBody = resolve; }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ status: 200, json } as unknown as Response);
    const pending = syncNextCheckinOperation(vault, () => csrf, active.signal, fetcher);
    const rejected = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    active.abort();
    await rejected;
    resolveBody(receipt);
    await Promise.resolve();
    expect(vault.applyReceipt).not.toHaveBeenCalled();
  });

  it("times out while reading a stalled body, preserving the pending operation", async () => {
    vi.useFakeTimers();
    try {
      const { vault } = fixture();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ status: 200, json: () => new Promise<unknown>(() => {}) } as unknown as Response);
      const rejected = expect(syncNextCheckinOperation(vault, () => csrf, undefined, fetcher)).rejects.toMatchObject({ code: "NETWORK" });
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(vault.applyReceipt).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("uses the recovery-only bearer transport without cookies or CSRF", async () => {
    const { vault, receipt, snapshot } = fixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(receipt));
    await expect(syncNextCheckinRecoveryOperation(vault, () => recoveryToken, undefined, fetcher)).resolves.toEqual({ kind: "STORED", receipt, snapshot });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/admin/races/${id(3)}/checkin-recovery/sync`, expect.objectContaining({
      method: "POST", cache: "no-store", credentials: "omit", redirect: "error",
      headers: { "content-type": "application/json", Authorization: `Bearer ${recoveryToken}` },
      body: JSON.stringify({ operation: snapshot.operations[0]!.operation, contentHash: snapshot.operations[0]!.contentHash })
    }));
  });

  it("rejects an invalid recovery token before network or local writes", async () => {
    const { vault } = fixture();
    const fetcher = vi.fn<typeof fetch>();
    await expect(syncNextCheckinRecoveryOperation(vault, () => "not-a-token", undefined, fetcher)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(vault.applyReceipt).not.toHaveBeenCalled();
  });

  it("retries recovery with exactly the frozen body and refuses invalid receipts", async () => {
    const { vault, receipt, snapshot } = fixture();
    const before = JSON.stringify(snapshot);
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response({ ...receipt, contentHash: "b".repeat(64) }))
      .mockResolvedValueOnce(response(receipt));
    await expect(syncNextCheckinRecoveryOperation(vault, () => recoveryToken, undefined, fetcher)).rejects.toMatchObject({ code: "NETWORK" });
    await expect(syncNextCheckinRecoveryOperation(vault, () => recoveryToken, undefined, fetcher)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(vault.applyReceipt).not.toHaveBeenCalled();
    await syncNextCheckinRecoveryOperation(vault, () => recoveryToken, undefined, fetcher);
    expect(new Set(fetcher.mock.calls.map((call) => call[1]?.body)).size).toBe(1);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("aborts a delayed recovery body and never applies its late receipt", async () => {
    const { vault, receipt } = fixture();
    const controller = new AbortController();
    let resolveBody!: (value: unknown) => void;
    const json = vi.fn(() => new Promise<unknown>((resolve) => { resolveBody = resolve; }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ status: 200, json } as unknown as Response);
    const pending = syncNextCheckinRecoveryOperation(vault, () => recoveryToken, controller.signal, fetcher);
    const rejected = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    resolveBody(receipt);
    await Promise.resolve();
    expect(vault.applyReceipt).not.toHaveBeenCalled();
  });
});
