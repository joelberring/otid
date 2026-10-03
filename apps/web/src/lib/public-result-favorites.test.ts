import { describe, expect, it } from "vitest";
import {
  hasPublicResultFavorite,
  parsePublicResultFavorites,
  togglePublicResultFavorite
} from "./public-result-favorites";

const raceId = "10000000-0000-4000-8000-000000000001";
const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";

describe("public result favorites", () => {
  it("parses only deduplicated opaque race-scoped public identities", () => {
    expect(parsePublicResultFavorites(JSON.stringify([
      { raceId, publicResultId: first }, { raceId, publicResultId: first },
      { raceId, publicResultId: "entry-id-is-not-a-public-id" }, { givenName: "Ada" }
    ]))).toEqual([{ raceId, publicResultId: first }]);
    expect(parsePublicResultFavorites("not json")).toEqual([]);
  });

  it("adds, removes and keeps favorites scoped to their race", () => {
    const favorite = { raceId, publicResultId: first };
    const added = togglePublicResultFavorite([], favorite);
    expect(hasPublicResultFavorite(added, raceId, first)).toBe(true);
    expect(hasPublicResultFavorite(added, "30000000-0000-4000-8000-000000000001", first)).toBe(false);
    expect(togglePublicResultFavorite(added, favorite)).toEqual([]);
    expect(togglePublicResultFavorite(added, { raceId, publicResultId: second })).toHaveLength(2);
  });
});
