import { useEffect, useRef, useState, type FormEvent } from "react";
import { createCheckinVault, listCheckinVaultIds, requestCheckinPersistentStorage, unlockCheckinVault,
  type CheckinVault, type CheckinVaultSnapshot } from "../lib/checkin-vault";
import { loadCheckinRoster, loginCheckinAdmin, registerCheckinDevice, type CheckinAdminCapability } from "../lib/checkin-admin-client";
import { getCheckinAdminSession } from "../lib/checkin-admin-client";
import { syncNextCheckinOperation, syncNextCheckinRecoveryOperation } from "../lib/checkin-vault-sync";
import type { StartCheckinOperation } from "@o-tid/contracts";
import { CheckinRosterControls } from "./roster-controls";
import { createCheckinRecoveryManifest } from "../lib/checkin-recovery-manifest";
import { START_CHECKIN_ADMIN_LOOPBACK_COOKIE_NAMES, START_CHECKIN_ADMIN_PRODUCTION_COOKIE_NAMES,
  FINISH_FOREST_WATCH_ADMIN_LOOPBACK_COOKIE_NAMES, FINISH_FOREST_WATCH_ADMIN_PRODUCTION_COOKIE_NAMES } from "../lib/start-checkin-admin-cookies";
import { checkinText as t } from "./text-sv";

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function csrf(capability: CheckinAdminCapability): string {
  const loopback = location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (!loopback && location.protocol !== "https:") throw new Error("Secure origin required");
  const names = capability === "START_CHECKIN"
    ? loopback ? START_CHECKIN_ADMIN_LOOPBACK_COOKIE_NAMES : START_CHECKIN_ADMIN_PRODUCTION_COOKIE_NAMES
    : loopback ? FINISH_FOREST_WATCH_ADMIN_LOOPBACK_COOKIE_NAMES : FINISH_FOREST_WATCH_ADMIN_PRODUCTION_COOKIE_NAMES;
  const matches = document.cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${names.csrf}=`));
  const value = matches.length === 1 ? matches[0]!.slice(names.csrf.length + 1) : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("CSRF unavailable");
  return value;
}

export function CheckinPreparation({ shellReady }: { shellReady: boolean }) {
  const [ids, setIds] = useState<string[]>([]), [snapshot, setSnapshot] = useState<CheckinVaultSnapshot | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [persisted, setPersisted] = useState<boolean | null>(null), [online, setOnline] = useState(navigator.onLine);
  const [writing, setWriting] = useState(false), [automaticSync, setAutomaticSync] = useState(false);
  const operationPending = useRef(false);
  const active = useRef<CheckinVault | null>(null), epoch = useRef(0), request = useRef<AbortController | null>(null);
  const registrationIntent = useRef<{ key: string; deviceId: string } | null>(null);
  const lock = () => {
    epoch.current++; request.current?.abort(); request.current = null;
    document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ""; });
    active.current?.lock(); active.current = null; setSnapshot(null); setBusy(false); setMessage(t.locked);
    setWriting(false); setAutomaticSync(false); operationPending.current = false;
  };
  useEffect(() => {
    let mounted = true;
    void listCheckinVaultIds().then((value) => { if (mounted) setIds(value); }, () => { if (mounted) setMessage(t.failed); });
    const network = () => setOnline(navigator.onLine);
    const hide = () => {
      epoch.current++; request.current?.abort(); active.current?.lock(); active.current = null;
      document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ""; });
      setSnapshot(null); setBusy(false); setMessage(t.locked);
      setWriting(false); setAutomaticSync(false); operationPending.current = false;
    };
    window.addEventListener("online", network); window.addEventListener("offline", network); window.addEventListener("pagehide", hide);
    return () => { mounted = false; epoch.current++; request.current?.abort(); active.current?.lock();
      window.removeEventListener("online", network); window.removeEventListener("offline", network); window.removeEventListener("pagehide", hide); };
  }, []);
  const run = async (operation: (signal: AbortSignal) => Promise<CheckinVault>) => {
    const current = ++epoch.current, controller = new AbortController(); request.current = controller; setBusy(true); setMessage("");
    let opened: CheckinVault | null = null;
    try {
      opened = await operation(controller.signal);
      const value = await opened.read();
      if (epoch.current !== current) { opened.lock(); return; }
      active.current?.lock(); active.current = opened; setSnapshot(value); setIds(await listCheckinVaultIds());
      if (epoch.current === current) setMessage(t.unlocked);
    } catch {
      opened?.lock();
      if (epoch.current === current) { active.current = null; setSnapshot(null); setMessage(t.failed); }
    } finally { if (epoch.current === current) { request.current = null; setBusy(false); } }
  };
  const prepare = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!shellReady || busy || persisted === null) return;
    const form = event.currentTarget, data = new FormData(form);
    const raceId = field(data, "raceId"), label = field(data, "label").trim();
    const capability = data.get("capability") === "FINISH_FOREST_WATCH" ? "FINISH_FOREST_WATCH" : "START_CHECKIN";
    let credential = field(data, "credential"); const passphrase = field(data, "passphrase");
    (form.elements.namedItem("credential") as HTMLInputElement).value = "";
    (form.elements.namedItem("passphrase") as HTMLInputElement).value = "";
    if (data.get("consent") !== "on" || (!persisted && data.get("risk") !== "on")) return;
    const key = JSON.stringify([raceId, capability, label]);
    if (registrationIntent.current?.key !== key) registrationIntent.current = { key, deviceId: crypto.randomUUID() };
    const deviceId = registrationIntent.current.deviceId;
    void run(async (signal) => {
      try { await loginCheckinAdmin(raceId, capability, credential, signal); }
      finally { credential = ""; }
      const registration = await registerCheckinDevice(raceId, capability, { deviceId, label }, csrf(capability), signal);
      const roster = await loadCheckinRoster(raceId, capability, signal);
      if (signal.aborted) throw new Error("Preparation cancelled");
      return createCheckinVault({ vaultId: crypto.randomUUID(), passphrase, registration, roster, preparedAt: new Date().toISOString() });
    });
  };
  const unlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget, data = new FormData(form), passphrase = field(data, "passphrase");
    (form.elements.namedItem("passphrase") as HTMLInputElement).value = "";
    void run(() => unlockCheckinVault(field(data, "vaultId"), passphrase));
  };
  const operate = async (operation: (vault: CheckinVault, signal: AbortSignal, publish: (value: CheckinVaultSnapshot) => void) => Promise<CheckinVaultSnapshot>, success: string, failure: string) => {
    const vault = active.current;
    if (!vault || operationPending.current || busy) return;
    operationPending.current = true;
    const current = epoch.current, controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage("");
    const publish = (value: CheckinVaultSnapshot) => { if (epoch.current === current) setSnapshot(value); };
    try {
      publish(await operation(vault, controller.signal, publish));
      if (epoch.current === current) setMessage(success);
    } catch (error) {
      if (epoch.current === current) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        setWriting(false);
        setMessage(code === "STALE_LOCAL_STATE" ? t.staleLocal : code === "REVIEW_REQUIRED" ? t.review : failure);
        try { publish(await vault.read()); } catch { if (epoch.current === current) lock(); }
      }
    } finally {
      if (epoch.current === current) { operationPending.current = false; request.current = null; setBusy(false); }
    }
  };
  const mark = (entryId: string, action: StartCheckinOperation["action"]) => {
    if (!writing || !snapshot) return;
    const version = snapshot.version;
    void operate((vault) => vault.enqueueAction(version, { requestId: crypto.randomUUID(), entryId,
      observedAt: new Date().toISOString(), action }), t.markSaved, t.failed);
  };
  const sync = (credential?: string) => {
    if (!snapshot) return;
    const { registration } = snapshot;
    void operate(async (vault, signal, publish) => {
      if (credential !== undefined) {
        try { await loginCheckinAdmin(registration.raceId, registration.capability, credential, signal); }
        finally { credential = undefined; }
      } else await getCheckinAdminSession(registration.raceId, registration.capability, signal);
      const registered = await registerCheckinDevice(registration.raceId, registration.capability,
        { deviceId: registration.deviceId, label: registration.label }, csrf(registration.capability), signal);
      if (JSON.stringify(registered) !== JSON.stringify(registration)) throw new Error("Device identity changed");
      for (;;) {
        const result = await syncNextCheckinOperation(vault, () => csrf(registration.capability), signal);
        publish(result.snapshot);
        if (result.kind === "IDLE") break;
      }
      const basis = await vault.read();
      const roster = await loadCheckinRoster(registration.raceId, registration.capability, signal);
      if (signal.aborted) throw new Error("Synchronization cancelled");
      return vault.replaceRoster(basis.version, roster);
    }, t.synced, t.syncStopped);
  };
  const recover = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form);
    let token = field(data, "recoveryToken");
    form.reset();
    if (!snapshot || busy || operationPending.current || data.get("recoveryConsent") !== "on") { token = ""; return; }
    setWriting(false); setAutomaticSync(false);
    void operate(async (vault, signal, publish) => {
      for (;;) {
        const result = await syncNextCheckinRecoveryOperation(vault, () => token || undefined, signal);
        publish(result.snapshot);
        if (result.kind === "IDLE") return result.snapshot;
      }
    }, t.recoverySynced, t.recoveryStopped).finally(() => { token = ""; });
  };
  const syncRef = useRef(sync); syncRef.current = sync;
  const clearLocal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const consent = new FormData(event.currentTarget).get("clearConsent") === "on";
    event.currentTarget.reset();
    const vault = active.current;
    if (!consent || !vault || !snapshot || busy || operationPending.current) return;
    operationPending.current = true; setBusy(true); setWriting(false); setAutomaticSync(false);
    const current = epoch.current;
    try {
      await vault.clear(snapshot.version);
      if (epoch.current !== current) return;
      active.current = null; setSnapshot(null); setIds(await listCheckinVaultIds());
      if (epoch.current === current) setMessage(t.cleared);
    } catch {
      if (epoch.current === current) setMessage(t.clearFailed);
    } finally {
      if (epoch.current === current) { operationPending.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    if (!automaticSync) return;
    const reconnect = () => syncRef.current();
    window.addEventListener("online", reconnect);
    return () => window.removeEventListener("online", reconnect);
  }, [automaticSync]);
  return <section><p>{online ? t.online : t.offline}</p><p>{t.noHardware}</p><p role="status" aria-label={t.operationStatus}>{message}</p>
    {(snapshot || busy) && <button onClick={lock}>{t.lock}</button>}
    {snapshot ? <section><h2>{snapshot.registration.label}</h2><p>{t.version} {snapshot.roster.snapshotVersion}</p>
      <p>{t.generated} {snapshot.roster.generatedAt}</p><p>{t.pending} {snapshot.operations.filter((row) => !row.receipt).length}</p>
      <button disabled={busy} onClick={() => sync()}>{t.sync}</button>
      <button disabled={busy} onClick={() => { setWriting(false); void operate((vault) => vault.read(), t.unlocked, t.failed); }}>{t.refreshLocal}</button>
      <label><input type="checkbox" disabled={busy} checked={automaticSync} onChange={(event) => setAutomaticSync(event.target.checked)} />{t.autoSync}</label>
      <CheckinRosterControls snapshot={snapshot} writing={writing} busy={busy} onWritingChange={setWriting} onMark={mark} />
      <button disabled={busy || snapshot.operations.every((row) => row.receipt !== null)} onClick={() => {
        setWriting(false);
        void operate(async (vault, signal) => {
          const result = await createCheckinRecoveryManifest(vault);
          if (signal.aborted) throw new Error("Export cancelled");
          const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: "application/json" }));
          try {
            const link = document.createElement("a"); link.href = url;
            link.download = `otid-checkin-recovery-${result.snapshot.vaultId}.json`;
            link.click();
          } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
          return result.snapshot;
        }, t.recoveryExported, t.failed);
      }}>{t.recoveryExport}</button>
      <p>{t.recoveryHelp}</p>
      <form onSubmit={recover} aria-label={t.recoveryTitle}><fieldset disabled={busy || snapshot.operations.every((row) => row.receipt !== null)}>
        <legend>{t.recoveryTitle}</legend>
        <label>{t.recoveryToken}<input type="password" name="recoveryToken" autoComplete="off" maxLength={160} required /></label>
        <label><input type="checkbox" name="recoveryConsent" required />{t.recoveryConsent}</label>
        <button>{t.recoverySubmit}</button>
      </fieldset></form>
      <form onSubmit={(event) => {
        event.preventDefault(); const form = event.currentTarget, credential = field(new FormData(form), "credential");
        (form.elements.namedItem("credential") as HTMLInputElement).value = ""; sync(credential);
      }}><fieldset disabled={busy}><label>{t.credential}<input type="password" name="credential" autoComplete="off" required /></label><button>{t.loginSync}</button></fieldset></form>
      <form onSubmit={event => void clearLocal(event)} aria-label={t.clearTitle}><fieldset disabled={busy}>
        <legend>{t.clearTitle}</legend><label><input type="checkbox" name="clearConsent" required />{t.clearConsent}</label>
        <button>{t.clear}</button>
      </fieldset></form>
    </section> : <>
      <h2>{t.unlock}</h2>{ids.length === 0 ? <p>{t.none}</p> : <form onSubmit={unlock}><fieldset disabled={busy}>
        <label>{t.localList}<select name="vaultId">{ids.map((id) => <option key={id}>{id}</option>)}</select></label>
        <label>{t.passphrase}<input name="passphrase" type="password" minLength={16} maxLength={1024} required autoComplete="off" /></label>
        <button>{t.unlock}</button></fieldset></form>}
      <h2>{t.prepare}</h2><p>{t.secretWarning}</p><button disabled={busy} onClick={() => {
        setBusy(true); void requestCheckinPersistentStorage().then(setPersisted, () => setMessage(t.failed)).finally(() => setBusy(false));
      }}>{t.persist}</button>
      {persisted !== null && <p>{persisted ? t.persisted : t.notPersisted}</p>}
      <form onSubmit={prepare}><fieldset disabled={busy || !shellReady || persisted === null}>
        <label>{t.race}<input name="raceId" required defaultValue={/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : ""} /></label>
        <label>{t.capability}<select name="capability" aria-label={t.capability}><option value="START_CHECKIN">{t.start}</option><option value="FINISH_FOREST_WATCH">{t.finish}</option></select></label>
        <label>{t.label}<input name="label" maxLength={120} required /></label>
        <label>{t.credential}<input name="credential" type="password" autoComplete="off" required /></label>
        <label>{t.passphrase}<input name="passphrase" type="password" minLength={16} maxLength={1024} autoComplete="off" required /></label>
        <label><input name="consent" type="checkbox" required />{t.consent}</label>
        {persisted === false && <label><input name="risk" type="checkbox" required />{t.risk}</label>}
        <button>{t.prepare}</button></fieldset></form>
    </>}
  </section>;
}
