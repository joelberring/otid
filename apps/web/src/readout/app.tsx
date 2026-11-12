import { useCallback, useState } from "react";
import { partyTextEn, readoutTextEn } from "./text-en";
import { useLanguage, useTexts } from "../components/language-provider";
import { sportidentReadoutPayloadSchema, type ReadoutPackage } from "@o-tid/contracts";
import { SiTimeError, type SiCardData } from "@o-tid/sportident";
import { evaluateLocally, linkedVariants, withLocalRegistrations } from "./evaluate";
import { exerciseAnchor, exerciseCard, exerciseRunners, exerciseWindow, teamSprintExerciseCard, type ExerciseVariant } from "./exercise";
import type { FakeStationTransport } from "./fake-transport";
import { buildReadoutPayload, payloadHash } from "./payload";
import type { StationFacts, StationStatus } from "./station";
import { chooseReadoutClock, stationClockUnusable } from "./clock";
import { IdbReadoutStore, type OtherRacePending, type QueuedRegistration, type ReadoutStore } from "./store";
import { RegistrationForm } from "./registration-form";
import { heldReadouts, releaseHeldReadouts } from "./sync";
import { failedReadoutsFile, loadFailedReadouts, saveFailedReadouts, type FailedReadout } from "./failed-readouts";
import { inRaceDay, raceTitle } from "@o-tid/domain";
import { toHex } from "./payload";
import type { Texts } from "../lib/language";
import { readoutText } from "./text-sv";
import { ReceiptPanel, type Printable } from "./receipt-panel";
import { receiptLink } from "./receipt";
import { loadReceiptSettings, saveReceiptSettings, type ReceiptSettings } from "./receipt-settings";
import { saveSoundEnabled } from "./sound";
import { HelpButton } from "../components/help/help-panel";
import { IdbPartyActionStore, type PartyActionStore } from "./party-store";
import { PartyDesk } from "./party-desk";
import { partyText } from "./party-text-sv";
import { placementState } from "./placement-text";
import { placementLinesEn } from "./placement-text-en";
import { RecentRow, Verdict, type Current } from "./verdict-panel";
import { useReadoutQueue } from "./use-readout-queue";
import { showUsbButton, useStation } from "./use-station";
import { useReadoutSound, useVerdictSound } from "./use-readout-sound";
import { useReadoutRegistration } from "./use-readout-registration";
import { useCurrentVerdict } from "./use-current-verdict";

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

function stationText(status: StationStatus, exercise: boolean, t: Pick<Texts<typeof readoutText>, "stationStatus">): string {
  switch (status.kind) {
    case "ready": return exercise ? t.stationStatus.exercise : t.stationStatus.ready(status.serialNumber);
    case "connecting": return t.stationStatus.connecting;
    case "misconfigured": return t.stationStatus.misconfigured;
    case "no-response": return t.stationStatus.noResponse;
    case "error": return `${t.stationStatus.error}: ${status.message}`;
    case "disconnected": return t.stationStatus.disconnected;
  }
}

/** En JSON-fil att spara (rålogg, väntande avläsningar, otolkade avläsningar) med tiden i namnet. */
function saveJson(text: string, prefix: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${prefix}-${new Date().toISOString().replaceAll(":", "")}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove();
  } finally { URL.revokeObjectURL(url); }
}

export function ReadoutApp({ store = new IdbReadoutStore(), partyStore = new IdbPartyActionStore() }: { store?: ReadoutStore;
  partyStore?: PartyActionStore }) {
  const t = useTexts(readoutText, readoutTextEn);
  const partyT = useTexts(partyText, partyTextEn);
  const englishPlacement = useLanguage() === "en";
  const [raceId] = useState(raceIdFromHash);
  const { pkg, pkgRef, items, itemsRef, elsewhere, registrations, registrationsRef, online, loginNeeded, syncProblem, serverDown,
    failedReadouts, setFailedReadouts, persistent, storeRef, partyActions, reload, sync, addPartyAction } = useReadoutQueue(raceId, store, partyStore);
  const [current, setCurrent] = useState<Current>();
  const [runnerId, setRunnerId] = useState("");
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(() => loadReceiptSettings());
  const { sound, soundOn, setSoundOn, soundUnlocked, setSoundUnlocked } = useReadoutSound();

  const onCardRead = useCallback(async (card: SiCardData, frames: readonly Uint8Array[], station: StationFacts,
    exercise: FakeStationTransport | undefined) => {
    if (!raceId) return;
    const now = new Date();
    const known = pkgRef.current;
    const timeZone = known?.event.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Stämplingstiderna löses mot stationens klocka när den finns (PLAN.md steg 22); övningsstationens klocka
    // står på tävlingsdagen. Datorns klocka är reservalternativet och avläsningen bär vilken som användes.
    // Steg 45: en stationsklocka som går mer än sex timmar fel används inte (`chooseReadoutClock`).
    const clock = chooseReadoutClock({ stationOffsetMs: station.clock?.clockOffsetMs,
      exerciseOffsetMs: exercise ? exercise.now().getTime() - now.getTime() : undefined });
    const build = (useStation: boolean) => buildReadoutPayload(card, frames, {
      reference: useStation ? new Date(now.getTime() + clock.referenceOffsetMs) : now, timeZone, simulated: exercise !== undefined,
      ...(station.serialNumber !== undefined ? { stationSerial: station.serialNumber } : {}),
      clockSource: useStation ? clock.clockSource : "device",
      ...(useStation && clock.clockOffsetMs !== undefined ? { clockOffsetMs: clock.clockOffsetMs } : {})
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
        // Steg 45: råramarna skickas också till servern (syncFailedReadouts), med ett stabilt id per avläsning.
        const identity = await storeRef.current.identity(raceId);
        const failed: FailedReadout = { cardNumber: String(card.cardNumber), at: now.toISOString(), message: fallback.message,
          frames: frames.map(toHex), requestId: crypto.randomUUID(), deviceId: identity.deviceId, sessionId: identity.sessionId,
          packageVersion: known?.packageVersion ?? 1, ...(station.serialNumber !== undefined ? { stationSerial: station.serialNumber } : {}),
          ...(clock.clockOffsetMs !== undefined ? { clockSource: clock.clockSource, clockOffsetMs: clock.clockOffsetMs } : {}),
          simulated: exercise !== undefined };
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
    // Beskedet bedöms mot de tidigare avläsningarna i den här webbläsaren (utan den nya).
    const verdict = known ? evaluateLocally(payload, withLocalRegistrations(known, registrationsRef.current),
      itemsRef.current.map((item) => item.payload), now.toISOString(), linkedVariants(known, registrationsRef.current)) : undefined;
    // Steg 58: kön läses om innan beskedet visas, så att "väntar" räknar den nya avläsningen när beskedet syns. Tidigare
    // kunde beskedet stå bredvid ett gammalt "0 väntar" en stund; den som då lämnade sidan trodde att allt var skickat
    // (och e2e-testerna gick vidare innan den sista avläsningen hade skickats).
    await reload();
    setCurrent({ phase: "done", cardNumber: payload.cardNumber, localSequence: stored.localSequence,
      ...(verdict ? { verdict } : {}), ...(valid ? {} : { invalid: true }) });
    void sync();
  }, [raceId, reload, sync, pkgRef, storeRef, setFailedReadouts, registrationsRef, itemsRef]);

  // Steg 35: stationen ansluts själv när sidan öppnas och när den sätts i, om den har anslutits här förut.
  const { station, exercise, exerciseRef, trafficRef, fastRead, changeFastRead, connected, auto, connectSerial, connectUsb, connectExercise,
    disconnect } = useStation({ pkgRef, ready: pkg !== undefined, sound, onCardRead, setCurrent });

  function downloadRawLog() {
    if (!raceId) return;
    saveJson(trafficRef.current.export(raceId, items, navigator.userAgent), "otid-ralogg");
  }

  /** ADR-0187: de väntande avläsningarna för en annan tävling som fil (nyttolasten oförändrad), så att inget går förlorat. */
  function downloadElsewhere(group: OtherRacePending) {
    saveJson(JSON.stringify({ format: "otid-vantande-avlasningar", formatVersion: 1, raceId: group.raceId,
      savedAt: new Date().toISOString(), readouts: group.readouts }, null, 2), "otid-vantande-avlasningar");
  }

  function downloadFailedReadouts() {
    if (!raceId) return;
    saveJson(failedReadoutsFile(raceId, loadFailedReadouts(raceId)), "otid-otolkade");
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
    // Steg 48: teamsprint – brickan har alla löparens sträckor och växlingsstämplingar.
    const sprint = variant === "ok" || variant === "missing-control" ? teamSprintExerciseCard(pkg, runner, variant, now) : undefined;
    if (sprint) { transport.insert(sprint.card, new Date(sprint.finishAt.getTime() + 5_000)); return; }
    // Tiderna följer löparens starttid och tävlingsdagen; övningsstationens klocka ställs strax efter målgången.
    const window = exerciseWindow(pkg, runner, variant, now);
    transport.insert(exerciseCard(runner.cardNumber, runner.controlCodes, variant, now, pkg.event.timeZone, window),
      new Date(window.finishAt.getTime() + 5_000));
  }

  const { effectivePkg, currentItem, verdict, alreadyReadOut, borrowed, currentRegistration } =
    useCurrentVerdict({ current, pkg, items, registrations });
  const { register, linkEntry, searchServer } = useReadoutRegistration({ raceId, current, storeRef, reload, sync, online, pkg });
  useVerdictSound({ sound, soundOn, current, verdict, pkgRef });
  const playParty = useCallback((kind: "ok" | "fail" | "neutral") => { if (soundOn) sound.current.play(kind); }, [soundOn]);

  if (!raceId) return <main className="readout"><div className="readout-head"><h1>{t.title}</h1><HelpButton view="READOUT_PAGE" large /></div>
    <p className="notice">{t.noRace}</p></main>;

  const runners = pkg ? exerciseRunners(pkg, t) : [];
  const selectedRunner = runners.find((candidate) => candidate.entryId === runnerId) ?? runners[0];
  const waiting = items.filter((item) => item.status === "pending").length +
    partyActions.filter((row) => row.status === "pending").length;
  const held = heldReadouts(items);
  // Steg 31: övningsstationen skriver riktiga avläsningar; på tävlingsdagen varnas tydligt.
  // Steg 58: tävlingsdygnet, så att varningen gäller även efter midnatt i en nattävling.
  const raceDay = pkg ? inRaceDay(new Date(), pkg.raceSnapshot.race.raceDate, pkg.event.timeZone) : false;
  const recent = [...items].sort((a, b) => b.localSequence - a.localSequence).slice(0, 10);
  // Klockskillnad i hela minuter, bara för en riktig station (övningsstationens klocka står med flit på tävlingsdagen).
  const clockSkew = !exercise && station.kind === "ready" && station.clock && Math.abs(station.clock.clockOffsetMs) >= CLOCK_SKEW_WARNING_MS
    ? Math.round(station.clock.clockOffsetMs / 60_000) : undefined;
  // Steg 45: mer än sex timmar fel – datorns klocka gäller i stället.
  const clockIgnored = !exercise && station.kind === "ready" && station.clock !== undefined && stationClockUnusable(station.clock.clockOffsetMs);
  const placement = current?.phase === "done" ? placementState(currentItem, online, englishPlacement ? placementLinesEn : undefined) : undefined;
  const printable: Printable | undefined = current?.phase === "done" && verdict && pkg
    ? { localSequence: current.localSequence, cardNumber: current.cardNumber, verdict,
      ...(placement?.kind === "known" ? { placement: placement.lines } : {}), placementPending: verdict.status === "OK" && placement?.kind === "sending" } : undefined;
  // QR-koden på skärmen: för en känd löpare, så att hen kan skanna i stället för att ta ett papperskvitto.
  const screenQr = printable && receiptSettings.showQr && pkg && printable.verdict.entryId
    ? receiptLink(pkg, printable.verdict.entryId, window.location.origin) : undefined;

  const head = <>
    <header>
      {/* PLAN.md steg 37: Hjälp öppnar en panel ovanpå; avläsningen fortsätter under tiden. */}
      <div className="readout-head"><h1>{pkg?.party ? partyT.title : t.title}</h1><HelpButton view="READOUT_PAGE" large /></div>
      {pkg ? <p className="race">{raceTitle(pkg.event.name, pkg.raceSnapshot.race.name)}</p> : null}
      <dl className="status" aria-label="Status">
        <div data-state={station.kind === "ready" ? "good" : station.kind === "disconnected" ? "idle" : "bad"}>
          <dt>{t.station}</dt><dd data-testid="station-status">{station.kind === "ready" ? "● " : "○ "}{stationText(station, exercise, t)}</dd></div>
        <div data-state={!online ? "bad" : serverDown ? "warn" : "good"}>
          <dt>{t.internet}</dt><dd data-testid="internet-status">{!online ? `○ ${t.offline}` : serverDown ? `◐ ${t.serverDown}` : `● ${t.online}`}</dd></div>
        <div data-state={waiting === 0 ? "good" : serverDown ? "bad" : "warn"}>
          <dt>{t.queue}</dt><dd data-testid="queue-status">{waiting === 0 ? t.queueEmpty : serverDown ? t.queueServerDown(waiting)
            : t.queueWaiting(waiting)}</dd></div>
        <div data-state={pkg ? "good" : "bad"}>
          <dt>{t.packageLabel}</dt><dd data-testid="package-status">{pkg ? <>{t.packageUpdated(fetchedAt(pkg))} <small className="package-version"
            title={t.packageVersionTitle(pkg.packageVersion)}>{t.packageVersion(pkg.packageVersion)}</small></> : t.packageMissing}</dd></div>
      </dl>
    </header>
  </>;

  const alerts = <>
    {loginNeeded ? <p className="notice" role="alert">{t.loginNeeded} <a href="/organizer">{t.login}</a></p> : null}
    {syncProblem ? <p className="notice" role="alert">{syncProblem}</p> : null}
    {serverDown ? <p className="notice" role="status" data-testid="server-down">{t.serverDownNotice(serverDown.status,
      Math.round(serverDown.retryInMs / 1_000))}</p> : null}
    {held.length > 0 ? <p className="notice" role="alert" data-testid="held-readouts">{t.heldReadouts(held.length, held.some((item) => (item.serverFailedStatus ?? 500) >= 500))}{" "}
      <button type="button" onClick={() => { if (raceId) void releaseHeldReadouts(storeRef.current, raceId).then(() => sync(true)); }}>
        {t.heldRetry}</button></p> : null}
    {failedReadouts.length > 0 ? <section className="notice" role="alert" data-testid="failed-readouts" aria-label={t.failedTitle}>
      <strong>{t.failedTitle}</strong> {t.failedHelp}
      <ul>{failedReadouts.map((row) => <li key={`${row.cardNumber}-${row.at}`}>{t.failedRow(row.cardNumber,
        new Date(row.at).toLocaleTimeString("sv-SE"), row.message)} – {row.storedAt ? t.failedStored : t.failedWaiting}</li>)}</ul>
      {/* Steg 45: ladda ner listan med råramar innan den rensas. */}
      <div className="row">
        <button type="button" onClick={downloadFailedReadouts}>{t.failedDownload}</button>
        <button type="button" onClick={() => { if (raceId) { saveFailedReadouts(raceId, []); setFailedReadouts([]); } }}>
          {t.failedClear}</button>
      </div>
    </section> : null}
    {elsewhere.map((group) => <section key={group.raceId} className="notice" role="alert" data-testid="other-race-readouts"
      aria-label={t.elsewhereTitle}>
      <strong>{t.elsewhereTitle}</strong> {t.elsewhere(group.readouts.length, group.name, group.raceDate)}
      <ul>{group.readouts.map((item) => <li key={`${item.deviceId}-${item.localSequence}`}>{t.elsewhereRow(item.payload.cardNumber,
        new Date(item.stationReceivedAt).toLocaleTimeString("sv-SE"))}</li>)}</ul>
      <div className="row">
        <button type="button" onClick={() => downloadElsewhere(group)}>{t.elsewhereDownload}</button>
        <a href={`/admin/${encodeURIComponent(group.raceId)}/readout`}>{t.elsewhereOpen}</a>
      </div>
    </section>)}
    {!persistent ? <p className="notice">{t.storageNotPersistent}</p> : null}
    {station.kind === "misconfigured" ? <p className="notice" role="alert">{t.misconfiguredHelp} ({station.problems.join(", ")})</p> : null}
    {clockIgnored ? <p className="notice" role="alert" data-testid="clock-ignored">{t.clockIgnored(clockSkew ?? 0)}</p>
      : clockSkew !== undefined ? <p className="notice" role="alert" data-testid="clock-skew">{t.clockSkew(clockSkew)}</p> : null}
    {!exercise && station.kind === "ready" && !station.clock ? <p className="notice" data-testid="clock-missing">{t.clockMissing}</p> : null}
  </>;
  const controls = <>
    <section className="controls">
      {connected
        ? <button type="button" onClick={() => { void disconnect(); }}>{t.disconnect}</button>
        : <>
          <button type="button" className="primary" onClick={() => { void connectSerial(); }}>{t.connectSerial}</button>
          {showUsbButton ? <button type="button" className="primary" onClick={() => { void connectUsb(); }}>{t.connectUsb}</button> : null}
          <button type="button" onClick={() => { void connectExercise(); }}>{t.connectExercise}</button>
          {raceDay ? <small className="exercise-warning" data-testid="exercise-warning-short">
            {pkg?.party ? partyT.exerciseNotCountedShort : t.exerciseRaceDayShort}</small> : null}
        </>}
      <label className="sound-choice"><input type="checkbox" checked={soundOn} onChange={(event) => {
        setSoundOn(event.target.checked); saveSoundEnabled(event.target.checked);
        if (event.target.checked) void sound.current.unlock().then(setSoundUnlocked);
      }} />{t.sound}</label>
    </section>
    {soundOn && !soundUnlocked && connected ? <p className="hint" data-testid="sound-locked">{t.soundLocked}</p> : null}
  </>;
  const autoConnect = <>
    {/* Steg 35: automatisk anslutning till den sparade stationen. */}
    {!exercise && (auto.remembered || auto.choices) ? <section className="auto-connect" data-testid="auto-connect" aria-label={t.autoTitle}>
      {auto.choices ? <>
        <p><strong>{t.autoChoose}</strong></p>
        <div className="row">{auto.choices.map((option, index) => <button key={index} type="button" className="primary"
          onClick={() => { void sound.current.unlock(); void auto.choose(option); }}>{option.label}</button>)}</div>
      </> : <p role="status">{connected ? t.autoConnected : auto.paused ? t.autoPaused : t.autoConnecting}</p>}
      {auto.problem ? <p role="alert">{t.autoProblem(auto.problem)}</p> : null}
      <button type="button" onClick={auto.stop}>{t.autoStop}</button>
    </section> : null}
    <p className="hint">{t.tabHint}</p>
  </>;
  const rawAndLinks = <>
    <section className="rawlog">
      <button type="button" onClick={downloadRawLog}>{t.rawLog}</button>
      <p>{t.rawLogHelp}</p>
      <label className="sound-choice"><input type="checkbox" checked={fastRead}
        onChange={(event) => changeFastRead(event.target.checked)} />{t.fastRead}</label>
      <p>{t.fastReadHelp}</p>
    </section>

    {/* Steg 35: länkarna öppnas i en ny flik, så att stationen inte kopplas från när man byter sida. */}
    <nav className="links">
      <a href={`/admin/${raceId}/manage`} target="_blank" rel="noopener">{t.manage}</a>
      <a href={`/results/${raceId}`} target="_blank" rel="noopener">{t.results}</a>
    </nav>
  </>;

  // Fest (PLAN.md steg 40): bardisken i ett fönster. Stationens knappar syns när den inte är ansluten; resten under Personal.
  if (pkg?.party) return <main className="readout party-page">
    {head}
    {alerts}
    <PartyDesk raceId={raceId} pkg={pkg} items={items} actions={partyActions} online={online} addAction={addPartyAction} play={playParty}
      reading={current?.phase === "reading" ? current.cardNumber : undefined}
      failure={current?.phase === "failed" ? current.message : undefined}
      exercise={exercise && station.kind === "ready" ? exerciseRef.current : undefined}
      statusArea={null}
      staffArea={<>{connected ? controls : null}{autoConnect}{rawAndLinks}</>} />
    {!connected ? controls : null}
  </main>;

  return <main className="readout">
    {head}
    {alerts}

    <section className="verdict" aria-live="assertive" data-testid="verdict"
      data-status={current?.phase === "done" ? verdict?.status ?? "NO_PACKAGE" : current?.phase ?? "idle"}>
      <Verdict current={current} verdict={verdict} item={currentItem} qr={screenQr} registration={currentRegistration}
        timeZone={pkg?.event.timeZone ?? "Europe/Stockholm"} online={online}
        borrowed={borrowed && (!currentRegistration || currentRegistration.status === "rejected") ? borrowed : undefined} />
    </section>

    {/* Steg 31 (B4): brickan har redan lästs ut för någon annan – lånad bricka? */}
    {current?.phase === "done" && alreadyReadOut && (!currentRegistration || currentRegistration.status === "rejected")
      ? <section className="notice" role="alert" data-testid="already-read-out" aria-label={t.alreadyReadOutTitle}>
        {/* Användartestet 2026-11-12: frågan står i beskedet; här vad som händer och valet "samma löpare". */}
        <p><strong>{borrowed ? t.alreadyReadOutHelp(alreadyReadOut.name) : t.alreadyReadOutPossible(alreadyReadOut.name)}</strong></p>
        {borrowed ? <>
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

    {controls}

    {autoConnect}

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

    {rawAndLinks}
  </main>;
}

/** Första brickan i löpardatabasen som varken är anmäld eller direktanmäld här, eller undefined. */
function unusedDatabaseCard(pkg: ReadoutPackage, registrations: readonly QueuedRegistration[]): number | undefined {
  const used = new Set([...pkg.raceSnapshot.cardAssignments.map((assignment) => assignment.cardNumber),
    ...registrations.map((row) => row.request.cardNumber)]);
  const card = pkg.runnerLookup?.runners.flatMap((runner) => runner.cards).find((number) => !used.has(number));
  return card === undefined ? undefined : Number(card);
}
