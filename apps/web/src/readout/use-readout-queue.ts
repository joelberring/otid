/**
 * Avläsningens kö: paketet, köade avläsningar, direktanmälningar och bardiskens åtgärder i webbläsaren, och synken till
 * servern (med väntan när servern inte svarar). Inget raderas lokalt förrän servern har kvitterat (`syncPending`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { readoutTextEn } from "./text-en";
import { useTexts } from "../components/language-provider";
import type { ReadoutPackage } from "@o-tid/contracts";
import { accountCsrf, fetchReadoutPackage } from "./api";
import type { OtherRacePending, QueuedReadout, QueuedRegistration, ReadoutStore } from "./store";
import { requeueLocallyInvalid, syncPending, unavailableBackoffMs } from "./sync";
import { loadFailedReadouts, syncFailedReadouts, type FailedReadout } from "./failed-readouts";
import type { PartyAction, PartyActionStore, QueuedPartyAction } from "./party-store";
import { syncPartyActions } from "./party-sync";
import { readoutText } from "./text-sv";

const SYNC_INTERVAL_MS = 5_000;
const PACKAGE_INTERVAL_MS = 60_000;

export function useReadoutQueue(raceId: string | undefined, store: ReadoutStore, partyStore: PartyActionStore) {
  const t = useTexts(readoutText, readoutTextEn);
  const [pkg, setPkg] = useState<ReadoutPackage>();
  const [items, setItems] = useState<QueuedReadout[]>([]);
  // ADR-0187: väntande avläsningar för andra tävlingar på den här datorn (t.ex. före en återställning). Skickas aldrig hit.
  const [elsewhere, setElsewhere] = useState<OtherRacePending[]>([]);
  /** Direktanmälningar av okända brickor (PLAN.md steg 25), köade som avläsningarna. */
  const [registrations, setRegistrations] = useState<QueuedRegistration[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [syncProblem, setSyncProblem] = useState<string>();
  // Översynen 2026-11-02: servern svarar inte (502/503/504). Kön skickas igen automatiskt med växande väntan.
  const [serverDown, setServerDown] = useState<{ status: number; retryInMs: number }>();
  const unavailableCount = useRef(0);
  const retryAt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Steg 31: avläsningar vars tider inte gick att tolka (sparas i webbläsaren tills funktionären tar bort dem).
  const [failedReadouts, setFailedReadouts] = useState<FailedReadout[]>(() => raceId ? loadFailedReadouts(raceId) : []);
  const [persistent, setPersistent] = useState(true);
  const storeRef = useRef(store);
  // Fest (PLAN.md steg 40): bardiskens in-/utcheckningar och gästnamn, köade som avläsningarna.
  const partyStoreRef = useRef(partyStore);
  const [partyActions, setPartyActions] = useState<QueuedPartyAction[]>([]);
  const pkgRef = useRef<ReadoutPackage | undefined>(undefined);
  const syncing = useRef(false);

  const itemsRef = useRef<QueuedReadout[]>([]);
  const registrationsRef = useRef<QueuedRegistration[]>([]);
  const reload = useCallback(async () => {
    if (!raceId) return;
    const [listed, registered, party, other] = await Promise.all([storeRef.current.list(raceId), storeRef.current.listRegistrations(raceId),
      partyStoreRef.current.list(raceId), storeRef.current.pendingElsewhere(raceId)]);
    itemsRef.current = listed; setItems(listed); setPartyActions(party); setElsewhere(other);
    registrationsRef.current = registered; setRegistrations(registered);
  }, [raceId]);

  const refreshPackage = useCallback(async () => {
    if (!raceId) return;
    const outcome = await fetchReadoutPackage(raceId);
    if (outcome.kind === "ok") {
      await storeRef.current.savePackage(outcome.value);
      pkgRef.current = outcome.value; setPkg(outcome.value); setOnline(true); setLoginNeeded(false);
    } else if (outcome.kind === "unauthorized") setLoginNeeded(true);
    else if (outcome.kind === "offline") setOnline(false);
  }, [raceId]);

  const syncRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);
  const sync = useCallback(async (force = false) => {
    if (!raceId || syncing.current) return;
    // Under väntan efter att servern inte svarat skickar bara den schemalagda synken (eller Försök igen/nätet tillbaka).
    if (!force && Date.now() < retryAt.current) return;
    syncing.current = true;
    try {
      const deps = { fetch: window.fetch.bind(window), csrf: accountCsrf };
      const outcome = await syncPending(storeRef.current, raceId, deps);
      setLoginNeeded(outcome.kind === "unauthorized");
      if (outcome.kind === "offline") setOnline(false);
      if (outcome.kind === "unavailable") {
        unavailableCount.current += 1;
        const wait = unavailableBackoffMs(unavailableCount.current);
        retryAt.current = Date.now() + wait;
        setOnline(true); setServerDown({ status: outcome.status, retryInMs: wait }); setSyncProblem(undefined);
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { void syncRef.current(true); }, wait);
      } else if (outcome.kind !== "offline" && outcome.kind !== "unauthorized") {
        unavailableCount.current = 0; retryAt.current = 0; setServerDown(undefined);
      }
      if (outcome.kind === "synced" || outcome.kind === "idle") { setOnline(true); setSyncProblem(undefined); }
      if (outcome.kind === "failed") setSyncProblem(t.syncFailed(outcome.status));
      if (outcome.kind === "throttled") setSyncProblem(t.syncThrottled);
      // Kvitterade direktanmälningar finns nu i serverns paket; hämta det så att brickan är känd även utan den lokala kön.
      if (outcome.kind === "synced" && outcome.registered) await refreshPackage();
      // Steg 45: råramarna för avläsningar vars tider inte gick att tolka, så att de finns kvar på servern.
      if (outcome.kind !== "unauthorized" && outcome.kind !== "offline" && outcome.kind !== "throttled" && outcome.kind !== "unavailable" &&
        loadFailedReadouts(raceId).some((row) => !row.storedAt)) {
        const failed = await syncFailedReadouts(raceId, await storeRef.current.identity(raceId), pkgRef.current?.packageVersion ?? 1, deps);
        if (failed.kind === "offline") setOnline(false);
        if (failed.kind === "unauthorized") setLoginNeeded(true);
        if (failed.kind === "failed") setSyncProblem(t.syncFailed(failed.status));
        setFailedReadouts(loadFailedReadouts(raceId));
      }
      // Bardisken: in-/utcheckningar och gästnamn efter avläsningarna, så att servern har brickans avläsning först.
      if (pkgRef.current?.party && outcome.kind !== "unauthorized" && outcome.kind !== "offline" && outcome.kind !== "throttled" &&
        outcome.kind !== "unavailable") {
        const party = await syncPartyActions(partyStoreRef.current, raceId, deps);
        if (party.kind === "offline") setOnline(false);
        if (party.kind === "unauthorized") setLoginNeeded(true);
        if (party.kind === "failed") setSyncProblem(t.syncFailed(party.status));
      }
    } catch (error) {
      setSyncProblem(error instanceof Error ? error.message : String(error));
    } finally {
      syncing.current = false;
      await reload();
    }
  }, [raceId, reload, refreshPackage]);
  useEffect(() => { syncRef.current = sync; return () => clearTimeout(retryTimer.current); }, [sync]);

  useEffect(() => {
    if (!raceId) return;
    void (async () => {
      const saved = await storeRef.current.loadPackage(raceId);
      if (saved && !pkgRef.current) { pkgRef.current = saved; setPkg(saved); }
      // Lokalt avvisade avläsningar som nu är giltiga (steg 36: nio ramar från en station som skickar alla åtta block).
      await requeueLocallyInvalid(storeRef.current, raceId, (saved ?? pkgRef.current)?.event.timeZone);
      await reload();
      if (navigator.storage?.persist) setPersistent(await navigator.storage.persist());
      await refreshPackage();
      await sync();
    })().catch((error: unknown) => setSyncProblem(error instanceof Error ? error.message : String(error)));
    const syncTimer = setInterval(() => { void sync(); }, SYNC_INTERVAL_MS);
    const packageTimer = setInterval(() => { void refreshPackage(); }, PACKAGE_INTERVAL_MS);
    const wentOnline = () => { setOnline(true); void refreshPackage().then(() => sync(true)); };
    const wentOffline = () => setOnline(false);
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    return () => {
      clearInterval(syncTimer); clearInterval(packageTimer);
      window.removeEventListener("online", wentOnline); window.removeEventListener("offline", wentOffline);
    };
  }, [raceId, refreshPackage, sync, reload]);

  const addPartyAction = useCallback(async (action: PartyAction) => {
    if (!raceId) return;
    await partyStoreRef.current.add({ raceId, requestId: crypto.randomUUID(), createdAt: new Date().toISOString(), status: "pending", action });
    await reload();
    void sync();
  }, [raceId, reload, sync]);

  return { pkg, pkgRef, items, itemsRef, elsewhere, registrations, registrationsRef, online, loginNeeded, syncProblem, serverDown,
    failedReadouts, setFailedReadouts, persistent, storeRef, partyActions, reload, sync, addPartyAction };
}
