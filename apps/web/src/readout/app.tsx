import { useCallback, useEffect, useRef, useState } from "react";
import { sportidentReadoutPayloadSchema, type ReadoutPackage } from "@o-tid/contracts";
import { WebSerialTransport, type WebSerialPortLike } from "@o-tid/device-transport";
import type { SiCardData } from "@o-tid/sportident";
import { enterRace, fetchReadoutPackage, raceAdminCsrf } from "./api";
import { evaluateLocally, formatRunningTime, type LocalVerdict } from "./evaluate";
import { exerciseCard, exerciseRunners, type ExerciseVariant } from "./exercise";
import { FakeStationTransport } from "./fake-transport";
import { buildReadoutPayload, payloadHash } from "./payload";
import { StationController, type StationStatus } from "./station";
import { IdbReadoutStore, type QueuedReadout, type ReadoutStore } from "./store";
import { syncPending } from "./sync";
import { readoutText as t } from "./text-sv";

type Current =
  | { readonly phase: "reading"; readonly cardNumber: number }
  | { readonly phase: "failed"; readonly message: string }
  | { readonly phase: "done"; readonly cardNumber: string; readonly localSequence: number; readonly verdict?: LocalVerdict; readonly invalid?: boolean };

type SerialNavigator = Navigator & { serial?: { requestPort(): Promise<WebSerialPortLike> } };

const SYNC_INTERVAL_MS = 5_000;
const PACKAGE_INTERVAL_MS = 60_000;
const BAUD_RATES = [38_400, 4_800];

function raceIdFromHash(): string | undefined {
  const value = window.location.hash.slice(1);
  return /^[0-9a-f-]{36}$/.test(value) ? value : undefined;
}

function fetchedAt(pkg: ReadoutPackage): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: pkg.event.timeZone, hour: "2-digit", minute: "2-digit" })
    .format(new Date(pkg.fetchedAt));
}

function stationText(status: StationStatus, exercise: boolean): string {
  switch (status.kind) {
    case "ready": return exercise ? t.stationStatus.exercise : t.stationStatus.ready(status.serialNumber);
    case "connecting": return t.stationStatus.connecting;
    case "misconfigured": return t.stationStatus.misconfigured;
    case "no-response": return t.stationStatus.noResponse;
    case "error": return `${t.stationStatus.error}: ${status.message}`;
    case "disconnected": return t.stationStatus.disconnected;
  }
}

export function ReadoutApp({ store = new IdbReadoutStore() }: { store?: ReadoutStore }) {
  const [raceId] = useState(raceIdFromHash);
  const [pkg, setPkg] = useState<ReadoutPackage>();
  const [items, setItems] = useState<QueuedReadout[]>([]);
  const [station, setStation] = useState<StationStatus>({ kind: "disconnected" });
  const [exercise, setExercise] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [syncProblem, setSyncProblem] = useState<string>();
  const [current, setCurrent] = useState<Current>();
  const [runnerId, setRunnerId] = useState("");
  const [persistent, setPersistent] = useState(true);
  const storeRef = useRef(store);
  const pkgRef = useRef<ReadoutPackage | undefined>(undefined);
  const controllerRef = useRef<StationController | undefined>(undefined);
  const exerciseRef = useRef<FakeStationTransport | undefined>(undefined);
  const syncing = useRef(false);

  const reload = useCallback(async () => {
    if (raceId) setItems(await storeRef.current.list(raceId));
  }, [raceId]);

  const refreshPackage = useCallback(async () => {
    if (!raceId) return;
    let outcome = await fetchReadoutPackage(raceId);
    if (outcome.kind === "unauthorized" && await enterRace(raceId)) outcome = await fetchReadoutPackage(raceId);
    if (outcome.kind === "ok") {
      await storeRef.current.savePackage(outcome.value);
      pkgRef.current = outcome.value; setPkg(outcome.value); setOnline(true); setLoginNeeded(false);
    } else if (outcome.kind === "unauthorized") setLoginNeeded(true);
    else if (outcome.kind === "offline") setOnline(false);
  }, [raceId]);

  const sync = useCallback(async () => {
    if (!raceId || syncing.current) return;
    syncing.current = true;
    try {
      const deps = { fetch: window.fetch.bind(window), csrf: raceAdminCsrf };
      let outcome = await syncPending(storeRef.current, raceId, deps);
      if (outcome.kind === "unauthorized" && await enterRace(raceId)) outcome = await syncPending(storeRef.current, raceId, deps);
      setLoginNeeded(outcome.kind === "unauthorized");
      if (outcome.kind === "offline") setOnline(false);
      if (outcome.kind === "synced" || outcome.kind === "idle") { setOnline(true); setSyncProblem(undefined); }
      if (outcome.kind === "failed") setSyncProblem(t.syncFailed(outcome.status));
    } catch (error) {
      setSyncProblem(error instanceof Error ? error.message : String(error));
    } finally {
      syncing.current = false;
      await reload();
    }
  }, [raceId, reload]);

  useEffect(() => {
    if (!raceId) return;
    void (async () => {
      const saved = await storeRef.current.loadPackage(raceId);
      if (saved && !pkgRef.current) { pkgRef.current = saved; setPkg(saved); }
      await reload();
      if (navigator.storage?.persist) setPersistent(await navigator.storage.persist());
      await refreshPackage();
      await sync();
    })().catch((error: unknown) => setSyncProblem(error instanceof Error ? error.message : String(error)));
    const syncTimer = setInterval(() => { void sync(); }, SYNC_INTERVAL_MS);
    const packageTimer = setInterval(() => { void refreshPackage(); }, PACKAGE_INTERVAL_MS);
    const wentOnline = () => { setOnline(true); void refreshPackage().then(sync); };
    const wentOffline = () => setOnline(false);
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    return () => {
      clearInterval(syncTimer); clearInterval(packageTimer);
      window.removeEventListener("online", wentOnline); window.removeEventListener("offline", wentOffline);
    };
  }, [raceId, refreshPackage, sync, reload]);

  const onCardRead = useCallback(async (card: SiCardData, frames: readonly Uint8Array[], serial: number | undefined) => {
    if (!raceId) return;
    const now = new Date();
    const known = pkgRef.current;
    const timeZone = known?.event.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const payload = buildReadoutPayload(card, frames, {
      reference: now, timeZone, simulated: exerciseRef.current !== undefined,
      ...(serial !== undefined ? { stationSerial: serial } : {})
    });
    const valid = sportidentReadoutPayloadSchema.safeParse(payload).success;
    const stored = await storeRef.current.append(raceId, {
      packageVersion: known?.packageVersion ?? 1, stationReceivedAt: now.toISOString(),
      payload, contentHash: await payloadHash(payload)
    });
    if (!valid) await storeRef.current.update({ ...stored, status: "rejected", rejectedReason: "LOCAL_INVALID" });
    setCurrent({ phase: "done", cardNumber: payload.cardNumber, localSequence: stored.localSequence,
      ...(known ? { verdict: evaluateLocally(payload, known) } : {}), ...(valid ? {} : { invalid: true }) });
    await reload();
    void sync();
  }, [raceId, reload, sync]);

  const attach = useCallback(async (controller: StationController): Promise<boolean> => {
    await controllerRef.current?.stop();
    controllerRef.current = controller;
    return controller.start();
  }, []);

  const callbacks = {
    onStatus: setStation,
    onCardInserted: (cardNumber: number) => setCurrent({ phase: "reading", cardNumber }),
    onCardRead: (card: SiCardData, frames: readonly Uint8Array[], serial: number | undefined) => {
      onCardRead(card, frames, serial).catch((error: unknown) =>
        setCurrent({ phase: "failed", message: error instanceof Error ? error.message : String(error) }));
    },
    onReadFailed: (cardNumber: number) => setCurrent({ phase: "failed", message: t.readFailed(cardNumber) }),
    onUnsupportedCard: (cardNumber: number) => setCurrent({ phase: "failed", message: t.unsupported(cardNumber) })
  };

  async function connectSerial() {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) { setStation({ kind: "error", message: t.serialUnsupported }); return; }
    let port: WebSerialPortLike;
    try { port = await serial.requestPort(); }
    catch { setStation({ kind: "disconnected" }); return; }
    exerciseRef.current = undefined; setExercise(false);
    for (const baudRate of BAUD_RATES) {
      if (await attach(new StationController(new WebSerialTransport(port, { baudRate }), callbacks))) return;
    }
    await controllerRef.current?.stop();
    setStation({ kind: "error", message: t.serialFailed });
  }

  async function connectExercise() {
    const transport = new FakeStationTransport();
    exerciseRef.current = transport; setExercise(true);
    await attach(new StationController(transport, callbacks));
  }

  async function disconnect() {
    await controllerRef.current?.stop();
    controllerRef.current = undefined; exerciseRef.current = undefined; setExercise(false);
  }

  function readExercise(variant: ExerciseVariant | "unknown") {
    const transport = exerciseRef.current;
    if (!transport || !pkg) return;
    const runner = runners.find((candidate) => candidate.entryId === runnerId) ?? runners[0];
    if (variant === "unknown") {
      // En löpare med en bricka som inte är anmäld, på vald deltagares bana.
      const used = new Set(pkg.raceSnapshot.cardAssignments.map((assignment) => assignment.cardNumber));
      let number = 7_100_000 + Math.floor(Math.random() * 800_000);
      while (used.has(String(number))) number += 1;
      transport.insert(exerciseCard(number, runner?.controlCodes ?? [], "ok", new Date(), pkg.event.timeZone));
      return;
    }
    if (runner) transport.insert(exerciseCard(runner.cardNumber, runner.controlCodes, variant, new Date(), pkg.event.timeZone));
  }

  if (!raceId) return <main className="readout"><h1>{t.title}</h1><p className="notice">{t.noRace}</p></main>;

  const runners = pkg ? exerciseRunners(pkg) : [];
  const waiting = items.filter((item) => item.status === "pending").length;
  const recent = [...items].sort((a, b) => b.localSequence - a.localSequence).slice(0, 10);
  const currentItem = current?.phase === "done" ? items.find((item) => item.localSequence === current.localSequence) : undefined;
  const connected = station.kind === "ready" || station.kind === "misconfigured" || station.kind === "connecting";

  return <main className="readout">
    <header>
      <h1>{t.title}</h1>
      {pkg ? <p className="race">{pkg.event.name} · {pkg.raceSnapshot.race.name}</p> : null}
      <dl className="status" aria-label="Status">
        <div data-state={station.kind === "ready" ? "good" : station.kind === "disconnected" ? "idle" : "bad"}>
          <dt>{t.station}</dt><dd data-testid="station-status">{station.kind === "ready" ? "● " : "○ "}{stationText(station, exercise)}</dd></div>
        <div data-state={online ? "good" : "bad"}>
          <dt>{t.internet}</dt><dd data-testid="internet-status">{online ? `● ${t.online}` : `○ ${t.offline}`}</dd></div>
        <div data-state={waiting === 0 ? "good" : "warn"}>
          <dt>{t.queue}</dt><dd data-testid="queue-status">{waiting === 0 ? t.queueEmpty : t.queueWaiting(waiting)}</dd></div>
        <div data-state={pkg ? "good" : "bad"}>
          <dt>{t.packageLabel}</dt><dd data-testid="package-status">{pkg ? t.packageVersion(pkg.packageVersion, fetchedAt(pkg)) : t.packageMissing}</dd></div>
      </dl>
    </header>

    {loginNeeded ? <p className="notice" role="alert">{t.loginNeeded} <a href="/organizer">{t.login}</a></p> : null}
    {syncProblem ? <p className="notice" role="alert">{syncProblem}</p> : null}
    {!persistent ? <p className="notice">{t.storageNotPersistent}</p> : null}
    {station.kind === "misconfigured" ? <p className="notice" role="alert">{t.misconfiguredHelp} ({station.problems.join(", ")})</p> : null}

    <section className="verdict" aria-live="assertive" data-testid="verdict"
      data-status={current?.phase === "done" ? current.verdict?.status ?? "NO_PACKAGE" : current?.phase ?? "idle"}>
      <Verdict current={current} item={currentItem} />
    </section>

    <section className="controls">
      {connected
        ? <button type="button" onClick={() => { void disconnect(); }}>{t.disconnect}</button>
        : <>
          <button type="button" className="primary" onClick={() => { void connectSerial(); }}>{t.connectSerial}</button>
          <button type="button" onClick={() => { void connectExercise(); }}>{t.connectExercise}</button>
        </>}
    </section>

    {exercise && station.kind === "ready" ? <section className="exercise" aria-label={t.exercise}>
      <h2>{t.exercise}</h2>
      <p>{t.exerciseHelp}</p>
      {runners.length === 0 ? <p>{t.exerciseNoRunners}</p> : <label>{t.exerciseRunner}
        <select value={runnerId} onChange={(event) => setRunnerId(event.target.value)}>
          {runners.map((runner) => <option key={runner.entryId} value={runner.entryId}>{runner.label}</option>)}
        </select></label>}
      <div className="row">
        <button type="button" disabled={runners.length === 0} onClick={() => readExercise("ok")}>{t.exerciseOk}</button>
        <button type="button" disabled={runners.length === 0} onClick={() => readExercise("missing-control")}>{t.exerciseMissing}</button>
        <button type="button" disabled={runners.length === 0} onClick={() => readExercise("no-finish")}>{t.exerciseNoFinish}</button>
        <button type="button" disabled={!pkg} onClick={() => readExercise("unknown")}>{t.exerciseUnknown}</button>
      </div>
    </section> : null}

    <section className="recent">
      <h2>{t.recent}</h2>
      {recent.length === 0 ? <p>{t.none}</p> : <ol data-testid="recent-readouts">
        {recent.map((item) => <RecentRow key={item.localSequence} item={item} pkg={pkg} />)}
      </ol>}
    </section>

    <nav className="links">
      <a href={`/admin/${raceId}/manage`}>{t.manage}</a>
      <a href={`/results/${raceId}`}>{t.results}</a>
    </nav>
  </main>;
}

function Verdict({ current, item }: { current: Current | undefined; item: QueuedReadout | undefined }) {
  if (!current) return <p className="big">{t.waitingForCard}</p>;
  if (current.phase === "reading") return <p className="big">{t.reading(current.cardNumber)}</p>;
  if (current.phase === "failed") return <p className="big">✗ {current.message}</p>;
  const verdict = current.verdict;
  const symbol = !verdict ? "✓" : verdict.status === "OK" ? "✓" : verdict.status === "MP" ? "✗" : "?";
  return <>
    <p className="big">{symbol} {verdict ? t.verdict[verdict.status] : t.verdict.NO_PACKAGE}</p>
    <p className="card">Bricka {current.cardNumber}{verdict?.name ? ` · ${verdict.name}` : ""}{verdict?.className ? ` · ${verdict.className}` : ""}</p>
    {verdict?.elapsedMs !== undefined && verdict.status === "OK" ? <p className="time">{formatRunningTime(verdict.elapsedMs)}</p> : null}
    {verdict && verdict.status !== "OK" ? <p>{t.reason[verdict.reason]}</p> : null}
    {verdict && verdict.missingControls.length > 0 ? <p>{t.missing(verdict.missingControls)}</p> : null}
    {!verdict ? <p>{t.noPackage}</p> : null}
    {verdict && verdict.splits.length > 0 ? <ol className="splits" aria-label={t.splits}>
      {verdict.splits.map((split, index) => <li key={index}>
        <span>{split.controlCode}</span> <span>{formatRunningTime(split.legMs)}</span> <span>({formatRunningTime(split.elapsedMs)})</span>
      </li>)}
    </ol> : null}
    {current.invalid ? <p>{t.localInvalid}</p> : null}
    {verdict && item?.serverResult && item.serverResult.status !== verdict.status
      ? <p role="alert">{t.serverDiffers(t.verdict[item.serverResult.status])}</p> : null}
    <p className="sync">{item?.status === "pending" ? t.savedLocally
      : item?.status === "rejected" ? t.rejected(item.rejectedReason ?? "")
      : item ? t.confirmed : t.savedLocally}</p>
  </>;
}

function RecentRow({ item, pkg }: { item: QueuedReadout; pkg: ReadoutPackage | undefined }) {
  const verdict = pkg ? evaluateLocally(item.payload, pkg) : undefined;
  const status = item.serverResult?.status ?? verdict?.status;
  const queue = item.status === "pending" ? t.statusPending : item.status === "stored" ? t.statusStored
    : item.status === "duplicate" ? t.statusDuplicate : t.statusRejected;
  return <li data-sequence={item.localSequence}>
    <span className="card">{item.payload.cardNumber}</span>
    <span>{verdict?.name ?? ""}</span>
    <span>{status ? t.verdict[status] : ""}</span>
    <span className="queue">{queue}</span>
  </li>;
}
