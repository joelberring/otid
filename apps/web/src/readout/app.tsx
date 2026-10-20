import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sportidentReadoutPayloadSchema, type ReadoutPackage } from "@o-tid/contracts";
import { CP210X_USB_FILTERS, WebSerialTransport, WebUsbCp210xPort, type WebSerialPortLike } from "@o-tid/device-transport";
import { SiTimeError, type SiCardData } from "@o-tid/sportident";
import { accountCsrf, fetchReadoutPackage, searchRunnerDatabase } from "./api";
import { evaluateLocally, formatRunningTime, withLocalRegistrations, type LocalVerdict } from "./evaluate";
import { exerciseAnchor, exerciseCard, exerciseRunners, exerciseWindow, type ExerciseVariant } from "./exercise";
import { FakeStationTransport } from "./fake-transport";
import { buildReadoutPayload, payloadHash } from "./payload";
import { StationController, type StationFacts, type StationStatus } from "./station";
import { TrafficLog } from "./rawlog";
import { IdbReadoutStore, type QueuedReadout, type QueuedRegistration, type ReadoutStore } from "./store";
import { RegistrationForm, RegistrationStatus, type RegistrationFields } from "./registration-form";
import type { EntrySuggestion } from "./runner-lookup";
import { startPunchText } from "../lib/start-punch-text";
import { heldReadouts, releaseHeldReadouts, syncPending } from "./sync";
import { loadFailedReadouts, saveFailedReadouts, type FailedReadout } from "./failed-readouts";
import { localRaceDate } from "@o-tid/domain";
import { toHex } from "./payload";
import { readoutText as t } from "./text-sv";
import { ReceiptPanel, type Printable } from "./receipt-panel";
import { QrCode } from "./receipt-view";
import { PunchListView } from "./punch-list-view";
import { receiptLink } from "./receipt";
import { loadReceiptSettings, saveReceiptSettings, type ReceiptSettings } from "./receipt-settings";
import { serialIdentity, usbIdentity, useStationAutoConnect, type SerialApi, type SerialStation, type UsbApi,
  type UsbStation } from "./station-auto";

type Current =
  | { readonly phase: "reading"; readonly cardNumber: number }
  | { readonly phase: "failed"; readonly message: string }
  | { readonly phase: "done"; readonly cardNumber: string; readonly localSequence: number; readonly verdict?: LocalVerdict; readonly invalid?: boolean };

type SerialNavigator = Navigator & { serial?: SerialApi };
/** WebUSB: läsplattor (Chrome på Android ser inte stationens CP210x-chip som serieport). */
type UsbNavigator = Navigator & { usb?: UsbApi };
/** Visa USB-knappen där Web Serial inte når stationen: Android, eller utan Web Serial. */
const showUsbButton = typeof navigator !== "undefined" && !!(navigator as UsbNavigator).usb &&
  (/Android/i.test(navigator.userAgent) || !(navigator as SerialNavigator).serial);

const SYNC_INTERVAL_MS = 5_000;
const PACKAGE_INTERVAL_MS = 60_000;
const BAUD_RATES = [38_400, 4_800];
/** Större klockskillnad mellan stationen och datorn än så visas som en varning (PLAN.md steg 22). */
const CLOCK_SKEW_WARNING_MS = 5 * 60_000;

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
  /** Direktanmälningar av okända brickor (PLAN.md steg 25), köade som avläsningarna. */
  const [registrations, setRegistrations] = useState<QueuedRegistration[]>([]);
  const [station, setStation] = useState<StationStatus>({ kind: "disconnected" });
  const [exercise, setExercise] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [syncProblem, setSyncProblem] = useState<string>();
  // Steg 31: avläsningar vars tider inte gick att tolka (sparas i webbläsaren tills funktionären tar bort dem).
  const [failedReadouts, setFailedReadouts] = useState<FailedReadout[]>(() => raceId ? loadFailedReadouts(raceId) : []);
  const [current, setCurrent] = useState<Current>();
  const [runnerId, setRunnerId] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(() => loadReceiptSettings());
  const storeRef = useRef(store);
  const pkgRef = useRef<ReadoutPackage | undefined>(undefined);
  const controllerRef = useRef<StationController | undefined>(undefined);
  const exerciseRef = useRef<FakeStationTransport | undefined>(undefined);
  const syncing = useRef(false);
  const trafficRef = useRef(new TrafficLog());

  const itemsRef = useRef<QueuedReadout[]>([]);
  const registrationsRef = useRef<QueuedRegistration[]>([]);
  const reload = useCallback(async () => {
    if (!raceId) return;
    const [listed, registered] = await Promise.all([storeRef.current.list(raceId), storeRef.current.listRegistrations(raceId)]);
    itemsRef.current = listed; setItems(listed);
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

  const sync = useCallback(async () => {
    if (!raceId || syncing.current) return;
    syncing.current = true;
    try {
      const deps = { fetch: window.fetch.bind(window), csrf: accountCsrf };
      const outcome = await syncPending(storeRef.current, raceId, deps);
      setLoginNeeded(outcome.kind === "unauthorized");
      if (outcome.kind === "offline") setOnline(false);
      if (outcome.kind === "synced" || outcome.kind === "idle") { setOnline(true); setSyncProblem(undefined); }
      if (outcome.kind === "failed") setSyncProblem(t.syncFailed(outcome.status));
      // Kvitterade direktanmälningar finns nu i serverns paket; hämta det så att brickan är känd även utan den lokala kön.
      if (outcome.kind === "synced" && outcome.registered) await refreshPackage();
    } catch (error) {
      setSyncProblem(error instanceof Error ? error.message : String(error));
    } finally {
      syncing.current = false;
      await reload();
    }
  }, [raceId, reload, refreshPackage]);

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

  const onCardRead = useCallback(async (card: SiCardData, frames: readonly Uint8Array[], station: StationFacts) => {
    if (!raceId) return;
    const now = new Date();
    const known = pkgRef.current;
    const timeZone = known?.event.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Stämplingstiderna löses mot stationens klocka när den finns (PLAN.md steg 22); övningsstationens klocka
    // står på tävlingsdagen. Datorns klocka är reservalternativet och avläsningen bär vilken som användes.
    const exercise = exerciseRef.current;
    const reference = exercise ? exercise.now() : station.clock ? new Date(now.getTime() + station.clock.clockOffsetMs) : now;
    const clockOffsetMs = exercise ? exercise.now().getTime() - now.getTime() : station.clock?.clockOffsetMs;
    const build = (useStation: boolean) => buildReadoutPayload(card, frames, {
      reference: useStation ? reference : now, timeZone, simulated: exercise !== undefined,
      ...(station.serialNumber !== undefined ? { stationSerial: station.serialNumber } : {}),
      clockSource: !useStation || clockOffsetMs === undefined ? "device" : "station",
      ...(!useStation || clockOffsetMs === undefined ? {} : { clockOffsetMs: Math.round(clockOffsetMs) })
    });
    let payload: ReturnType<typeof buildReadoutPayload>;
    try { payload = build(true); }
    catch (error) {
      // Steg 31: går tiderna inte att placera med stationens klocka prövas datorns. Går det inte heller sparas brickans
      // råramar i webbläsaren och funktionären ser ett tydligt besked, i stället för att avläsningen försvinner.
      if (!(error instanceof SiTimeError)) throw error;
      try { payload = build(false); }
      catch (fallback) {
        if (!(fallback instanceof SiTimeError)) throw fallback;
        const failed: FailedReadout = { cardNumber: String(card.cardNumber), at: now.toISOString(), message: fallback.message,
          frames: frames.map(toHex) };
        const rows = [...loadFailedReadouts(raceId), failed];
        saveFailedReadouts(raceId, rows); setFailedReadouts(rows);
        throw fallback;
      }
    }
    const valid = sportidentReadoutPayloadSchema.safeParse(payload).success;
    const stored = await storeRef.current.append(raceId, {
      packageVersion: known?.packageVersion ?? 1, stationReceivedAt: now.toISOString(),
      payload, contentHash: await payloadHash(payload)
    });
    if (!valid) await storeRef.current.update({ ...stored, status: "rejected", rejectedReason: "LOCAL_INVALID" });
    setCurrent({ phase: "done", cardNumber: payload.cardNumber, localSequence: stored.localSequence,
      ...(known ? { verdict: evaluateLocally(payload, withLocalRegistrations(known, registrationsRef.current),
        itemsRef.current.map((item) => item.payload), now.toISOString()) } : {}),
      ...(valid ? {} : { invalid: true }) });
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
    onCardRead: (card: SiCardData, frames: readonly Uint8Array[], station: StationFacts) => {
      onCardRead(card, frames, station).catch((error: unknown) =>
        setCurrent({ phase: "failed", message: error instanceof SiTimeError ? t.timeUnresolvable(error.message)
          : error instanceof Error ? error.message : String(error) }));
    },
    onReadFailed: (cardNumber: number) => setCurrent({ phase: "failed", message: t.readFailed(cardNumber) }),
    onUnsupportedCard: (cardNumber: number) => setCurrent({ phase: "failed", message: t.unsupported(cardNumber) }),
    onTraffic: (direction: "in" | "out", bytes: Uint8Array) => trafficRef.current.add(direction, bytes)
  };

  function downloadRawLog() {
    if (!raceId) return;
    const text = trafficRef.current.export(raceId, items, navigator.userAgent);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `otid-ralogg-${new Date().toISOString().replaceAll(":", "")}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove();
    } finally { URL.revokeObjectURL(url); }
  }

  async function connectSerial() {
    const serial = (navigator as SerialNavigator).serial;
    if (!serial) { setStation({ kind: "error", message: t.serialUnsupported }); return; }
    let port: SerialStation;
    try { port = await serial.requestPort(); }
    catch { setStation({ kind: "disconnected" }); return; }
    // Steg 35: en lyckad anslutning sparas, så att stationen ansluts själv nästa gång.
    if (await connectPort(port)) auto.remember("serial", serialIdentity(port));
  }

  /** Ger sant när stationen svarade (på någon av hastigheterna). */
  async function connectPort(port: WebSerialPortLike): Promise<boolean> {
    exerciseRef.current = undefined; setExercise(false);
    const timeZone = pkgRef.current?.event.timeZone;
    for (const baudRate of BAUD_RATES) {
      if (await attach(new StationController(new WebSerialTransport(port, { baudRate }), callbacks, timeZone ? { timeZone } : {}))) return true;
    }
    await controllerRef.current?.stop();
    setStation({ kind: "error", message: t.serialFailed });
    return false;
  }

  /** Stationen direkt över WebUSB (läsplatta). Samma avläsning som Web Serial när porten väl är öppen. */
  async function connectUsb() {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) { setStation({ kind: "error", message: t.usbUnsupported }); return; }
    let device: UsbStation;
    try { device = await usb.requestDevice({ filters: CP210X_USB_FILTERS }); }
    catch { setStation({ kind: "disconnected" }); return; }
    if (await connectUsbDevice(device)) auto.remember("usb", usbIdentity(device));
  }

  /** En godkänd USB-enhet (vald nu eller sparad sedan förut). */
  async function connectUsbDevice(device: UsbStation): Promise<boolean> {
    const usb = (navigator as UsbNavigator).usb;
    if (!usb) return false;
    const port = new WebUsbCp210xPort(device, usb);
    // Prova att ta enheten först: en annan app på plattan kan hålla den.
    try { await port.open({ baudRate: BAUD_RATES[0]! }); await port.close(); }
    catch (error) {
      setStation({ kind: "error", message: t.usbBusy(error instanceof Error ? error.message : String(error)) });
      return false;
    }
    return connectPort(port);
  }

  async function connectExercise() {
    const timeZone = pkgRef.current?.event.timeZone;
    const transport = new FakeStationTransport(timeZone ? { timeZone } : {});
    exerciseRef.current = transport; setExercise(true);
    await attach(new StationController(transport, callbacks, timeZone ? { timeZone } : {}));
  }

  async function disconnect() {
    // Steg 35: en manuell frånkoppling ansluter inte igen av sig själv förrän nästa gång sidan öppnas.
    auto.pause();
    await controllerRef.current?.stop();
    controllerRef.current = undefined; exerciseRef.current = undefined; setExercise(false);
  }

  function readExercise(variant: ExerciseVariant | "unknown" | "runner-database") {
    const transport = exerciseRef.current;
    if (!transport || !pkg) return;
    const runner = runners.find((candidate) => candidate.entryId === runnerId) ?? runners[0];
    const now = new Date();
    if (variant === "unknown" || variant === "runner-database") {
      // En löpare med en bricka som inte är anmäld, på vald deltagares bana, i mål strax före "nu" på tävlingsdagen.
      // Ur löpardatabasen (PLAN.md steg 29): första brickan där som inte är anmäld, så att förifyllningen kan övas.
      const used = new Set(pkg.raceSnapshot.cardAssignments.map((assignment) => assignment.cardNumber));
      const fromDatabase = variant === "runner-database" ? unusedDatabaseCard(pkg, registrations) : undefined;
      let number = fromDatabase ?? 7_100_000 + Math.floor(Math.random() * 800_000);
      while (used.has(String(number))) number += 1;
      const anchor = exerciseAnchor(pkg.raceSnapshot.race.raceDate, pkg.event.timeZone, now);
      transport.insert(exerciseCard(number, runner?.controlCodes ?? [], "ok", anchor, pkg.event.timeZone), new Date(anchor.getTime() + 5_000));
      return;
    }
    if (!runner) return;
    // Tiderna följer löparens starttid och tävlingsdagen; övningsstationens klocka ställs strax efter målgången.
    const window = exerciseWindow(pkg, runner, variant, now);
    transport.insert(exerciseCard(runner.cardNumber, runner.controlCodes, variant, now, pkg.event.timeZone, window),
      new Date(window.finishAt.getTime() + 5_000));
  }

  // Paketet med den här webbläsarens direktanmälningar, så att en anmäld bricka bedöms lokalt även utan nät (PLAN.md steg 25).
  const effectivePkg = useMemo(() => pkg ? withLocalRegistrations(pkg, registrations) : undefined, [pkg, registrations]);
  const currentItem = current?.phase === "done" ? items.find((item) => item.localSequence === current.localSequence) : undefined;
  // Beskedet bedöms om när paketet eller anmälningarna ändras, så att "Lägg till" ger beskedet för den nya löparen direkt.
  const localVerdict = useMemo(() => {
    if (current?.phase !== "done") return undefined;
    if (!currentItem || !effectivePkg) return current.verdict;
    const earlier = items.filter((item) => item.localSequence < currentItem.localSequence).map((item) => item.payload);
    return evaluateLocally(currentItem.payload, effectivePkg, earlier, currentItem.stationReceivedAt);
  }, [current, currentItem, effectivePkg, items]);
  // Steg 31 (B4): brickan har redan lästs ut för någon annan. Serverns svar avgör: okänd = lånad bricka (den förstes
  // resultat skrivs inte över), ett resultat = samma avläsning igen. Utan svar räcker en tidigare annorlunda avläsning här.
  const registeredHere = current?.phase === "done" && registrations.some((row) => row.request.cardNumber === current.cardNumber &&
    row.localSequence === current.localSequence && row.status !== "rejected");
  const alreadyReadOut = !registeredHere && localVerdict?.alreadyReadOutBy && (currentItem?.serverResult
    ? currentItem.serverResult.status === "UNKNOWN_CARD" : true) ? localVerdict.alreadyReadOutBy : undefined;
  const borrowed = alreadyReadOut && (alreadyReadOut.certain || currentItem?.serverResult?.status === "UNKNOWN_CARD")
    ? alreadyReadOut : undefined;
  const verdict = useMemo(() => localVerdict && borrowed
    ? { ...localVerdict, status: "UNKNOWN_CARD" as const, reason: "UNKNOWN_CARD" as const, missingControls: [], splits: [] }
    : localVerdict, [localVerdict, borrowed]);
  const currentRegistration = current?.phase === "done"
    ? registrations.filter((row) => row.request.cardNumber === current.cardNumber).at(-1) : undefined;

  async function register(fields: RegistrationFields, borrowedCard = false) {
    if (!raceId || current?.phase !== "done") return;
    const requestId = crypto.randomUUID();
    await storeRef.current.addRegistration({ raceId, requestId, localSequence: current.localSequence, createdAt: new Date().toISOString(),
      status: "pending", request: { formatVersion: 1, requestId, cardNumber: current.cardNumber, classId: fields.classId,
        givenName: fields.givenName.trim(), familyName: fields.familyName.trim(), organisationName: fields.club.trim() || null,
        ...(fields.eventorPersonId ? { eventorPersonId: fields.eventorPersonId } : {}),
        ...(fields.eventorOrganisationId ? { eventorOrganisationId: fields.eventorOrganisationId } : {}),
        ...(borrowedCard ? { borrowedCard: true as const } : {}) } });
    await reload();
    void sync();
  }

  /** PLAN.md steg 29: koppla den okända brickan till en anmäld deltagare, köat som en anmälan (även offline). */
  async function linkEntry(entry: Pick<EntrySuggestion, "entryId" | "classId" | "name" | "className">, borrowedCard = false) {
    if (!raceId || current?.phase !== "done") return;
    const requestId = crypto.randomUUID();
    await storeRef.current.addRegistration({ raceId, requestId, localSequence: current.localSequence, createdAt: new Date().toISOString(),
      status: "pending", display: { entryName: entry.name, className: entry.className },
      request: { formatVersion: 1, requestId, cardNumber: current.cardNumber, target: "EXISTING_ENTRY", entryId: entry.entryId,
        expectedClassId: entry.classId, ...(borrowedCard ? { borrowedCard: true as const } : {}) } });
    await reload();
    void sync();
  }
  // Hela landets löpare söks på servern när nätet finns; annars räcker paketets klubbar.
  const searchServer = useMemo(() => raceId && online && pkg?.runnerLookup?.wholeCountryOnServer
    ? (request: Parameters<typeof searchRunnerDatabase>[1]) => searchRunnerDatabase(raceId, request) : undefined,
  [raceId, online, pkg?.runnerLookup?.wholeCountryOnServer]);

  // Steg 35: stationen ansluts själv när sidan öppnas och när den sätts i, om den har anslutits här förut.
  const connected = station.kind === "ready" || station.kind === "misconfigured" || station.kind === "connecting";
  const auto = useStationAutoConnect({ serial: (navigator as SerialNavigator).serial, usb: (navigator as UsbNavigator).usb,
    connected, ready: pkg !== undefined, connectSerialPort: connectPort, connectUsbDevice,
    label: (link, index, identity, name) => link === "usb" ? t.autoStationUsb(index, identity.serialNumber, name) : t.autoStationSerial(index) });

  if (!raceId) return <main className="readout"><h1>{t.title}</h1><p className="notice">{t.noRace}</p></main>;

  const runners = pkg ? exerciseRunners(pkg) : [];
  const selectedRunner = runners.find((candidate) => candidate.entryId === runnerId) ?? runners[0];
  const waiting = items.filter((item) => item.status === "pending").length;
  const held = heldReadouts(items);
  // Steg 31: övningsstationen skriver riktiga avläsningar; på tävlingsdagen varnas tydligt.
  const raceDay = pkg ? localRaceDate(new Date(), pkg.event.timeZone) === pkg.raceSnapshot.race.raceDate : false;
  const recent = [...items].sort((a, b) => b.localSequence - a.localSequence).slice(0, 10);
  // Klockskillnad i hela minuter, bara för en riktig station (övningsstationens klocka står med flit på tävlingsdagen).
  const clockSkew = !exercise && station.kind === "ready" && station.clock && Math.abs(station.clock.clockOffsetMs) >= CLOCK_SKEW_WARNING_MS
    ? Math.round(station.clock.clockOffsetMs / 60_000) : undefined;
  const printable: Printable | undefined = current?.phase === "done" && verdict && pkg
    ? { localSequence: current.localSequence, cardNumber: current.cardNumber, verdict } : undefined;
  // QR-koden på skärmen: för en känd löpare, så att hen kan skanna i stället för att ta ett papperskvitto.
  const screenQr = printable && receiptSettings.showQr && pkg && printable.verdict.entryId
    ? receiptLink(pkg, printable.verdict.entryId, window.location.origin) : undefined;

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
          <dt>{t.packageLabel}</dt><dd data-testid="package-status">{pkg ? <>{t.packageUpdated(fetchedAt(pkg))} <small className="package-version"
            title={t.packageVersionTitle(pkg.packageVersion)}>{t.packageVersion(pkg.packageVersion)}</small></> : t.packageMissing}</dd></div>
      </dl>
    </header>

    {loginNeeded ? <p className="notice" role="alert">{t.loginNeeded} <a href="/organizer">{t.login}</a></p> : null}
    {syncProblem ? <p className="notice" role="alert">{syncProblem}</p> : null}
    {held.length > 0 ? <p className="notice" role="alert" data-testid="held-readouts">{t.heldReadouts(held.length)}{" "}
      <button type="button" onClick={() => { if (raceId) void releaseHeldReadouts(storeRef.current, raceId).then(sync); }}>
        {t.heldRetry}</button></p> : null}
    {failedReadouts.length > 0 ? <section className="notice" role="alert" data-testid="failed-readouts" aria-label={t.failedTitle}>
      <strong>{t.failedTitle}</strong> {t.failedHelp}
      <ul>{failedReadouts.map((row) => <li key={`${row.cardNumber}-${row.at}`}>{t.failedRow(row.cardNumber,
        new Date(row.at).toLocaleTimeString("sv-SE"), row.message)}</li>)}</ul>
      <button type="button" onClick={() => { if (raceId) { saveFailedReadouts(raceId, []); setFailedReadouts([]); } }}>
        {t.failedClear}</button>
    </section> : null}
    {!persistent ? <p className="notice">{t.storageNotPersistent}</p> : null}
    {station.kind === "misconfigured" ? <p className="notice" role="alert">{t.misconfiguredHelp} ({station.problems.join(", ")})</p> : null}
    {clockSkew !== undefined ? <p className="notice" role="alert" data-testid="clock-skew">{t.clockSkew(clockSkew)}</p> : null}
    {!exercise && station.kind === "ready" && !station.clock ? <p className="notice" data-testid="clock-missing">{t.clockMissing}</p> : null}

    <section className="verdict" aria-live="assertive" data-testid="verdict"
      data-status={current?.phase === "done" ? verdict?.status ?? "NO_PACKAGE" : current?.phase ?? "idle"}>
      <Verdict current={current} verdict={verdict} item={currentItem} qr={screenQr} registration={currentRegistration}
        timeZone={pkg?.event.timeZone ?? "Europe/Stockholm"} />
    </section>

    {/* Steg 31 (B4): brickan har redan lästs ut för någon annan – lånad bricka? */}
    {current?.phase === "done" && alreadyReadOut && (!currentRegistration || currentRegistration.status === "rejected")
      ? <section className="notice" role="alert" data-testid="already-read-out" aria-label={t.alreadyReadOutTitle}>
        <p><strong>{borrowed ? t.alreadyReadOut(alreadyReadOut.name) : t.alreadyReadOutPossible(alreadyReadOut.name)}</strong></p>
        {borrowed ? <><p>{t.alreadyReadOutHelp(alreadyReadOut.name)}</p>
          <button type="button" onClick={() => { void linkEntry(alreadyReadOut, true); }}>{t.sameRunner}</button></> : null}
      </section> : null}

    {/* Okänd bricka (PLAN.md steg 25): anmäl löparen här, även utan nät. */}
    {current?.phase === "done" && effectivePkg && (verdict?.status === "UNKNOWN_CARD" || currentRegistration?.status === "rejected") &&
      (!currentRegistration || currentRegistration.status === "rejected")
      ? <RegistrationForm key={current.localSequence} pkg={effectivePkg} cardNumber={current.cardNumber}
        payload={currentItem?.payload ?? { punches: [] }} items={items} registrations={registrations} search={searchServer}
        onSubmit={(fields) => register(fields, !!borrowed)} onLink={(entry) => linkEntry(entry, !!borrowed)} /> : null}

    <ReceiptPanel printable={printable} pkg={pkg} settings={receiptSettings}
      onSettings={(settings) => { setReceiptSettings(settings); saveReceiptSettings(settings); }} />

    <section className="controls">
      {connected
        ? <button type="button" onClick={() => { void disconnect(); }}>{t.disconnect}</button>
        : <>
          <button type="button" className="primary" onClick={() => { void connectSerial(); }}>{t.connectSerial}</button>
          {showUsbButton ? <button type="button" className="primary" onClick={() => { void connectUsb(); }}>{t.connectUsb}</button> : null}
          <button type="button" onClick={() => { void connectExercise(); }}>{t.connectExercise}</button>
          {raceDay ? <small className="exercise-warning">{t.exerciseRaceDayShort}</small> : null}
        </>}
    </section>

    {/* Steg 35: automatisk anslutning till den sparade stationen. */}
    {!exercise && (auto.remembered || auto.choices) ? <section className="auto-connect" data-testid="auto-connect" aria-label={t.autoTitle}>
      {auto.choices ? <>
        <p><strong>{t.autoChoose}</strong></p>
        <div className="row">{auto.choices.map((option, index) => <button key={index} type="button" className="primary"
          onClick={() => { void auto.choose(option); }}>{option.label}</button>)}</div>
      </> : <p role="status">{connected ? t.autoConnected : auto.paused ? t.autoPaused : t.autoConnecting}</p>}
      {auto.problem ? <p role="alert">{t.autoProblem(auto.problem)}</p> : null}
      <button type="button" onClick={auto.stop}>{t.autoStop}</button>
    </section> : null}
    <p className="hint">{t.tabHint}</p>

    {exercise && station.kind === "ready" ? <section className="exercise" aria-label={t.exercise}>
      <h2>{t.exercise}</h2>
      {raceDay ? <p className="notice" role="alert" data-testid="exercise-race-day">{t.exerciseRaceDay}</p> : null}
      <p>{t.exerciseHelp}</p>
      {runners.length === 0 ? <p>{t.exerciseNoRunners}</p> : <label>{t.exerciseRunner}
        <select value={runnerId} onChange={(event) => setRunnerId(event.target.value)}>
          {runners.map((runner) => <option key={runner.entryId} value={runner.entryId}>{runner.label}</option>)}
        </select></label>}
      <div className="row">
        <button type="button" disabled={runners.length === 0} onClick={() => readExercise("ok")}>{t.exerciseOk}</button>
        <button type="button" disabled={runners.length === 0} onClick={() => readExercise("missing-control")}>{t.exerciseMissing}</button>
        <button type="button" disabled={runners.length === 0} onClick={() => readExercise("no-finish")}>{t.exerciseNoFinish}</button>
        {selectedRunner?.timeLimitMs !== undefined
          ? <button type="button" onClick={() => readExercise("late")}>{t.exerciseLate}</button> : null}
        {selectedRunner?.fixedStartTime !== undefined && selectedRunner.timeLimitMs === undefined
          ? <button type="button" onClick={() => readExercise("late-start")}>{t.exerciseLateStart}</button> : null}
        <button type="button" disabled={!pkg} onClick={() => readExercise("unknown")}>{t.exerciseUnknown}</button>
        {pkg && unusedDatabaseCard(pkg, registrations) !== undefined
          ? <button type="button" onClick={() => readExercise("runner-database")}>{t.exerciseRunnerDatabase}</button> : null}
      </div>
    </section> : null}

    <section className="recent">
      <h2>{t.recent}</h2>
      {recent.length === 0 ? <p>{t.none}</p> : <ol data-testid="recent-readouts">
        {recent.map((item) => <RecentRow key={item.localSequence} item={item} pkg={effectivePkg}
          registration={registrations.filter((row) => row.request.cardNumber === item.payload.cardNumber).at(-1)}
          local={items.filter((candidate) => candidate.localSequence < item.localSequence).map((candidate) => candidate.payload)} />)}
      </ol>}
    </section>

    <section className="rawlog">
      <button type="button" onClick={downloadRawLog}>{t.rawLog}</button>
      <p>{t.rawLogHelp}</p>
    </section>

    {/* Steg 35: länkarna öppnas i en ny flik, så att stationen inte kopplas från när man byter sida. */}
    <nav className="links">
      <a href={`/admin/${raceId}/manage`} target="_blank" rel="noopener">{t.manage}</a>
      <a href={`/results/${raceId}`} target="_blank" rel="noopener">{t.results}</a>
    </nav>
  </main>;
}

/** Första brickan i löpardatabasen som varken är anmäld eller direktanmäld här, eller undefined. */
function unusedDatabaseCard(pkg: ReadoutPackage, registrations: readonly QueuedRegistration[]): number | undefined {
  const used = new Set([...pkg.raceSnapshot.cardAssignments.map((assignment) => assignment.cardNumber),
    ...registrations.map((row) => row.request.cardNumber)]);
  const card = pkg.runnerLookup?.runners.flatMap((runner) => runner.cards).find((number) => !used.has(number));
  return card === undefined ? undefined : Number(card);
}

/** Serverns status för avläsningen; en okänd bricka som sedan direktanmälts har anmälans bedömning (PLAN.md steg 25). */
function serverStatus(item: QueuedReadout | undefined, registration: QueuedRegistration | undefined) {
  const status = item?.serverResult?.status;
  if (status !== "UNKNOWN_CARD" || !registration || registration.status === "rejected") return status;
  return registration.response?.linkedResult?.status;
}

function Verdict({ current, verdict, item, qr, registration, timeZone }: { current: Current | undefined; verdict: LocalVerdict | undefined;
  item: QueuedReadout | undefined; qr: ReturnType<typeof receiptLink> | undefined; registration: QueuedRegistration | undefined;
  timeZone: string }) {
  if (!current) return <p className="big">{t.waitingForCard}</p>;
  if (current.phase === "reading") return <p className="big">{t.reading(current.cardNumber)}</p>;
  if (current.phase === "failed") return <p className="big">✗ {current.message}</p>;
  const symbol = !verdict ? "✓" : verdict.status === "OK" ? "✓" : verdict.status === "MP" || verdict.status === "OVERTIME" ? "✗" : "?";
  const server = serverStatus(item, registration);
  return <div className="verdict-layout"><div className="verdict-body">
    <p className="big">{symbol} {verdict ? t.verdict[verdict.status] : t.verdict.NO_PACKAGE}</p>
    <p className="card">Bricka {current.cardNumber}{verdict?.name ? ` · ${verdict.name}` : ""}{verdict?.className ? ` · ${verdict.className}` : ""}</p>
    {/* Hyrbricka (PLAN.md steg 25): en egen rad med ord och symbol, inte bara färg. */}
    {verdict?.rental ? <p className="rental" data-testid="verdict-rental">▲ {t.rental}</p> : null}
    {registration ? <RegistrationStatus registration={registration} className={verdict?.className ?? ""} /> : null}
    {verdict?.relay ? <RelayLine relay={verdict.relay} /> : null}
    {verdict?.variant ? <p className="variant" data-testid="verdict-variant">{verdict.variant.assigned
      ? t.variant(verdict.variant.code) : t.variantGuessed(verdict.variant.code)}</p> : null}
    {verdict?.rogaining && verdict.elapsedMs !== undefined ? <Rogaining score={verdict.rogaining} elapsedMs={verdict.elapsedMs}
      splits={verdict.splits} />
      : verdict?.elapsedMs !== undefined && (verdict.status === "OK" || verdict.status === "OVERTIME")
        ? <p className="time">{formatRunningTime(verdict.elapsedMs)}</p> : null}
    {/* Minutstart (PLAN.md steg 25): sen eller tidig startstämpling är en varning, inte en ny status. */}
    {verdict?.startNote ? <p className="start-note" role="note" data-testid="verdict-start-punch" data-kind={verdict.startNote.kind}>
      {verdict.startNote.kind === "FROM_PUNCH" ? "" : "! "}{startPunchText(verdict.startNote, timeZone)}</p> : null}
    {verdict?.ignoredPunches && !verdict.punchList ? <p className="start-note" role="note" data-testid="verdict-old-punches">! {t.ignoredPunches(verdict.ignoredPunches)}</p> : null}
    {verdict && verdict.status !== "OK" ? <p>{t.reason[verdict.reason]}</p> : null}
    {verdict && verdict.missingControls.length > 0 ? <p>{t.missing(verdict.missingControls)}</p> : null}
    {verdict?.punchList ? <PunchListView list={verdict.punchList} timeZone={timeZone} /> : null}
    {!verdict ? <p>{t.noPackage}</p> : null}
    {verdict && !verdict.rogaining && verdict.splits.length > 0 ? <ol className="splits" aria-label={t.splits}>
      {verdict.splits.map((split, index) => <li key={index}>
        <span>{split.controlCode}</span> <span>{formatRunningTime(split.legMs)}</span> <span>({formatRunningTime(split.elapsedMs)})</span>
      </li>)}
    </ol> : null}
    {current.invalid ? <p>{t.localInvalid}</p> : null}
    {verdict && server && server !== verdict.status ? <p role="alert">{t.serverDiffers(t.verdict[server])}</p> : null}
    <p className="sync">{item?.status === "pending" ? t.savedLocally
      : item?.status === "rejected" ? t.rejected(item.rejectedReason ?? "")
      : item ? t.confirmed : t.savedLocally}</p>
  </div>
  {qr ? <figure className="verdict-qr" data-testid="screen-qr">
    <QrCode value={qr.url} label={t.receipt.scan} />
    <figcaption>{t.receipt.scan}{qr.published ? null : <small>{t.receipt.notPublished}</small>}</figcaption>
  </figure> : null}
  </div>;
}

function RecentRow({ item, pkg, local, registration }: { item: QueuedReadout; pkg: ReadoutPackage | undefined;
  local: readonly QueuedReadout["payload"][]; registration: QueuedRegistration | undefined }) {
  // Bedöms om bara när avläsningen, paketet eller de tidigare avläsningarna ändras (inte vid varje stationshändelse).
  const verdict = useMemo(() => pkg ? evaluateLocally(item.payload, pkg, local, item.stationReceivedAt) : undefined,
    [item.payload, pkg, local.length, item.stationReceivedAt]);
  const status = serverStatus(item, registration) ?? verdict?.status;
  const queue = item.status === "pending" ? t.statusPending : item.status === "stored" ? t.statusStored
    : item.status === "duplicate" ? t.statusDuplicate : t.statusRejected;
  return <li data-sequence={item.localSequence}>
    <span className="card">{item.payload.cardNumber}</span>
    <span>{verdict?.name ?? ""}</span>
    <span>{status ? t.verdict[status] : ""}</span>
    <span className="queue">{queue}</span>
  </li>;
}

/**
 * Rogaining (ADR-0170 beslut 5): summan stort, kontrollpoäng och straff, tiden mot gränsen och de räknade
 * kontrollerna med poäng och tid från start. För sent märks med ord och symbol, inte bara färg.
 */
function Rogaining({ score, elapsedMs, splits }: { score: NonNullable<LocalVerdict["rogaining"]>; elapsedMs: number;
  splits: LocalVerdict["splits"] }) {
  const times = new Map(splits.map((split) => [split.controlCode, split.elapsedMs]));
  return <>
    <p className="time" data-testid="verdict-total">{t.rogainingTotal(score.total)}</p>
    <p className="breakdown" data-testid="verdict-breakdown"><span>{t.rogainingBreakdown(score.controlPoints, score.penalty)}</span>
      {" · "}<span>{t.rogainingTime(formatRunningTime(elapsedMs), formatRunningTime(score.timeLimitMs))}</span></p>
    {score.overtimeMinutes > 0 ? <p className="late" data-testid="verdict-late">! {t.rogainingLate(score.overtimeMinutes)}</p> : null}
    {score.controls.length > 0 ? <ol className="splits" aria-label={t.rogainingControls}>
      {score.controls.map((control) => <li key={control.controlCode}>
        <span>{control.controlCode}</span> <span>{t.rogainingPoints(control.points)}</span>
        {times.has(control.controlCode) ? <> <span>({formatRunningTime(times.get(control.controlCode)!)})</span></> : null}
      </li>)}
    </ol> : null}
  </>;
}

/** Stafett: "Lag 12 OK Test · Sträcka 2 av 3 · Växlar till sträcka 3", eller lagets tid på sista sträckan. */
function RelayLine({ relay }: { relay: NonNullable<LocalVerdict["relay"]> }) {
  const last = relay.leg === relay.legCount;
  const team = relay.team;
  const outcome = !last ? t.relayNext(relay.leg + 1)
    : team.status === "OK" && team.elapsedMs !== undefined ? `${t.relayLast} – ${t.relayTeamTime(formatRunningTime(team.elapsedMs))}`
      : team.status === "RUNNING" ? `${t.relayLast} – ${t.relayTeamWaiting}` : `${t.relayLast} – ${t.relayTeamStatus[team.status]}`;
  return <p className="relay" data-testid="verdict-relay">{t.relayTeam(relay.teamNumber, relay.teamName, relay.leg, relay.legCount)} · {outcome}</p>;
}
