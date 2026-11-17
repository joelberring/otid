import { describe, expect, it } from "vitest";
import {
  applyReadout, DEFAULT_SETTINGS, formatDuration, gameDuration, gameStatus, newGame, parseSavedState, punchesSince, randomSecret, readGuess,
  resultOf, scoreGuess, settingsProblems, standings, type CardGame, type CardPunch, type GameResult, type GameSettings
} from "./game";

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
  it("plays a whole game on one card without clearing it", () => {
    const random = sequence();
    const secret = randomSecret(DEFAULT_SETTINGS, sequence());
    const codes = secret.map((color) => DEFAULT_SETTINGS.codes[color]!);
    const wrong = [...codes].reverse();

    const first = applyReadout(undefined, 7_000_001, punches(wrong), DEFAULT_SETTINGS, at, random);
    expect(first.kind).toBe("guessed");
    expect(first.newGame).toBe(true);
    expect(first.game.secret).toEqual(secret);

    const card = [...punches(wrong), ...punches(codes, 10)];
    const second = applyReadout(first.game, 7_000_001, card, DEFAULT_SETTINGS, at, random);
    expect(second.kind).toBe("guessed");
    if (second.kind !== "guessed") return;
    expect(second.guess.score).toEqual({ exact: 4, colorOnly: 0 });
    expect(second.status).toBe("won");
    expect(second.game.guesses).toHaveLength(2);

    // Samma bricka igen utan nya stämplingar: det vunna spelet ligger kvar.
    const again = applyReadout(second.game, 7_000_001, card, DEFAULT_SETTINGS, at, random);
    expect(again).toMatchObject({ kind: "rejected", newGame: false, reading: { kind: "empty" } });
    expect(again.game.guesses).toHaveLength(2);

    // Nya färgstämplingar efter vinsten: nästa spel börjar och gissningen räknas där.
    const next = applyReadout(again.game, 7_000_001, [...card, ...punches([31, 32, 33, 34], 20)], DEFAULT_SETTINGS, at, random);
    expect(next).toMatchObject({ kind: "guessed", newGame: true });
    expect(next.game.guesses).toHaveLength(1);
  });

  it("does not spend a guess on an invalid punch sequence", () => {
    const game = newGame(1, DEFAULT_SETTINGS, at);
    const result = applyReadout(game, 1, punches([31, 32]), DEFAULT_SETTINGS, at);
    expect(result.kind).toBe("rejected");
    expect(result.game.guesses).toHaveLength(0);
    expect(result.game.marker).toEqual({ count: 2, code: 32, time: "1" });
  });

  it("is lost after the last guess", () => {
    const settings: GameSettings = { ...DEFAULT_SETTINGS, maxGuesses: 1 };
    const game = { ...newGame(1, settings, at), secret: [0, 1, 2, 3] };
    const result = applyReadout(game, 1, punches([32, 31, 33, 34]), settings, at);
    expect(result.kind === "guessed" && result.status).toBe("lost");
    expect(gameStatus(result.game)).toBe("lost");
  });
});

describe("settings and saved state", () => {
  it("flags impossible settings", () => {
    expect(settingsProblems(DEFAULT_SETTINGS)).toEqual([]);
    expect(settingsProblems({ ...DEFAULT_SETTINGS, codes: [31, 31, 33, 34] })).toContain("code-duplicate");
    expect(settingsProblems({ ...DEFAULT_SETTINGS, codes: [31, 32, 33, 34], positions: 5 })).toContain("too-few-colors");
  });

  it("survives broken storage", () => {
    expect(parseSavedState("{not json")).toEqual({ settings: DEFAULT_SETTINGS, games: [], results: [], names: {} });
    const game = newGame(5, DEFAULT_SETTINGS, at);
    const saved = parseSavedState(JSON.stringify({ settings: { codes: [1] }, games: [game, { cardNumber: "x" }] }));
    expect(saved.settings).toEqual(DEFAULT_SETTINGS);
    expect(saved.games).toEqual([game]);
  });
});

/** Stämplingar med absolut tid: sekund n efter 20:00:00. */
const timed = (codes: number[], from: number): CardPunch[] => codes.map((code, index) =>
  ({ code, time: `${from + index}`, at: new Date(at.getTime() + (from + index) * 1000).toISOString() }));

describe("timer", () => {
  it("runs from the first punch to the last punch of the winning guess", () => {
    const game = { ...newGame(1, DEFAULT_SETTINGS, at), secret: [0, 1, 2, 3] };
    // Första gissningen börjar med en startkontroll (50) och har fel antal färger: klockan startar ändå.
    const card1 = timed([50, 31, 32], 10);
    const first = applyReadout(game, 1, card1, DEFAULT_SETTINGS, at);
    expect(first.kind).toBe("rejected");
    expect(first.game.firstPunchAt).toBe(card1[0]!.at);
    const card2 = [...card1, ...timed([32, 31, 33, 34], 100)];
    const second = applyReadout(first.game, 1, card2, DEFAULT_SETTINGS, at);
    expect(second.game.finishedAt).toBeUndefined();
    const card3 = [...card2, ...timed([31, 32, 33, 34], 250)];
    const third = applyReadout(second.game, 1, card3, DEFAULT_SETTINGS, at);
    expect(third.kind === "guessed" && third.status).toBe("won");
    expect(gameDuration(third.game)).toBe((253 - 10) * 1000);
    expect(resultOf(third.game)).toMatchObject({ status: "won", guesses: 2 });
  });

  it("has no time without punch times", () => {
    const game = { ...newGame(1, DEFAULT_SETTINGS, at), secret: [0, 1, 2, 3] };
    const result = applyReadout(game, 1, punches([31, 32, 33, 34]), DEFAULT_SETTINGS, at);
    expect(gameDuration(result.game)).toBeUndefined();
  });

  it("formats durations", () => {
    expect(formatDuration(247_900)).toBe("4:07");
    expect(formatDuration(3_847_000)).toBe("1:04:07");
  });
});

describe("standings", () => {
  const result = (cardNumber: number, status: GameResult["status"], guesses: number, seconds?: number): GameResult => ({
    cardNumber, startedAt: at.toISOString(), status, guesses,
    ...(seconds === undefined ? {} : { firstPunchAt: at.toISOString(), finishedAt: new Date(at.getTime() + seconds * 1000).toISOString() })
  });

  it("ranks solved games by time, then playing, then lost", () => {
    const playing: CardGame = { ...newGame(9, DEFAULT_SETTINGS, at), firstPunchAt: at.toISOString() };
    const rows = standings([result(1, "won", 5, 300), result(2, "lost", 10, 900), result(3, "won", 3, 200), result(4, "won", 4),
      result(5, "won", 2, 300)], [playing]);
    expect(rows.map((r) => [r.cardNumber, r.place])).toEqual([[3, 1], [5, 2], [1, 3], [4, 4], [9, undefined], [2, undefined]]);
    expect(rows[0]!.durationMs).toBe(200_000);
  });

  it("gives equal time and guesses the same place", () => {
    const rows = standings([result(1, "won", 4, 100), result(2, "won", 4, 100), result(3, "won", 4, 120)], []);
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3]);
  });
});
