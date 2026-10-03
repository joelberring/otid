const FAVORITES_LIMIT = 50;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const publicResultFavoritesStorageKey = "otid:public-result-favorites:v1";

export interface PublicResultFavorite {
  raceId: string;
  publicResultId: string;
}

function isFavorite(value: unknown): value is PublicResultFavorite {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.raceId === "string" && typeof candidate.publicResultId === "string" &&
    uuidPattern.test(candidate.raceId) && uuidPattern.test(candidate.publicResultId);
}

function normalized(favorites: readonly PublicResultFavorite[]): PublicResultFavorite[] {
  const seen = new Set<string>();
  return favorites.filter((favorite) => {
    const key = `${favorite.raceId}:${favorite.publicResultId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, FAVORITES_LIMIT);
}

export function parsePublicResultFavorites(value: string | null): PublicResultFavorite[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? normalized(parsed.filter(isFavorite)) : [];
  } catch {
    return [];
  }
}

export function togglePublicResultFavorite(
  favorites: readonly PublicResultFavorite[],
  favorite: PublicResultFavorite
): PublicResultFavorite[] {
  if (!isFavorite(favorite)) return normalized(favorites);
  const key = `${favorite.raceId}:${favorite.publicResultId}`;
  const current = normalized(favorites);
  return current.some((item) => `${item.raceId}:${item.publicResultId}` === key)
    ? current.filter((item) => `${item.raceId}:${item.publicResultId}` !== key)
    : normalized([...current, favorite]);
}

export function hasPublicResultFavorite(
  favorites: readonly PublicResultFavorite[], raceId: string, publicResultId: string
): boolean {
  return normalized(favorites).some((item) => item.raceId === raceId && item.publicResultId === publicResultId);
}
