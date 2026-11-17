import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_LAYOUTS, resolveSiTime, stationClock, type SiCardData, type SimulatedCard } from "@o-tid/sportident";
import { ReadoutSound } from "../readout/sound";
import type { StationStatus } from "../readout/station";
import { languageHref, type Language } from "../lib/language";
import {
  applyReadout, formatDuration, gameDuration, gameStatus, MAX_COLORS, MAX_POSITIONS, MIN_COLORS, MIN_POSITIONS, PALETTE, parseSavedState,
  restart, resultOf, settingsProblems, standings, type CardGame, type CardPunch, type Code, type GameSettings, type SavedState, type Score
} from "./game";
import { StandingsTable, useElapsed } from "./standings-view";
import { hasSerial, hasBluetooth, hasUsb, useGameStation, type CardEvent } from "./station";
import { mastermindText, mastermindTextEn, type MastermindTexts } from "./texts";

const STORAGE_KEY = "otid.mastermind.v1";
const PRACTICE_CARDS = [7_000_001, 7_000_002, 7_000_003];
type Tone = "info" | "ok" | "fail";

function loadState(): SavedState {
  try { return parseSavedState(window.localStorage.getItem(STORAGE_KEY)); }
  catch { return parseSavedState(null); }
}

function saveState(state: SavedState): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
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

/**
 * Brickans stämplingar med absolut tid. Tiderna placeras mot avläsningsstationens klocka när den är känd (kontrollerna är
 * normalt ställda mot samma klocka), annars datorns. En tid som inte går att placera blir utan tid i stället för ett fel.
 */
function cardPunches(card: SiCardData, clockOffsetMs: number | undefined): CardPunch[] {
  const options = { reference: new Date(Date.now() + (clockOffsetMs ?? 0)), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  return card.punches.map((p) => {
    if (!p.time) return { code: p.code };
    let at: string | undefined;
    try { at = resolveSiTime(p.time, options).toISOString(); }
    catch (error) { console.warn(`Stämplingen på kontroll ${p.code} har en tid som inte går att placera`, error); }
    return { code: p.code, time: JSON.stringify(p.time), ...(at ? { at } : {}) };
  });
}

function GameClock({ game, clockOffsetMs, t }: { game: CardGame; clockOffsetMs: number; t: MastermindTexts }) {
  const playing = gameStatus(game) === "playing";
  const elapsed = useElapsed(playing ? game.firstPunchAt : undefined, clockOffsetMs);
  const duration = playing ? elapsed : gameDuration(game);
  return (
    <p className="mm-clock" aria-label={t.time}>
      <span className="mm-muted">{t.time}</span>{" "}
      <strong>{duration === undefined ? (playing && !game.firstPunchAt ? t.clockNotStarted : "–") : formatDuration(duration)}</strong>
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
  const problems = settingsProblems(draft);
  const update = (next: GameSettings) => { setDraft(next); if (settingsProblems(next).length === 0) onChange(next); };
  const setColors = (count: number) => {
    const codes = Array.from({ length: count }, (_, index) => draft.codes[index] ?? (draft.codes.at(-1) ?? 30) + index - draft.codes.length + 1);
    update({ ...draft, codes });
  };
  const number = (value: string) => Number.parseInt(value, 10);
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
          <input type="number" min={1} max={20} value={Number.isNaN(draft.maxGuesses) ? "" : draft.maxGuesses}
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

export function MastermindApp({ language }: { language: Language }) {
  const t = language === "en" ? mastermindTextEn : mastermindText;
  const [state, setState] = useState<SavedState>(() => loadState());
  const [viewing, setViewing] = useState<number | undefined>(() => state.games.at(-1)?.cardNumber);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | undefined>(undefined);
  const sound = useRef(new ReadoutSound());
  const stateRef = useRef(state);
  /** Avläsningsstationens klocka minus datorns (från senaste avläsningen), för den löpande tiden. */
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  const commit = useCallback((next: SavedState) => { stateRef.current = next; setState(next); saveState(next); }, []);

  // Stationen läser alltid den senaste versionen av funktionen (useGameStation håller den i en ref).
  const onCard = (event: CardEvent) => {
    if (event.kind === "inserted") { setViewing(event.cardNumber); setMessage({ tone: "info", text: t.reading(event.cardNumber) }); return; }
    if (event.kind === "failed") { setMessage({ tone: "fail", text: t.readFailed(event.cardNumber) }); sound.current.play("fail"); return; }
    if (event.kind === "unsupported") { setMessage({ tone: "fail", text: t.unsupported(event.cardNumber) }); sound.current.play("fail"); return; }
    if (event.clockOffsetMs !== undefined) setClockOffsetMs(event.clockOffsetMs);
    readCard(event.card, event.clockOffsetMs);
  };

  function readCard(card: SiCardData, stationOffsetMs: number | undefined) {
    const current = stateRef.current;
    const existing = current.games.find((game) => game.cardNumber === card.cardNumber);
    const outcome = applyReadout(existing, card.cardNumber, cardPunches(card, stationOffsetMs), current.settings, new Date());
    const games = [...current.games.filter((game) => game.cardNumber !== card.cardNumber), outcome.game];
    // Ett spel som just tog slut går in i statistiken (en gång: ett avslutat spel som läses igen ger "rejected").
    const result = outcome.kind === "guessed" ? resultOf(outcome.game) : undefined;
    commit({ ...current, games, results: result ? [...current.results, result] : current.results });
    setViewing(card.cardNumber);
    const prefix = outcome.newGame ? t.newGameStarted : "";
    const full = card.punches.length + outcome.game.settings.positions > CARD_LAYOUTS[card.cardType].maxPunches ? ` ${t.cardFull}` : "";
    const finished = gameStatus(outcome.game);
    if (outcome.kind === "rejected" && finished !== "playing") {
      // Ett avslutat spel som läses ut igen utan nya färger: visa hur det gick.
      setMessage(finished === "won" ? { tone: "ok", text: wonText(outcome.game) } : { tone: "fail", text: t.lost });
      sound.current.play("neutral");
      return;
    }
    if (outcome.kind === "rejected") {
      const reading = outcome.reading;
      const text = reading.kind === "too-few" ? t.rejected["too-few"](reading.colors.length, outcome.game.settings.positions)
        : t.rejected[reading.kind];
      setMessage({ tone: reading.kind === "empty" ? "info" : "fail", text: prefix + text + full });
      sound.current.play(reading.kind === "empty" ? "neutral" : "fail");
      return;
    }
    const { exact, colorOnly } = outcome.guess.score;
    if (outcome.status === "won") { setMessage({ tone: "ok", text: wonText(outcome.game) }); sound.current.play("ok"); return; }
    if (outcome.status === "lost") { setMessage({ tone: "fail", text: t.lost }); sound.current.play("fail"); return; }
    const left = outcome.game.settings.maxGuesses - outcome.game.guesses.length;
    setMessage({ tone: "info", text: `${prefix}${t.scoreLabel(exact, colorOnly)} · ${t.guessesLeft(left)}${full}` });
    sound.current.play("neutral");
  }

  function wonText(game: CardGame): string {
    const duration = gameDuration(game);
    return t.won(game.guesses.length) + (duration === undefined ? "" : ` ${t.wonTime(formatDuration(duration))}`);
  }

  function setName(cardNumber: number, name: string) {
    const current = stateRef.current;
    const names = { ...current.names };
    if (name.trim()) names[String(cardNumber)] = name; else delete names[String(cardNumber)];
    commit({ ...current, names });
  }

  const station = useGameStation(onCard, t);
  const unlockThen = (action: () => Promise<void>) => () => { void sound.current.unlock(); void action(); };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) { const next = loadState(); stateRef.current = next; setState(next); } };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const game = state.games.find((g) => g.cardNumber === viewing);
  const connected = station.status.kind === "ready" || station.status.kind === "misconfigured" || station.status.kind === "connecting";
  const rows = standings(state.results, state.games);

  return (
    <main className="mm-app">
      <header className="mm-header">
        <h1>{t.title}</h1>
        <a className="mm-language" href={languageHref(language === "en" ? "sv" : "en", "/mastermind/")}>{t.language}</a>
      </header>
      <p className="mm-intro">{t.intro}</p>

      <section className="mm-panel" aria-label={t.station}>
        <div className="mm-actions">
          {!connected && hasSerial && <button type="button" className="mm-button mm-primary" onClick={unlockThen(station.connectSerial)}>{t.connect}</button>}
          {!connected && hasUsb && <button type="button" className="mm-button" onClick={unlockThen(station.connectUsb)}>{t.connectUsb}</button>}
          {!connected && hasBluetooth && <button type="button" className="mm-button" onClick={unlockThen(station.connectBluetooth)}>{t.connectBluetooth}</button>}
          {!connected && <button type="button" className="mm-button" onClick={unlockThen(station.connectPractice)}>{t.practice}</button>}
          {connected && <button type="button" className="mm-button" onClick={() => void station.disconnect()}>{t.disconnect}</button>}
        </div>
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
                  <input type="text" maxLength={40} value={state.names[String(game.cardNumber)] ?? ""} placeholder={t.teamNamePlaceholder}
                    onChange={(event) => setName(game.cardNumber, event.target.value)} />
                </label>
              </div>
              <button type="button" className="mm-button" onClick={() => {
                commit({ ...state, games: state.games.map((g) => g === game ? restart(g, state.settings, new Date()) : g) });
                setMessage(undefined);
              }}>{t.newGame}</button>
            </div>
            <GameClock game={game} clockOffsetMs={clockOffsetMs} t={t} />
            {message && <p className={`mm-message mm-message-${message.tone}`}>{message.text}</p>}
            <Board game={game} t={t} language={language} />
          </> : <>{message && <p className={`mm-message mm-message-${message.tone}`}>{message.text}</p>}<p className="mm-muted">{t.noPlayers}</p></>}
        </section>

        <aside className="mm-side">
          {station.practice && <PracticePanel settings={state.settings} t={t} language={language}
            onReadOut={(card) => station.practice?.insert(card)} />}
          <SettingsPanel settings={state.settings} onChange={(settings) => commit({ ...stateRef.current, settings })} t={t} language={language} />
        </aside>
      </div>

      <section className="mm-panel" aria-labelledby="mm-results-title">
        <h2 id="mm-results-title">{t.results}</h2>
        <p className="mm-muted">{t.resultsNote}</p>
        <StandingsTable rows={rows} names={state.names} viewing={viewing} clockOffsetMs={clockOffsetMs} t={t}
          onSelect={(cardNumber) => setViewing(cardNumber)} />
        {rows.length > 0 && <button type="button" className="mm-button mm-small" onClick={() => {
          if (window.confirm(t.forgetConfirm)) { commit({ ...stateRef.current, games: [], results: [] }); setViewing(undefined); setMessage(undefined); }
        }}>{t.forget}</button>}
      </section>
    </main>
  );
}
