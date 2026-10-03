import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type {} from "./fixtures/checkin-vault-browser";

// Reuse the workspace's existing esbuild tool; no production test endpoint or fake IDB.
const bundle = execFileSync(resolve("apps/station/node_modules/.bin/esbuild"), [
  resolve("tests/e2e/fixtures/checkin-vault-browser.ts"), "--bundle", "--format=iife", "--platform=browser", "--target=chrome110",
  `--tsconfig=${resolve("tests/e2e/tsconfig.vault.json")}`
], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
async function load(page: Page) { await page.goto("/"); await page.addScriptTag({ content: bundle }); }
test.beforeEach(async ({ page }) => load(page));

test("rensning kräver kvittens och uttrycklig rostergranskning för historisk konflikt", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture(), vault = await api.createCheckinVault(input);
    let snapshot = await vault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:01:00.000Z", action: { kind: "MARK_START", state: "STARTED" } });
    const row = snapshot.operations[0]!;
    snapshot = await vault.applyReceipt(snapshot.version, { formatVersion: 1, storage: "STORED", requestId: row.operation.requestId,
      deviceId: row.operation.deviceId, raceId: row.operation.raceId, entryId: row.operation.entryId, localSequence: 1,
      contentHash: row.contentHash, receivedAt: "2026-09-05T10:02:00.000Z", effect: { kind: "CONFLICT", revision: 1, reason: "STALE_REVISION" } });
    let denied = false; try { await vault.clear(snapshot.version); } catch { denied = true; }
    const original = JSON.stringify(snapshot.operations);
    const roster = { ...snapshot.roster, entries: snapshot.roster.entries.map(entry => ({ ...entry,
      reviewedConflictRequestIds: [row.operation.requestId] })) };
    snapshot = await vault.replaceRoster(snapshot.version, roster);
    const unchanged = JSON.stringify(snapshot.operations) === original;
    await vault.clear(snapshot.version);
    return { denied, unchanged, removed: !(await api.listCheckinVaultIds()).includes(input.vaultId) };
  });
  expect(result).toEqual({ denied: true, unchanged: true, removed: true });
});

test("återhämtningsmanifest fryser bara väntande identiteter och lämnar verklig IDB orörd", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture(), vault = await api.createCheckinVault(input);
    let emptyRejected = false;
    try { await api.createCheckinRecoveryManifest(vault); } catch { emptyRejected = true; }
    let snapshot = await vault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:01:00.000Z", action: { kind: "MARK_START", state: "STARTED" } });
    const first = snapshot.operations[0]!;
    snapshot = await vault.applyReceipt(snapshot.version, { formatVersion: 1, storage: "STORED", requestId: first.operation.requestId,
      deviceId: first.operation.deviceId, raceId: first.operation.raceId, entryId: first.operation.entryId,
      localSequence: 1, contentHash: first.contentHash, receivedAt: "2026-09-05T10:02:00.000Z", effect: { kind: "APPLIED", revisionId: crypto.randomUUID(), revision: 1 } });
    snapshot = await vault.enqueueAction(snapshot.version, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:03:00.000Z", action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" } });
    const before = await api.exportCheckinVaultArchive(input.vaultId), exported = await api.createCheckinRecoveryManifest(vault);
    const after = await api.exportCheckinVaultArchive(input.vaultId);
    vault.lock();
    let lockedRejected = false;
    try { await api.createCheckinRecoveryManifest(vault); } catch { lockedRejected = true; }
    return { emptyRejected, lockedRejected, unchanged: before === after, text: new TextDecoder().decode(exported.bytes),
      manifest: exported.manifest, hash: exported.contentHash, pending: snapshot.operations[1]!, passphrase: input.passphrase };
  });
  expect(result.emptyRejected && result.lockedRejected && result.unchanged).toBe(true);
  expect(result.manifest.firstSequence).toBe(2); expect(result.manifest.lastSequence).toBe(2);
  expect(result.manifest.items).toEqual([{ requestId: result.pending.operation.requestId, localSequence: 2, contentHash: result.pending.contentHash }]);
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.text).not.toContain("Offlineperson"); expect(result.text).not.toContain(result.passphrase);
  expect(result.text).not.toContain("MARK_START"); expect(result.text).not.toContain("observedAt");
});

test("transporten bevarar riktig IDB-kö vid tappat svar och kvitterar exakt retry efter omladdning", async ({ page }) => {
  const saved = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture(), vault = await api.createCheckinVault(input);
    const snapshot = await vault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:01:00.000Z", action: { kind: "MARK_START", state: "STARTED" } });
    let sent = "", failed = false;
    const archive = await api.exportCheckinVaultArchive(input.vaultId);
    try {
      await api.syncNextCheckinOperation(vault, () => "c".repeat(43), undefined, async (_url, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected serialized operation");
        sent = init.body; throw new Error("Synthetic lost reply");
      });
    } catch { failed = true; }
    const unchanged = archive === await api.exportCheckinVaultArchive(input.vaultId);
    vault.lock();
    return { input, snapshot, sent, failed, unchanged };
  });
  expect(saved.failed && saved.unchanged).toBe(true);
  await page.reload(); await page.addScriptTag({ content: bundle });
  const retried = await page.evaluate(async ({ input, sent }) => {
    const api = window.checkinVaultTest, vault = await api.unlockCheckinVault(input.vaultId, input.passphrase);
    const before = await vault.read(), row = before.operations[0]!;
    const receipt = { formatVersion: 1, storage: "STORED", requestId: row.operation.requestId, deviceId: row.operation.deviceId,
      raceId: row.operation.raceId, entryId: row.operation.entryId, localSequence: row.operation.localSequence,
      contentHash: row.contentHash, receivedAt: "2026-09-05T10:03:00.000Z",
      effect: { kind: "APPLIED", revisionId: crypto.randomUUID(), revision: 1 } };
    let same = false;
    await api.syncNextCheckinOperation(vault, () => "d".repeat(43), undefined, async (_url, init) => {
      same = init?.body === sent; return new Response(JSON.stringify(receipt), { status: 200 });
    });
    vault.lock();
    const reopened = await api.unlockCheckinVault(input.vaultId, input.passphrase);
    const idle = await api.syncNextCheckinOperation(reopened, () => undefined, undefined, async () => { throw new Error("Must not send"); });
    return { same, kind: idle.kind, snapshot: await reopened.read(), receipt };
  }, saved);
  expect(retried.same).toBe(true); expect(retried.kind).toBe("IDLE");
  expect(retried.snapshot.operations[0]!.operation).toEqual(saved.snapshot.operations[0]!.operation);
  expect(retried.snapshot.operations[0]!.receipt).toEqual(retried.receipt);
  expect(retried.snapshot.lastReceiptSequence).toBe(1);
});

test("krypterad kö över omladdning, beroenden, exakta kvittenser och bevarad konflikt", async ({ page }) => {
  const fixture = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture(), vault = await api.createCheckinVault(input);
    api.handles.set(input.vaultId, vault);
    let snapshot = await vault.read();
    snapshot = await vault.enqueueAction(snapshot.version, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:01:00.000Z", action: { kind: "MARK_START", state: "STARTED" } });
    snapshot = await vault.enqueueAction(snapshot.version, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:02:00.000Z", action: { kind: "MARK_START", state: "REPORTED_NOT_STARTED" } });
    const archive = await api.exportCheckinVaultArchive(input.vaultId);
    vault.lock();
    return { input, snapshot, archive };
  });
  expect(fixture.archive).not.toContain("Offlineperson"); expect(fixture.archive).not.toContain("MARK_START");
  expect(fixture.archive).not.toContain(fixture.input.passphrase); expect(fixture.archive).not.toContain(fixture.input.registration.actorCredentialId);
  expect(fixture.snapshot.operations[1]!.operation.dependsOnRequestId).toBe(fixture.snapshot.operations[0]!.operation.requestId);
  expect(fixture.snapshot.operations.map((row) => row.operation.expectedRevision)).toEqual([0, 1]);
  await page.reload(); await page.addScriptTag({ content: bundle });
  const restored = await page.evaluate(async ({ input }) => {
    const api = window.checkinVaultTest;
    let rejected = false;
    try { await api.unlockCheckinVault(input.vaultId, "Fel men tillräckligt lång lösenfras"); } catch { rejected = true; }
    const archive = await api.exportCheckinVaultArchive(input.vaultId);
    const vault = await api.unlockCheckinVault(input.vaultId, input.passphrase); api.handles.set(input.vaultId, vault);
    return { rejected, archive, snapshot: await vault.read() };
  }, fixture);
  expect(restored.rejected).toBe(true); expect(restored.archive).toBe(fixture.archive); expect(restored.snapshot).toEqual(fixture.snapshot);
  const receipts = await page.evaluate(async ({ input }) => {
    const api = window.checkinVaultTest, vault = api.handles.get(input.vaultId)!;
    let snapshot = await vault.read(); const first = snapshot.operations[0]!, second = snapshot.operations[1]!;
    const base = { formatVersion: 1, storage: "STORED", receivedAt: "2026-09-05T10:03:00.000Z" };
    const ack = (row: typeof first) => ({ ...base, requestId: row.operation.requestId, deviceId: row.operation.deviceId,
      raceId: row.operation.raceId, entryId: row.operation.entryId, localSequence: row.operation.localSequence, contentHash: row.contentHash,
      effect: { kind: "APPLIED", revisionId: crypto.randomUUID(), revision: row.operation.expectedRevision + 1 } });
    const firstAck = ack(first), secondAck = ack(second); let badHash = false, badOrder = false, badRevision = false;
    try { await vault.applyReceipt(snapshot.version, { ...firstAck, contentHash: "0".repeat(64) }); } catch { badHash = true; }
    try { await vault.applyReceipt(snapshot.version, secondAck); } catch { badOrder = true; }
    try { await vault.applyReceipt(snapshot.version, { ...firstAck, effect: { kind: "UNCHANGED", revision: 1 } }); } catch { badRevision = true; }
    const afterErrors = await vault.read();
    snapshot = await vault.applyReceipt(snapshot.version, firstAck);
    const same = await vault.applyReceipt(1, firstAck);
    snapshot = await vault.applyReceipt(snapshot.version, { ...secondAck, effect: { kind: "CONFLICT", revision: 1, reason: "RETURN_ALREADY_REGISTERED" } });
    let clearRejected = false, reviewRequired = false;
    try { await vault.clear(snapshot.version); } catch { clearRejected = true; }
    try { await vault.enqueueAction(snapshot.version, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:04:00.000Z", action: { kind: "MARK_START", state: "STARTED" } }); } catch { reviewRequired = true; }
    vault.lock();
    const reopened = await api.unlockCheckinVault(input.vaultId, input.passphrase);
    return { badHash, badOrder, badRevision, afterErrors, same, snapshot: await reopened.read(), clearRejected, reviewRequired };
  }, fixture);
  expect(receipts.badHash && receipts.badOrder && receipts.badRevision && receipts.clearRejected && receipts.reviewRequired).toBe(true);
  expect(receipts.afterErrors).toEqual(fixture.snapshot); expect(receipts.same.lastReceiptSequence).toBe(1);
  expect(receipts.snapshot.operations).toHaveLength(2); expect(receipts.snapshot.lastReceiptSequence).toBe(2);
  expect(receipts.snapshot.operations[1]!.receipt?.effect.kind).toBe("CONFLICT");
});

test("två flikar får en atomisk vinnare utan dubbel sekvens och dubbelt device avvisas", async ({ page, context }) => {
  const input = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture(); api.handles.set(input.vaultId, await api.createCheckinVault(input)); return input;
  });
  const second = await context.newPage(); await load(second);
  await second.evaluate(async (input) => {
    const api = window.checkinVaultTest; api.handles.set(input.vaultId, await api.unlockCheckinVault(input.vaultId, input.passphrase));
  }, input);
  const attempt = (target: Page) => target.evaluate(async (input) => {
    try {
      await window.checkinVaultTest.handles.get(input.vaultId)!.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: input.entryId,
        observedAt: "2026-09-05T10:01:00.000Z", action: { kind: "MARK_START", state: "STARTED" } }); return "saved";
    } catch (error) { return (error as { code: string }).code; }
  }, input);
  expect((await Promise.all([attempt(page), attempt(second)])).sort()).toEqual(["STALE_LOCAL_STATE", "saved"].sort());
  const after = await page.evaluate(async (input) => {
    const api = window.checkinVaultTest; let duplicateRejected = false;
    try { await api.createCheckinVault({ ...input, vaultId: crypto.randomUUID() }); } catch { duplicateRejected = true; }
    const snapshot = await api.handles.get(input.vaultId)!.read();
    return { duplicateRejected, snapshot, ids: await api.listCheckinVaultIds() };
  }, input);
  expect(after.duplicateRejected).toBe(true); expect(after.ids).toEqual([input.vaultId]);
  expect(after.snapshot.nextSequence).toBe(2); expect(after.snapshot.operations).toHaveLength(1);
});

test("forcerad IDB-abort och låsning lämnar sekvens och kö oförändrade", async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture(), vault = await api.createCheckinVault(input);
    const before = await api.exportCheckinVaultArchive(input.vaultId);
    const original = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, "add")!.value as IDBObjectStore["add"];
    IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (this.name === "operations") this.transaction.abort();
      return request;
    };
    let aborted = false;
    try { await vault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:01:00.000Z", action: { kind: "MARK_START", state: "STARTED" } }); }
    catch { aborted = true; } finally { IDBObjectStore.prototype.add = original; }
    const after = await api.exportCheckinVaultArchive(input.vaultId);
    const pending = vault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: input.entryId,
      observedAt: "2026-09-05T10:01:00.000Z", action: { kind: "MARK_START", state: "STARTED" } });
    vault.lock(); let locked = false; try { await pending; } catch { locked = true; }
    const unlocked = await api.unlockCheckinVault(input.vaultId, input.passphrase);
    return { aborted, locked, before, after, snapshot: await unlocked.read() };
  });
  expect(outcome.aborted && outcome.locked).toBe(true); expect(outcome.after).toBe(outcome.before);
  expect(outcome.snapshot.nextSequence).toBe(1); expect(outcome.snapshot.operations).toHaveLength(0);
});

test("rosterbyte bevarar intents, manuell retur och exakta actionbehörigheter", async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture("FINISH_FOREST_WATCH"), vault = await api.createCheckinVault(input);
    let snapshot = await vault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: input.entryId, observedAt: input.preparedAt,
      action: { kind: "FINISH_CORRECTION", state: "UNMARKED", manualReturnRegistered: true } });
    snapshot = await vault.enqueueAction(snapshot.version, { requestId: crypto.randomUUID(), entryId: input.entryId, observedAt: input.preparedAt,
      action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true } });
    snapshot = await vault.enqueueAction(snapshot.version, { requestId: crypto.randomUUID(), entryId: input.entryId, observedAt: input.preparedAt,
      action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: false } });
    let wrongAction = false;
    try { await vault.enqueueAction(snapshot.version, { requestId: crypto.randomUUID(), entryId: input.entryId, observedAt: input.preparedAt,
      action: { kind: "MARK_START", state: "UNMARKED" } }); } catch { wrongAction = true; }
    const before = JSON.parse(await api.exportCheckinVaultArchive(input.vaultId)) as { operations: unknown };
    snapshot = await vault.replaceRoster(snapshot.version, { ...input.roster, snapshotVersion: 2, generatedAt: "2026-09-05T10:10:00.000Z",
      entries: input.roster.entries.map((entry) => ({ ...entry, entryVersion: 2, displayName: "Ändrat syntetiskt namn" })) });
    const after = JSON.parse(await api.exportCheckinVaultArchive(input.vaultId)) as { operations: unknown };
    let unsafeClear = false; try { await vault.clear(snapshot.version); } catch { unsafeClear = true; }
    const startInput = api.fixture(), startVault = await api.createCheckinVault(startInput); let wrongFinish = false;
    try { await startVault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: startInput.entryId, observedAt: input.preparedAt,
      action: { kind: "FINISH_CORRECTION", state: "STARTED", manualReturnRegistered: true } }); } catch { wrongFinish = true; }
    return { before, after, snapshot, unsafeClear, wrongAction, wrongFinish };
  });
  expect(outcome.after.operations).toEqual(outcome.before.operations); expect(outcome.unsafeClear).toBe(true);
  expect(outcome.snapshot.operations.map((row) => row.operation.expectedRevision)).toEqual([0, 1, 2]);
  expect(outcome.snapshot.operations.every((row) => row.operation.packageVersion === 1)).toBe(true);
  expect(outcome.snapshot.roster.snapshotVersion).toBe(2);
  expect(outcome.wrongAction && outcome.wrongFinish).toBe(true);
});

test("manipulerad kryptering avvisas och rensas inte vid upplåsning", async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const api = window.checkinVaultTest, input = api.fixture(), vault = await api.createCheckinVault(input); vault.lock();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(api.CHECKIN_VAULT_DATABASE, 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("rosters", "readwrite", { durability: "strict" });
        const get = tx.objectStore("rosters").get(input.vaultId);
        get.onsuccess = () => {
          const row = get.result as { encrypted: { ciphertext: string } };
          row.encrypted.ciphertext = (row.encrypted.ciphertext[0] === "0" ? "1" : "0") + row.encrypted.ciphertext.slice(1);
          tx.objectStore("rosters").put(row);
        };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(new Error("fixture fault failed")); };
      };
    });
    const before = await api.exportCheckinVaultArchive(input.vaultId); let rejected = false;
    try { await api.unlockCheckinVault(input.vaultId, input.passphrase); } catch { rejected = true; }
    return { rejected, before, after: await api.exportCheckinVaultArchive(input.vaultId) };
  });
  expect(outcome.rejected).toBe(true); expect(outcome.after).toBe(outcome.before);
});

test("säker explicit rensning av helt kvitterad kö tar bara vald vault", async ({ page }) => {
  const outcome = await page.evaluate(async () => {
    const api = window.checkinVaultTest, first = api.fixture(), second = api.fixture();
    const vault = await api.createCheckinVault(first); await api.createCheckinVault(second);
    let snapshot = await vault.enqueueAction(1, { requestId: crypto.randomUUID(), entryId: first.entryId, observedAt: first.preparedAt,
      action: { kind: "MARK_START", state: "STARTED" } });
    const row = snapshot.operations[0]!;
    snapshot = await vault.applyReceipt(snapshot.version, { formatVersion: 1, storage: "STORED", requestId: row.operation.requestId,
      deviceId: first.registration.deviceId, raceId: first.registration.raceId, entryId: first.entryId, localSequence: 1,
      contentHash: row.contentHash, receivedAt: first.preparedAt, effect: { kind: "APPLIED", revisionId: crypto.randomUUID(), revision: 1 } });
    await vault.clear(snapshot.version);
    return { ids: await api.listCheckinVaultIds(), remaining: second.vaultId, persisted: await api.requestCheckinPersistentStorage() };
  });
  expect(outcome.ids).toEqual([outcome.remaining]); expect(typeof outcome.persisted).toBe("boolean");
});
