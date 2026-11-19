import { describe, expect, it } from "vitest";
import {
  abandonGame, applyReadout, currentGame, DEFAULT_SETTINGS, formatDuration, gameDuration, gameStatus, mergeGame, mergeMastermindState, newGame, normalizeGame,
  punchesSince, randomSecret, readGuess, restart, scoreGuess, settingsProblems, standings, type CardGame, type CardPunch, type GameSettings,
  type MastermindState
} from "../src/mastermind";

const at = new Date("2026-11-11T20:00:00Z");
/** Ger samma följd varje gång: 0, 0.1, 0.2, … */
const sequence = () => { let n = 0; return () => (n++ % 10) / 10; };
const punch = (code: number, second: number): CardPunch => ({ code, time: `${second}` });
const punches = (codes: number[], from = 0) => codes.map((code, index) => punch(code, from + index));

describe("scoreGuess", () => {
  it("counts exact and colour-only matches", () => {
    expect(scoreGuess([0, 1, 2, 3], [0, 1, 2, 3])).toEqual({ exact: 4, colorOnly: 0 });
    expect(scoreGuess([0, 1, 2, 3], [3, 2, 1, 0])).toEqual({ exact: 0, colorOnly: 4 });
    expect(scoreGuess([0, 1, 2, 3], [0, 2, 4, 5])).toEqual({ exact: 1, colorOnly: 1 });
    expect(scoreGuess([0, 1, 2, 3], [4, 5, 4, 5])).toEqual({ exact: 0, colorOnly: 0 });
  });

  it("does not count a repeated colour more often than it occurs", () => {
    expect(scoreGuess([0, 0, 1, 2], [0, 3, 0, 0])).toEqual({ exact: 1, colorOnly: 1 });
    expect(scoreGuess([0, 1, 2, 3], [1, 1, 1, 1])).toEqual({ exact: 1, colorOnly: 0 });
  });
});

describe("randomSecret", () => {
  it("has no repeats unless allowed", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const secret = randomSecret(DEFAULT_SETTINGS);
      expect(secret).toHaveLength(4);
      expect(new Set(secret).size).toBe(4);
      expect(secret.every((color) => color >= 0 && color < 6)).toBe(true);
    }
  });

  it("can repeat colours when allowed", () => {
    expect(randomSecret({ ...DEFAULT_SETTINGS, allowRepeats: true }, () => 0)).toEqual([0, 0, 0, 0]);
  });
});

describe("readGuess", () => {
  it("ignores other controls and collapses a double punch", () => {
    expect(readGuess(punches([31, 50, 32, 32, 33, 34]), DEFAULT_SETTINGS)).toEqual({ kind: "guess", colors: [0, 1, 2, 3] });
  });

  it("rejects too few colours and repeats", () => {
    expect(readGuess(punches([50, 51]), DEFAULT_SETTINGS)).toEqual({ kind: "empty" });
    expect(readGuess(punches([31, 32, 33]), DEFAULT_SETTINGS).kind).toBe("too-few");
    expect(readGuess(punches([31, 32, 31, 33]), DEFAULT_SETTINGS).kind).toBe("repeated");
  });

  it("counts only the last colours when too many were punched, in punch order", () => {
    expect(readGuess(punches([36, 31, 32, 33, 34]), DEFAULT_SETTINGS)).toEqual({ kind: "guess", colors: [0, 1, 2, 3] });
    expect(readGuess(punches([31, 32, 33, 34, 35, 36, 31, 32]), DEFAULT_SETTINGS)).toEqual({ kind: "guess", colors: [4, 5, 0, 1] });
    // En upprepning före de sista fyra spelar ingen roll; inom dem gör den det.
    expect(readGuess(punches([33, 31, 32, 33, 34]), DEFAULT_SETTINGS).kind).toBe("guess");
    expect(readGuess(punches([31, 32, 33, 32, 34]), DEFAULT_SETTINGS).kind).toBe("repeated");
    // En annan kontroll mitt i räknas inte.
    expect(readGuess(punches([35, 31, 50, 32, 33, 34, 50]), DEFAULT_SETTINGS)).toEqual({ kind: "guess", colors: [0, 1, 2, 3] });
  });

  it("counts every punch when repeats are allowed", () => {
    const settings: GameSettings = { ...DEFAULT_SETTINGS, allowRepeats: true };
    expect(readGuess(punches([31, 31, 32, 32]), settings)).toEqual({ kind: "guess", colors: [0, 0, 1, 1] });
  });
});

describe("punchesSince", () => {
  it("takes only punches after the last readout", () => {
    const card = punches([31, 32, 33, 34, 35, 36]);
    expect(punchesSince(card, { count: 4, code: 34, time: "3" })).toEqual(card.slice(4));
  });

  it("takes everything when the card has been cleared", () => {
    const card = punches([35, 36], 100);
    expect(punchesSince(card, { count: 4, code: 34, time: "3" })).toEqual(card);
    const refilled = punches([31, 32, 33, 34], 200);
    expect(punchesSince(refilled, { count: 4, code: 34, time: "3" })).toEqual(refilled);
  });
});

describe("applyReadout", () => {
  it("starts the game at the first readout without reading the punches", () => {
    const first = applyReadout(undefined, 7_000_001, punches([31, 32, 33, 34]), DEFAULT_SETTINGS, at, { random: sequence(), id: () => "a" });
    expect(first).toMatchObject({ kind: "started", afterGame: false });
    expect(first.game).toMatchObject({ id: "a", startedAt: at.toISOString(), guesses: [], marker: { count: 4, code: 34, time: "3", at: at.toISOString() } });
  });

  it("plays a whole game on one card without clearing it", () => {
    const random = { random: sequence() };
    const secret = randomSecret(DEFAULT_SETTINGS, sequence());
    const codes = secret.map((color) => DEFAULT_SETTINGS.codes[color]!);
    const wrong = [...codes].reverse();

    // Första utläsningen startar spelet; det som redan finns på brickan räknas inte.
    const old = punches([50, 31, 32]);
    const start = applyReadout(undefined, 7_000_001, old, DEFAULT_SETTINGS, at, random);
    expect(start.kind).toBe("started");
    expect(start.game.secret).toEqual(secret);

    const card1 = [...old, ...punches(wrong, 10)];
    const first = applyReadout(start.game, 7_000_001, card1, DEFAULT_SETTINGS, at, random);
    expect(first.kind).toBe("guessed");
    expect(first.game.guesses[0]!.colors).toEqual([...secret].reverse());

    const card = [...card1, ...punches(codes, 20)];
    const second = applyReadout(first.game, 7_000_001, card, DEFAULT_SETTINGS, at, random);
    expect(second.kind).toBe("guessed");
    if (second.kind !== "guessed") return;
    expect(second.guess.score).toEqual({ exact: 4, colorOnly: 0 });
    expect(second.status).toBe("won");
    expect(second.game.guesses).toHaveLength(2);

    // Nästa utläsning efter vinsten startar ett nytt spel; stämplingarna på brickan räknas inte heller då.
    const next = applyReadout(second.game, 7_000_001, [...card, ...punches([31, 32, 33, 34], 30)], DEFAULT_SETTINGS, at, random);
    expect(next).toMatchObject({ kind: "started", afterGame: true });
    expect(next.game.guesses).toHaveLength(0);
  });

  it("does not spend a guess on an invalid punch sequence", () => {
    const game = newGame(1, DEFAULT_SETTINGS, at);
    const result = applyReadout(game, 1, punches([31, 32]), DEFAULT_SETTINGS, at);
    expect(result.kind).toBe("rejected");
    expect(result.game.guesses).toHaveLength(0);
    expect(result.game.marker).toEqual({ count: 2, code: 32, time: "1", at: at.toISOString() });
  });

  it("is lost after the last guess", () => {
    const settings: GameSettings = { ...DEFAULT_SETTINGS, maxGuesses: 1 };
    const game = { ...newGame(1, settings, at), secret: [0, 1, 2, 3] };
    const result = applyReadout(game, 1, punches([32, 31, 33, 34]), settings, at);
    expect(result.kind === "guessed" && result.status).toBe("lost");
    expect(gameStatus(result.game)).toBe("lost");
  });
});

describe("settings", () => {
  it("flags impossible settings", () => {
    expect(settingsProblems(DEFAULT_SETTINGS)).toEqual([]);
    expect(settingsProblems({ ...DEFAULT_SETTINGS, codes: [31, 31, 33, 34] })).toContain("code-duplicate");
    expect(settingsProblems({ ...DEFAULT_SETTINGS, codes: [31, 32, 33, 34], positions: 5 })).toContain("too-few-colors");
  });
});

const later = (seconds: number) => new Date(at.getTime() + seconds * 1000);

describe("timer", () => {
  it("runs from the first readout to the readout of the winning guess", () => {
    const start = applyReadout(undefined, 1, [], DEFAULT_SETTINGS, at);
    const game: CardGame = { ...start.game, secret: [0, 1, 2, 3] };
    const card1 = punches([32, 31, 33, 34]);
    const first = applyReadout(game, 1, card1, DEFAULT_SETTINGS, later(90));
    expect(first.game.finishedAt).toBeUndefined();
    expect(gameDuration(first.game)).toBeUndefined();
    const second = applyReadout(first.game, 1, [...card1, ...punches([31, 32, 33, 34], 10)], DEFAULT_SETTINGS, later(243));
    expect(second.kind === "guessed" && second.status).toBe("won");
    expect(gameDuration(second.game)).toBe(243_000);
    expect(second.game).toMatchObject({ finishedAt: later(243).toISOString() });
  });

  it("formats durations", () => {
    expect(formatDuration(247_900)).toBe("4:07");
    expect(formatDuration(3_847_000)).toBe("1:04:07");
  });
});

/** Ett avgjort spel: vunnet på `guesses` gissningar efter `seconds` sekunder, eller förlorat. */
function played(cardNumber: number, status: "won" | "lost" | "playing", guesses: number, seconds = 60, startSecond = 0): CardGame {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, maxGuesses: status === "lost" ? guesses : 10 };
  const start = later(startSecond);
  const wrong = [1, 0, 2, 3], right = [0, 1, 2, 3];
  const list = Array.from({ length: guesses }, (_, index) => {
    const colors = status === "won" && index === guesses - 1 ? right : wrong;
    return { colors, score: scoreGuess(right, colors), at: new Date(start.getTime() + (index === guesses - 1 ? seconds : index + 1) * 1000).toISOString() };
  });
  return normalizeGame({ id: `${cardNumber}-${startSecond}`, cardNumber, secret: right, guesses: list, startedAt: start.toISOString(), settings })!;
}

describe("standings", () => {
  it("ranks solved games by time, then playing, then lost", () => {
    const games = [played(1, "won", 5, 300), played(2, "lost", 10, 900), played(3, "won", 3, 200), played(5, "won", 2, 300),
      played(9, "playing", 1)];
    const rows = standings(games);
    expect(rows.map((r) => [r.cardNumber, r.place])).toEqual([[3, 1], [5, 2], [1, 3], [9, undefined], [2, undefined]]);
    expect(rows[0]!.durationMs).toBe(200_000);
  });

  it("gives equal time and guesses the same place", () => {
    const rows = standings([played(1, "won", 4, 100), played(2, "won", 4, 100), played(3, "won", 4, 120)]);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3]);
  });

  it("keeps finished games, leaves out abandoned ones and shows only the card's current game as playing", () => {
    const solved = played(1, "won", 2, 100);
    const old = played(4, "playing", 1, 60, 0);
    const { previous, next } = restart(old, DEFAULT_SETTINGS, later(30), { id: () => "4-new" });
    expect(previous.abandonedAt).toBe(later(30).toISOString());
    const rows = standings([solved, previous, next]);
    expect(rows.map((r) => r.gameId)).toEqual([solved.id, "4-new"]);
    expect(currentGame([solved, previous, next], 4)).toBe(next);
    // Ett avgjort spel blir inte avbrutet av Nytt spel; det står kvar i statistiken.
    expect(restart(solved, DEFAULT_SETTINGS, later(200)).previous).toBe(solved);
  });
});

describe("abandonGame", () => {
  it("takes an ongoing game out of the standings so that the card's next readout starts a new game", () => {
    const ongoing = played(4, "playing", 1);
    const aborted = abandonGame(ongoing, later(30));
    expect(aborted.abandonedAt).toBe(later(30).toISOString());
    expect(standings([aborted])).toEqual([]);
    expect(currentGame([aborted], 4)).toBeUndefined();
    expect(applyReadout(currentGame([aborted], 4), 4, [], DEFAULT_SETTINGS, later(40))).toMatchObject({ kind: "started", afterGame: false });
    // Ett avgjort spel avbryts inte; ett avbrutet behåller sin tid, också efter sammanslagningen.
    const solved = played(1, "won", 2, 100);
    expect(abandonGame(solved, later(200))).toBe(solved);
    expect(abandonGame(aborted, later(50))).toBe(aborted);
    expect(mergeGame(ongoing, aborted).abandonedAt).toBe(later(30).toISOString());
  });
});

describe("normalizeGame", () => {
  it("recomputes the scores from the secret and ends the game at the deciding guess", () => {
    const game = played(1, "won", 2, 100);
    const forged = { ...game, guesses: [{ ...game.guesses[0]!, score: { exact: 4, colorOnly: 0 } }, ...game.guesses,
      { colors: [3, 2, 1, 0], score: { exact: 0, colorOnly: 4 }, at: later(500).toISOString() }], finishedAt: undefined };
    const checked = normalizeGame(forged)!;
    expect(checked.guesses.map((guess) => guess.score.exact)).toEqual([2, 4]);
    expect(checked.finishedAt).toBe(game.guesses[1]!.at);
  });

  it("rejects games that do not fit their settings", () => {
    const game = newGame(1, DEFAULT_SETTINGS, at, { id: () => "x" });
    expect(normalizeGame(game)).toEqual(game);
    expect(normalizeGame({ ...game, secret: [0, 0, 1, 2] })).toBeUndefined();
    expect(normalizeGame({ ...game, secret: [0, 1, 2, 9] })).toBeUndefined();
    expect(normalizeGame({ ...game, settings: { ...DEFAULT_SETTINGS, codes: [1] } })).toBeUndefined();
    expect(normalizeGame({ ...game, id: undefined })).toBeUndefined();
    expect(normalizeGame({ ...game, id: undefined }, () => "new")?.id).toBe("new");
    // En ogiltig gissning hoppas över; spelet står kvar.
    expect(normalizeGame({ ...game, guesses: [{ colors: [0, 1], at: at.toISOString() }] })?.guesses).toEqual([]);
  });
});

describe("merging", () => {
  const base = { ...newGame(7, DEFAULT_SETTINGS, at, { id: () => "g" }), secret: [0, 1, 2, 3] };
  const guess = (colors: number[], second: number) => ({ colors, score: scoreGuess([0, 1, 2, 3], colors), at: later(second).toISOString() });

  it("joins the guesses of two copies of a game, keeps the first copy's secret and the latest marker", () => {
    const server: CardGame = { ...base, guesses: [guess([1, 0, 2, 3], 10)], marker: { count: 4, code: 34, time: "3", at: later(10).toISOString() } };
    const local: CardGame = { ...base, secret: [3, 2, 1, 0], guesses: [guess([1, 0, 2, 3], 10), guess([0, 1, 2, 3], 20)],
      marker: { count: 8, code: 34, time: "9", at: later(20).toISOString() } };
    const merged = mergeGame(server, local);
    expect(merged.secret).toEqual([0, 1, 2, 3]);
    expect(merged.guesses).toHaveLength(2);
    expect(gameStatus(merged)).toBe("won");
    expect(merged.finishedAt).toBe(later(20).toISOString());
    expect(merged.marker?.count).toBe(8);
    expect(mergeGame(merged, server)).toEqual(merged);
  });

  it("merges the whole state: games by id, the latest settings and the latest name per card", () => {
    const other = newGame(8, DEFAULT_SETTINGS, later(5), { id: () => "h" });
    const server: MastermindState = { settings: DEFAULT_SETTINGS, games: [base], names: { "7": { name: "Rävarna", at: later(1).toISOString() } } };
    const local: MastermindState = { settings: { ...DEFAULT_SETTINGS, positions: 3 }, settingsAt: later(2).toISOString(), games: [other],
      names: { "7": { name: "Gamla", at: later(0).toISOString() }, "8": { name: "Ugglorna", at: later(3).toISOString() } } };
    const merged = mergeMastermindState(server, local);
    expect(merged.games.map((game) => game.id)).toEqual(["g", "h"]);
    expect(merged.settings.positions).toBe(3);
    expect(merged.names).toEqual({ "7": { name: "Rävarna", at: later(1).toISOString() }, "8": { name: "Ugglorna", at: later(3).toISOString() } });
    expect(mergeMastermindState(merged, server)).toEqual(merged);
  });
});
