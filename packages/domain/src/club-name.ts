/**
 * Användartest 2026-11-12: "OK Test" och "ok test" blev två klubbar i resultatens klubbvyer. En klubb som skrivs för hand
 * och bara skiljer i skiftläge eller blanksteg från en klubb som redan finns i tävlingen får den befintliga stavningen
 * (den vanligaste, vid lika den först i bokstavsordning). Befintliga data ändras inte.
 */
const clubKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");

export function existingClubSpelling(name: string, existing: readonly (string | null | undefined)[]): string {
  const key = clubKey(name);
  if (!key) return name.trim();
  const counts = new Map<string, number>();
  for (const candidate of existing) if (candidate && clubKey(candidate) === key) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "sv"));
  return best ? best[0] : name.trim();
}
