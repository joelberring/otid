/**
 * Mastermind med kontroller: varje färg är en kontrollkod. En gissning är färgkontrollerna som brickan har stämplat,
 * i ordning, sedan den lästes ut senast. Varje bricka har sitt eget hemliga mönster, så flera kan spela samtidigt.
 * Ren TypeScript utan I/O; sidan (`app.tsx`) läser stationen och sparar i webbläsaren.
 */

export const PALETTE = [
  { id: "red", hex: "#d62828", sv: "röd", en: "red" },
  { id: "blue", hex: "#1d5fd1", sv: "blå", en: "blue" },
  { id: "green", hex: "#2a9d3c", sv: "grön", en: "green" },
  { id: "yellow", hex: "#f2c300", sv: "gul", en: "yellow" },
  { id: "orange", hex: "#f07f13", sv: "orange", en: "orange" },
  { id: "purple", hex: "#8e2a80", sv: "lila", en: "purple" },
  { id: "white", hex: "#f4f4f4", sv: "vit", en: "white" },
  { id: "black", hex: "#222222", sv: "svart", en: "black" }
] as const;

export const MIN_COLORS = 4;
export const MAX_COLORS = PALETTE.length;
export const MIN_POSITIONS = 3;
export const MAX_POSITIONS = 6;

export interface GameSettings {
  /** Kontrollkoden för varje färg, i palettens ordning. Antalet koder är antalet färger. */
  readonly codes: readonly number[];
  readonly positions: number;
  readonly maxGuesses: number;
  /** Samma färg får finnas flera gånger i mönstret. */
  readonly allowRepeats: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = { codes: [31, 32, 33, 34, 35, 36], positions: 4, maxGuesses: 10, allowRepeats: false };

/** Färgernas index (0 = första färgen i paletten). */
export type Code = readonly number[];

export interface Score { readonly exact: number; readonly colorOnly: number }

export interface Guess { readonly colors: Code; readonly score: Score; readonly at: string }

/** Den senaste stämplingen som har lästs ut, så att nästa gissning bara tar stämplingarna efter den. */
export interface PunchMarker { readonly count: number; readonly code: number; readonly time: string | undefined }

export interface CardGame {
  readonly cardNumber: number;
  readonly secret: Code;
  readonly guesses: readonly Guess[];
  readonly startedAt: string;
  readonly settings: GameSettings;
  readonly marker?: PunchMarker;
  /** Spelets första stämpling (vilken kontroll som helst), med brickans tid. Startar klockan. */
  readonly firstPunchAt?: string;
  /** Sista stämplingen i den avgörande gissningen. Stoppar klockan. */
  readonly finishedAt?: string;
}

export type GameStatus = "playing" | "won" | "lost";

/**
 * En stämpling som avläsningen ger den: koden, tiden som jämförbar text (för markören) och tiden som absolut tidpunkt
 * (ISO, för klockan). SI5:s sista stämplingar saknar tid.
 */
export interface CardPunch { readonly code: number; readonly time?: string; readonly at?: string }

export function settingsProblems(settings: GameSettings): string[] {
  const problems: string[] = [];
  const { codes, positions, maxGuesses, allowRepeats } = settings;
  if (codes.length < MIN_COLORS || codes.length > MAX_COLORS) problems.push("colors");
  if (codes.some((code) => !Number.isInteger(code) || code < 1 || code > 999)) problems.push("code-range");
  if (new Set(codes).size !== codes.length) problems.push("code-duplicate");
  if (!Number.isInteger(positions) || positions < MIN_POSITIONS || positions > MAX_POSITIONS) problems.push("positions");
  if (!allowRepeats && positions > codes.length) problems.push("too-few-colors");
  if (!Number.isInteger(maxGuesses) || maxGuesses < 1 || maxGuesses > 20) problems.push("guesses");
  return problems;
}

/** Svart = rätt färg på rätt plats; vit = rätt färg på fel plats. */
export function scoreGuess(secret: Code, guess: Code): Score {
  let exact = 0;
  const secretLeft = new Map<number, number>();
  const guessLeft = new Map<number, number>();
  secret.forEach((color, index) => {
    if (guess[index] === color) { exact += 1; return; }
    secretLeft.set(color, (secretLeft.get(color) ?? 0) + 1);
    const other = guess[index];
    if (other !== undefined) guessLeft.set(other, (guessLeft.get(other) ?? 0) + 1);
  });
  let colorOnly = 0;
  for (const [color, count] of guessLeft) colorOnly += Math.min(count, secretLeft.get(color) ?? 0);
  return { exact, colorOnly };
}

/** Ett slumpat mönster. `random` ger [0, 1) som Math.random. */
export function randomSecret(settings: GameSettings, random: () => number = Math.random): Code {
  const colors = settings.codes.length;
  if (settings.allowRepeats) return Array.from({ length: settings.positions }, () => Math.floor(random() * colors));
  const pool = Array.from({ length: colors }, (_, index) => index);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other]!, pool[index]!];
  }
  return pool.slice(0, settings.positions);
}

export function newGame(cardNumber: number, settings: GameSettings, now: Date, random?: () => number, marker?: PunchMarker): CardGame {
  return { cardNumber, secret: randomSecret(settings, random), guesses: [], startedAt: now.toISOString(), settings,
    ...(marker ? { marker } : {}) };
}

export function gameStatus(game: CardGame): GameStatus {
  const last = game.guesses.at(-1);
  if (last && last.score.exact === game.settings.positions) return "won";
  if (game.guesses.length >= game.settings.maxGuesses) return "lost";
  return "playing";
}

/** Stämplingarna efter den förra utläsningen. Är brickan tömd sedan dess (markören finns inte kvar) gäller alla. */
export function punchesSince(punches: readonly CardPunch[], marker: PunchMarker | undefined): readonly CardPunch[] {
  if (!marker || marker.count === 0) return punches;
  const last = punches[marker.count - 1];
  if (last && last.code === marker.code && last.time === marker.time) return punches.slice(marker.count);
  return punches;
}

export function markerFor(punches: readonly CardPunch[]): PunchMarker | undefined {
  const last = punches.at(-1);
  return last ? { count: punches.length, code: last.code, time: last.time } : undefined;
}

export type GuessReading =
  | { readonly kind: "guess"; readonly colors: Code }
  | { readonly kind: "empty" }
  | { readonly kind: "too-few"; readonly colors: Code }
  | { readonly kind: "repeated"; readonly colors: Code };

/**
 * Färgerna i nya stämplingar. Andra kontroller räknas inte. Utan upprepade färger räknas två stämplingar i rad på samma
 * kontroll som en (en dubbelstämpling); med upprepade färger räknas varje stämpling. Har laget stämplat fler färger än
 * mönstret har platser gäller bara de sista, i den ordning de stämplades.
 */
export function readGuess(punches: readonly CardPunch[], settings: GameSettings): GuessReading {
  const colors: number[] = [];
  for (const punch of punches) {
    const color = settings.codes.indexOf(punch.code);
    if (color < 0) continue;
    if (!settings.allowRepeats && colors.at(-1) === color) continue;
    colors.push(color);
  }
  if (colors.length === 0) return { kind: "empty" };
  if (colors.length < settings.positions) return { kind: "too-few", colors };
  const last = colors.slice(-settings.positions);
  if (!settings.allowRepeats && new Set(last).size !== last.length) return { kind: "repeated", colors: last };
  return { kind: "guess", colors: last };
}

export type ReadoutOutcome =
  | { readonly kind: "guessed"; readonly game: CardGame; readonly guess: Guess; readonly status: GameStatus; readonly newGame: boolean }
  | { readonly kind: "rejected"; readonly game: CardGame; readonly reading: Exclude<GuessReading, { kind: "guess" }>; readonly newGame: boolean };

/**
 * En utläst bricka. Har brickan inget spel, eller är det slut, börjar ett nytt med de aktuella inställningarna. En giltig
 * gissning räknas; en ogiltig kostar ingen gissning. Markören flyttas alltid fram, så att samma stämplingar inte räknas igen.
 */
export function applyReadout(existing: CardGame | undefined, cardNumber: number, punches: readonly CardPunch[], settings: GameSettings,
  now: Date, random?: () => number): ReadoutOutcome {
  const marker = markerFor(punches);
  // Ett avslutat spel ligger kvar (och visas) tills brickan har nya färgstämplingar; först då börjar nästa spel.
  if (existing && gameStatus(existing) !== "playing") {
    const next = readGuess(punchesSince(punches, existing.marker), settings);
    if (next.kind === "empty") return { kind: "rejected", game: { ...existing, ...(marker ? { marker } : {}) }, reading: next, newGame: false };
  }
  const fresh = !existing || gameStatus(existing) !== "playing";
  const base = fresh ? newGame(cardNumber, settings, now, random, existing?.marker) : existing;
  const newPunches = punchesSince(punches, base.marker);
  const reading = readGuess(newPunches, base.settings);
  // Klockan startar vid spelets första stämpling, vilken kontroll det än är (också i en gissning som inte räknades).
  const firstPunchAt = base.firstPunchAt ?? newPunches.find((p) => p.at)?.at;
  const moved: CardGame = { ...base, ...(marker ? { marker } : {}), ...(firstPunchAt ? { firstPunchAt } : {}) };
  if (reading.kind !== "guess") return { kind: "rejected", game: moved, reading, newGame: fresh };
  const guess: Guess = { colors: reading.colors, score: scoreGuess(base.secret, reading.colors), at: now.toISOString() };
  const guessed: CardGame = { ...moved, guesses: [...moved.guesses, guess] };
  const status = gameStatus(guessed);
  // Klockan stannar vid den sista stämplingen i den avgörande gissningen.
  const finishedAt = status === "playing" ? undefined : [...newPunches].reverse().find((p) => p.at)?.at;
  const game: CardGame = finishedAt ? { ...guessed, finishedAt } : guessed;
  return { kind: "guessed", game, guess, status, newGame: fresh };
}

/** Börjar om med ett nytt mönster men behåller markören (de redan utlästa stämplingarna räknas inte). */
export function restart(game: CardGame, settings: GameSettings, now: Date, random?: () => number): CardGame {
  return newGame(game.cardNumber, settings, now, random, game.marker);
}

/** Speltiden i ms, från första stämplingen till den sista i den avgörande gissningen. Saknas när en tid saknas. */
export function gameDuration(game: { readonly firstPunchAt?: string; readonly finishedAt?: string }): number | undefined {
  if (!game.firstPunchAt || !game.finishedAt) return undefined;
  const ms = Date.parse(game.finishedAt) - Date.parse(game.firstPunchAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** 4:07 eller 1:04:07. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Ett avslutat spel i statistiken. Ligger kvar när brickan börjar ett nytt spel. */
export interface GameResult {
  readonly cardNumber: number;
  readonly startedAt: string;
  readonly status: Exclude<GameStatus, "playing">;
  readonly guesses: number;
  readonly firstPunchAt?: string;
  readonly finishedAt?: string;
}

export function resultOf(game: CardGame): GameResult | undefined {
  const status = gameStatus(game);
  if (status === "playing") return undefined;
  return { cardNumber: game.cardNumber, startedAt: game.startedAt, status, guesses: game.guesses.length,
    ...(game.firstPunchAt ? { firstPunchAt: game.firstPunchAt } : {}), ...(game.finishedAt ? { finishedAt: game.finishedAt } : {}) };
}

/** En rad i statistiken: ett avslutat spel eller ett som pågår. */
export interface StandingRow {
  readonly cardNumber: number;
  readonly status: GameStatus;
  readonly guesses: number;
  readonly firstPunchAt?: string;
  /** Speltiden för avslutade spel. */
  readonly durationMs?: number;
  /** Plats bland lösta spel: snabbast först, vid lika tid färre gissningar. */
  readonly place?: number;
}

/**
 * Lösta spel först (snabbast överst, lösta utan tid sist bland dem), sedan pågående spel och sist de som tog slut på
 * gissningar. Samma lag kan stå flera gånger, en gång per spel.
 */
export function standings(results: readonly GameResult[], games: readonly CardGame[]): StandingRow[] {
  const finished: StandingRow[] = results.map((r) => {
    const durationMs = gameDuration(r);
    return { cardNumber: r.cardNumber, status: r.status, guesses: r.guesses, ...(r.firstPunchAt ? { firstPunchAt: r.firstPunchAt } : {}),
      ...(durationMs === undefined ? {} : { durationMs }) };
  });
  const won = finished.filter((r) => r.status === "won").sort((a, b) =>
    (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity) || a.guesses - b.guesses);
  let place = 0;
  const ranked = won.map((row, index) => {
    const previous = won[index - 1];
    if (!previous || previous.durationMs !== row.durationMs || previous.guesses !== row.guesses) place = index + 1;
    return { ...row, place };
  });
  const playing: StandingRow[] = games.filter((g) => gameStatus(g) === "playing")
    .map((g) => ({ cardNumber: g.cardNumber, status: "playing" as const, guesses: g.guesses.length,
      ...(g.firstPunchAt ? { firstPunchAt: g.firstPunchAt } : {}) }))
    .sort((a, b) => (a.firstPunchAt ?? "~").localeCompare(b.firstPunchAt ?? "~"));
  return [...ranked, ...playing, ...finished.filter((r) => r.status === "lost")];
}

export interface SavedState {
  readonly settings: GameSettings;
  readonly games: readonly CardGame[];
  /** Avslutade spel, äldst först. */
  readonly results: readonly GameResult[];
  /** Lagnamn per bricknummer. */
  readonly names: Readonly<Record<string, string>>;
}

const isNumberArray = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => typeof item === "number");

function validSettings(value: unknown): GameSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (!isNumberArray(v.codes) || typeof v.positions !== "number" || typeof v.maxGuesses !== "number" || typeof v.allowRepeats !== "boolean") {
    return undefined;
  }
  const settings: GameSettings = { codes: v.codes, positions: v.positions, maxGuesses: v.maxGuesses, allowRepeats: v.allowRepeats };
  return settingsProblems(settings).length === 0 ? settings : undefined;
}

/** Läser sparat läge; trasiga delar hoppas över i stället för att hela läget går förlorat. */
export function parseSavedState(text: string | null | undefined): SavedState {
  const fallback: SavedState = { settings: DEFAULT_SETTINGS, games: [], results: [], names: {} };
  if (!text) return fallback;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return fallback; }
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  const settings = validSettings(record.settings) ?? DEFAULT_SETTINGS;
  const games = Array.isArray(record.games) ? record.games.flatMap((item): CardGame[] => {
    if (!item || typeof item !== "object") return [];
    const g = item as Record<string, unknown>;
    const gameSettings = validSettings(g.settings);
    if (typeof g.cardNumber !== "number" || !isNumberArray(g.secret) || !Array.isArray(g.guesses) || typeof g.startedAt !== "string"
      || !gameSettings || g.secret.length !== gameSettings.positions) return [];
    return [item as CardGame];
  }) : [];
  const results = Array.isArray(record.results) ? record.results.filter((item): item is GameResult => {
    if (!item || typeof item !== "object") return false;
    const r = item as Record<string, unknown>;
    return typeof r.cardNumber === "number" && typeof r.startedAt === "string" && (r.status === "won" || r.status === "lost")
      && typeof r.guesses === "number";
  }) : [];
  const names: Record<string, string> = {};
  if (record.names && typeof record.names === "object") {
    for (const [card, name] of Object.entries(record.names as Record<string, unknown>)) if (typeof name === "string") names[card] = name;
  }
  return { settings, games, results, names };
}
