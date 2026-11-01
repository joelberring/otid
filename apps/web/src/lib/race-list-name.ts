/**
 * Ett lopp i listan över ett evenemangs lopp (Mina tävlingar). Loppets namn är valfritt; saknas det och evenemanget har
 * flera lopp skiljs de åt med "Lopp N" efter datumordningen (bara i den här listan, inget sparas). Ett ensamt lopp utan
 * namn ger undefined: då visar listan datumet.
 */
type Race = { raceId: string; raceName: string; raceDate: string };

export function raceListName(race: Race, races: readonly Race[], numbered: (n: number) => string): string | undefined {
  const name = race.raceName.trim();
  if (name) return name;
  if (races.length < 2) return undefined;
  const ordered = [...races].sort((left, right) => left.raceDate.localeCompare(right.raceDate) || left.raceId.localeCompare(right.raceId));
  return numbered(ordered.findIndex(other => other.raceId === race.raceId) + 1);
}
