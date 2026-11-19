/**
 * Mastermind med kontroller (ADR-0228): varje färg är en kontrollkod. Brickans första utläsning startar spelet (klockan på 0,
 * stämplingarna på brickan räknas inte). En gissning är färgkontrollerna som brickan har stämplat, i ordning, sedan den
 * lästes ut senast. Klockan stannar när den vinnande gissningen läses ut; start och mål är datorns tid. Varje bricka har sitt
 * eget hemliga mönster, så flera kan spela samtidigt.
 *
 * Ren TypeScript utan I/O, samma regler i webbläsaren och på servern: datorn spelar och sparar i webbläsaren, servern tar emot
 * spelen, slår ihop dem (`mergeMastermindState`) och räknar om gissningarnas svar ur mönstret (`normalizeGame`).
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
export const MAX_GUESSES = 20;
/** Lagets namn (det enda som skrivs in om laget). */
export const MASTERMIND_NAME_MAX = 40;

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

/**
 * Den senaste stämplingen som har lästs ut, så att nästa gissning bara tar stämplingarna efter den. `at`: utläsningen (datorns
 * tid), så att den senaste markören vinner när två datorer har samma spel.
 */
export interface PunchMarker { readonly count: number; readonly code: number; readonly time: string | undefined; readonly at?: string }

export interface CardGame {
  /** Spelets id (slumpat av datorn), samma i webbläsaren och på servern. */
  readonly id: string;
  readonly cardNumber: number;
  readonly secret: Code;
  readonly guesses: readonly Guess[];
  /** När spelet startade (brickans första utläsning, datorns tid). Klockan räknar från den. */
  readonly startedAt: string;
  readonly settings: GameSettings;
  readonly marker?: PunchMarker;
  /** När den avgörande gissningen lästes ut (datorns tid). Stoppar klockan. Följer alltid av gissningarna. */
  readonly finishedAt?: string;
  /** Spelet avbröts (Nytt spel) innan det var avgjort. Det räknas inte i statistiken. */
  readonly abandonedAt?: string;
}

export type GameStatus = "playing" | "won" | "lost";

/** En stämpling som avläsningen ger den: koden och tiden som jämförbar text (för markören). SI5:s sista stämplingar saknar tid. */
export interface CardPunch { readonly code: number; readonly time?: string }

/** Slump och id för nya spel (tester ger egna). */
export interface NewGameOptions {
  readonly random?: () => number;
  readonly id?: () => string;
}

const newId = () => globalThis.crypto.randomUUID();
const instant = (text: string | undefined) => text === undefined ? Number.NaN : Date.parse(text);
const validInstant = (text: unknown): text is string => typeof text === "string" && Number.isFinite(Date.parse(text));

export function settingsProblems(settings: GameSettings): string[] {
  const problems: string[] = [];
  const { codes, positions, maxGuesses, allowRepeats } = settings;
  if (codes.length < MIN_COLORS || codes.length > MAX_COLORS) problems.push("colors");
  if (codes.some((code) => !Number.isInteger(code) || code < 1 || code > 999)) problems.push("code-range");
  if (new Set(codes).size !== codes.length) problems.push("code-duplicate");
  if (!Number.isInteger(positions) || positions < MIN_POSITIONS || positions > MAX_POSITIONS) problems.push("positions");
  if (!allowRepeats && positions > codes.length) problems.push("too-few-colors");
  if (!Number.isInteger(maxGuesses) || maxGuesses < 1 || maxGuesses > MAX_GUESSES) problems.push("guesses");
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

export function newGame(cardNumber: number, settings: GameSettings, now: Date, options: NewGameOptions = {}, marker?: PunchMarker): CardGame {
  return { id: (options.id ?? newId)(), cardNumber, secret: randomSecret(settings, options.random), guesses: [], startedAt: now.toISOString(), settings,
    ...(marker ? { marker } : {}) };
}

export function gameStatus(game: Pick<CardGame, "guesses" | "settings">): GameStatus {
  const last = game.guesses.at(-1);
  if (last && last.score.exact === game.settings.positions) return "won";
  if (game.guesses.length >= game.settings.maxGuesses) return "lost";
  return "playing";
}

/** Spelet pågår: inte avgjort och inte avbrutet. */
export const isPlaying = (game: CardGame) => !game.abandonedAt && gameStatus(game) === "playing";

/** Stämplingarna efter den förra utläsningen. Är brickan tömd sedan dess (markören finns inte kvar) gäller alla. */
export function punchesSince(punches: readonly CardPunch[], marker: PunchMarker | undefined): readonly CardPunch[] {
  if (!marker || marker.count === 0) return punches;
  const last = punches[marker.count - 1];
  if (last && last.code === marker.code && last.time === marker.time) return punches.slice(marker.count);
  return punches;
}

export function markerFor(punches: readonly CardPunch[], now?: Date): PunchMarker | undefined {
  const last = punches.at(-1);
  return last ? { count: punches.length, code: last.code, time: last.time, ...(now ? { at: now.toISOString() } : {}) } : undefined;
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

/**
 * Brickans spel just nu: det senast startade som inte är avbrutet (också ett avgjort, så att nästa utläsning vet att ett nytt
 * spel ska starta). Avgjorda spel ligger kvar i listan för statistiken.
 */
export function currentGame(games: readonly CardGame[], cardNumber: number): CardGame | undefined {
  let current: CardGame | undefined;
  for (const game of games) {
    if (game.cardNumber !== cardNumber || game.abandonedAt) continue;
    if (!current || instant(game.startedAt) > instant(current.startedAt)) current = game;
  }
  return current;
}

/** `started`: utläsningen startade ett spel (`afterGame`: brickans förra spel var slut). */
export type ReadoutOutcome =
  | { readonly kind: "started"; readonly game: CardGame; readonly afterGame: boolean }
  | { readonly kind: "guessed"; readonly game: CardGame; readonly guess: Guess; readonly status: GameStatus }
  | { readonly kind: "rejected"; readonly game: CardGame; readonly reading: Exclude<GuessReading, { kind: "guess" }> };

/**
 * En utläst bricka (`existing`: brickans spel just nu, `currentGame`). Har brickan inget spel, eller är det slut, startar
 * utläsningen ett nytt med de aktuella inställningarna: klockan står på 0 och stämplingarna på brickan räknas inte. Annars är
 * de nya stämplingarna en gissning; en giltig räknas, en ogiltig kostar ingen gissning. Markören flyttas alltid fram, så att
 * samma stämplingar inte räknas igen.
 */
export function applyReadout(existing: CardGame | undefined, cardNumber: number, punches: readonly CardPunch[], settings: GameSettings,
  now: Date, options: NewGameOptions = {}): ReadoutOutcome {
  const marker = markerFor(punches, now);
  if (!existing || !isPlaying(existing)) {
    return { kind: "started", game: newGame(cardNumber, settings, now, options, marker), afterGame: existing !== undefined };
  }
  const reading = readGuess(punchesSince(punches, existing.marker), existing.settings);
  const moved: CardGame = { ...existing, ...(marker ? { marker } : {}) };
  if (reading.kind !== "guess") return { kind: "rejected", game: moved, reading };
  const guess: Guess = { colors: reading.colors, score: scoreGuess(existing.secret, reading.colors), at: now.toISOString() };
  const guessed: CardGame = { ...moved, guesses: [...moved.guesses, guess] };
  const status = gameStatus(guessed);
  // Klockan stannar när den avgörande gissningen läses ut.
  const game: CardGame = status === "playing" ? guessed : { ...guessed, finishedAt: now.toISOString() };
  return { kind: "guessed", game, guess, status };
}

/**
 * Börjar om med ett nytt mönster nu (klockan på 0) men behåller markören (de redan utlästa stämplingarna räknas inte). Ett
 * spel som pågick markeras som avbrutet; ett avgjort står kvar som det är (det finns redan i statistiken).
 */
export function restart(game: CardGame, settings: GameSettings, now: Date, options: NewGameOptions = {}): { previous: CardGame; next: CardGame } {
  const previous = gameStatus(game) === "playing" && !game.abandonedAt ? { ...game, abandonedAt: now.toISOString() } : game;
  return { previous, next: newGame(game.cardNumber, settings, now, options, game.marker) };
}

/**
 * Avbryter ett pågående spel (arrangören, från spelsidan): det räknas inte i statistiken, och brickans nästa utläsning startar
 * ett nytt spel. Ett avgjort eller redan avbrutet spel står kvar som det är.
 */
export function abandonGame(game: CardGame, now: Date): CardGame {
  return isPlaying(game) ? { ...game, abandonedAt: now.toISOString() } : game;
}

/** Speltiden i ms, från starten till utläsningen av den avgörande gissningen. Saknas för spel som pågår. */
export function gameDuration(game: { readonly startedAt: string; readonly finishedAt?: string | undefined }): number | undefined {
  if (!game.finishedAt) return undefined;
  const ms = Date.parse(game.finishedAt) - Date.parse(game.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** 4:07 eller 1:04:07. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** En rad i statistiken: ett avslutat spel eller ett som pågår. */
export interface StandingRow {
  readonly gameId: string;
  readonly cardNumber: number;
  readonly status: GameStatus;
  readonly guesses: number;
  /** När spelet startade (den löpande tiden räknar från det för spel som pågår). */
  readonly startedAt: string;
  /** Speltiden för avslutade spel. */
  readonly durationMs?: number;
  /** Plats bland lösta spel: snabbast först, vid lika tid färre gissningar. */
  readonly place?: number;
}

/**
 * Lösta spel först (snabbast överst, lösta utan tid sist bland dem), sedan pågående spel och sist de som tog slut på
 * gissningar. Samma lag kan stå flera gånger, en gång per spel. Avbrutna spel räknas inte, och bara brickans senaste spel kan
 * pågå.
 */
export function standings(games: readonly CardGame[]): StandingRow[] {
  const row = (game: CardGame): StandingRow => {
    const durationMs = gameDuration(game);
    return { gameId: game.id, cardNumber: game.cardNumber, status: gameStatus(game), guesses: game.guesses.length, startedAt: game.startedAt,
      ...(durationMs === undefined ? {} : { durationMs }) };
  };
  const decided = games.filter((game) => gameStatus(game) !== "playing").map(row);
  const won = decided.filter((r) => r.status === "won").sort((a, b) =>
    (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity) || a.guesses - b.guesses || a.startedAt.localeCompare(b.startedAt));
  let place = 0;
  const ranked = won.map((r, index) => {
    const previous = won[index - 1];
    if (!previous || previous.durationMs !== r.durationMs || previous.guesses !== r.guesses) place = index + 1;
    return { ...r, place };
  });
  const playing = games.filter((game) => isPlaying(game) && currentGame(games, game.cardNumber) === game).map(row)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const lost = decided.filter((r) => r.status === "lost").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return [...ranked, ...playing, ...lost];
}

/* ---------- Kontroll och sammanslagning (webbläsaren och servern) ---------- */

const isColorList = (value: unknown, settings: GameSettings): value is number[] => Array.isArray(value) && value.length === settings.positions
  && value.every((color) => Number.isInteger(color) && color >= 0 && color < settings.codes.length)
  && (settings.allowRepeats || new Set(value).size === value.length);

/** Inställningar ur okänd data; undefined om de inte går att spela med. */
export function readSettings(value: unknown): GameSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.codes) || !v.codes.every((code) => typeof code === "number") || typeof v.positions !== "number"
    || typeof v.maxGuesses !== "number" || typeof v.allowRepeats !== "boolean") return undefined;
  const settings: GameSettings = { codes: [...v.codes], positions: v.positions, maxGuesses: v.maxGuesses, allowRepeats: v.allowRepeats };
  return settingsProblems(settings).length === 0 ? settings : undefined;
}

function readMarker(value: unknown): PunchMarker | undefined {
  if (!value || typeof value !== "object") return undefined;
  const m = value as Record<string, unknown>;
  if (!Number.isInteger(m.count) || (m.count as number) < 0 || !Number.isInteger(m.code)) return undefined;
  if (m.time !== undefined && typeof m.time !== "string") return undefined;
  return { count: m.count as number, code: m.code as number, time: m.time, ...(validInstant(m.at) ? { at: m.at } : {}) };
}

/**
 * Ett spel ur okänd data (webbläsarens lagring eller en förfrågan), kontrollerat: mönstret och gissningarna passar
 * inställningarna, gissningarnas svar räknas om ur mönstret, gissningar efter den avgörande tas bort och `finishedAt` är den
 * avgörande gissningens tid. Undefined om spelet inte går att använda. Utan id får spelet `fallbackId` (äldre lagring).
 */
export function normalizeGame(value: unknown, fallbackId?: () => string): CardGame | undefined {
  if (!value || typeof value !== "object") return undefined;
  const g = value as Record<string, unknown>;
  const settings = readSettings(g.settings);
  const id = typeof g.id === "string" && g.id.length > 0 ? g.id : fallbackId?.();
  if (!settings || !id || !Number.isInteger(g.cardNumber) || (g.cardNumber as number) < 1 || !validInstant(g.startedAt)
    || !isColorList(g.secret, settings) || !Array.isArray(g.guesses)) return undefined;
  const secret = [...g.secret];
  const guesses: Guess[] = [];
  // Samma tid och färger är samma gissning (två kopior av spelet, eller samma sändning två gånger).
  const unique = new Map<string, { colors: number[]; at: string }>();
  for (const guess of g.guesses) {
    if (!guess || typeof guess !== "object") continue;
    const { colors, at } = guess as Record<string, unknown>;
    if (isColorList(colors, settings) && validInstant(at)) unique.set(`${at}|${colors.join(",")}`, { colors, at });
  }
  for (const guess of [...unique.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (gameStatus({ guesses, settings }) !== "playing") break;
    guesses.push({ colors: [...guess.colors], score: scoreGuess(secret, guess.colors), at: guess.at });
  }
  const decided = gameStatus({ guesses, settings }) !== "playing";
  const marker = readMarker(g.marker);
  return { id, cardNumber: g.cardNumber as number, secret, guesses, startedAt: g.startedAt, settings,
    ...(marker ? { marker } : {}),
    ...(decided ? { finishedAt: guesses.at(-1)!.at } : {}),
    ...(!decided && validInstant(g.abandonedAt) ? { abandonedAt: g.abandonedAt } : {}) };
}

/**
 * Två versioner av samma spel (samma id, t.ex. från två datorer eller före och efter en utläsning utan nät). Det som inte
 * ändras under spelet (bricka, mönster, inställningar, start) tas från `first` (serverns). Gissningarna är unionen (samma
 * tid och färger är samma gissning), den senaste markören gäller och avbrutet gäller från den tidigaste tidpunkten.
 */
export function mergeGame(first: CardGame, second: CardGame): CardGame {
  const markerAt = (game: CardGame) => instant(game.marker?.at);
  const secondNewer = markerAt(second) > markerAt(first) || (Number.isNaN(markerAt(first)) && !Number.isNaN(markerAt(second)));
  const marker = !second.marker ? first.marker : !first.marker || secondNewer ? second.marker : first.marker;
  const abandoned = [first.abandonedAt, second.abandonedAt].filter((at): at is string => at !== undefined)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  // `first` är redan kontrollerat, så sammanslagningen går alltid att kontrollera; annars står `first` kvar.
  return normalizeGame({ ...first, guesses: [...first.guesses, ...second.guesses], marker, abandonedAt: abandoned }) ?? first;
}

/** Lagets namn per bricknummer, med när det ändrades (det senaste gäller). Ett tomt namn tar bort det. */
export type MastermindNames = Readonly<Record<string, { readonly name: string; readonly at: string }>>;

/** Allt om spelet för en träning: inställningarna (det senaste gäller), alla spel och lagens namn. */
export interface MastermindState {
  readonly settings: GameSettings;
  /** När inställningarna ändrades; saknas = förvalen, som alla senare ändringar vinner över. */
  readonly settingsAt?: string;
  readonly games: readonly CardGame[];
  readonly names: MastermindNames;
}

/** `b` är senare än `a` (en tid som saknas är tidigast). */
const later = (a: string | undefined, b: string | undefined) => b !== undefined && (a === undefined || Date.parse(b) > Date.parse(a));

/** `first` och `second` ihop: spelen per id (`mergeGame`, `first` först), de senaste inställningarna och det senaste namnet per bricka. */
export function mergeMastermindState(first: MastermindState, second: MastermindState): MastermindState {
  const games = new Map<string, CardGame>();
  for (const game of first.games) games.set(game.id, game);
  for (const game of second.games) {
    const known = games.get(game.id);
    games.set(game.id, known ? mergeGame(known, game) : game);
  }
  const names: Record<string, { name: string; at: string }> = { ...first.names };
  for (const [card, entry] of Object.entries(second.names)) if (later(names[card]?.at, entry.at)) names[card] = entry;
  const settings = later(first.settingsAt, second.settingsAt) ? { settings: second.settings, settingsAt: second.settingsAt! }
    : { settings: first.settings, ...(first.settingsAt ? { settingsAt: first.settingsAt } : {}) };
  return { ...settings, games: [...games.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.id.localeCompare(b.id)), names };
}

/** Lagets namn för bricknumret (tomt = inget namn). */
export const teamName = (names: MastermindNames, cardNumber: number) => names[String(cardNumber)]?.name.trim() || undefined;
