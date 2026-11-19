import { DEFAULT_SETTINGS, normalizeGame, readSettings, type CardGame, type MastermindState } from "@o-tid/domain/mastermind";

/**
 * Spelet i webbläsaren (ADR-0228): hela läget för träningen och kön mot servern. `version` räknas upp vid varje ändring på den
 * här datorn och `acked` är den version som servern senast har tagit emot; är `version` större finns något att skicka.
 */
export interface SavedState extends MastermindState {
  readonly version: number;
  readonly acked: number;
}

export const EMPTY_SAVED: SavedState = { settings: DEFAULT_SETTINGS, games: [], names: {}, version: 0, acked: 0 };

/** Ett namn från den första versionen (utan tid): äldre än allt som skrivs sedan. */
const LONG_AGO = "1970-01-01T00:00:00.000Z";
const validInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/**
 * Läser sparat läge; trasiga delar hoppas över i stället för att hela läget går förlorat. Den första versionen (spel utan id,
 * namn utan tid och en lista över avslutade spel) läses också: spelen får id och skickas till servern; listan över avslutade
 * spel saknar mönster och gissningar och tas inte med.
 */
export function parseSavedState(text: string | null | undefined, newId: () => string = () => crypto.randomUUID()): SavedState {
  if (!text) return EMPTY_SAVED;
  let data: unknown;
  try { data = JSON.parse(text); } catch { return EMPTY_SAVED; }
  if (!data || typeof data !== "object") return EMPTY_SAVED;
  const record = data as Record<string, unknown>;
  const seen = new Set<string>();
  const games = (Array.isArray(record.games) ? record.games : []).flatMap((item): CardGame[] => {
    const game = normalizeGame(item, newId);
    if (!game || seen.has(game.id)) return [];
    seen.add(game.id);
    return [game];
  });
  const names: Record<string, { name: string; at: string }> = {};
  if (record.names && typeof record.names === "object") {
    for (const [card, entry] of Object.entries(record.names as Record<string, unknown>)) {
      if (!/^[1-9][0-9]{0,7}$/.test(card)) continue;
      if (typeof entry === "string") names[card] = { name: entry, at: LONG_AGO };
      else if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string"
        && validInstant((entry as Record<string, unknown>).at)) {
        names[card] = { name: (entry as { name: string }).name, at: (entry as { at: string }).at };
      }
    }
  }
  const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
  const acked = count(record.acked) ?? 0;
  // Den första versionen hade ingen kö: finns något sparat ska det skickas.
  const version = Math.max(count(record.version) ?? (games.length > 0 || Object.keys(names).length > 0 ? 1 : 0), acked);
  return { settings: readSettings(record.settings) ?? DEFAULT_SETTINGS, ...(validInstant(record.settingsAt) ? { settingsAt: record.settingsAt } : {}),
    games, names, version, acked };
}

/** Spelet in i listan: ersätter spelet med samma id, annars sist. */
export function upsertGame(games: readonly CardGame[], game: CardGame): CardGame[] {
  const index = games.findIndex((item) => item.id === game.id);
  return index < 0 ? [...games, game] : games.map((item, i) => i === index ? game : item);
}
