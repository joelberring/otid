import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_LAYOUTS, stationClock, type SiCardData, type SimulatedCard } from "@o-tid/sportident";
import { ReadoutSound } from "../readout/sound";
import type { StationStatus } from "../readout/station";
import { languageHref, type Language } from "../lib/language";
import {
  abandonGame, applyReadout, currentGame, isPlaying, formatDuration, gameDuration, gameStatus, MASTERMIND_NAME_MAX, MAX_COLORS, MAX_GUESSES, MAX_POSITIONS, MIN_COLORS,
  MIN_POSITIONS, PALETTE, restart, settingsProblems, standings, teamName, type CardGame, type CardPunch, type Code, type GameSettings, type MastermindState,
  type Score
} from "@o-tid/domain/mastermind";
import { RaceSwitch } from "../readout/race-switch";
import { StandingsTable, useElapsed } from "./standings-view";
import { EMPTY_SAVED, parseSavedState, upsertGame, type SavedState } from "./saved-state";
import { accountCsrf } from "../readout/api";
import { setOpenStations, useMastermindSync, type SyncInfo, type SyncStatus } from "./server-sync";
import { hasSerial, hasBluetooth, hasUsb, useGameStation, type CardEvent } from "./station";
import { mastermindText, mastermindTextEn, type MastermindTexts } from "./texts";

const STORAGE_KEY = "otid.mastermind.v1";
/** Från en träning hålls spelen och resultaten isär per träning; de skickas också till servern (ADR-0228). */
const storageKey = (raceId: string | undefined, station: boolean) =>
  raceId ? `${STORAGE_KEY}.${station ? "spela." : ""}${raceId}` : STORAGE_KEY;
const PRACTICE_CARDS = [7_000_001, 7_000_002, 7_000_003];
type Tone = "info" | "ok" | "fail";

function loadState(key: string): SavedState {
  try { return parseSavedState(window.localStorage.getItem(key)); }
  catch { return EMPTY_SAVED; }
}

function saveState(key: string, state: SavedState): void {
  try { window.localStorage.setItem(key, JSON.stringify(state)); }
  catch (error) { console.warn("Spelet kunde inte sparas i webbläsaren", error); }
}

function statusText(t: MastermindTexts, status: StationStatus): string {
  switch (status.kind) {
    case "disconnected": return t.status.disconnected;
    case "connecting": return t.status.connecting;
    case "ready": return t.status.ready(status.serialNumber);
    case "misconfigured": return t.status.misconfigured(status.problems.join(", "));
    case "no-response": return t.status.noResponse;
    case "error": return t.status.error(status.message);
  }
}

/** Brickans stämplingar: kod och tid som jämförbar text (markören känner igen redan utlästa stämplingar). */
function cardPunches(card: SiCardData): CardPunch[] {
  return card.punches.map((p) => p.time ? { code: p.code, time: JSON.stringify(p.time) } : { code: p.code });
}

/** Spelets klocka: från starten (första utläsningen) till utläsningen av den avgörande gissningen, datorns tid. */
function GameClock({ game, t }: { game: CardGame; t: MastermindTexts }) {
  const playing = gameStatus(game) === "playing";
  const elapsed = useElapsed(playing ? game.startedAt : undefined);
  const duration = playing ? elapsed : gameDuration(game);
  return (
    <p className="mm-clock" aria-label={t.time}>
      <span className="mm-muted">{t.time}</span>{" "}
      <strong>{duration === undefined ? "–" : formatDuration(duration)}</strong>
    </p>
  );
}

function Pip({ color, settings, language, size = "md" }: { color: number | undefined; settings: GameSettings; language: Language; size?: "md" | "sm" }) {
  if (color === undefined) return <span className={`mm-pip mm-pip-${size} mm-pip-empty`} aria-hidden="true" />;
  const paint = PALETTE[color]!;
  return (
    <span className={`mm-pip mm-pip-${size} mm-pip-${paint.id}`} style={{ background: paint.hex }} title={`${paint[language]} (${settings.codes[color]})`}
      role="img" aria-label={`${paint[language]} ${settings.codes[color]}`}>
      {settings.codes[color]}
    </span>
  );
}

function Pegs({ score, positions, label }: { score: Score | undefined; positions: number; label: string | undefined }) {
  const pegs = Array.from({ length: positions }, (_, index) =>
    !score ? "none" : index < score.exact ? "black" : index < score.exact + score.colorOnly ? "white" : "none");
  return (
    <span className="mm-pegs" role={label ? "img" : undefined} aria-label={label} title={label}
      style={{ gridTemplateColumns: `repeat(${Math.ceil(positions / 2)}, 14px)` }}>
      {pegs.map((peg, index) => <span key={index} className={`mm-peg mm-peg-${peg}`} />)}
    </span>
  );
}

function Board({ game, t, language }: { game: CardGame; t: MastermindTexts; language: Language }) {
  const { settings } = game;
  const status = gameStatus(game);
  const row = (colors: Code | undefined) => Array.from({ length: settings.positions }, (_, index) => colors?.[index]);
  return (
    <div className="mm-board">
      <div className="mm-row mm-secret" aria-label={t.secret}>
        <span className="mm-row-number">{status === "playing" ? "?" : "★"}</span>
        <span className="mm-pips">
          {row(game.secret).map((color, index) => status === "playing"
            ? <span key={index} className="mm-pip mm-pip-md mm-pip-hidden" aria-hidden="true">?</span>
            : <Pip key={index} color={color} settings={settings} language={language} />)}
        </span>
        <span className="mm-pegs" />
      </div>
      {Array.from({ length: settings.maxGuesses }, (_, index) => {
        const guess = game.guesses[index];
        const current = index === game.guesses.length && status === "playing";
        return (
          <div key={index} className={`mm-row${current ? " mm-row-current" : ""}${guess ? "" : " mm-row-blank"}`}>
            <span className="mm-row-number">{index + 1}</span>
            <span className="mm-pips">{row(guess?.colors).map((color, i) => <Pip key={i} color={color} settings={settings} language={language} />)}</span>
            <Pegs score={guess?.score} positions={settings.positions} label={guess ? t.scoreLabel(guess.score.exact, guess.score.colorOnly) : undefined} />
          </div>
        );
      })}
    </div>
  );
}

function SettingsPanel({ settings, onChange, t, language }: { settings: GameSettings; onChange: (settings: GameSettings) => void; t: MastermindTexts; language: Language }) {
  const [draft, setDraft] = useState(settings);
  const [savedNotice, setSavedNotice] = useState(false);
  // Inställningarna ändras utifrån (serverns träning eller en annan flik): utkastet följer med när de skiljer sig.
  const settingsJson = JSON.stringify(settings);
  useEffect(() => { setDraft(current => JSON.stringify(current) === settingsJson ? current : JSON.parse(settingsJson) as GameSettings); }, [settingsJson]);
  const problems = settingsProblems(draft);
  const dirty = JSON.stringify(draft) !== settingsJson;
  const update = (next: GameSettings) => { setDraft(next); setSavedNotice(false); };
  const setColors = (count: number) => {
    const codes = Array.from({ length: count }, (_, index) => draft.codes[index] ?? (draft.codes.at(-1) ?? 30) + index - draft.codes.length + 1);
    update({ ...draft, codes });
  };
  const number = (value: string) => Number.parseInt(value, 10);
  const save = () => {
    if (problems.length > 0 || !dirty) return;
    onChange(draft);
    setSavedNotice(true);
  };
  return (
    <details className="mm-panel">
      <summary>{t.settings}</summary>
      <p className="mm-muted">{t.settingsNote}</p>
      <div className="mm-settings">
        <label>{t.colors}
          <select value={draft.codes.length} onChange={(event) => setColors(number(event.target.value))}>
            {Array.from({ length: MAX_COLORS - MIN_COLORS + 1 }, (_, i) => MIN_COLORS + i).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>{t.positions}
          <select value={draft.positions} onChange={(event) => update({ ...draft, positions: number(event.target.value) })}>
            {Array.from({ length: MAX_POSITIONS - MIN_POSITIONS + 1 }, (_, i) => MIN_POSITIONS + i).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>{t.maxGuesses}
          <input type="number" min={1} max={MAX_GUESSES} value={Number.isNaN(draft.maxGuesses) ? "" : draft.maxGuesses}
            onChange={(event) => update({ ...draft, maxGuesses: number(event.target.value) })} />
        </label>
        <label className="mm-check">
          <input type="checkbox" checked={draft.allowRepeats} onChange={(event) => update({ ...draft, allowRepeats: event.target.checked })} />
          {t.allowRepeats}
        </label>
      </div>
      <div className="mm-codes">
        {draft.codes.map((code, index) => (
          <label key={index} className="mm-code">
            <span className="mm-pip mm-pip-sm" style={{ background: PALETTE[index]!.hex }} aria-hidden="true" />
            <span className="mm-visually-hidden">{t.code(PALETTE[index]![language])}</span>
            <input type="number" min={1} max={999} value={Number.isNaN(code) ? "" : code}
              onChange={(event) => update({ ...draft, codes: draft.codes.map((c, i) => i === index ? number(event.target.value) : c) })} />
          </label>
        ))}
      </div>
      {problems.length > 0 && <ul className="mm-problems" role="alert">{problems.map((p) => <li key={p}>{t.problems[p as keyof MastermindTexts["problems"]]}</li>)}</ul>}
      <div className="mm-actions mm-settings-actions">
        <button type="button" className="mm-button mm-primary" disabled={problems.length > 0 || !dirty} onClick={save}
          data-testid="mastermind-save-settings">{t.saveSettings}</button>
        {savedNotice && !dirty && <span className="mm-muted" role="status">{t.settingsSaved}</span>}
      </div>
    </details>
  );
}

interface VirtualCard { readonly punches: SimulatedCard["punches"]; readonly readCount: number }

function PracticePanel({ settings, onReadOut, t, language }: {
  settings: GameSettings; onReadOut: (card: SimulatedCard) => void; t: MastermindTexts; language: Language;
}) {
  const [cardNumber, setCardNumber] = useState(PRACTICE_CARDS[0]!);
  const [cards, setCards] = useState<Record<number, VirtualCard>>({});
  const card = cards[cardNumber] ?? { punches: [], readCount: 0 };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const capacity = CARD_LAYOUTS.SI10.maxPunches;
  const change = (next: VirtualCard) => setCards((all) => ({ ...all, [cardNumber]: next }));
  const punch = (code: number) => {
    if (card.punches.length >= capacity) return;
    change({ ...card, punches: [...card.punches, { code, time: stationClock(new Date(), zone) }] });
  };
  const fresh = card.punches.slice(card.readCount);
  return (
    <section className="mm-panel mm-practice" aria-labelledby="mm-practice-title">
      <h2 id="mm-practice-title">{t.practiceTitle}</h2>
      <p className="mm-muted">{t.practiceNote}</p>
      <label className="mm-inline">{t.practiceCard}
        <select value={cardNumber} onChange={(event) => setCardNumber(Number(event.target.value))}>
          {PRACTICE_CARDS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="mm-punch-buttons">
        {settings.codes.map((code, index) => (
          <button key={code} type="button" className="mm-punch" onClick={() => punch(code)} aria-label={`${PALETTE[index]![language]} ${code}`}>
            <Pip color={index} settings={settings} language={language} />
          </button>
        ))}
      </div>
      <p className="mm-muted">{t.punched}:</p>
      <div className="mm-pips mm-punched">
        {fresh.length === 0 ? <span className="mm-muted">{t.nothingPunched}</span> : fresh.map((p, i) => {
          const color = settings.codes.indexOf(p.code);
          return color < 0 ? <span key={i} className="mm-other-code">{p.code}</span> : <Pip key={i} color={color} settings={settings} language={language} size="sm" />;
        })}
      </div>
      <div className="mm-actions">
        <button type="button" className="mm-button mm-primary"
          onClick={() => { onReadOut({ cardType: "SI10", cardNumber, punches: card.punches }); change({ ...card, readCount: card.punches.length }); }}>
          {t.readOut}
        </button>
        <button type="button" className="mm-button" disabled={fresh.length === 0}
          onClick={() => change({ ...card, punches: card.punches.slice(0, -1) })}>{t.undo}</button>
        <button type="button" className="mm-button" onClick={() => change({ punches: [], readCount: 0 })}>{t.clearCard}</button>
      </div>
    </section>
  );
}

/** Var resultaten finns: sparade på servern, väntar på nätet, eller bara här (inte inloggad). */
function SyncNote({ status, t }: { status: SyncStatus | undefined; t: MastermindTexts }) {
  if (!status) return null;
  return <span className={`mm-muted mm-sync mm-sync-${status}`} role="status" data-testid="mastermind-sync">{t.sync[status]}</span>;
}

/**
 * Administratören slår på "Spela på egen dator" (knappen på tävlingssidan); funktionären ser bara om det är på.
 */
function OpenStations({ raceId, info, onChange, t }: { raceId: string; info: Extract<SyncInfo, { mode: "staff" }>;
  onChange: (info: SyncInfo) => void; t: MastermindTexts }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Valet syns direkt; går ändringen inte igenom visas serverns läge igen.
  const [wanted, setWanted] = useState<boolean>();
  if (!info.canOpen) return info.openStations ? <span className="mm-muted" data-testid="mastermind-stations">{t.stations.on}</span> : null;
  return <span className="mm-stations" data-testid="mastermind-stations">
    <label className="mm-check">
      <input type="checkbox" checked={wanted ?? info.openStations} disabled={busy} onChange={(event) => {
        const open = event.target.checked;
        setBusy(true); setFailed(false); setWanted(open);
        void setOpenStations(raceId, open, { fetch: (...args) => fetch(...args), csrf: accountCsrf }).then((outcome) => {
          if (outcome.kind === "ok") onChange(outcome.info); else setFailed(true);
        }).finally(() => { setBusy(false); setWanted(undefined); });
      }} />
      {t.stations.label}
    </label>{" "}
    <span className="mm-muted">{failed ? t.stations.failed : t.stations.help}</span>
  </span>;
}

export function MastermindApp({ language, raceId, station: publicStation = false }: { language: Language; raceId?: string | undefined; station?: boolean }) {
  const t = language === "en" ? mastermindTextEn : mastermindText;
  const key = storageKey(raceId, publicStation);
  const [state, setState] = useState<SavedState>(() => loadState(key));
  const [training, setTraining] = useState<string>();
  const [viewing, setViewing] = useState<number | undefined>(() => state.games.at(-1)?.cardNumber);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | undefined>(undefined);
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [confirmAbortId, setConfirmAbortId] = useState<string>();
  const [confirmForget, setConfirmForget] = useState(false);
  const sound = useRef(new ReadoutSound());
  const stateRef = useRef(state);

  useEffect(() => {
    if (!confirmNewGame) return;
    const timer = setTimeout(() => setConfirmNewGame(false), 5_000);
    return () => clearTimeout(timer);
  }, [confirmNewGame]);
  useEffect(() => { setConfirmNewGame(false); }, [viewing]);

  /** En ändring på den här datorn: versionen räknas upp så att den skickas till servern. */
  const commit = useCallback((next: MastermindState) => {
    const saved: SavedState = { ...next, version: stateRef.current.version + 1, acked: stateRef.current.acked };
    stateRef.current = saved; setState(saved); saveState(key, saved);
  }, [key]);
  /** Serverns läge inslaget (`useMastermindSync`): ingen ny version. */
  const applyServer = useCallback((next: SavedState) => { stateRef.current = next; setState(next); saveState(key, next); }, [key]);
  const sync = useMastermindSync(raceId, publicStation ? "station" : "staff", state.version, state.acked, () => stateRef.current, applyServer);
  // "Spela på egen dator": spelet startar först när träningens inställningar har kommit från servern.
  const stationInfo = sync.info?.mode === "station" ? sync.info : undefined;
  const staffInfo = sync.info?.mode === "staff" ? sync.info : undefined;
  const ready = !publicStation || (stationInfo !== undefined && sync.status !== "closed");

  // Stationen läser alltid den senaste versionen av funktionen (useGameStation håller den i en ref).
  const onCard = (event: CardEvent) => {
    if (event.kind === "inserted") { setViewing(event.cardNumber); setMessage({ tone: "info", text: t.reading(event.cardNumber) }); return; }
    if (event.kind === "failed") { setMessage({ tone: "fail", text: t.readFailed(event.cardNumber) }); sound.current.play("fail"); return; }
    if (event.kind === "unsupported") { setMessage({ tone: "fail", text: t.unsupported(event.cardNumber) }); sound.current.play("fail"); return; }
    readCard(event.card);
  };

  function readCard(card: SiCardData) {
    const current = stateRef.current;
    const outcome = applyReadout(currentGame(current.games, card.cardNumber), card.cardNumber, cardPunches(card), current.settings, new Date());
    // Avgjorda spel ligger kvar i listan (statistiken); nästa utläsning av brickan startar ett nytt.
    commit({ ...current, games: upsertGame(current.games, outcome.game) });
    setViewing(card.cardNumber);
    const full = card.punches.length + outcome.game.settings.positions > CARD_LAYOUTS[card.cardType].maxPunches ? ` ${t.cardFull}` : "";
    if (outcome.kind === "started") {
      // Första utläsningen: spelet startar, klockan står på 0 och stämplingarna på brickan räknas inte.
      setMessage({ tone: "info", text: (outcome.afterGame ? t.newGameStarted : "") + t.started + full });
      sound.current.play("neutral");
      return;
    }
    if (outcome.kind === "rejected") {
      const reading = outcome.reading;
      const text = reading.kind === "too-few" ? t.rejected["too-few"](reading.colors.length, outcome.game.settings.positions)
        : t.rejected[reading.kind];
      setMessage({ tone: reading.kind === "empty" ? "info" : "fail", text: text + full });
      sound.current.play(reading.kind === "empty" ? "neutral" : "fail");
      return;
    }
    const { exact, colorOnly } = outcome.guess.score;
    if (outcome.status === "won") { setMessage({ tone: "ok", text: wonText(outcome.game) }); sound.current.play("ok"); return; }
    if (outcome.status === "lost") { setMessage({ tone: "fail", text: t.lost }); sound.current.play("fail"); return; }
    const left = outcome.game.settings.maxGuesses - outcome.game.guesses.length;
    setMessage({ tone: "info", text: `${t.scoreLabel(exact, colorOnly)} · ${t.guessesLeft(left)}${full}` });
    sound.current.play("neutral");
  }

  function wonText(game: CardGame): string {
    const duration = gameDuration(game);
    return t.won(game.guesses.length) + (duration === undefined ? "" : ` ${t.wonTime(formatDuration(duration))}`);
  }

  /** Arrangörens dator: avbryter ett spel som pågår, efter en inline-bekräftelse. Når servern och andra datorer som vanligt. */
  function requestAbort(gameId: string) {
    const current = stateRef.current;
    const target = current.games.find((item) => item.id === gameId);
    if (!target || !isPlaying(target)) return;
    setConfirmAbortId(gameId);
  }
  function confirmAbort() {
    if (!confirmAbortId) return;
    const current = stateRef.current;
    const target = current.games.find((item) => item.id === confirmAbortId);
    setConfirmAbortId(undefined);
    if (!target || !isPlaying(target)) return;
    const team = teamName(current.names, target.cardNumber) ?? t.card(target.cardNumber);
    commit({ ...current, games: upsertGame(current.games, abandonGame(target, new Date())) });
    setMessage({ tone: "info", text: t.aborted(team) });
  }
  const canAbort = raceId !== undefined && !publicStation;
  const abortTarget = confirmAbortId ? state.games.find((item) => item.id === confirmAbortId && isPlaying(item)) : undefined;
  const abortTargetName = abortTarget ? (teamName(state.names, abortTarget.cardNumber) ?? t.card(abortTarget.cardNumber)) : undefined;

  function setName(cardNumber: number, name: string) {
    const current = stateRef.current;
    // Ett tomt namn står kvar med sin tid, så att borttagningen också når servern och andra datorer.
    commit({ ...current, names: { ...current.names, [String(cardNumber)]: { name, at: new Date().toISOString() } } });
  }

  const station = useGameStation(onCard, t);
  const unlockThen = (action: () => Promise<void>) => () => { void sound.current.unlock(); void action(); };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === key) { const next = loadState(key); stateRef.current = next; setState(next); } };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const game = viewing === undefined ? undefined : currentGame(state.games, viewing);
  const connected = station.status.kind === "ready" || station.status.kind === "misconfigured" || station.status.kind === "connecting";
  const rows = standings(state.games);
  const names = Object.fromEntries(Object.keys(state.names).flatMap((card) => {
    const name = teamName(state.names, Number(card));
    return name ? [[card, name]] : [];
  }));

  return (
    <main className="mm-app">
      <header className="mm-header">
        <div className="mm-header-title">
          <h1>{t.title}</h1>
          <span className="mm-mode-badge" data-mode={publicStation ? "station" : raceId ? "training" : "local"} data-testid="mastermind-mode-badge">
            {publicStation ? t.modePublicStation : raceId ? t.modeTraining : t.modeLocal}
          </span>
        </div>
        <a className="mm-language" href={languageHref(language === "en" ? "sv" : "en", "/mastermind/")}
          // Träningen (`#<tävling>`) och den publika stationen (`#spela:<tävling>`) ligger i adressens fragment, som servern inte ser.
          onClick={(event) => { const link = event.currentTarget; link.href = languageHref(language === "en" ? "sv" : "en", `/mastermind/${window.location.hash}`); }}>{t.language}</a>
      </header>
      {raceId && !publicStation && <p className="mm-training" data-testid="mastermind-training">
        <a href={`/admin/${raceId}`}>{t.backToTraining}</a> <strong>{training ? t.training(training) : t.trainingUnknown}</strong>{" "}
        <SyncNote status={sync.status} t={t} />
        {staffInfo && <> <OpenStations raceId={raceId} info={staffInfo} onChange={sync.setInfo} t={t} /></>}</p>}
      {raceId && publicStation && <p className="mm-training" data-testid="mastermind-training">
        {stationInfo && <><a href={`/t/${stationInfo.shortCode}`}>{t.stations.back}</a>{" "}
          <strong>{t.training(stationInfo.raceName === stationInfo.eventName ? stationInfo.eventName : `${stationInfo.eventName} – ${stationInfo.raceName}`)}</strong>{" "}</>}
        {sync.status === "closed" ? <span className="mm-muted" role="status">{t.stations.closed}</span>
          : stationInfo ? <SyncNote status={sync.status} t={t} /> : <span className="mm-muted" role="status">{t.stations.loading}</span>}</p>}
      {/* Öppen tills något spel finns (för träningen), sedan hopfälld så att den inte tar plats under spelet. */}
      <details className="mm-panel mm-about" open={state.games.length === 0} data-testid="mastermind-about">
        <summary>{t.aboutTitle}</summary>
        <ul>{t.about.map((line) => <li key={line}>{line}</li>)}</ul>
      </details>

      <section className="mm-panel" aria-label={t.station}>
        {ready && <div className="mm-actions">
          {!connected && hasSerial && <button type="button" className="mm-button mm-primary" onClick={unlockThen(station.connectSerial)}>{t.connect}</button>}
          {!connected && hasUsb && <button type="button" className="mm-button" onClick={unlockThen(station.connectUsb)}>{t.connectUsb}</button>}
          {!connected && hasBluetooth && <button type="button" className="mm-button" onClick={unlockThen(station.connectBluetooth)}>{t.connectBluetooth}</button>}
          {!connected && <button type="button" className="mm-button" onClick={unlockThen(station.connectPractice)}>{t.practice}</button>}
          {connected && <button type="button" className="mm-button" onClick={() => void station.disconnect()}>{t.disconnect}</button>}
        </div>}
        <p className={`mm-status mm-status-${station.status.kind}`} role="status">{statusText(t, station.status)}</p>
      </section>

      <section className="mm-panel" aria-labelledby="mm-legend-title">
        <h2 id="mm-legend-title">{t.legend}</h2>
        <ul className="mm-legend">
          {state.settings.codes.map((code, index) => (
            <li key={code}><Pip color={index} settings={state.settings} language={language} /> {PALETTE[index]![language]}</li>
          ))}
        </ul>
      </section>

      <div className="mm-layout">
        <section className="mm-panel mm-game" aria-live="polite">
          {game ? <>
            <div className="mm-game-head">
              <div>
                <h2>{t.card(game.cardNumber)}</h2>
                <label className="mm-name">{t.teamName}
                  <input type="text" maxLength={MASTERMIND_NAME_MAX} value={state.names[String(game.cardNumber)]?.name ?? ""} placeholder={t.teamNamePlaceholder}
                    onChange={(event) => setName(game.cardNumber, event.target.value)} />
                </label>
              </div>
              <div className="mm-actions">
              <button type="button" className={confirmNewGame ? "mm-button mm-primary" : "mm-button"} data-testid="mastermind-new-game" onClick={() => {
                if (isPlaying(game) && !confirmNewGame) { setConfirmNewGame(true); return; }
                setConfirmNewGame(false);
                const current = stateRef.current;
                const { previous, next } = restart(game, current.settings, new Date());
                commit({ ...current, games: upsertGame(upsertGame(current.games, previous), next) });
                setMessage(undefined);
              }}>{confirmNewGame ? t.newGameConfirm : t.newGame}</button>
              {canAbort && isPlaying(game) && <button type="button" className="mm-button" onClick={() => requestAbort(game.id)}>{t.abortGame}</button>}
              </div>
            </div>
            {abortTarget && abortTargetName && game.id === abortTarget.id && <div className="mm-confirm" role="alert" data-testid="mastermind-abort-confirm">
              <p>{t.abortConfirm(abortTargetName)}</p>
              <div className="mm-actions">
                <button type="button" className="mm-button mm-primary" onClick={confirmAbort}>{t.abortGame}</button>
                <button type="button" className="mm-button" onClick={() => setConfirmAbortId(undefined)}>{t.cancel}</button>
              </div>
            </div>}
            <GameClock game={game} t={t} />
            {message && <p className={`mm-message mm-message-${message.tone}`}>{message.text}</p>}
            <Board game={game} t={t} language={language} />
          </> : <>{message && <p className={`mm-message mm-message-${message.tone}`}>{message.text}</p>}<p className="mm-muted">{t.noPlayers}</p></>}
        </section>

        <aside className="mm-side">
          {station.practice && <PracticePanel settings={state.settings} t={t} language={language}
            onReadOut={(card) => station.practice?.insert(card)} />}
          {/* "Spela på egen dator" spelar med träningens inställningar. */}
          {!publicStation && <SettingsPanel settings={state.settings} onChange={(settings) => commit({ ...stateRef.current, settings, settingsAt: new Date().toISOString() })}
            t={t} language={language} />}
        </aside>
      </div>

      <section className="mm-panel" aria-labelledby="mm-results-title">
        <h2 id="mm-results-title">{t.results}</h2>
        <p className="mm-muted">{t.resultsNote}</p>
        <StandingsTable rows={rows} names={names} viewing={viewing} t={t}
          onSelect={(cardNumber) => setViewing(cardNumber)} onAbort={canAbort ? requestAbort : undefined} />
        {abortTarget && abortTargetName && (!game || game.id !== abortTarget.id) && <div className="mm-confirm" role="alert" data-testid="mastermind-abort-confirm">
          <p>{t.abortConfirm(abortTargetName)}</p>
          <div className="mm-actions">
            <button type="button" className="mm-button mm-primary" onClick={confirmAbort}>{t.abortGame}</button>
            <button type="button" className="mm-button" onClick={() => setConfirmAbortId(undefined)}>{t.cancel}</button>
          </div>
        </div>}
        {/* Från en träning finns spelen på servern (också andra datorers), så de glöms inte här; gallringen tar bort dem. */}
        {!raceId && rows.length > 0 && (confirmForget ? <div className="mm-confirm" role="alert" data-testid="mastermind-forget-confirm">
          <p>{t.forgetConfirm}</p>
          <div className="mm-actions">
            <button type="button" className="mm-button mm-primary" onClick={() => {
              commit({ ...stateRef.current, games: [] }); setViewing(undefined); setMessage(undefined); setConfirmForget(false);
            }}>{t.forget}</button>
            <button type="button" className="mm-button" onClick={() => setConfirmForget(false)}>{t.cancel}</button>
          </div>
        </div> : <button type="button" className="mm-button mm-small" onClick={() => setConfirmForget(true)}>{t.forget}</button>)}
      </section>
      {raceId && !publicStation && <RaceSwitch raceId={raceId} connected={connected} onContext={(context) =>
        setTraining(context.raceName === context.eventName ? context.eventName : `${context.eventName} – ${context.raceName}`)}
        current={{ key: "mastermind", label: "MASTERMIND", href: `/admin/${raceId}/mastermind` }} />}
    </main>
  );
}
