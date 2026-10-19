/**
 * Ranking från fil för seedningen i lottningen (PLAN.md steg 26). En CSV-fil (semikolon, komma eller tabb) med
 * placering och namn, gärna klubb och bricka. Första raden får vara rubriker (Placering/Rank, Namn/Name, Förnamn,
 * Efternamn, Klubb/Club, Bricka/SI/Card); utan rubriker läses kolumnerna som placering, namn, klubb, bricka.
 * Löparna matchas på bricka och annars på namn (och klubb när den finns). Namn som passar flera löpare matchas inte.
 */
export type SeedRankingEntry = { id: string; name: string; club: string | null; card: string | null };
export type SeedRankingRow = { line: number; rank: number; name: string; club: string | null; card: string | null };
export type SeedRankingResult = {
  /** Löparens id → placering. */
  ranks: Map<string, number>;
  /** Rader som inte kunde läsas eller inte matchade någon (eller flera) löpare. */
  unmatched: { line: number; text: string }[];
};

const HEADERS: Record<string, "rank" | "name" | "given" | "family" | "club" | "card"> = {
  placering: "rank", plac: "rank", rank: "rank", ranking: "rank", position: "rank", pos: "rank", seed: "rank", seedning: "rank",
  namn: "name", name: "name", löpare: "name", förnamn: "given", given: "given", firstname: "given", efternamn: "family", family: "family",
  lastname: "family", surname: "family", klubb: "club", club: "club", organisation: "club", förening: "club",
  bricka: "card", si: "card", "si-nr": "card", sinr: "card", card: "card", "bricknummer": "card"
};

const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("sv-SE");

function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (quoted) {
      if (character === "\"" && line[index + 1] === "\"") { cell += "\""; index += 1; }
      else if (character === "\"") quoted = false;
      else cell += character;
    } else if (character === "\"" && cell.trim() === "") { quoted = true; cell = ""; }
    else if (character === separator) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

/** Läser filens rader. Rader utan giltig placering eller namn hamnar i `invalid`. */
export function parseSeedRanking(text: string): { rows: SeedRankingRow[]; invalid: { line: number; text: string }[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const firstLine = lines.find(line => line.trim() !== "") ?? "";
  const separator = [";", "\t", ","].map(candidate => [candidate, firstLine.split(candidate).length] as const)
    .sort((a, b) => b[1] - a[1])[0]![0];
  const firstCells = splitLine(firstLine, separator).map(cell => HEADERS[normalize(cell)]);
  const hasHeader = firstCells.some(Boolean);
  const columns: readonly (string | undefined)[] = hasHeader ? firstCells : ["rank", "name", "club", "card"];
  const index = (key: "rank" | "name" | "given" | "family" | "club" | "card") => columns.indexOf(key);
  const rows: SeedRankingRow[] = [], invalid: { line: number; text: string }[] = [];
  let headerSkipped = !hasHeader;
  lines.forEach((line, position) => {
    if (line.trim() === "") return;
    if (!headerSkipped) { headerSkipped = true; return; }
    const cells = splitLine(line, separator);
    const cell = (key: Parameters<typeof index>[0]) => index(key) < 0 ? "" : cells[index(key)] ?? "";
    const rankText = cell("rank").replace(/\.$/, "");
    const name = cell("name") || [cell("given"), cell("family")].filter(Boolean).join(" ");
    const rank = Number(rankText);
    if (!/^\d+$/.test(rankText) || rank < 1 || rank > 10_000 || name.trim() === "" && cell("card") === "") {
      invalid.push({ line: position + 1, text: line.trim().slice(0, 120) });
      return;
    }
    rows.push({ line: position + 1, rank, name: name.trim(), club: cell("club") || null, card: cell("card").replace(/\s/g, "") || null });
  });
  return { rows, invalid };
}

/** Matchar raderna mot tävlingens löpare: bricka först, annars namn (och klubb om raden har en). */
export function matchSeedRanking(text: string, entries: readonly SeedRankingEntry[]): SeedRankingResult {
  const { rows, invalid } = parseSeedRanking(text);
  const byCard = new Map<string, SeedRankingEntry[]>();
  const byName = new Map<string, SeedRankingEntry[]>();
  for (const entry of entries) {
    if (entry.card) byCard.set(entry.card, [...byCard.get(entry.card) ?? [], entry]);
    byName.set(normalize(entry.name), [...byName.get(normalize(entry.name)) ?? [], entry]);
  }
  const ranks = new Map<string, number>();
  const unmatched = [...invalid];
  for (const row of rows) {
    let candidates = row.card ? byCard.get(row.card) ?? [] : [];
    if (candidates.length !== 1) {
      candidates = byName.get(normalize(row.name)) ?? [];
      if (row.club && candidates.length > 1) candidates = candidates.filter(entry => entry.club && normalize(entry.club) === normalize(row.club!));
    }
    if (candidates.length !== 1) { unmatched.push({ line: row.line, text: [row.rank, row.name, row.club, row.card].filter(Boolean).join(" ") }); continue; }
    const entry = candidates[0]!;
    // Står löparen flera gånger i filen gäller den bästa placeringen.
    ranks.set(entry.id, Math.min(ranks.get(entry.id) ?? Number.MAX_SAFE_INTEGER, row.rank));
  }
  return { ranks, unmatched: unmatched.sort((a, b) => a.line - b.line) };
}
