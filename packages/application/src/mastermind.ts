import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  MASTERMIND_GAMES_MAX, mastermindOpenStationsRequestSchema, mastermindStandingsSchema, mastermindStateSchema, mastermindStationRequestSchema,
  mastermindStationResponseSchema, mastermindSyncResponseSchema, type MastermindStandings, type MastermindStationResponse, type MastermindSyncResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { normalizeSelfRegistrationName, selfRegistrationDay } from "@o-tid/domain";
import {
  DEFAULT_SETTINGS, gameStatus, MASTERMIND_NAME_MAX, mergeMastermindState, normalizeGame, readSettings, standings, teamName,
  type CardGame, type MastermindNames, type MastermindState
} from "@o-tid/domain/mastermind";
import { consumeAccountRequestAllowance } from "./account-throttle";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { UUID_PATTERN as uuid } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * Mastermind med kontroller på servern (ADR-0228). Datorn vid stationen spelar och sparar i webbläsaren och skickar hela sitt
 * läge för träningen; servern slår ihop det med det den har (`mergeMastermindState`: spelen per id, gissningarna som union,
 * svaren omräknade ur mönstret) och svarar med resultatet, så att flera datorer ser varandras spel. Arrangören och
 * funktionären skriver och läser allt. Med "Spela på egen dator" påslaget (administratören) får också en dator utan
 * inloggning spela träningsdagen: med träningens inställningar, och den ändrar bara sina egna spel. Den publika ställningen
 * visar bara namn, brickans sista siffror, status, gissningar och tid.
 */

/** Sändningar från datorer utan inloggning per IP-adress (hashad) och tio minuter; skolor och klubbar delar adresser. */
export const MASTERMIND_POSTS_PER_IP = 3000;
const MASTERMIND_IP_WINDOW_MS = 10 * 60 * 1000;
/** Nya spel från datorer utan inloggning per träning och dygn. */
export const MASTERMIND_STATION_GAMES_PER_DAY = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
export type MastermindResult = Failure | { status: "ok"; response: MastermindSyncResponse };
export type MastermindStationResult =
  | { status: "not-found" | "closed" | "rate-limited" | "invalid-request" }
  | { status: "ok"; response: MastermindStationResponse };

type GameRow = typeof schema.mastermindGames.$inferSelect;

const toGame = (row: GameRow): CardGame | undefined => normalizeGame({
  id: row.id, cardNumber: row.cardNumber, secret: row.secret, settings: row.settings, guesses: row.guesses, startedAt: row.startedAt.toISOString(),
  ...(row.marker ? { marker: row.marker } : {}), ...(row.abandonedAt ? { abandonedAt: row.abandonedAt.toISOString() } : {})
});

/** Träningens läge, vilken dator (utan inloggning) varje spel kom från och om "Spela på egen dator" är på. */
interface Loaded { state: MastermindState; stations: Map<string, string | null>; openStations: boolean }

async function load(tx: DbExecutor, raceId: string): Promise<Loaded> {
  const [race] = await tx.select().from(schema.mastermindRaces).where(eq(schema.mastermindRaces.raceId, raceId));
  const rows = await tx.select().from(schema.mastermindGames).where(eq(schema.mastermindGames.raceId, raceId))
    .orderBy(asc(schema.mastermindGames.startedAt), asc(schema.mastermindGames.id));
  return {
    state: {
      settings: readSettings(race?.settings) ?? DEFAULT_SETTINGS,
      ...(race?.settingsAt ? { settingsAt: race.settingsAt.toISOString() } : {}),
      games: rows.flatMap(row => toGame(row) ?? []),
      names: race?.names ?? {}
    },
    stations: new Map(rows.map(row => [row.id, row.stationKeyHash])),
    openStations: race?.openStationsAt != null
  };
}

const staffResponse = (raceId: string, loaded: Pick<Loaded, "state" | "openStations">, canOpen: boolean): MastermindSyncResponse =>
  mastermindSyncResponseSchema.parse({ formatVersion: 1, raceId, settings: loaded.state.settings,
    ...(loaded.state.settingsAt ? { settingsAt: loaded.state.settingsAt } : {}), games: loaded.state.games, names: loaded.state.names,
    openStations: loaded.openStations, canOpen });

interface RaceFacts { raceType: string; raceDate: string; timeZone: string; eventName: string; raceName: string; shortCode: string; published: boolean }

async function raceFacts(tx: DbExecutor, raceId: string): Promise<RaceFacts | undefined> {
  const [race] = await tx.select({ raceType: schema.races.raceType, raceDate: schema.races.raceDate, timeZone: schema.events.timeZone,
    eventName: schema.events.name, raceName: schema.races.name, shortCode: schema.races.shortCode, publishedAt: schema.races.publishedAt,
    hidden: schema.races.hiddenBySuperadmin })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  const { publishedAt, hidden, ...facts } = race;
  return { ...facts, published: publishedAt !== null && !hidden };
}

/** Träningsdagen i tävlingens tidszon (arrangören och funktionären alla dagar). */
const openToday = (race: RaceFacts, staff: boolean, now: Date) =>
  staff || selfRegistrationDay({ raceDate: race.raceDate, timeZone: race.timeZone, party: false, now });

/** Mastermind hör till träningar (som raden i arrangemanget). */
async function isTraining(tx: DbExecutor, raceId: string): Promise<boolean> {
  return (await raceFacts(tx, raceId))?.raceType === "TRAINING";
}

/** Raden för träningen finns och är låst, så att två sändningar slås ihop en i taget. */
async function lockRace(tx: DbExecutor, raceId: string, now: Date): Promise<void> {
  await tx.insert(schema.mastermindRaces).values({ raceId, settings: { ...DEFAULT_SETTINGS, codes: [...DEFAULT_SETTINGS.codes] }, names: {}, updatedAt: now })
    .onConflictDoNothing();
  await tx.select({ raceId: schema.mastermindRaces.raceId }).from(schema.mastermindRaces).where(eq(schema.mastermindRaces.raceId, raceId)).for("update");
}

/** Lagens namn som de sparas (samma rensning som självregistreringens namn); ett tomt namn står kvar som borttaget. */
function cleanNames(names: MastermindNames): Record<string, { name: string; at: string }> {
  return Object.fromEntries(Object.entries(names).map(([card, entry]) =>
    [card, { name: normalizeSelfRegistrationName(entry.name, MASTERMIND_NAME_MAX) ?? "", at: entry.at }]));
}

const rowStatus = (game: CardGame) => game.abandonedAt ? "abandoned" as const : gameStatus(game);
/** Det som sparas i en spelrad; lika betyder att raden inte behöver skrivas. */
const stored = (game: CardGame) => JSON.stringify([game.guesses, game.marker ?? null, game.abandonedAt ?? null]);

/**
 * Skriver det sammanslagna läget: raden för träningen och de spel som är nya eller har ändrats (bara `only` om den är
 * given). Nya spel får `stationKeyHash` (null = arrangörens eller funktionärens dator).
 */
async function write(tx: DbExecutor, raceId: string, before: Loaded, merged: MastermindState, now: Date,
  options: { stationKeyHash: string | null; only?: ReadonlySet<string> }): Promise<void> {
  await tx.update(schema.mastermindRaces).set({ settings: { ...merged.settings, codes: [...merged.settings.codes] },
    settingsAt: merged.settingsAt ? new Date(merged.settingsAt) : null, names: { ...merged.names }, updatedAt: now })
    .where(eq(schema.mastermindRaces.raceId, raceId));
  const known = new Map(before.state.games.map(game => [game.id, game]));
  for (const game of merged.games) {
    if (options.only && !options.only.has(game.id)) continue;
    const previous = known.get(game.id);
    if (previous && stored(previous) === stored(game)) continue;
    const values = { cardNumber: game.cardNumber, status: rowStatus(game), secret: [...game.secret],
      settings: { ...game.settings, codes: [...game.settings.codes] }, guesses: game.guesses.map(guess => ({ ...guess, colors: [...guess.colors] })),
      marker: game.marker ? { count: game.marker.count, code: game.marker.code, ...(game.marker.time !== undefined ? { time: game.marker.time } : {}),
        ...(game.marker.at ? { at: game.marker.at } : {}) } : null,
      startedAt: new Date(game.startedAt), finishedAt: game.finishedAt ? new Date(game.finishedAt) : null,
      abandonedAt: game.abandonedAt ? new Date(game.abandonedAt) : null, updatedAt: now };
    if (previous) await tx.update(schema.mastermindGames).set(values).where(and(eq(schema.mastermindGames.raceId, raceId), eq(schema.mastermindGames.id, game.id)));
    else await tx.insert(schema.mastermindGames).values({ raceId, id: game.id, stationKeyHash: options.stationKeyHash, createdAt: now, ...values });
  }
}

/** Serverns läge för träningen. Arrangören och funktionären. */
export async function readMastermindAsStaff(db: Database, input: RaceSessionProof, now = new Date()): Promise<MastermindResult> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    if (!await isTraining(tx, auth.principal.raceId)) return { status: "not-found" as const };
    return { status: "ok" as const, response: staffResponse(auth.principal.raceId, await load(tx, auth.principal.raceId), auth.principal.role === "ADMIN") };
  }, { isolationLevel: "repeatable read" });
}

/**
 * Datorns läge in, serverns sammanslagna läge ut. Spel som inte går att kontrollera hoppas över (datorn har samma kontroll,
 * så det händer bara med en trasig klient). Arrangören och funktionären.
 */
export async function syncMastermindAsStaff(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date()): Promise<MastermindResult> {
  const parsed = mastermindStateSchema.safeParse(input.request);
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    // Inloggningen och behörigheten prövas före kroppen (städrundan 2026-11-07): utloggad får 401, inte 400.
    if (!parsed.success) return { status: "invalid-request" as const };
    const settings = readSettings(parsed.data.settings);
    if (!settings) return { status: "invalid-request" as const };
    const incoming: MastermindState = { settings, ...(parsed.data.settingsAt ? { settingsAt: parsed.data.settingsAt } : {}),
      games: parsed.data.games.flatMap(game => normalizeGame(game) ?? []), names: cleanNames(parsed.data.names) };
    const raceId = auth.principal.raceId;
    if (!await isTraining(tx, raceId)) return { status: "not-found" as const };
    await lockRace(tx, raceId, now);
    const before = await load(tx, raceId);
    const merged = mergeMastermindState(before.state, incoming);
    if (merged.games.length > MASTERMIND_GAMES_MAX) return { status: "invalid-request" as const };
    await write(tx, raceId, before, merged, now, { stationKeyHash: null });
    return { status: "ok" as const, response: staffResponse(raceId, { state: merged, openStations: before.openStations }, auth.principal.role === "ADMIN") };
  });
}

/** Slår på eller av "Spela på egen dator" (knappen på tävlingssidan). Bara administratören; auditpost. Spelen står kvar. */
export async function setMastermindStationsAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date()): Promise<MastermindResult> {
  const parsed = mastermindOpenStationsRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    // Demoläget: gästen öppnar inget för okända besökare.
    if (auth.principal.guest) return { status: "forbidden" as const };
    const raceId = auth.principal.raceId;
    if (!await isTraining(tx, raceId)) return { status: "not-found" as const };
    await lockRace(tx, raceId, now);
    await tx.update(schema.mastermindRaces).set(parsed.data.open ? { openStationsAt: now, openStationsBy: auth.principal.accountId, updatedAt: now }
      : { openStationsAt: null, openStationsBy: null, updatedAt: now }).where(eq(schema.mastermindRaces.raceId, raceId));
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "mastermind", entityId: raceId, actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId,
      action: parsed.data.open ? "MASTERMIND_STATIONS_OPENED" : "MASTERMIND_STATIONS_CLOSED", before: null, after: { open: parsed.data.open }, createdAt: now });
    return { status: "ok" as const, response: staffResponse(raceId, await load(tx, raceId), true) };
  });
}

const sameSettings = (a: CardGame["settings"], b: CardGame["settings"]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * En dator utan inloggning ("Spela på egen dator", ADR-0228). Kräver en publicerad träning (eller att den som skickar är
 * arrangör eller funktionär), att administratören har slagit på det och träningsdagen. Datorn ändrar bara sina egna spel
 * (nyckelns hash), nya spel måste ha träningens inställningar och namn sätts bara på datorns egna brickor. Svaret har bara
 * datorns egna spel och namn, aldrig andras mönster. Varje sändning räknas mot spärren per IP och varje nytt spel mot
 * spärren per träning.
 */
export async function receiveMastermindStation(db: Database, input: { raceId: string; clientKey: string; request: unknown; staff: boolean },
  now = new Date()): Promise<MastermindStationResult> {
  if (!uuid.test(input.raceId)) return { status: "not-found" };
  const parsed = mastermindStationRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const hash = createHash("sha256").update(request.stationKey).digest("hex");
  return db.transaction(async tx => {
    const race = await raceFacts(tx, input.raceId);
    if (!race || race.raceType !== "TRAINING" || (!race.published && !input.staff)) return { status: "not-found" as const };
    const [open] = await tx.select({ at: schema.mastermindRaces.openStationsAt }).from(schema.mastermindRaces)
      .where(eq(schema.mastermindRaces.raceId, input.raceId));
    if (!open?.at || !openToday(race, input.staff, now)) return { status: "closed" as const };
    if (!await consumeAccountRequestAllowance(tx, { scope: "MASTERMIND_IP", key: input.clientKey, limit: MASTERMIND_POSTS_PER_IP,
      windowMs: MASTERMIND_IP_WINDOW_MS }, now)) return { status: "rate-limited" as const };
    await lockRace(tx, input.raceId, now);
    const before = await load(tx, input.raceId);
    const accepted = new Set<string>();
    const respond = (state: MastermindState) => {
      const own = state.games.filter(game => before.stations.get(game.id) === hash || accepted.has(game.id));
      const cards = new Set(own.map(game => String(game.cardNumber)));
      return { status: "ok" as const, response: mastermindStationResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
        eventName: race.eventName, raceName: race.raceName, shortCode: race.shortCode, settings: state.settings, games: own,
        names: Object.fromEntries(Object.entries(state.names).filter(([card]) => cards.has(card))) }) };
    };
    // Fälla mot robotar: ett ifyllt dolt fält ger ett svar, men inget sparas.
    if (request.website?.trim()) return respond(before.state);
    const games: CardGame[] = [];
    for (const raw of request.games) {
      const game = normalizeGame(raw);
      if (!game) continue;
      const owner = before.stations.get(game.id);
      if (owner === undefined) {
        if (!sameSettings(game.settings, before.state.settings)) continue;
        if (!await consumeAccountRequestAllowance(tx, { scope: "MASTERMIND_RACE", key: input.raceId, limit: MASTERMIND_STATION_GAMES_PER_DAY,
          windowMs: DAY_MS }, now)) return { status: "rate-limited" as const };
      } else if (owner !== hash) continue;
      accepted.add(game.id);
      games.push(game);
    }
    const cards = new Set([...games.map(game => String(game.cardNumber)),
      ...before.state.games.filter(game => before.stations.get(game.id) === hash).map(game => String(game.cardNumber))]);
    const names = cleanNames(Object.fromEntries(Object.entries(request.names).filter(([card]) => cards.has(card))));
    const merged = mergeMastermindState(before.state, { settings: before.state.settings, games, names });
    if (merged.games.length > MASTERMIND_GAMES_MAX) return { status: "invalid-request" as const };
    await write(tx, input.raceId, before, merged, now, { stationKeyHash: hash, only: accepted });
    return respond(merged);
  });
}

/**
 * Den publika delen på tävlingssidan: bara en träning, bara träningsdagen i tävlingens tidszon (arrangören och funktionären
 * alla dagar), och bara när något spel finns eller "Spela på egen dator" är på. Anroparen har redan släppt igenom tävlingen
 * (`publicRaceAccess`). Undefined = inget att visa.
 */
export async function readMastermindStandings(db: Database, input: { raceId: string; staff: boolean }, now = new Date()): Promise<MastermindStandings | undefined> {
  if (!uuid.test(input.raceId)) return undefined;
  return db.transaction(async tx => {
    const race = await raceFacts(tx, input.raceId);
    if (!race || race.raceType !== "TRAINING" || !openToday(race, input.staff, now)) return undefined;
    const loaded = await load(tx, input.raceId);
    if (loaded.state.games.length === 0 && !loaded.openStations) return undefined;
    const byId = new Map(loaded.state.games.map(game => [game.id, game]));
    return mastermindStandingsSchema.parse({ formatVersion: 1, openStations: loaded.openStations, rows: standings(loaded.state.games).map(row => {
      const name = teamName(loaded.state.names, row.cardNumber);
      return { ...(name ? { name } : {}), cardEnd: String(row.cardNumber).slice(-3), status: row.status, guesses: row.guesses,
        ...(row.place !== undefined ? { place: row.place } : {}), ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
        ...(row.status === "playing" ? { startedAt: byId.get(row.gameId)?.startedAt } : {}) };
    }) });
  }, { isolationLevel: "repeatable read" });
}
